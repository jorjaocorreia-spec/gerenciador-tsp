# Busca textual em Tarefas (Kanban) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um campo de busca textual livre na view Tarefas (Kanban) que encontra tarefas por título, descrição ou comentário, funcionando com ou sem cliente filtrado.

**Architecture:** Busca 100% client-side sobre `_tasksCache` (já contém todas as tarefas do usuário, populado por `store.getTasks()`). Com cliente selecionado, o termo entra como mais um filtro AND no board Kanban existente. Sem cliente selecionado, substitui o placeholder atual por uma lista de resultados (tabela) entre todos os clientes.

**Tech Stack:** JavaScript vanilla ES6+ (sem build step), HTML5, CSS já existente no projeto (`.form-control`, `.data-table`, `.kb-badge*`, `.kb-empty-state`).

## Global Constraints

- Sem TypeScript, sem React, sem bundler — JavaScript vanilla ES6+ direto em `js/app.js` (CLAUDE.md).
- Este projeto **não tem framework de testes unitários**. Verificação é manual via servidor local (`python -m http.server 8080` → `http://localhost:8080/index.html`) e, só no final, a suíte Playwright E2E existente (mas ela testa contra produção — só roda depois do deploy manual no Easypanel, conforme CLAUDE.md). Os passos de "teste" abaixo trocam o ciclo TDD vermelho/verde por verificação manual no browser, seguindo o padrão real deste repositório.
- Todo texto interpolado em `innerHTML` deve passar por `escapeHtml()` (função global em `js/app.js:28`) para evitar XSS.
- `_tasksCache` já contém **todas** as tarefas do usuário (via `store.getTasks()`, `select('*')`, sem filtro de cliente) independente do filtro de Cliente estar setado ou não — a busca não precisa de nenhuma query nova ao Supabase.
- Reaproveitar classes CSS já existentes: `.form-control`, `.data-table`, `.kb-badge`, `.kb-badge-priority-high/medium/low`, `.kb-badge-completed`, `.kb-empty-state`. Não criar CSS novo.
- Nunca usar `await` dentro de `forEach` (regra do projeto) — não se aplica aqui pois não há novas chamadas assíncronas.
- Branch: repositório só usa `main`, sem feature branches; deploy é manual no Easypanel (webhook quebrado). Commits vão direto para `main` e devem ser seguidos de `git push origin main`.

---

## File Structure

- **Modify `index.html`**: novo campo de busca `#filter-task-search` dentro de `.kanban-filters` (bloco atualmente nas linhas ~336-363).
- **Modify `js/app.js`**:
  - Novos métodos `_normalizeSearch()` e `_taskMatchesSearch()` (inseridos após `_populateLabelFilter()`, hoje terminando na linha 1811).
  - Novo método `_renderTaskSearchResultsList()` (inserido após `_renderKanbanBoard()`, hoje terminando na linha 3532).
  - Modificar `clearKanbanFilters()` (linhas 1791-1799), `renderTasks()` (linhas 3295-3371) e `_renderTasksFromCache()` (linhas 3402-3433) para ler e aplicar o termo de busca.
- **Modify `CLAUDE.md`**: nova entrada em "Armadilhas conhecidas" documentando a dependência de `_tasksCache` conter todas as tarefas e a escolha de `completed` em vez do nome da coluna Kanban no modo lista.

---

### Task 1: Campo de busca na UI (`index.html`)

**Files:**
- Modify: `index.html:352-357`

**Interfaces:**
- Produces: elemento `#filter-task-search` (input de texto), lido por `js/app.js` nas Tasks 3 e 4 via `document.getElementById('filter-task-search')?.value`.

- [ ] **Step 1: Adicionar o campo de busca no HTML**

Localizar o bloco do filtro de Label em `index.html` (linhas 352-357):

```html
                <div class="form-group">
                    <label>Label</label>
                    <select id="filter-task-label" class="form-control" onchange="app.renderTasks()">
                        <option value="">Todas</option>
                    </select>
                </div>
```

Inserir imediatamente depois (antes de `<div class="kanban-filters-actions">`):

