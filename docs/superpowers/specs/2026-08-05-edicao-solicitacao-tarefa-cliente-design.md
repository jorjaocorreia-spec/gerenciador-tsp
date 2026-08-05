# Edição de Solicitação de Tarefa pelo Cliente (Portal do Cliente)

**Data**: 2026-08-05
**Status**: Aprovado para planejamento

## Contexto

A feature de Solicitações de Tarefa pelo Cliente (spec [2026-08-05-solicitacoes-cliente-tarefas-design.md](2026-08-05-solicitacoes-cliente-tarefas-design.md)) permite ao cliente do Portal propor uma tarefa (título/descrição/anexos) que fica pendente até o consultor aprovar ou rejeitar. Depois de enviada, não havia nenhuma forma de o cliente corrigir a solicitação — um título digitado errado, uma descrição incompleta ou um anexo esquecido ficavam presos até o consultor decidir, sem chance de correção. Esta extensão adiciona edição enquanto a solicitação está `pending`.

## Escopo

Editar fica disponível **somente enquanto `approval_status='pending'`**. Uma solicitação `approved` já virou uma tarefa real no board do consultor — editá-la passa a ser controlada por ele, como qualquer outra tarefa (fora do escopo desta extensão). Uma solicitação `rejected` não pode ser editada/reenviada nesta versão — decisão deliberada para manter o escopo pequeno; se necessário no futuro, é uma extensão natural sobre o mesmo modelo.

## Segurança (RLS + trigger)

Mesmo padrão de defesa em profundidade já estabelecido no projeto para este fluxo (`enforce_client_task_position_only`, Fase 45; `enforce_client_task_request_insert`, feature de solicitações):

1. **Policy de UPDATE** `clients_update_own_pending_task_requests` em `tasks`: libera `UPDATE` para o papel `client` cujo `user_roles.client_id` bate com o `client_id` da linha.
2. **Trigger `BEFORE UPDATE`** `enforce_client_task_request_update`: quando quem edita tem papel `client`, só permite a alteração se `OLD.approval_status = 'pending'` — caso contrário, reconstrói `NEW` inteiramente a partir de `OLD` (no-op total, a tentativa de edição é silenciosamente descartada pelo banco). Quando `OLD.approval_status = 'pending'`, só `title`, `description` e `attachments` passam do valor enviado; todos os demais campos (incluindo uma tentativa de o próprio cliente setar `approval_status='approved'`) são reconstruídos de `OLD`. Mesmo cuidado de `SET search_path = public, pg_temp` desde a criação.

Isso garante que, mesmo com uma chamada direta à API REST usando o JWT do cliente, seja impossível editar uma solicitação já decidida ou alterar qualquer campo além dos três permitidos.

## `store.js`

Novo método de escrita:

```js
async updateTaskRequest(id, { title, description, attachments })   // UPDATE — client_id/user_id não mudam
```

Segue a mesma convenção de nomenclatura do guard de Modo Supervisão (não começa com `get`/`_`) — bloqueado automaticamente pelo Proxy quando `isManagerView===true` (irrelevante na prática, já que só o próprio cliente edita a própria solicitação, mas mantém a convenção).

## UI

- Em "Minhas Solicitações", o card de uma solicitação com selo **Pendente** fica clicável (`tabindex="0" role="button"`, mesmo padrão de acessibilidade de cards clicáveis já usado no restante do app — Kanban, Implementações, Treinamentos). Cards **Aprovada**/**Rejeitada** continuam estáticos, sem indicação de clique.
- Clicar abre o mesmo modal `#modal-new-task-request`, agora pré-preenchido (`request-title`, `request-description`, `_requestAttachments` carregados do item já em cache), com:
  - Título do modal: "Editar Solicitação" (em vez de "Nova Solicitação")
  - Texto do botão: "Salvar Alterações" (em vez de "Enviar Solicitação")
- Novo estado `this._editingRequestId` (`string|null`) em `AppController`, resetado ao fechar o modal e ao abrir em modo criação. `handleTaskRequestSubmit()` passa a decidir entre `store.submitTaskRequest(...)` (criação) e `store.updateTaskRequest(this._editingRequestId, {...})` (edição) com base nesse estado.
- Reaproveita integralmente a infraestrutura de anexos já existente (`_requestAttachments`, `_renderRequestAttachmentPreviews`, `removeRequestAttachment`, `_openRequestAttachmentLightbox`) — o usuário pode remover anexos antigos e adicionar novos livremente antes de salvar.

## Fora de escopo (YAGNI)

- Editar/reenviar uma solicitação rejeitada.
- Cancelar/excluir uma solicitação pendente sem editá-la (não foi pedido).
- Qualquer indicação ao consultor de que uma solicitação foi editada (ex.: "editada em"). O consultor só vê o conteúdo atual quando abre o modal de pendências, como já acontece hoje.
