# Portal do Cliente: reordenar cards de tarefas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o usuário-cliente (papel `client` em `user_roles`) reordene, por drag-and-drop, os cards de tarefas dentro da mesma coluna do Kanban no Portal do Cliente — definindo a prioridade que também vale para o consultor — sem que isso conte como "tarefa editada hoje" para o Gerador de Apontamentos por IA.

**Architecture:** O campo `tasks.position` continua sendo a única fonte de verdade de ordem/prioridade (compartilhado entre consultor e cliente). Uma nova policy de RLS + trigger no Postgres autoriza o papel `client` a fazer `UPDATE` em `tasks`, mas restringe (a nível de banco, defesa em profundidade) a mudança apenas ao campo `position` — nunca `status`, nunca `updated_at`, nunca conteúdo. No frontend, o Kanban do Portal do Cliente ganha drag-and-drop habilitado só para reordenar dentro da coluna atual; tentar mudar de coluna é bloqueado no cliente antes mesmo de chegar ao banco.

**Tech Stack:** JavaScript vanilla ES6+ (`js/app.js`, `js/store.js`), Supabase Postgres (RLS + trigger PL/pgSQL), Playwright para teste E2E.

## Global Constraints

- Nunca adicionar `.eq('user_id', this.userId)` em queries que leem ou escrevem dados do Portal do Cliente — a tarefa pertence ao consultor, não ao usuário-cliente logado; a autorização é sempre via RLS por `client_id`.
- A reordenação do cliente nunca pode alterar `updated_at` de `tasks` (crítico: usado por `getTasksForApontamento` como critério de elegibilidade do Gerador de Apontamentos por IA).
- Nenhuma outra ação do Kanban (editar, concluir, excluir, mudar de coluna, comentar) pode ser habilitada para o papel `client` — continuam bloqueadas exatamente como hoje.
- Comportamento do Kanban do consultor deve permanecer 100% inalterado (mesmos parâmetros default nas funções tocadas).
- Toda migration SQL deve ser aplicada em produção via Supabase Management API (token de acesso — ver `reference_supabase_management_api_sql` na memória do usuário) e commitada em `supabase/migrations/`.

---

### Task 1: Migration — RLS de UPDATE + trigger de restrição de coluna para o papel `client`

**Files:**
- Create: `supabase/migrations/20260726_client_task_reorder.sql`

**Interfaces:**
- Produces: policy `clients_reorder_own_tasks` (UPDATE em `tasks`) e trigger `trg_enforce_client_task_position_only` (função `enforce_client_task_position_only()`), usados implicitamente por qualquer UPDATE em `tasks` feito com o JWT de um usuário com papel `client`.

- [ ] **Step 1: Escrever o arquivo de migration**

Crie `supabase/migrations/20260726_client_task_reorder.sql` com o conteúdo exato:

```sql
-- Portal do Cliente: reordenar cards de tarefas dentro da mesma coluna.
-- O cliente define a prioridade (ordem em tasks.position); nenhum outro
-- campo pode ser alterado por esse papel, nem mesmo via chamada direta
-- à API REST do Supabase com o JWT do usuário-cliente.

-- 1) RLS de UPDATE para o papel 'client' — aditiva, convive com a policy
--    existente do consultor dono (auth.uid() = user_id).
CREATE POLICY "clients_reorder_own_tasks" ON tasks
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = 'client'
              AND ur.client_id = tasks.client_id
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = 'client'
              AND ur.client_id = tasks.client_id
        )
    );

-- 2) Trigger: quando quem edita tem papel 'client', reconstrói a linha a
--    partir de OLD e só aceita a nova posição. Roda para TODO UPDATE em
--    tasks (inclusive do consultor), mas só altera algo quando is_client
--    é verdadeiro — para o consultor é um no-op, comportamento inalterado.
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

DROP TRIGGER IF EXISTS trg_enforce_client_task_position_only ON tasks;
CREATE TRIGGER trg_enforce_client_task_position_only
    BEFORE UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION enforce_client_task_position_only();
```

- [ ] **Step 2: Aplicar a migration em produção via Management API**

No PowerShell (o token pessoal já está registrado na memória do projeto como
`reference_supabase_token` — use o valor real, nunca cole-o em nenhum arquivo do repo):