```html
                <div class="form-group">
                    <label>Buscar</label>
                    <div style="position:relative">
                        <input type="text" id="filter-task-search" class="form-control"
                               style="padding-left:34px"
                               placeholder="Título, descrição ou comentário..."
                               onkeydown="if(event.key==='Enter'){event.preventDefault();app.renderTasks();}">
                        <i data-lucide="search" style="position:absolute;left:10px;top:50%;
                           transform:translateY(-50%);width:16px;height:16px;opacity:0.5;
                           pointer-events:none"></i>
                    </div>
                </div>
```

- [ ] **Step 2: Verificar manualmente no browser**

Rodar:
```powershell
python -m http.server 8080
```
Abrir `http://localhost:8080/index.html`, logar, ir para a view **Tarefas**. Confirmar:
- O campo "Buscar" aparece alinhado com Cliente/Prioridade/Label, com o ícone de lupa visível dentro do input.
- Digitar texto e apertar Enter não gera erro no console (mesmo sem lógica de filtro ainda — `app.renderTasks()` já existe e simplesmente vai ignorar o campo até a Task 3).

- [ ] **Step 3: Commit**

```powershell
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.6.1\resources\app\git\cmd\git.exe"
& $git add index.html
& $git commit -m "feat(tasks): add search input field to Kanban filters bar"
```

---

### Task 2: Helpers de normalização e matching (`js/app.js`)

**Files:**
- Modify: `js/app.js:1811` (inserir após `_populateLabelFilter`)

**Interfaces:**
- Consumes: nenhuma dependência de tasks anteriores.
- Produces: `this._normalizeSearch(s: string): string` — minúsculas, sem acento. `this._taskMatchesSearch(task: Task, term: string): boolean` — `term` já deve vir normalizado pelo chamador. Usadas pelas Tasks 3 e 4.

- [ ] **Step 1: Adicionar os métodos**

Localizar o fim de `_populateLabelFilter()` em `js/app.js` (linha 1811):

```js
    _populateLabelFilter(tasks) {
        const select = document.getElementById('filter-task-label');
        if (!select) return;
        const current = select.value;
        // Coletar cores únicas
        const colors = new Set();
        tasks.forEach(t => (t.labels || []).forEach(l => colors.add(l.color)));
        const extra = [...colors].map(c => `<option value="${c}" style="background:${c}">${c}</option>`).join('');
        select.innerHTML = `<option value="">Todas</option>${extra}`;
        if (current) select.value = current;
    }
```

Inserir imediatamente depois:

```js

    // Normaliza para busca: minúsculas + remove acentos (PT-BR)
    _normalizeSearch(s) {
        return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    }

    // term já deve estar normalizado via _normalizeSearch() pelo chamador
    _taskMatchesSearch(task, term) {
        if (!term) return true;
        const haystack = [
            task.title,
            task.description,
            ...(task.comments || []).filter(c => c.type === 'comment').map(c => c.text)
        ].map(s => this._normalizeSearch(s)).join(' ');
        return haystack.includes(term);
    }
```

- [ ] **Step 2: Verificar manualmente no console do browser**

Com o app aberto (`http://localhost:8080/index.html`) e logado, abrir o DevTools Console e rodar:

```js
app._normalizeSearch('Atualização de Cadastro')
// esperado: "atualizacao de cadastro"

app._taskMatchesSearch({ title: 'Corrigir bug de login', description: '', comments: [] }, app._normalizeSearch('login'))
// esperado: true

app._taskMatchesSearch({ title: 'Corrigir bug de login', description: '', comments: [] }, app._normalizeSearch('fatura'))
// esperado: false

app._taskMatchesSearch({ title: 'X', description: '', comments: [{ type: 'comment', text: 'falar sobre integração' }] }, app._normalizeSearch('integracao'))
// esperado: true (acha no comentário, mesmo sem acento digitado)
```

Confirmar que todos os 4 resultados batem com o esperado antes de seguir.

- [ ] **Step 3: Commit**

```powershell
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.6.1\resources\app\git\cmd\git.exe"
& $git add js/app.js
& $git commit -m "feat(tasks): add search normalization and matching helpers"
```

---

### Task 3: Aplicar a busca no board Kanban (com cliente selecionado)

**Files:**
- Modify: `js/app.js:1791-1799` (`clearKanbanFilters`)
- Modify: `js/app.js:3295-3371` (`renderTasks`)
- Modify: `js/app.js:3402-3433` (`_renderTasksFromCache`)

