# Notas Rápidas (Inbox pessoal) — Design

**Data**: 2026-08-07
**Status**: Aprovado, aguardando plano de implementação

## Contexto e problema

O usuário faz anotações rápidas de demandas do dia a dia (frequentemente durante calls com clientes, ou lembretes soltos) que ainda não têm destino definido. Hoje, se a demanda já é claramente de um cliente específico, ele cria a tarefa direto no Kanban daquele cliente. A lacuna é para anotações que:

- Ainda não têm destino decidido (pode virar tarefa de cliente, compromisso na Agenda, ou só precisa ser lembrado e resolvido sem gerar nada em outro módulo);
- Precisam de um lugar rápido para capturar sem quebrar o fluxo atual (ex.: no meio de uma call);
- Têm duas urgências distintas: coisas que **não podem ser esquecidas no mesmo dia**, e coisas que **vão para o projeto para serem resolvidas depois**.

## Objetivo

Um "bloco de notas" pessoal, acessível de qualquer tela do app, para capturar essas anotações e, quando o usuário quiser, "destinar" cada uma para o lugar certo (Tarefa, Agenda, ou apenas marcar como resolvida) — com um sistema de lembrete que não deixa itens marcados como "Hoje" passarem despercebidos.

## Escopo

- Novo recurso pessoal, isolado por usuário (RLS por `user_id`, mesmo padrão do restante do app).
- Disponível para papéis `consultant` e `manager`. **Nunca** para o Portal do Cliente (`role = 'client'`).
- **Bloqueado em Modo Supervisão** (quando um Gerente está visualizando os dados de outro consultor) — são notas pessoais do próprio usuário logado, sem relação com o consultor supervisionado; a interação continua bloqueada pelo mesmo Proxy-guard de escrita já existente (Fase 49), e o botão de acesso fica oculto nesse modo.
- Fora de escopo (YAGNI, não implementar nesta fase): anexos nas notas, compartilhamento entre usuários, intervalo do lembrete configurável por usuário, testes automatizados Playwright dedicados.

## Modelo de dados

Nova tabela `quick_notes`:

| Campo | Tipo | Observações |
|---|---|---|
| `id` | uuid PK, default `gen_random_uuid()` | |
| `user_id` | uuid, `references auth.users on delete cascade`, not null | dono da nota |
| `text` | text, not null | conteúdo livre digitado na captura |
| `client_id` | uuid, `references clients on delete set null`, nullable | cliente sugerido no momento da captura (opcional) |
| `suggested_date` | date, nullable | data sugerida no momento da captura (opcional) |
| `is_today` | boolean, default `false` | flag "não posso esquecer hoje"; pode ser marcada na captura e reclassificada depois, na triagem |
| `status` | text, default `'pending'` | `'pending'` \| `'resolved'` |
| `resolution_type` | text, nullable | `'task'` \| `'agenda'` \| `'dismissed'`; preenchido só quando `status = 'resolved'` |
| `resolved_task_id` | uuid, `references tasks on delete set null`, nullable | preenchido quando `resolution_type = 'task'` |
| `resolved_event_id` | uuid, `references agenda_events on delete set null`, nullable | preenchido quando `resolution_type = 'agenda'` |
| `created_at` | timestamptz, default `now()` | |
| `resolved_at` | timestamptz, nullable | preenchido ao resolver |

RLS: `ENABLE ROW LEVEL SECURITY` + policy única `users_own_quick_notes FOR ALL USING (auth.uid() = user_id)` — sem policy cross-role (nem manager, nem client têm acesso a notas de outro usuário).

`client_id`/`resolved_task_id`/`resolved_event_id` usam `ON DELETE SET NULL`: se o cliente, a tarefa ou o evento gerado forem excluídos depois, a nota não quebra — só perde a referência.

## Store (`js/store.js`)

Métodos novos, seguindo a convenção existente (`get*` = leitura liberada mesmo sob Proxy-guard; os demais são escrita e ficam bloqueados em Modo Supervisão):

- `getQuickNotes()` — busca todas as notas do usuário (pendentes + resolvidas), mapeadas via um `_quickNote()` (camelCase).
- `addQuickNote({ text, clientId, suggestedDate, isToday })` — insere com `status: 'pending'`.
- `updateQuickNote(id, patch)` — usado tanto para edição de texto/cliente/data/`isToday` de uma nota pendente quanto para resolver (`patch` inclui `status: 'resolved', resolutionType, resolvedTaskId|resolvedEventId, resolvedAt`).
- `deleteQuickNote(id)` — exclusão definitiva (usada tanto para remover uma nota pendente por engano quanto, futuramente, para limpar histórico antigo, se necessário).

Não há necessidade de um método de leitura filtrado por período — a lista é pequena por natureza (fluxo de captura pessoal) e o cache local cobre o volume esperado.

## UI/UX

### Botão flutuante (FAB)