```powershell
$env:SUPABASE_ACCESS_TOKEN = "<token pessoal — ver memória reference_supabase_token>"
$sql = Get-Content -Raw "supabase/migrations/20260726_client_task_reorder.sql"
Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/klimkamnydfnzqetqlqm/database/query" `
  -Method POST `
  -Headers @{ "Authorization" = "Bearer $env:SUPABASE_ACCESS_TOKEN"; "Content-Type" = "application/json" } `
  -Body (@{ query = $sql } | ConvertTo-Json)
```

Expected: resposta JSON sem campo `error` (uma lista vazia ou de resultados de DDL é
esperada — `CREATE POLICY`/`CREATE FUNCTION`/`CREATE TRIGGER` não retornam linhas).

- [ ] **Step 3: Verificar que a policy e a trigger foram criadas**

```powershell
$verifySql = "SELECT policyname FROM pg_policies WHERE tablename = 'tasks' AND policyname = 'clients_reorder_own_tasks'; SELECT trigger_name FROM information_schema.triggers WHERE event_object_table = 'tasks' AND trigger_name = 'trg_enforce_client_task_position_only';"
Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/klimkamnydfnzqetqlqm/database/query" `
  -Method POST `
  -Headers @{ "Authorization" = "Bearer $env:SUPABASE_ACCESS_TOKEN"; "Content-Type" = "application/json" } `
  -Body (@{ query = $verifySql } | ConvertTo-Json)
```

Expected: o resultado inclui `clients_reorder_own_tasks` e
`trg_enforce_client_task_position_only`.

- [ ] **Step 4: Commit**

```powershell
$git = (Get-ChildItem "C:\Users\jorge\AppData\Local\GitHubDesktop" -Recurse -Filter git.exe -ErrorAction SilentlyContinue | Where-Object { $_.FullName -like "*cmd*" } | Select-Object -First 1 -ExpandProperty FullName)
& $git add "supabase/migrations/20260726_client_task_reorder.sql"
& $git commit -m "feat(portal-cliente): RLS + trigger para cliente reordenar tarefas"
& $git push origin main
```

---

### Task 2: `store.js` — método `reorderClientTaskPositions`

**Files:**
- Modify: `js/store.js:945` (inserir logo após `getClientPortalColumns`, antes de `getClientPortalName`)

**Interfaces:**
- Consumes: nenhuma dependência de tasks anteriores além do schema já existente (`tasks.position`, `tasks.client_id`).
- Produces: `store.reorderClientTaskPositions(updates, clientId)` — `updates: [{id, position}]`, `clientId: string`. Retorna `Promise<void>`, lança erro se qualquer UPDATE falhar. Consumido pela Task 4 (`js/app.js` `_handleDrop`).

- [ ] **Step 1: Adicionar o método em `js/store.js`**

Insira este bloco imediatamente depois do fim de `getClientPortalColumns` (linha 953 no
estado atual do arquivo, função que termina em `}` seguida de linha em branco):

```javascript
    // Reordenação de tarefas pelo Portal do Cliente: só grava `position`,
    // nunca `status` nem `updated_at` — a trigger enforce_client_task_position_only
    // (migration 20260726_client_task_reorder.sql) garante isso também no banco,
    // mesmo que este método um dia envie algo além de position por engano.
    // Sem filtro por user_id pelo mesmo motivo de getClientPortalTasks: a tarefa
    // pertence ao consultor, não ao usuário-cliente logado — a RLS
    // (clients_reorder_own_tasks) autoriza via client_id.
    async reorderClientTaskPositions(updates, clientId) {
        // updates: [{id, position}]
        const results = await Promise.all(
            updates.map(u =>
                this.db.from('tasks')
                    .update({ position: u.position })
                    .eq('id', u.id).eq('client_id', clientId)
            )
        );
        const failed = results.find(r => r.error);
        if (failed) throw failed.error;
    }
```

- [ ] **Step 2: Verificar sintaxe carregando o app localmente**

```powershell
python -m http.server 8080
```

Abra `http://localhost:8080/index.html` no navegador, abra o Console (F12) e confirme
que não há erro de parse em `store.js` (a página carrega a tela de login normalmente).
Pare o servidor com Ctrl+C depois de confirmar.