**Interfaces:**
- Consumes: `this._normalizeSearch()`, `this._taskMatchesSearch()` (Task 2).
- Produces: filtro de busca aplicado em conjunto com Prioridade/Label no board Kanban existente. Não altera o ramo "sem cliente" ainda (isso é a Task 4).

- [ ] **Step 1: Atualizar `clearKanbanFilters()`**

Conteúdo atual (linhas 1791-1799):

```js
    clearKanbanFilters() {
        const fc = document.getElementById('filter-task-client');
        const fp = document.getElementById('filter-task-priority');
        const fl = document.getElementById('filter-task-label');
        if (fc) fc.value = '';
        if (fp) fp.value = '';
        if (fl) fl.value = '';
        this.renderTasks();
    }
```

Substituir por:

```js
    clearKanbanFilters() {
        const fc = document.getElementById('filter-task-client');
        const fp = document.getElementById('filter-task-priority');
        const fl = document.getElementById('filter-task-label');
        const fs = document.getElementById('filter-task-search');
        if (fc) fc.value = '';
        if (fp) fp.value = '';
        if (fl) fl.value = '';
        if (fs) fs.value = '';
        this.renderTasks();
    }
```

- [ ] **Step 2: Aplicar o filtro de busca em `renderTasks()` (ramo com cliente selecionado)**

Localizar em `renderTasks()` (próximo da linha 3301-3303):

```js
        const filterClient   = document.getElementById('filter-task-client')?.value;
        const filterPriority = document.getElementById('filter-task-priority')?.value;
        const filterLabel    = document.getElementById('filter-task-label')?.value;
```

Substituir por:

```js
        const filterClient   = document.getElementById('filter-task-client')?.value;
        const filterPriority = document.getElementById('filter-task-priority')?.value;
        const filterLabel    = document.getElementById('filter-task-label')?.value;
        const searchTerm     = this._normalizeSearch(document.getElementById('filter-task-search')?.value || '');
```

Depois, localizar a linha do filtro de Label dentro do ramo com cliente (linha 3358-3360):

```js
        let tasks = this._tasksCache.filter(t => t.clientId === filterClient);
        if (filterPriority) tasks = tasks.filter(t => t.priority === filterPriority);
        if (filterLabel)    tasks = tasks.filter(t => (t.labels || []).some(l => l.color === filterLabel));
```

Substituir por:

```js
        let tasks = this._tasksCache.filter(t => t.clientId === filterClient);
        if (filterPriority) tasks = tasks.filter(t => t.priority === filterPriority);
        if (filterLabel)    tasks = tasks.filter(t => (t.labels || []).some(l => l.color === filterLabel));
        if (searchTerm)     tasks = tasks.filter(t => this._taskMatchesSearch(t, searchTerm));
```

- [ ] **Step 3: Repetir o mesmo padrão em `_renderTasksFromCache()`**

Localizar (próximo da linha 3406-3408):

```js
        const filterClient   = document.getElementById('filter-task-client')?.value;
        const filterPriority = document.getElementById('filter-task-priority')?.value;
        const filterLabel    = document.getElementById('filter-task-label')?.value;
```

Substituir por:

```js
        const filterClient   = document.getElementById('filter-task-client')?.value;
        const filterPriority = document.getElementById('filter-task-priority')?.value;
        const filterLabel    = document.getElementById('filter-task-label')?.value;
        const searchTerm     = this._normalizeSearch(document.getElementById('filter-task-search')?.value || '');
```

E localizar (linha 3420-3422):

```js
        let tasks = this._tasksCache.filter(t => t.clientId === filterClient);
        if (filterPriority) tasks = tasks.filter(t => t.priority === filterPriority);
        if (filterLabel)    tasks = tasks.filter(t => (t.labels || []).some(l => l.color === filterLabel));
```

Substituir por:

```js
        let tasks = this._tasksCache.filter(t => t.clientId === filterClient);
        if (filterPriority) tasks = tasks.filter(t => t.priority === filterPriority);
        if (filterLabel)    tasks = tasks.filter(t => (t.labels || []).some(l => l.color === filterLabel));
        if (searchTerm)     tasks = tasks.filter(t => this._taskMatchesSearch(t, searchTerm));
```

- [ ] **Step 4: Verificar manualmente no browser**

