# Solicitações de Tarefa pelo Cliente (Portal do Cliente)

**Data**: 2026-08-05
**Status**: Aprovado para planejamento

## Contexto

O Portal do Cliente (Fase 45) já permite ao cliente visualizar o Kanban do próprio projeto em modo somente-leitura, com reordenação de cards liberada (Fase 49, `allowReorder`). Esta feature adiciona a capacidade do cliente **propor** novas tarefas — sem inserir diretamente no board do consultor. As propostas ficam em uma área separada até serem aprovadas ou rejeitadas pelo consultor responsável.

## Modelo de dados

Reaproveita a tabela `tasks` existente — sem tabela nova. Três colunas novas:

| Coluna | Tipo | Default | Descrição |
|---|---|---|---|
| `requested_by_client` | BOOLEAN | `false` | Marca que a tarefa se originou de uma solicitação do Portal do Cliente. Permanece `true` mesmo depois de aprovada, para preservar o histórico na aba "Minhas solicitações". |
| `approval_status` | TEXT | `'approved'` | `'pending'` \| `'approved'` \| `'rejected'`. Tarefas criadas normalmente pelo consultor continuam nascendo `'approved'` — nenhuma mudança de comportamento para o fluxo existente. |
| `rejection_reason` | TEXT | `NULL` | Motivo opcional preenchido pelo consultor ao rejeitar. |

Migration:
```sql
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS requested_by_client BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

ALTER TABLE tasks ALTER COLUMN status DROP NOT NULL;
```

Enquanto `approval_status IN ('pending', 'rejected')`, a coluna `status` (que hoje é o UUID da `kanban_columns` — ver nota "Kanban Fase 22" do CLAUDE.md) fica `NULL`: a tarefa não pertence a nenhuma coluna e não é candidata a aparecer em nenhum board.

### Consumidores que precisam excluir não-aprovadas

Todos os métodos de leitura em lote de `tasks` no `store.js` passam a filtrar `.eq('approval_status', 'approved')`:

- `getTasks()` (board do consultor + busca textual + `_tasksCache`)
- `getTasksByClient(clientId)`
- `getTasksForApontamento(date)` (Gerador de Apontamentos por IA)
- `getClientPortalTasks(clientId)` (board somente-leitura do cliente)

Isso garante que pendências e rejeitadas nunca vazem para board, busca, Indicadores ou o Gerador de Apontamentos, sem precisar alterar cada consumidor individualmente — o filtro vive na fonte.

## Fluxo do cliente (Portal)

### Nova aba "Minhas solicitações"

Ao lado do board Kanban somente-leitura existente, uma nova aba/seção dentro da view Tarefas do portal (mesmo padrão de `switchClientPortalView`, que hoje roteia entre `tasks`/`indicadores`/`records`). Lista **todas** as tarefas com `requested_by_client=true` do cliente, ordenadas por `created_at desc`, com um selo por status:

- 🟡 **Pendente** — aguardando análise do consultor.
- 🟢 **Aprovada** — já entrou no board (o cliente pode ver o card real na aba Kanban).
- 🔴 **Rejeitada** — exibe o `rejection_reason`, se houver.

### Botão "+ Nova solicitação"

Abre um modal simplificado com:
- Título (obrigatório)
- Descrição (opcional)
- Anexos (fotos/documentos) — reaproveita o mecanismo já existente de paste/upload com compressão de imagem via Canvas (`compressImageFile`) e leitura de outros tipos como data URL (mesmo padrão de `task-attachments`/`impl-attachments`). Estado local em `this._requestAttachments` (array `{name, data}`), resetado ao fechar/enviar o modal.

Ao enviar: `store.submitTaskRequest({ title, description, attachments })`. Não há campo de prioridade, prazo, coluna ou cliente no formulário — o cliente do portal é implícito (`this.userClientId`) e os demais campos ficam a critério do consultor na aprovação.

## Fluxo do consultor

### Botão "Pendentes de Aprovação (N)"

No header da view Tarefas, quando há um cliente filtrado (`filter-task-client`) **e** esse cliente tem ao menos uma tarefa com `approval_status='pending'`, um botão com badge numérico aparece ao lado dos botões existentes ("+ Nova Tarefa", "Gerenciar Colunas"). Sem cliente filtrado, ou sem pendências, o botão fica oculto — não há contador agregado global.

### Modal "Pendências de Aprovação"

Ao clicar, abre um modal dedicado (mesmo padrão visual dos demais modais do app) listando as pendências do cliente filtrado:

- Checkbox por linha
- Título, descrição (truncada, expansível), anexos (thumbnails/links), data da solicitação
- Botões **Aprovar** / **Rejeitar** por linha
- Rodapé: **"Aprovar selecionadas"** / **"Rejeitar selecionadas"** (habilitados só com ≥1 checkbox marcado)