- [ ] **Step 3: Commit**

```powershell
$git = (Get-ChildItem "C:\Users\jorge\AppData\Local\GitHubDesktop" -Recurse -Filter git.exe -ErrorAction SilentlyContinue | Where-Object { $_.FullName -like "*cmd*" } | Select-Object -First 1 -ExpandProperty FullName)
& $git add "js/store.js"
& $git commit -m "feat(portal-cliente): store.reorderClientTaskPositions"
```

---

### Task 3: `app.js` — habilitar drag-and-drop condicional (`allowReorder`) em `_renderKanbanBoard`/`createKanbanCard`

**Files:**
- Modify: `js/app.js:4112-4173` (`_renderKanbanBoard`)
- Modify: `js/app.js:4219-4248` (`createKanbanCard`, só a parte de drag)
- Modify: `js/app.js:2305` (call site em `renderClientPortalTasks`)

**Interfaces:**
- Consumes: nenhuma dependência de tasks anteriores.
- Produces: `_renderKanbanBoard(columns, tasks, clientsMap, readOnly = false, allowReorder = !readOnly)` e `createKanbanCard(task, clientsMap, readOnly = false, allowReorder = !readOnly)` — novo 5º/4º parâmetro `allowReorder`, com default que preserva o comportamento atual de todos os call sites existentes sem precisar alterá-los. Consumido pela Task 4 (`_handleDrop` já existe e não muda de assinatura).

- [ ] **Step 1: Alterar a assinatura e o `dropzoneAttrs` de `_renderKanbanBoard`**

Em `js/app.js`, localize (linha 4112):

```javascript
    _renderKanbanBoard(columns, tasks, clientsMap, readOnly = false) {
```

Substitua por:

```javascript
    _renderKanbanBoard(columns, tasks, clientsMap, readOnly = false, allowReorder = !readOnly) {
```

Localize (linha 4137):

```javascript
            const dropzoneAttrs = readOnly ? '' : `ondragover="app.allowDrop(event)" ondrop="app.dropTask(event)"`;
```

Substitua por:

```javascript
            const dropzoneAttrs = allowReorder ? `ondragover="app.allowDrop(event)" ondrop="app.dropTask(event)"` : '';
```

Localize (linha 4169):

```javascript
            colTasks.forEach(task => dropzone.appendChild(this.createKanbanCard(task, clientsMap, readOnly)));
```

Substitua por:

```javascript
            colTasks.forEach(task => dropzone.appendChild(this.createKanbanCard(task, clientsMap, readOnly, allowReorder)));
```

- [ ] **Step 2: Alterar a assinatura e o gate de drag de `createKanbanCard`**

Localize (linha 4219):

```javascript
    createKanbanCard(task, clientsMap, readOnly = false) {
```

Substitua por:

```javascript
    createKanbanCard(task, clientsMap, readOnly = false, allowReorder = !readOnly) {
```

Localize (linha 4222):

```javascript
        card.draggable = !readOnly;
```

Substitua por:

```javascript
        card.draggable = allowReorder;
```

Localize (linha 4228):

```javascript
        if (!readOnly) {
            card.addEventListener('dragstart', this.dragStart.bind(this));
```

Substitua por:

```javascript
        if (allowReorder) {
            card.addEventListener('dragstart', this.dragStart.bind(this));
```

(o resto do bloco `dragend`/`dragover`/`drop` dentro desse `if` não muda).

- [ ] **Step 3: Habilitar `allowReorder` no call site do Portal do Cliente**

Localize (linha 2305):

```javascript
        this._renderKanbanBoard(this._currentColumns, tasks, {}, true);
```

Substitua por:

```javascript
        this._renderKanbanBoard(this._currentColumns, tasks, {}, true, true);
```

- [ ] **Step 4: Verificar que o board do consultor não mudou visualmente**

```powershell
python -m http.server 8080
```

Abra `http://localhost:8080/index.html`, faça login com `testes@teste.com` / `123testes`
(usuário consultor — ver memória `project_test_accounts`), vá para a view Tarefas,
filtre por um cliente com ao menos 2 tarefas na mesma coluna, e arraste um card para
reordenar dentro da coluna. Confirme visualmente que o drag-and-drop do consultor
continua funcionando exatamente como antes (a ordem muda e persiste após reload).
Pare o servidor com Ctrl+C.