No app local, ir para Tarefas, selecionar um Cliente que tenha pelo menos 2 tarefas com títulos diferentes. Confirmar:
1. Sem termo de busca: todas as tarefas do cliente aparecem normalmente (comportamento inalterado).
2. Digitar uma palavra que existe só no título de uma das tarefas e apertar Enter → só essa tarefa (ou as que casam) permanece visível no board.
3. Digitar uma palavra que só existe num comentário de uma tarefa (adicionar um comentário de teste antes, se necessário) e apertar Enter → a tarefa aparece.
4. Apagar o campo de busca e apertar Enter → todas as tarefas do cliente voltam a aparecer.
5. Repetir o passo 2, depois clicar no botão "Limpar filtros" (ícone X) → campo de busca fica vazio e o board mostra o placeholder "Selecione um cliente..." (já que Cliente também é limpo).
6. Trocar Prioridade ou Label enquanto há um termo de busca preenchido → o filtro combinado (AND) deve se aplicar sem precisar apertar Enter de novo (o `onchange` desses selects já chama `renderTasks()`).

- [ ] **Step 5: Commit**

```powershell
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.6.1\resources\app\git\cmd\git.exe"
& $git add js/app.js
& $git commit -m "feat(tasks): apply search term filter to Kanban board"
```

---

### Task 4: Modo lista quando não há cliente selecionado

**Files:**
- Modify: `js/app.js:3311-3332` (ramo "sem cliente" de `renderTasks()`)
- Modify: `js/app.js:3415-3418` (ramo "sem cliente" de `_renderTasksFromCache()`)
- Modify: `js/app.js:3532` (inserir `_renderTaskSearchResultsList` após `_renderKanbanBoard`)

**Interfaces:**
- Consumes: `this._normalizeSearch()`, `this._taskMatchesSearch()` (Task 2); `this._clientsMapCache` (já populado por `renderTasks()`/`_renderTasksFromCache()` com todos os clientes presentes em `_tasksCache`); `app.handleEditTask(id)` (já existe, self-contained).
- Produces: `this._renderTaskSearchResultsList(tasks, clientsMap)` — renderiza `#kanban-board` como tabela de resultados. Usado apenas quando não há Cliente filtrado e há termo de busca.

- [ ] **Step 1: Adicionar `_renderTaskSearchResultsList()` após `_renderKanbanBoard()`**

Localizar o fechamento de `_renderKanbanBoard()` em `js/app.js` (linha 3532):

```js
            const dropzone = colEl.querySelector('.kb-dropzone');
            colTasks.forEach(task => dropzone.appendChild(this.createKanbanCard(task, clientsMap)));

            board.appendChild(colEl);
        });
    }
```

Inserir imediatamente depois (antes de `createKanbanCard`):

```js

    // Renderiza lista de resultados de busca quando não há Cliente filtrado
    _renderTaskSearchResultsList(tasks, clientsMap) {
        const board = document.getElementById('kanban-board');
        if (!board) return;

        if (tasks.length === 0) {
            board.innerHTML = `<div class="kb-empty-state">
                <i data-lucide="search-x" style="width:48px;height:48px;opacity:0.25"></i>
                <p>Nenhuma tarefa encontrada para esse termo.</p>
            </div>`;
            return;
        }

        const priMap = { high: ['priority-high', 'Alta'], medium: ['priority-medium', 'Média'], low: ['priority-low', 'Baixa'] };

        const rowsHtml = tasks.map(t => {
            const clientName = t.clientId ? (clientsMap[t.clientId]?.name || '—') : '—';
            const [priClass, priLabel] = priMap[t.priority] || priMap.medium;
            const completedHtml = t.completed
                ? `<span class="kb-badge kb-badge-completed"><i data-lucide="check-circle" style="width:10px;height:10px"></i> Concluída</span>`
                : '—';
            return `
                <tr onclick="app.handleEditTask('${t.id}')" style="cursor:pointer">
                    <td>${escapeHtml(t.title)}</td>
                    <td>${escapeHtml(clientName)}</td>
                    <td><span class="kb-badge kb-badge-${priClass}">${priLabel}</span></td>
                    <td>${completedHtml}</td>
                </tr>`;
        }).join('');

        board.innerHTML = `
            <table class="data-table" style="margin:0">
                <thead>
                    <tr>
                        <th>Título</th>
                        <th>Cliente</th>
                        <th>Prioridade</th>
                        <th>Concluída?</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
            </table>`;
    }
```

