# Portal do Cliente: reordenar cards de tarefas (define prioridade)

**Data**: 2026-07-26
**Status**: aprovado para planejamento

## Contexto

O Kanban do Portal do Cliente (papel `client` em `user_roles`) hoje é somente leitura:
o cliente vê os cards de tarefas (`_renderKanbanBoard(..., readOnly=true)`) mas não pode
arrastar, editar, concluir ou excluir nada.

A ordem dos cards dentro de cada coluna (`tasks.position`) é hoje definida só pelo
consultor, via drag-and-drop no Kanban normal (`dragStart`/`_handleDrop`/`store.reorderTasks`).
Essa mesma ordem é a que representa a prioridade de execução de cada fila.

O cliente precisa poder definir essa prioridade sozinho, sem depender do consultor para
reordenar. Como a ordem dentro da fila É a prioridade, a reordenação do cliente deve
escrever no mesmo campo `tasks.position` que o consultor usa — não uma ordem paralela.

### Restrição crítica: não pode contar como "tarefa editada hoje"

O Gerador de Apontamentos via IA (`store.getTasksForApontamento(date)`) usa
`t.updatedAt.startsWith(date)` como um dos três critérios de elegibilidade de uma tarefa
para entrar no apontamento automático do consultor (junto com "concluída hoje" e
"comentada hoje"). Se a reordenação do cliente bumpar `updated_at` (como o
`store.reorderTasks` do consultor já faz, de forma deliberada, para reduzir falsos
negativos daquele fluxo), toda tarefa que o cliente apenas reordenar viraria candidata a
apontamento automático sem nenhum trabalho real do consultor ter ocorrido. Isso é
inaceitável — a reordenação do cliente é sinalização de prioridade, não trabalho.

## Comportamento

- No board do Portal do Cliente, a única ação nova habilitada é **arrastar um card para
  cima/baixo dentro da mesma coluna** (mesmo gesto de drag-and-drop que o consultor já usa
  no Kanban normal).
- Tentar soltar o card em **outra coluna** (mudar status) é bloqueado: o drop é ignorado,
  o board volta ao estado salvo, e um toast avisa que só é possível reordenar dentro da
  mesma fila.
- Nenhuma outra ação do Kanban muda: título, descrição, mover entre colunas, marcar
  concluída, excluir, comentar — tudo continua bloqueado para o papel `client` como já é
  hoje.
- A nova ordem é salva de forma otimista (like o Kanban do consultor: atualiza a tela
  antes da confirmação do banco) e passa a valer também na visão do consultor, pois é o
  mesmo campo `tasks.position`.

## Banco de dados

Migration nova (arquivo em `Documentation/` ou `supabase/migrations/`, a definir no plano
de execução):

1. **RLS `UPDATE` em `tasks` para o papel `client`** — nova policy, mesmo padrão das
   policies de leitura cross-user já existentes (Fase 45):
   ```sql
   CREATE POLICY "clients_reorder_own_tasks" ON tasks
     FOR UPDATE
     USING (EXISTS (
       SELECT 1 FROM user_roles
       WHERE user_roles.user_id = auth.uid()
         AND user_roles.role = 'client'
         AND user_roles.client_id = tasks.client_id
     ))
     WITH CHECK (EXISTS (
       SELECT 1 FROM user_roles
       WHERE user_roles.user_id = auth.uid()
         AND user_roles.role = 'client'
         AND user_roles.client_id = tasks.client_id
     ));
   ```
   Essa policy é **aditiva** — não altera as policies de UPDATE já existentes para o
   dono real da tarefa (`user_id = auth.uid()`, papel consultor).

2. **Trigger `BEFORE UPDATE ON tasks`** — quando quem edita tem papel `client` em
   `user_roles`, a trigger reconstrói a linha a partir de `OLD` e só aceita a nova
   posição:
   ```sql
   CREATE OR REPLACE FUNCTION enforce_client_task_position_only()
   RETURNS TRIGGER AS $$
   DECLARE
     is_client BOOLEAN;
     new_position INTEGER := NEW.position;
   BEGIN
     SELECT EXISTS (
       SELECT 1 FROM user_roles
       WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'client'
     ) INTO is_client;

     IF is_client THEN
       NEW := OLD;
       NEW.position := new_position;
     END IF;

     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql SECURITY DEFINER;

   CREATE TRIGGER trg_enforce_client_task_position_only
     BEFORE UPDATE ON tasks
     FOR EACH ROW
     EXECUTE FUNCTION enforce_client_task_position_only();
   ```
   Efeito: mesmo que uma chamada direta à API REST do Supabase (com o JWT válido de um
   usuário-cliente) tente alterar título, status, `updated_at`, `hidden_from_client` etc.,
   a trigger descarta tudo exceto `position`. Isso é defesa em profundidade — a UI do
   Portal do Cliente já só envia `{id, position}`, mas a trigger garante isso também no
   nível do banco, independente do que o cliente JS envie.
   `updated_at` nunca é tocado por esse caminho: como a trigger reconstrói a linha a
   partir de `OLD` e só sobrescreve `position`, o valor antigo de `updated_at` é
   preservado — não é necessário (nem correto) a trigger setar `updated_at` explicitamente
   aqui.

   A trigger roda para **todo** UPDATE em `tasks` (inclusive os do consultor), mas só
   altera o comportamento quando `is_client` é verdadeiro — para o consultor (`is_client
   = false`), a trigger é um no-op e o UPDATE segue exatamente como hoje, incluindo o
   `reorderTasks` do consultor bumpar `updated_at` normalmente (comportamento já
   documentado e deliberado, não deve mudar).