- [ ] **Step 5: Commit**

```powershell
$git = (Get-ChildItem "C:\Users\jorge\AppData\Local\GitHubDesktop" -Recurse -Filter git.exe -ErrorAction SilentlyContinue | Where-Object { $_.FullName -like "*cmd*" } | Select-Object -First 1 -ExpandProperty FullName)
& $git add "js/app.js"
& $git commit -m "feat(portal-cliente): allowReorder no Kanban (drag habilitado condicionalmente)"
```

---

### Task 4: `app.js` — `_handleDrop`: bloquear troca de coluna e persistir via papel

**Files:**
- Modify: `js/app.js:1574-1627` (`_handleDrop`)

**Interfaces:**
- Consumes: `store.reorderClientTaskPositions(updates, clientId)` (Task 2); `this.userRole`, `this.userClientId` (já existentes, `js/app.js:80,84`); `this.renderClientPortalTasks()` (já existente, `js/app.js:2274`).
- Produces: nenhuma interface nova — `_handleDrop` continua com a mesma assinatura, chamada pelos mesmos pontos (`dropTask`, o listener de `drop` do placeholder em `dragStart`, e o listener de `drop` do próprio card em `createKanbanCard`).

- [ ] **Step 1: Substituir o corpo de `_handleDrop`**

Localize o método completo em `js/app.js` (linha 1574-1627):

```javascript
    async _handleDrop(e, colEl) {
        const draggedId = e.dataTransfer.getData('text/plain');
        const newStatus = colEl?.dataset.status;
        if (!draggedId || !newStatus) return;

        // Lê a ordem do DOM: substitui o placeholder pelo id do card arrastado
        const elements = [...colEl.querySelectorAll('.kb-card:not(.dragging), .kb-drag-placeholder')];
        const ids = elements.map(el =>
            el.classList.contains('kb-drag-placeholder') ? draggedId : el.dataset.id
        ).filter(Boolean);

        // Garante que o card arrastado está na lista (coluna vazia)
        if (!ids.includes(draggedId)) ids.push(draggedId);

        const oldStatus = this._draggingFromStatus;
        const reorderData = ids.map((id, pos) => ({ id, status: newStatus, position: pos }));

        // Optimistic: atualiza cache imediatamente e re-renderiza o board (instantâneo)
        if (this._tasksCache) {
            reorderData.forEach(({ id, status, position }) => {
                const t = this._tasksCache.find(t => t.id === id);
                if (t) { t.status = status; t.position = position; }
            });
            this._renderTasksFromCache();
        }

        // Bounce animation no card após o re-render
        requestAnimationFrame(() => {
            const droppedCard = document.querySelector(`.kb-card[data-id="${draggedId}"]`);
            if (droppedCard) {
                droppedCard.classList.add('kb-card-dropped');
                droppedCard.addEventListener('animationend', () => droppedCard.classList.remove('kb-card-dropped'), { once: true });
            }
        });

        // Persiste em background (reorderTasks já salva status + position de todos os afetados)
        store.reorderTasks(reorderData).catch(err => {
            console.error('reorderTasks error:', err);
            // Rollback: invalida cache e busca dados frescos do banco
            this._tasksCache = null;
            this.renderTasks();
            Toast.show('Erro ao salvar posição da tarefa.', 'error');
        });
        if (oldStatus !== newStatus) {
            store.logTaskActivity(draggedId, 'status_change', { from: oldStatus, to: newStatus }).catch(() => {});
            const newCol = this._currentColumns.find(c => c.id === newStatus);
            if (newCol?.isDone) {
                const task = this._tasksCache?.find(t => t.id === draggedId);
                if (task && !task.completed) {
                    this.toggleTaskComplete(draggedId, true);
                }
            }
        }
    }
```

Substitua pelo corpo completo:

