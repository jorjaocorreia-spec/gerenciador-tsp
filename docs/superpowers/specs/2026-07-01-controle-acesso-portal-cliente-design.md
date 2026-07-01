# Controle de Acesso por Níveis de Usuário (Portal do Cliente)

**Status**: aprovado, aguardando plano de implementação
**Data**: 2026-07-01

## Objetivo

Fechar o cadastro livre do GerenciadorTSP e introduzir dois papéis de usuário:
- **`consultant`** — acesso total (comportamento atual, inalterado).
- **`client`** — usuário vinculado a exatamente um `client_id`, com acesso somente-leitura à view Tarefas (Kanban) filtrada para aquele cliente. Sem comentar, sem editar, sem ver nenhuma outra view/tabela.

Motivação: permitir que clientes finais acompanhem o andamento das próprias tarefas sem dar acesso ao restante do sistema (outros clientes, financeiro, chamados, etc.).

## Decisões já fechadas (não reabrir sem motivo forte)

1. Clientes apenas visualizam tarefas — sem comentar, sem editar, sem drag-and-drop.
2. Seção de comentários do modal de tarefa é ocultada por completo para o papel `client` (não só o campo de envio) — evita expor conversa interna do consultor.
3. Haverá um painel admin dentro do próprio app (view "Usuários", só visível para `consultant`) para convidar/listar/remover usuários.
4. Cada usuário-cliente é vinculado a exatamente um `client_id`; múltiplos usuários podem apontar para o mesmo `client_id` (vários contatos da mesma empresa-cliente).
5. RLS cross-user (não Edge Function como intermediária de leitura) é o mecanismo de acesso do cliente às tarefas — mais simples e correto do ponto de vista de segurança em banco.
6. Bootstrap dos consultores atuais via migration SQL manual (uma vez); depois disso, todo novo usuário só entra via convite.
7. Convite usa o e-mail nativo do Supabase (`auth.admin.inviteUserByEmail`), não senha temporária manual.
8. Revogação de acesso deleta a role **e** o usuário do Supabase Auth (não deixa login "zumbi" sem role).

## 1. Modelo de dados e RLS

```sql
CREATE TABLE user_roles (
  user_id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('consultant', 'client')),
  client_id UUID REFERENCES clients ON DELETE CASCADE,
  invited_by UUID REFERENCES auth.users,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_own_role" ON user_roles
  FOR SELECT USING (auth.uid() = user_id);
-- Sem policy de INSERT/UPDATE/DELETE para o browser: gerenciamento de roles
-- só acontece via Edge Function `manage-users` com service role.

CREATE POLICY "clients_read_own_tasks" ON tasks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'client' AND ur.client_id = tasks.client_id
    )
  );

CREATE POLICY "clients_read_own_columns" ON kanban_columns
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'client' AND ur.client_id = kanban_columns.client_id
    )
  );
```

Notas:
- `client_id` é `NULL` para consultores, obrigatório para clientes (validado na Edge Function, não no banco — mesmo padrão de outras validações do app que ficam só no JS/proxy).
- Nenhuma outra tabela (`clients`, `records`, `agenda_events`, `apontamentos`, `implementations`, `tickets`, etc.) recebe policy para o papel `client` — permanecem bloqueadas por padrão.
- Tarefas sem `client_id` (órfãs — caso já documentado no projeto) nunca aparecem para nenhum usuário-cliente: `NULL = NULL` é `NULL` (falso) em SQL, então a policy nunca casa.
- `ON DELETE CASCADE` em `client_id` remove a role automaticamente se o cliente (empresa) for excluído.

## 2. Bootstrap e fluxo de convite

**Bootstrap (migration manual, uma vez, antes de desabilitar signup):**
```sql
INSERT INTO user_roles (user_id, role)
SELECT id, 'consultant' FROM auth.users
WHERE email IN ('jorjaocorreia@gmail.com' /*, demais consultores atuais */);
```

**Desabilitar signup público** (passo manual, não scriptável): Supabase Dashboard → Authentication → Providers → Email → "Allow new users to sign up" = OFF. A aba "Criar Conta" é removida de `auth.js`/`index.html` (não faz sentido manter UI para um fluxo desligado no backend).

**Edge Function `manage-users`** (`supabase/functions/manage-users/index.ts`), seguindo o padrão de `otobo-proxy`/`ai-proxy`/`whatsapp-bot`:
- Autenticação: JWT do chamador no header `Authorization: Bearer`; a function verifica via client autenticado que o `auth.uid()` correspondente tem `role = 'consultant'` em `user_roles` (senão, 403). Usa `SUPABASE_SERVICE_ROLE_KEY` internamente para as operações administrativas.
- `action: 'list'` — retorna todas as linhas de `user_roles` com e-mail (via `admin.listUsers`/`getUserById`) e nome do cliente vinculado (join em `clients`).
- `action: 'invite'` — body `{ email, role, clientId }`. Se `role === 'client'` e `clientId` ausente, erro 400. Chama `supabaseAdmin.auth.admin.inviteUserByEmail(email)`, depois insere `user_roles (user_id, role, client_id, invited_by: auth.uid())`.
- `action: 'revoke'` — body `{ userId }`. Deleta a linha de `user_roles` e chama `supabaseAdmin.auth.admin.deleteUser(userId)`.
- Deploy: `npx supabase@latest functions deploy manage-users --project-ref klimkamnydfnzqetqlqm` (mantém verificação JWT do gateway — diferente do WhatsApp bot, que precisa de `--no-verify-jwt` por não vir de um usuário logado; aqui todo chamador é um usuário real da app).