**Aprovar** (individual ou em massa):
- `approval_status='approved'`
- `status` = ID da primeira coluna (`position` mais baixa) do board do cliente
- `position` = fim dessa coluna
- `priority='medium'`, sem `due_date`
- `requested_by_client` permanece `true` (preserva o histórico)

O consultor ajusta prioridade/coluna/prazo depois normalmente, arrastando o card ou editando — sem diferença de tratamento em relação a qualquer outra tarefa do board a partir daí.

**Rejeitar** (individual ou em massa):
- `approval_status='rejected'`
- `rejection_reason` = texto de um campo opcional (textarea compartilhada quando em massa, aplicada a todas as selecionadas)
- `status` permanece `NULL` — a tarefa nunca chega a existir no board
- Some da lista de pendentes do consultor; continua visível ao cliente em "Minhas solicitações" com o selo e o motivo

## Segurança (RLS + trigger)

Segue o mesmo padrão de defesa em profundidade já usado no reorder de cards do cliente (Fase 45/49, `clients_reorder_own_tasks` + `enforce_client_task_position_only`):

1. **Policy de INSERT** `clients_insert_own_task_requests` em `tasks`: libera `INSERT` para usuários com `user_roles.role='client'` cujo `user_roles.client_id` bate com o `client_id` da linha sendo inserida.
2. **Trigger `BEFORE INSERT`** `enforce_client_task_request_insert` (com `SET search_path = public, pg_temp`, mesmo cuidado do hardening anterior): quando quem insere tem papel `client`, força server-side:
   - `user_id` = dono real do cliente (`clients.user_id` daquele `client_id`)
   - `requested_by_client = true`
   - `approval_status = 'pending'`
   - `status = NULL`
   - `priority = 'medium'`
   - `labels = '[]'`, `checklist = '[]'`, `due_date = NULL`, `cover_color = NULL`, `hidden_from_client = false`
   - `title`/`description`/`attachments` são os únicos campos que passam do valor enviado pelo cliente

Isso garante que mesmo uma chamada direta à API REST do Supabase com o JWT do cliente (bypassando a UI) não consiga inserir uma tarefa "completa" fora do fluxo de aprovação — só título, descrição e anexos importam.

Aprovar/rejeitar usa as policies de `UPDATE` que o consultor já tem sobre a própria linha (`user_id = auth.uid()`) — nenhuma policy nova necessária para esse lado.

**Modo Supervisão (Gerente)**: `approveTaskRequest`/`rejectTaskRequest`/`submitTaskRequest` são métodos de escrita (não começam com `get`/`_`), então já ficam bloqueados automaticamente pelo Proxy de guard existente quando `store.isManagerView === true` — sem tratamento especial necessário.

## Métodos novos no `store.js`

```js
// Cliente (Portal)
async submitTaskRequest({ title, description, attachments })   // INSERT — client_id = this.userClientId
async getClientTaskRequests(clientId)                           // SELECT requested_by_client=true, qualquer approval_status

// Consultor
async getPendingTaskApprovals(clientId)                         // SELECT approval_status='pending' AND client_id=clientId
async approveTaskRequests(ids)                                  // UPDATE em lote (Promise.all de UPDATEs individuais, mesmo padrão de reorderTasks — nunca upsert)
async rejectTaskRequests(ids, reason)                            // UPDATE em lote
```

`approveTaskRequests`/`rejectTaskRequests` aceitam array (1 elemento cobre o caso individual) — sem duplicar lógica entre ação individual e em massa.

## UI — pontos de entrada novos

- `index.html`: novo modal `modal-new-task-request` (cliente), novo modal `modal-task-approvals` (consultor), nova seção/aba dentro de `view-tasks` para "Minhas solicitações" no portal.
- `js/app.js`: `switchClientPortalView` ganha uma 3ª sub-aba dentro de Tarefas (Kanban / Minhas solicitações) — reaproveita o padrão de toggle já usado por `indicadores`/`records`. Novo estado de instância `this._requestAttachments`.

## Fora de escopo (YAGNI)

- Notificação push/e-mail ao consultor sobre nova pendência — o badge "(N)" no botão já resolve a necessidade descrita; central de notificações (Fase 47) não é acionada por esta feature.
- Edição da solicitação pelo cliente após o envio (cancelar/editar um pedido pendente) — não foi pedido; se necessário, é extensão futura natural sobre o mesmo modelo.
- Prioridade sugerida pelo cliente no formulário — decidido explicitamente que fica a critério do consultor na aprovação.
- Contador agregado de pendências no menu lateral (fora do contexto do cliente filtrado) — decidido explicitamente que o badge só aparece com cliente selecionado.