```javascript
    async _handleDrop(e, colEl) {
        const draggedId = e.dataTransfer.getData('text/plain');
        const newStatus = colEl?.dataset.status;
        if (!draggedId || !newStatus) return;

        const oldStatus = this._draggingFromStatus;

        // Portal do Cliente: só pode reordenar dentro da mesma coluna. Mudar
        // de coluna (status) continua exclusivo do consultor.
        if (this.userRole === 'client' && newStatus !== oldStatus) {
            Toast.show('Só é possível reordenar tarefas dentro da mesma fila.', 'warning');
            this.renderClientPortalTasks();
            return;
        }

        // Lê a ordem do DOM: substitui o placeholder pelo id do card arrastado
        const elements = [...colEl.querySelectorAll('.kb-card:not(.dragging), .kb-drag-placeholder')];
        const ids = elements.map(el =>
            el.classList.contains('kb-drag-placeholder') ? draggedId : el.dataset.id
        ).filter(Boolean);

        // Garante que o card arrastado está na lista (coluna vazia)
        if (!ids.includes(draggedId)) ids.push(draggedId);

        const reorderData = ids.map((id, pos) => ({ id, status: newStatus, position: pos }));

        // Optimistic: atualiza cache imediatamente e re-renderiza o board (instantâneo)
        if (this._tasksCache) {
            reorderData.forEach(({ id, status, position }) => {
                const t = this._tasksCache.find(t => t.id === id);
                if (t) { t.status = status; t.position = position; }
            });
            if (this.userRole === 'client') {
                this.renderClientPortalTasks();
            } else {
                this._renderTasksFromCache();
            }
        }

        // Bounce animation no card após o re-render
        requestAnimationFrame(() => {
            const droppedCard = document.querySelector(`.kb-card[data-id="${draggedId}"]`);
            if (droppedCard) {
                droppedCard.classList.add('kb-card-dropped');
                droppedCard.addEventListener('animationend', () => droppedCard.classList.remove('kb-card-dropped'), { once: true });
            }
        });

        // Portal do Cliente: persiste só a posição, nunca status/updated_at
        // (ver migration 20260726_client_task_reorder.sql — a trigger bloqueia
        // qualquer outro campo mesmo que este código um dia envie mais coisa).
        if (this.userRole === 'client') {
            store.reorderClientTaskPositions(
                reorderData.map(({ id, position }) => ({ id, position })),
                this.userClientId
            ).catch(err => {
                console.error('reorderClientTaskPositions error:', err);
                this._tasksCache = null;
                this.renderClientPortalTasks();
                Toast.show('Erro ao salvar a nova ordem.', 'error');
            });
            return;
        }

        // Persiste em background (reorderTasks já salva status + position de todos os afetados)
        store.reorderTasks(reorderData).catch(err => {
            console.error('reorderTasks error:', err);
            // Rollback: invalida cache e busca dados frescos do banco
            this._tasksCache = null;
            this.renderTasks();
            Toast.show('Erro ao salvar posição da tarefa.', 'error');
        });
        if (oldStatus !== newStatus) {
            store.logTaskActivity(draggedId, 'status_change', { from: oldStatus, to: newStatus }).catch(() => {});
            const newCol = this._currentColumns.find(c => c.id === newStatus);
            if (newCol?.isDone) {
                const task = this._tasksCache?.find(t => t.id === draggedId);
                if (task && !task.completed) {
                    this.toggleTaskComplete(draggedId, true);
                }
            }
        }
    }
```

- [ ] **Step 2: Verificar que o board do consultor continua idêntico**

Repita o teste manual do Passo 4 da Task 3 (drag-and-drop do consultor dentro da mesma
coluna e entre colunas diferentes) — nenhum comportamento deve ter mudado, já que
`this.userRole === 'client'` é sempre falso para o consultor.

- [ ] **Step 3: Commit**

```powershell
$git = (Get-ChildItem "C:\Users\jorge\AppData\Local\GitHubDesktop" -Recurse -Filter git.exe -ErrorAction SilentlyContinue | Where-Object { $_.FullName -like "*cmd*" } | Select-Object -First 1 -ExpandProperty FullName)
& $git add "js/app.js"
& $git commit -m "feat(portal-cliente): _handleDrop bloqueia troca de coluna e persiste só position para o cliente"
& $git push origin main
```

---

### Task 5: Deploy manual + teste E2E com Playwright