**E-mail de convite**: template padrão "Invite user" do Supabase (customizável em Dashboard → Authentication → Email Templates). Usuário clica, define senha, é redirecionado à app já autenticado.

## 3. Mudanças no app

### a) Resolução de papel no login
`store.getUserRole()` — query única: `user_roles.select('role, client_id').eq('user_id', this.userId).single()`. Chamada no início de `initAfterAuth()`:
- **Sem linha** → `Auth.signOut()` + mensagem "Seu acesso ainda não foi configurado. Contate o consultor responsável." (rede de segurança; não deveria ocorrer com signup fechado).
- **`consultant`** → fluxo atual inalterado + novo item "Usuários" no sidebar.
- **`client`** → `enterClientPortalMode(clientId)`.

### b) Modo portal do cliente
- Sidebar reduzida via JS: esconde todos os `nav-item` exceto `data-view="tasks"`; esconde todos os botões de `sidebar-bottom` exceto Logout.
- Força `switchView('tasks')`; demais views ficam inacessíveis (itens de menu com `display:none`, não apenas classe de estado).
- `store.getClientPortalTasks(clientId)` — query **sem** `.eq('user_id', ...)`, só `.eq('client_id', clientId)`; a RLS cross-user já restringe o resultado ao consultor dono. Mesmo padrão para `getClientPortalColumns(clientId)`.
- Board Kanban em modo leitura: sem quick-add, sem listeners de drag-and-drop, sem "Gerenciar Colunas", sem seletor de cliente (fixo no `clientId` da role).
- Clique no card abre `modal-task` com todos os inputs `disabled`, botões Salvar/Excluir/Anexar removidos, seção de comentários oculta por completo. Checklist, anexos, prioridade, prazo e labels continuam visíveis (leitura).

### c) View "Usuários" (só consultor)
- Novo `nav-item` (ícone `users`), `data-view="users"`.
- `renderUsers()` chama `manage-users?action=list`; tabela com e-mail, papel, cliente vinculado, convidado por/quando; botão "Remover acesso" por linha usando `_twostepDelete` (nunca `window.confirm`), que chama `action=revoke`.
- Botão "+ Convidar" abre modal: e-mail, select papel (Consultor/Cliente), select cliente (habilitado/obrigatório só se papel = Cliente) → `action=invite`.
- Chamadas usam JWT da sessão atual, mesmo padrão de `aiClient.complete()`.

## 4. Edge cases

- Usuário autenticado sem linha em `user_roles` (deletado por fora, corrida entre convite e primeira query) → logout automático com mensagem clara.
- Não-consultor tentando `action=list`/`action=invite`/`action=revoke` → 403 no backend (defesa real; a UI apenas não mostra o menu).
- Cliente vinculado a um `client_id` excluído → `CASCADE` remove a role; próximo login cai no caso "sem role".
- Tarefas órfãs (sem `client_id`) nunca aparecem para nenhum cliente.

## 5. Migrations SQL (resumo, ordem de execução)

```sql
-- 1. Tabela + RLS
CREATE TABLE user_roles (...);
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_own_role" ...;
CREATE POLICY "clients_read_own_tasks" ON tasks ...;
CREATE POLICY "clients_read_own_columns" ON kanban_columns ...;

-- 2. Bootstrap dos consultores atuais
INSERT INTO user_roles (user_id, role) SELECT id, 'consultant' FROM auth.users WHERE email IN (...);
```
Depois: desabilitar signup no Dashboard (manual) + deploy da Edge Function `manage-users`.

## 6. Plano de testes (Playwright — suíte existente + novos casos)

1. Consultor existente continua funcionando normalmente (regressão completa da suíte de 48 testes).
2. Login como cliente cai direto em Tarefas, sidebar reduzida; outras views inacessíveis mesmo manipulando o DOM/URL.
3. Cliente vê só tarefas do seu `client_id`; tarefas de outros clientes não aparecem mesmo via `page.evaluate` fazendo query direta (valida RLS, não só UI).
4. Cliente não consegue drag-and-drop nem editar/excluir/comentar — tentativa via `page.evaluate` chamando `store.updateTask` deve falhar por RLS.
5. Consultor convida cliente → linha aparece em "Usuários" → consultor remove acesso → login subsequente do e-mail removido falha.

## Itens fora de escopo (YAGNI, não implementar agora)

- Downgrade parcial de acesso (ex.: "pausar" sem deletar) — só existe convite e revogação total.
- Múltiplos `client_id` por usuário-cliente — decisão fechada é 1:1 (usuário → 1 cliente).
- Edição/comentário do cliente nas tarefas — somente leitura, sem exceções.
- Dashboard/resumo simplificado para o cliente — só o Kanban de Tarefas.