- [ ] **Step 2: Usar a lista no ramo "sem cliente" de `renderTasks()`**

Localizar o bloco atual (linhas 3311-3332):

```js
        if (!filterClient) {
            // Sem cliente: placeholder
            this._currentColumns = [];
            if (btnManage) btnManage.style.display = 'none';
            // Usa cache se disponível, senão busca do banco
            if (this._tasksCache === null) {
                const allTasks = await store.getTasks();
                this._tasksCache = allTasks;
                const clientIds = [...new Set(allTasks.map(t => t.clientId).filter(Boolean))];
                const entries = await Promise.all(clientIds.map(async id => [id, await store.getClient(id)]));
                this._clientsMapCache = Object.fromEntries(entries);
            }
            this._populateLabelFilter(this._tasksCache);
            board.innerHTML = `
                <div class="kb-empty-state">
                    <i data-lucide="columns" style="width:48px;height:48px;opacity:0.25"></i>
                    <p>Selecione um cliente nos filtros para visualizar o Kanban</p>
                </div>`;
            await this.renderTasksDashboard(this._tasksCache, '');
            lucide.createIcons();
            return;
        }
```

Substituir por:

```js
        if (!filterClient) {
            // Sem cliente: placeholder, ou lista de busca se houver termo
            this._currentColumns = [];
            if (btnManage) btnManage.style.display = 'none';
            // Usa cache se disponível, senão busca do banco
            if (this._tasksCache === null) {
                const allTasks = await store.getTasks();
                this._tasksCache = allTasks;
                const clientIds = [...new Set(allTasks.map(t => t.clientId).filter(Boolean))];
                const entries = await Promise.all(clientIds.map(async id => [id, await store.getClient(id)]));
                this._clientsMapCache = Object.fromEntries(entries);
            }
            this._populateLabelFilter(this._tasksCache);

            if (searchTerm) {
                let results = this._tasksCache.filter(t => this._taskMatchesSearch(t, searchTerm));
                if (filterPriority) results = results.filter(t => t.priority === filterPriority);
                if (filterLabel)    results = results.filter(t => (t.labels || []).some(l => l.color === filterLabel));
                this._renderTaskSearchResultsList(results, this._clientsMapCache);
                await this.renderTasksDashboard(this._tasksCache, '');
                lucide.createIcons();
                return;
            }

            board.innerHTML = `
                <div class="kb-empty-state">
                    <i data-lucide="columns" style="width:48px;height:48px;opacity:0.25"></i>
                    <p>Selecione um cliente nos filtros para visualizar o Kanban</p>
                </div>`;
            await this.renderTasksDashboard(this._tasksCache, '');
            lucide.createIcons();
            return;
        }
```

- [ ] **Step 3: Mesmo ajuste em `_renderTasksFromCache()`**

Localizar (linhas 3415-3418):

```js
        if (!filterClient) {
            this._renderTasksDashboardSync(this._tasksCache, '');
            return;
        }
```

Substituir por:

```js
        if (!filterClient) {
            if (searchTerm) {
                let results = this._tasksCache.filter(t => this._taskMatchesSearch(t, searchTerm));
                if (filterPriority) results = results.filter(t => t.priority === filterPriority);
                if (filterLabel)    results = results.filter(t => (t.labels || []).some(l => l.color === filterLabel));
                this._renderTaskSearchResultsList(results, this._clientsMapCache);
                lucide.createIcons();
            }
            this._renderTasksDashboardSync(this._tasksCache, '');
            return;
        }
```

- [ ] **Step 4: Verificar manualmente no browser**

No app local, ir para Tarefas, garantir que o filtro Cliente está em "Todos" (vazio). Confirmar:
1. Sem termo de busca: placeholder "Selecione um cliente nos filtros..." aparece (comportamento inalterado).
2. Digitar um termo que bate com tarefas de **clientes diferentes** e apertar Enter → aparece uma tabela com colunas Título/Cliente/Prioridade/Concluída?, uma linha por tarefa encontrada, cada uma com o nome do cliente correto.
3. Digitar um termo sem nenhuma tarefa correspondente e apertar Enter → mensagem "Nenhuma tarefa encontrada para esse termo." aparece no lugar da tabela.
4. Clicar em uma linha da tabela → o modal de edição da tarefa (`modal-task`) abre com os dados certos (título, cliente, descrição, etc.) — confirmar que o cliente mostrado no modal é o mesmo da linha clicada.
5. Apagar o campo de busca e apertar Enter → volta ao placeholder do passo 1.