**Files:**
- Create: `C:\Users\jorge\AppData\Local\Temp\playwright-test-client-reorder.js` (script de teste, fora do repo — segue o padrão já usado pela suíte existente)

**Interfaces:**
- Consumes: `store.reorderClientTaskPositions` (Task 2), `_handleDrop`/`allowReorder` (Tasks 3-4), migration da Task 1 já aplicada em produção.
- Produces: nenhuma — task de validação final.

- [ ] **Step 1: Lembrar o usuário de fazer o deploy manual**

O webhook de deploy automático do Easypanel está quebrado (ver CLAUDE.md, seção Deploy).
Antes de rodar o teste E2E, avise o usuário: "Fiz o push dos commits — antes de eu testar
em produção, preciso que você faça o deploy manual no Easypanel do serviço
`gerenciador-tsp`." Aguarde a confirmação de que o deploy terminou antes do próximo passo.

- [ ] **Step 2: Escrever o script de teste Playwright**

Crie `C:\Users\jorge\AppData\Local\Temp\playwright-test-client-reorder.js`:

```javascript
const { chromium } = require('C:\\Users\\jorge\\AppData\\Local\\Temp\\claude\\d--GerenciadorTSP\\687162b8-d184-484e-babc-21babe973616\\scratchpad\\node_modules\\playwright');

const PROD_URL = 'https://jorge-gerenciador-tsp.27pl2o.easypanel.host';
const CLIENT_EMAIL = 'jorjaocorreia@gmail.com';
const CLIENT_PASSWORD = 'Jhc1881//';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    console.log('1) Login como cliente...');
    await page.goto(PROD_URL);
    await page.fill('#login-email', CLIENT_EMAIL);
    await page.fill('#login-password', CLIENT_PASSWORD);
    await page.click('#btn-login');
    await page.waitForSelector('#kanban-board .kb-card', { timeout: 15000 });

    console.log('2) Lendo updated_at da primeira tarefa antes do drag...');
    const beforeState = await page.evaluate(async () => {
        const uid = Auth.getUserId();
        const roleRow = await window.supabaseClient.from('user_roles').select('client_id').eq('user_id', uid).single();
        const clientId = roleRow.data.client_id;
        const { data } = await window.supabaseClient.from('tasks').select('id, status, position, updated_at, title')
            .eq('client_id', clientId).eq('hidden_from_client', false).order('status').order('position');
        return { clientId, tasks: data };
    });
    console.log('Tarefas antes:', JSON.stringify(beforeState.tasks, null, 2));

    const firstColumnStatus = beforeState.tasks[0]?.status;
    const sameColumnTasks = beforeState.tasks.filter(t => t.status === firstColumnStatus);
    if (sameColumnTasks.length < 2) {
        console.log('AVISO: menos de 2 tarefas na primeira coluna — não é possível testar reorder. Abortando.');
        await browser.close();
        return;
    }

    console.log('3) Arrastando o primeiro card para a posição do segundo (mesma coluna)...');
    const cardA = page.locator(`.kb-card[data-id="${sameColumnTasks[0].id}"]`);
    const cardB = page.locator(`.kb-card[data-id="${sameColumnTasks[1].id}"]`);
    await cardA.dragTo(cardB);
    await page.waitForTimeout(1500);

    console.log('4) Lendo estado depois do drag...');
    const afterState = await page.evaluate(async (clientId) => {
        const { data } = await window.supabaseClient.from('tasks').select('id, status, position, updated_at, title')
            .eq('client_id', clientId).eq('hidden_from_client', false).order('status').order('position');
        return data;
    }, beforeState.clientId);
    console.log('Tarefas depois:', JSON.stringify(afterState, null, 2));

    const taskAAfter = afterState.find(t => t.id === sameColumnTasks[0].id);
    const taskAWithBefore = sameColumnTasks[0];
    console.log('CHECK updated_at inalterado:', taskAAfter.updated_at === taskAWithBefore.updated_at ? 'PASS' : 'FAIL');
    console.log('CHECK status inalterado:', taskAAfter.status === taskAWithBefore.status ? 'PASS' : 'FAIL');
    console.log('CHECK position mudou:', taskAAfter.position !== taskAWithBefore.position ? 'PASS' : 'FAIL (pode ser normal se já estava na posição certa)');

    console.log('5) Tentando mover um card para outra coluna (deve ser bloqueado)...');
    const otherColumnTask = afterState.find(t => t.status !== firstColumnStatus);
    if (otherColumnTask) {
        const cardX = page.locator(`.kb-card[data-id="${afterState[0].id}"]`);
        const cardY = page.locator(`.kb-card[data-id="${otherColumnTask.id}"]`);
        await cardX.dragTo(cardY);
        await page.waitForTimeout(1500);
        const afterCrossAttempt = await page.evaluate(async (id) => {
            const { data } = await window.supabaseClient.from('tasks').select('id, status').eq('id', id).single();
            return data;
        }, afterState[0].id);
        console.log('CHECK coluna não mudou após tentativa cross-column:',
            afterCrossAttempt.status === afterState[0].status ? 'PASS' : 'FAIL');
    } else {
        console.log('Só existe uma coluna com tarefas — não foi possível testar o bloqueio cross-column.');
    }

    console.log('6) Tentando alterar title/status diretamente via JWT do cliente (deve ser neutralizado pela trigger)...');
    const targetId = afterState[0].id;
    const originalTitle = afterState[0].title;
    const tamperResult = await page.evaluate(async ({ id, otherStatus }) => {
        const { error } = await window.supabaseClient.from('tasks')
            .update({ title: 'TAMPERED-BY-TEST', status: otherStatus, position: 999 })
            .eq('id', id);
        const { data: after } = await window.supabaseClient.from('tasks').select('title, status, position').eq('id', id).single();
        return { error: error?.message || null, after };
    }, { id: targetId, otherStatus: otherColumnTask?.status || firstColumnStatus });
    console.log('Resultado pós-tentativa:', JSON.stringify(tamperResult, null, 2));
    console.log('CHECK title não foi alterado pela trigger:', tamperResult.after.title === originalTitle ? 'PASS' : 'FAIL');
    console.log('CHECK position foi aplicada (único campo permitido):', tamperResult.after.position === 999 ? 'PASS' : 'FAIL');

    await browser.close();
})();
```

