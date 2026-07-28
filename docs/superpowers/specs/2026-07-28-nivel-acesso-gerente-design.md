# Nível de Acesso "Gerente" — Design

**Data**: 2026-07-28
**Status**: Aprovado, aguardando plano de implementação

## Contexto

O GerenciadorTSP hoje tem dois papéis (`user_roles.role`): `consultant` (dono pleno de sua carteira de clientes) e `client` (Portal do Cliente, somente leitura restrita a um `client_id`, sem dados financeiros).

É necessário um terceiro papel, **Gerente**, que funcione como supervisor geral: precisa enxergar os projetos, horas, tarefas, agenda e financeiro de **todos os consultores**, sem poder editar nada de outra conta. Importante: o Gerente também é, ele mesmo, um consultor — tem seus próprios clientes/projetos e precisa continuar podendo criar/editar normalmente os seus, sem misturar com os dados que está supervisionando.

## Decisões de escopo

- **Somente leitura** sobre dados de outros consultores — sem edição, sem impersonação de escrita.
- **Financeiro visível** — ao contrário do Portal do Cliente, o Gerente vê valores pagos, comissão e valor/hora de qualquer cliente/consultor.
- **Navegação**: seletor de consultor + reaproveitamento de todas as telas existentes (Dashboard, Clientes, Tarefas, Agenda, Atendimentos, Financeiro, Indicadores, Produtividade, Implementações) em modo leitura — não é um painel agregado à parte.
- **Secrets excluídos**: credenciais de OTOBO (`otobo_config`) e de IA (`user_ai_config`) nunca são expostas ao Gerente, mesmo em modo supervisão.

## 1. Modelo de dados e papéis

- `user_roles.role` passa a aceitar `'manager'` (hoje só `'consultant'`/`'client'`; validação em `supabase/functions/manage-users/index.ts`).
- Um usuário `role='manager'` tem `client_id = null` e opera, por padrão, exatamente como um consultor comum: seus `clients`/`tasks`/`records`/etc. têm `user_id` = o próprio ID, CRUD completo, navegação padrão sem nenhuma diferença visual.
- A capacidade de supervisão é um **modo opcional** ("Modo Supervisão"), ligado/desligado pelo próprio Gerente.

## 2. RLS (Supabase)

Novas policies aditivas, **somente SELECT**, mesmo padrão das policies cross-user já usadas para o papel `client` (Fase 45), mas sem restrição de `client_id` — liberam leitura de qualquer linha, de qualquer `user_id`, para quem tem `role='manager'`:

```sql
CREATE POLICY "managers_read_all_<tabela>" ON <tabela> FOR SELECT
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'manager'));
```

Aplicar em: `clients`, `records`, `tasks`, `kanban_columns`, `agenda_events`, `apontamentos`, `implementations`, `implementation_clients`, `tickets`.

**Excluídas deliberadamente**: `otobo_config` (senha) e `user_ai_config` (API key) — nunca recebem policy de manager.

As policies de escrita (INSERT/UPDATE/DELETE) de todas as tabelas continuam exigindo `auth.uid() = user_id`. Isso significa que, mesmo em modo supervisão, o banco bloqueia qualquer escrita na conta de outro consultor — defesa em profundidade, independente do guard de JS (seção 4).

## 3. Modo Supervisão no frontend

- Botão novo na sidebar, visível só quando `app.userRole === 'manager'`: **"Ver outro consultor"**, abre um modal listando todos os usuários com `role IN ('consultant', 'manager')` exceto o próprio (nova ação em `manage-users` ou query direta, dependendo do que a RLS de `user_roles` permitir).
- Ao selecionar um consultor: `store.userId` é trocado para o ID daquele consultor; `store.realUserId` guarda o ID verdadeiro do Gerente para restaurar depois; `app.isManagerView = true`.
- Como toda `store.js` e todo `render*()` já filtram por `this.userId`, **nenhuma view precisa de código novo de leitura** — Dashboard, Clientes, Tarefas, Agenda, Atendimentos, Financeiro, Indicadores, Produtividade, Implementações renderizam os dados do consultor selecionado automaticamente.
- Barra fixa no topo enquanto o modo está ativo: `"Visualizando: <email> (somente leitura)"` com botões **Trocar** e **Sair**. "Sair" restaura `store.userId = store.realUserId`, zera `isManagerView`, re-renderiza a view atual com os dados do próprio Gerente.
- **Chamados (OTOBO) e botões de IA ficam ocultos/desabilitados em modo supervisão** — a sessão do Supabase Auth nunca muda (continua sendo o JWT do Gerente); só o filtro de `user_id` no JS é trocado. Como a config de OTOBO/IA resolvida pelos proxies usaria a do próprio Gerente (não a do consultor visualizado), a solução mais simples e segura é desabilitar essas ações nesse modo, em vez de simular a config de outra pessoa.

## 4. Bloqueio de escrita (defesa em profundidade no JS)

Guard central envolvendo a instância do `store` (via `Proxy` ou checagem no topo dos métodos mutadores): se `store.isManagerView === true`, qualquer chamada de escrita (`addXxx`, `updateXxx`, `deleteXxx`, `reorderXxx`, `saveXxx`, etc.) lança erro amigável ("Modo de visualização — ação bloqueada") antes de tocar o banco. A lista exata de métodos a proteger deve ser levantada na fase de implementação, lendo `store.js` por completo (não enumerada aqui para evitar lista desatualizada no spec).

## 5. UI: ocultar ações de escrita

Em cada view, botões de criar/editar/excluir e interações de escrita (drag-and-drop do Kanban, drag de eventos da Agenda, etc.) ficam ocultos quando `isManagerView` — estendendo o mesmo padrão `readOnly` que o Kanban do Portal do Cliente já usa (`createKanbanCard(..., readOnly)`) às demais views que hoje não têm esse parâmetro.

## 6. Convite de Gerente

O modal "Usuários" (`renderUsers()`) ganha uma 3ª opção de papel no seletor de convite ("Gerente", ao lado de "Consultor" e "Cliente"). A Edge Function `manage-users` passa a aceitar `role === 'manager'` sem exigir `clientId` (mesma validação hoje aplicada a `consultant`).

## Testes

- **RLS**: um usuário `manager` consegue `SELECT` dados de outro `user_id` em todas as tabelas listadas; não consegue `INSERT`/`UPDATE`/`DELETE` em linhas de outro `user_id`; não consegue `SELECT` `otobo_config`/`user_ai_config` de outro usuário.
- **Frontend**: entrar em modo supervisão, confirmar que ações de escrita estão ocultas/bloqueadas em pelo menos 3 views representativas (Clientes, Tarefas, Agenda); sair do modo e confirmar que os dados e permissões do próprio Gerente permanecem intactos, sem mistura com os dados do consultor visualizado.

## Fora de escopo (YAGNI)

- Edição/impersonação de escrita em nome de outro consultor.
- Painel agregado consolidado de múltiplos consultores (poderá ser um projeto futuro separado).
- Acesso do Gerente a credenciais de OTOBO/IA de outros consultores.