- [ ] **Step 5: Commit**

```powershell
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.6.1\resources\app\git\cmd\git.exe"
& $git add js/app.js
& $git commit -m "feat(tasks): add cross-client search results list when no client filter is active"
```

---

### Task 5: Documentação, regressão e deploy

**Files:**
- Modify: `CLAUDE.md` (seção "Armadilhas conhecidas", bloco de Kanban/Tarefas)

**Interfaces:**
- Consumes: nenhuma (tarefa de documentação e wrap-up).
- Produces: nenhuma (fim da feature).

- [ ] **Step 1: Adicionar entrada em "Armadilhas conhecidas" no `CLAUDE.md`**

Localizar o bloco de armadilhas do Kanban (próximo de "Kanban: filtro por label usa `l.color` como chave") e adicionar, na sequência:

```markdown
- **Kanban: busca textual roda sobre `_tasksCache`, que sempre contém todas as tarefas do usuário** — `store.getTasks()` nunca filtra por cliente; isso é o que permite a busca funcionar sem nenhuma query nova mesmo sem cliente selecionado. `_normalizeSearch()` remove acentos e caixa antes de comparar; `_taskMatchesSearch()` varre `title`, `description` e `comments[].text` (só itens com `type === 'comment'`, ignorando logs de atividade). No modo lista (sem cliente filtrado), a coluna "Concluída?" usa o booleano `t.completed`, não o nome da coluna Kanban — resolver o nome real exigiria buscar `kanban_columns` por cada cliente diferente nos resultados, custo que foi deliberadamente evitado.
```

- [ ] **Step 2: Commit da documentação**

```powershell
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.6.1\resources\app\git\cmd\git.exe"
& $git add CLAUDE.md
& $git commit -m "docs: document task search caveats in CLAUDE.md"
```

- [ ] **Step 3: Push de todos os commits da feature**

```powershell
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.6.1\resources\app\git\cmd\git.exe"
& $git push origin main
```

- [ ] **Step 4: Lembrar o usuário do deploy manual**

Avisar explicitamente: o webhook automático do Easypanel está quebrado (CLAUDE.md). É necessário abrir o Easypanel → projeto `jorge` → serviço `gerenciador-tsp` e disparar o deploy manualmente para a feature ir ao ar em produção.

- [ ] **Step 5 (opcional, após o deploy manual): Regressão com Playwright**

Só depois do deploy manual em produção, rodar a suíte E2E existente para garantir que nada quebrou:

```powershell
cd "d:\GerenciadorTSP\skills\playwright-skill"
node run.js "C:\Users\jorge\AppData\Local\Temp\playwright-test-tsp-v2.js"
```

Confirmar 48/48 testes passando (mesmo baseline documentado no CLAUDE.md). Esta suíte não cobre a busca textual em si (feature nova, fora do script existente) — serve apenas para confirmar que nenhuma regressão foi introduzida nas views existentes.

---

## Self-Review

- **Cobertura da spec**: escopo da busca com/sem cliente (Tasks 3 e 4) ✓; campos buscados título/descrição/comentários (Task 2) ✓; normalização de acento (Task 2) ✓; disparo por Enter sem debounce (Task 1) ✓; combinação AND com Prioridade/Label (Tasks 3 e 4) ✓; clique abre `handleEditTask` direto (Task 4) ✓; sem query nova (Global Constraints + Task 4, reaproveita `_tasksCache`/`_clientsMapCache`) ✓; modo lista com `completed` em vez de nome de coluna (Task 4) ✓; atualização do CLAUDE.md (Task 5) ✓.
- **Sem placeholders**: todos os steps têm código completo e comandos exatos, nenhum "TODO"/"implementar depois".
- **Consistência de nomes**: `_normalizeSearch`, `_taskMatchesSearch` e `_renderTaskSearchResultsList` são usados com a mesma assinatura em todas as tasks que os consomem (Tasks 3 e 4 chamam exatamente os mesmos nomes definidos na Task 2 e no Step 1 da Task 4).