- [ ] **Step 3: Rodar o script**

```powershell
cd "d:\GerenciadorTSP\skills\playwright-skill"
node run.js "C:\Users\jorge\AppData\Local\Temp\playwright-test-client-reorder.js"
```

Expected: todas as linhas `CHECK` impressas como `PASS`. Se algum `FAIL` aparecer,
investigar antes de considerar a task concluída — não reportar como resolvido sem essa
saída (ver memória `feedback_test_after_fix`: Supabase não autentica em `localhost`,
então este teste roda contra produção após o deploy manual).

- [ ] **Step 4: Verificar visualmente no board do consultor**

```powershell
cd "d:\GerenciadorTSP\skills\playwright-skill"
```

Rode manualmente (ou peça ao usuário) para logar como `testes@teste.com` / `123testes`
em produção, abrir o mesmo cliente cujas tarefas foram reordenadas pelo teste, e
confirmar visualmente que a nova ordem definida pelo "cliente" aparece também no board
do consultor.

- [ ] **Step 5: Atualizar o CLAUDE.md**

Adicione, na seção de armadilhas do Kanban/Portal do Cliente em `CLAUDE.md`, uma entrada
descrevendo: a nova policy/trigger, o novo parâmetro `allowReorder` (separado de
`readOnly`) em `_renderKanbanBoard`/`createKanbanCard`, e o motivo pelo qual
`reorderClientTaskPositions` nunca deve enviar `status`/`updated_at`. Sem essa entrada,
um trabalho futuro pode reintroduzir o bug de `updated_at` sendo bumpado pela
reordenação do cliente.

- [ ] **Step 6: Commit final**

```powershell
$git = (Get-ChildItem "C:\Users\jorge\AppData\Local\GitHubDesktop" -Recurse -Filter git.exe -ErrorAction SilentlyContinue | Where-Object { $_.FullName -like "*cmd*" } | Select-Object -First 1 -ExpandProperty FullName)
& $git add "CLAUDE.md"
& $git commit -m "docs: documenta reordenacao de tarefas pelo cliente no Portal (CLAUDE.md)"
& $git push origin main
```