## Frontend (`js/app.js` / `js/store.js`)

- `_renderKanbanBoard(columns, tasks, clientsMap, readOnly, allowReorder)` — novo
  parâmetro `allowReorder` (default `false`), independente de `readOnly`. Controla
  exclusivamente se o dropzone recebe `ondragover`/`ondrop` e se os cards recebem
  `draggable`/listeners de drag. `renderClientPortalTasks()` passa `readOnly=true,
  allowReorder=true`. Todos os outros call sites (consultor) continuam passando só
  `readOnly` (que já implica reorder total, comportamento inalterado).
- `createKanbanCard(task, clientsMap, readOnly, allowReorder)` — os listeners de
  `dragstart`/`dragend`/`dragover`/`drop` passam a ser gated por `allowReorder` (hoje são
  gated por `!readOnly`); `card.draggable = allowReorder`.
- `_handleDrop(e, colEl)` — no início, se `this.userRole === 'client'` e
  `newStatus !== oldStatus` (tentativa de mover para outra coluna): aborta, mostra Toast
  de aviso ("Só é possível reordenar dentro da mesma fila."), re-renderiza a partir do
  cache sem persistir nada, e retorna.
- Persistência: branch por papel.
  - Consultor (comportamento atual, inalterado): `store.reorderTasks(reorderData)` —
    grava `status`, `position` e `updated_at` de todas as tarefas afetadas.
  - Cliente: novo método `store.reorderClientTaskPositions(updates, clientId)` — grava
    **só** `{position}` por tarefa (sem `status`, sem `updated_at`), sem filtrar por
    `.eq('user_id', this.userId)` (a tarefa pertence ao consultor, não ao usuário-cliente
    logado — mesma razão pela qual `getClientPortalTasks` não filtra por `user_id`),
    confiando na RLS + trigger acima para autorizar. Adiciona `.eq('client_id', clientId)`
    como guarda extra (redundante com a RLS, mas barato).
  - Rollback de erro em ambos os casos: invalida `_tasksCache`, re-renderiza a partir do
    banco (`renderTasks()` ou `renderClientPortalTasks()` conforme o papel), Toast de
    erro.
- Como `newStatus === oldStatus` é garantido para o caminho do cliente antes de chegar
  no bloco de persistência, os efeitos colaterais de mudança de coluna (log de atividade,
  auto-completar quando cai numa coluna `is_done`) nunca disparam para o cliente — não
  precisam de nenhum guard adicional, já ficam de fora naturalmente.

## Fora de escopo (não implementar)

- Mover cards entre colunas pelo cliente (mudar status/completar/excluir) — continua
  exclusivo do consultor.
- Qualquer edição de conteúdo da tarefa pelo cliente — já bloqueado hoje, não muda.
- Ordem separada por papel (`client_position` distinto de `position`) — rejeitado
  deliberadamente: o pedido é que a prioridade definida pelo cliente valha para o
  consultor também, então precisa ser o mesmo campo.

## Testes

Validar com o usuário de teste do Portal do Cliente
(`jorjaocorreia@gmail.com`, cliente Caruime — ver `project_test_accounts` na memória) via
Playwright:

1. Reordenar dois cards dentro da mesma coluna persiste e reflete também no board do
   consultor (`testes@teste.com`) após reload.
2. Tentar arrastar um card para outra coluna é bloqueado — a tarefa permanece na coluna
   original após o drop.
3. Após a reordenação, `tasks.updated_at` da(s) tarefa(s) afetada(s) não muda (comparar
   timestamp antes/depois direto no banco).
4. Uma chamada de UPDATE simulando o papel `client` tentando alterar `title`/`status`
   diretamente (bypass da UI) é neutralizada pela trigger — confirmar que só `position`
   muda.