- Fixo no canto inferior direito, presente em todas as views (exceto Portal do Cliente e Modo Supervisão).
- Ícone de nota adesiva (Lucide, ex. `notebook-pen` ou `sticky-note`).
- Badge numérico com a contagem de notas `pending`.
- Quando existe ao menos uma nota `pending` com `is_today = true`, o badge assume uma variante vermelha com animação de pulso contínuo (respeitando `prefers-reduced-motion`, mesmo padrão já usado em `.notif-badge`/`.stat-card.over-limit`).
- Novo token de z-index dedicado (`--z-fab`), coerente com a escala semântica já documentada em `:root`.

### Painel (abre por cima da tela atual, sem navegação)

**Topo — captura rápida**: textarea (texto livre), select de cliente (opcional, mesma lista usada em outros selects de cliente do app), input de data (opcional), checkbox "Hoje", botão Salvar. Pensado para ser preenchido em poucos segundos.

**Lista de pendentes**: itens com `is_today = true` aparecem primeiro (borda vermelha de destaque). Cada linha mostra o texto, cliente/data se preenchidos, e:
- Um toggle inline para marcar/desmarcar "Hoje" (reclassificação na triagem, sem precisar editar mais nada).
- Clique no texto abre edição inline do conteúdo (mesmo padrão já usado na edição inline de data do preview de Agendamento Automático) — sem modal próprio.
- Três ações de triagem: **Virar Tarefa**, **Virar Compromisso**, **Marcar como resolvida** (lembrete puro, sem gerar nada em outro módulo).
- Ação de excluir (usa o padrão `_twostepDelete()` já padronizado no app, nunca `window.confirm()`).

**Aba Histórico**: lista notas com `status = 'resolved'`, com um selo indicando `resolution_type` e, quando `resolved_task_id`/`resolved_event_id` existir, um link clicável que abre a tarefa (`handleEditTask`) ou o evento (`editAgendaEvent`) gerado.

### Fluxo de triagem

- **Virar Tarefa**: abre o modal normal de Tarefa (`modal-task`) pré-preenchido (título/descrição a partir do texto da nota; cliente pré-selecionado se a nota já tinha `client_id`). O usuário revisa/ajusta coluna, prioridade etc. normalmente antes de salvar. Estado transiente `this._triagingNoteId` (mesmo padrão de outros IDs transientes do `AppController`) guarda qual nota está sendo destinada; ao salvar com sucesso em `handleTaskSubmit`, se `_triagingNoteId` estiver setado, chama `store.updateQuickNote(id, { status:'resolved', resolutionType:'task', resolvedTaskId: novaTarefa.id, resolvedAt: now })` e limpa o estado.
- **Virar Compromisso**: mesmo padrão, abrindo `openNewAgendaEvent()` pré-preenchido (título/descrição a partir do texto; data = `suggested_date` da nota se houver, senão hoje; cliente pré-selecionado se houver). Resolve via `handleAgendaSubmit` de forma equivalente.
- **Marcar como resolvida**: chama `store.updateQuickNote(id, { status:'resolved', resolutionType:'dismissed', resolvedAt: now })` direto, sem abrir modal.

Em todos os casos, a nota sai da lista de pendentes imediatamente (atualização otimista do cache local) e passa a aparecer na aba Histórico.

### Aviso persistente para itens "Hoje"

- O badge pulsante do FAB já é o aviso "sempre visível", em qualquer tela.
- Adicionalmente, um modal de aviso reaparece a cada 60 minutos enquanto existir ao menos uma nota `pending` com `is_today = true` — implementado com `setInterval` (mesmo padrão do sync periódico do Google Calendar: `_quickNotesReminderInterval`, iniciado em `initAfterAuth()`, limpo no logout). O modal lista as notas "Hoje" pendentes com um atalho para abrir o painel já na lista (sem filtro adicional necessário, pois "Hoje" já aparece primeiro). Fechar o modal não resolve nada — o próximo ciclo de 60 min reavalia se ainda há pendências antes de mostrar de novo.

## Cache e performance

- `AppController._quickNotesCache`: populado uma única vez em `initAfterAuth()` via `store.getQuickNotes()` (necessário já no login para calcular o contador do badge e decidir se o lembrete periódico deve iniciar).
- Todas as mutações (capturar, editar, reclassificar "Hoje", resolver, excluir) atualizam o cache localmente (padrão otimista já usado em Kanban/Agenda) — sem novo round-trip ao banco para re-renderizar o painel ou o badge.
- Cache é invalidado (`= null`, força reload) apenas no logout.

## Casos de borda

- Cliente/tarefa/evento referenciado por uma nota sendo excluído depois: tratado via `ON DELETE SET NULL` no schema — a nota permanece íntegra, só perde a referência.
- Nota "Hoje" resolvida: desaparece do badge/pulso e do modal periódico imediatamente (o próximo ciclo de 60 min não vai mostrá-la, pois a query de contagem só considera `pending`).
- Edição de texto de nota pendente: inline, sem modal — mesmo padrão de outros pontos de edição inline já existentes no app.

## Fora de escopo desta fase

- Anexos nas notas.
- Compartilhamento de notas entre usuários.
- Intervalo do lembrete periódico configurável por usuário (fixo em 60 min).
- Suite de testes automatizados Playwright dedicada — validação será manual após a implementação (login → capturar → triar → confirmar que o badge zera → confirmar item no histórico com link correto).
