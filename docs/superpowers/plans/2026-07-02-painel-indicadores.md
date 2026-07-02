# Painel de Indicadores — Evolução do Cliente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar a view "Indicadores" (sidebar) — disponível para consultor (com seletor de cliente) e cliente (Portal), mostrando KPIs, gráfico mensal de tarefas, distribuição por status/prioridade, timeline do projeto, resumo e chat de IA, e exportação em PDF — sem tabelas novas no banco, calculando tudo sob demanda a partir de `tasks`/`records`/`agenda_events`/`implementations`.

**Architecture:** `store.getClientIndicators(clientId)` faz 6 queries paralelas (sem filtro por `user_id`, dependendo só de RLS) e delega a agregação pura para `store._computeClientIndicators(...)`. `app.js` ganha `renderIndicadores()` (mesmo padrão guard-by-`currentView` das demais views) que monta o HTML a partir desses dados. `ai.js` ganha dois métodos que reusam um builder de contexto textual comum. A Edge Function `ai-proxy` passa a resolver a config de IA via `service_role`, permitindo que o papel `client` use a config de IA do consultor dono do cliente.

**Tech Stack:** Vanilla JS ES6+ (sem build step), Supabase (Postgres + RLS + Edge Functions Deno), jsPDF + jsPDF-AutoTable (já carregado via CDN), Lucide Icons (já carregado).

## Global Constraints

- Sem tabelas novas — toda métrica é derivada de `tasks.completed_at`/`created_at`, `records.date`, `agenda_events.date`, `implementations.implementation_date` (spec: "Escopo").
- Dados financeiros (`client_pays`, `hourly_rate`, `consultant_bonus`) nunca podem aparecer nos KPIs, no HTML do painel, no contexto passado à IA, nem no PDF — em nenhum papel (spec: "Considerações e riscos conhecidos").
- Novas RLS policies são **somente leitura** (`SELECT`), aditivas, restritas por `user_roles.client_id`, e nunca alteram as policies existentes de `tasks`/`kanban_columns` (spec: "RLS — extensão para o papel client").
- Métodos do Portal do Cliente (`getClientPortalXxx`) e o novo `getClientIndicators` nunca filtram por `user_id` — dependem só da RLS, mesmo padrão documentado em `CLAUDE.md:387` (armadilha "Portal do Cliente").
- `ai-proxy` precisa do secret `SUPABASE_SERVICE_ROLE_KEY` (mesmo padrão de `whatsapp-bot/index.ts:50-56`).
- Deploy automático (webhook Easypanel) está quebrado — após cada `git push`, é preciso deploy manual no Easypanel antes de testar em produção (`CLAUDE.md`).
- Supabase não autentica em `localhost` — qualquer verificação que dependa de login/RLS/IA precisa rodar contra produção (memória do usuário: `feedback_test_after_fix.md`).

---

### Task 1: Migration SQL — RLS para o papel `client` em `clients`, `records`, `agenda_events`, `implementations`, `implementation_clients`

**Files:**
- Create: `supabase/migrations/20260702_indicadores_rls.sql`

**Interfaces:**
- Produces: 5 novas policies `SELECT`-only que a Task 2 (`store.getClientIndicators`) depende para funcionar quando chamada pelo papel `client`.

- [ ] **Step 1: Escrever a migration**

```sql
-- Fase: Painel de Indicadores — Evolução do Cliente
-- Extensão de RLS para o papel 'client' (Portal do Cliente) ler, além de
-- tasks/kanban_columns (já liberados na Fase 45), os demais dados do
-- próprio projeto: dados do cliente, horas, agenda e implementações.
-- Todas as policies são SELECT-only e seguem o mesmo padrão de
-- clients_read_own_tasks/clients_read_own_columns (EXISTS em user_roles
-- casando user_roles.client_id com o client_id da linha).

-- Cliente lê a própria linha em `clients` (nome, horas contratadas, status).
-- A UI/prompt de IA são responsáveis por nunca exibir client_pays/hourly_rate/
-- consultant_bonus para o papel client — esta policy libera a linha inteira.
CREATE POLICY "clients_read_own_client_row" ON clients
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = 'client'
              AND ur.client_id = clients.id
        )
    );

CREATE POLICY "clients_read_own_records" ON records
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = 'client'
              AND ur.client_id = records.client_id
        )
    );

CREATE POLICY "clients_read_own_agenda_events" ON agenda_events
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = 'client'
              AND ur.client_id = agenda_events.client_id
        )
    );

-- implementations não tem client_id direto — o vínculo é via implementation_clients.
CREATE POLICY "clients_read_own_implementations" ON implementations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM implementation_clients ic
            JOIN user_roles ur ON ur.client_id = ic.client_id
            WHERE ic.implementation_id = implementations.id
              AND ur.user_id = auth.uid()
              AND ur.role = 'client'
        )
    );

CREATE POLICY "clients_read_own_implementation_clients" ON implementation_clients
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = 'client'
              AND ur.client_id = implementation_clients.client_id
        )
    );
```

- [ ] **Step 2: Rodar a migration no Supabase SQL Editor**

Cole o conteúdo do arquivo no SQL Editor do projeto `klimkamnydfnzqetqlqm` e execute. Esperado: `Success. No rows returned` sem erros.

- [ ] **Step 3: Verificar que as 5 policies foram criadas**

Rodar no SQL Editor:

```sql
SELECT tablename, policyname FROM pg_policies
WHERE policyname LIKE 'clients_read_own_%'
ORDER BY tablename;
```

Esperado: 7 linhas (as 2 já existentes de `tasks`/`kanban_columns` da Fase 45 + as 5 novas desta migration: `clients`, `records`, `agenda_events`, `implementations`, `implementation_clients`).

- [ ] **Step 4: Commit**

```powershell
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.6.1\resources\app\git\cmd\git.exe"
& $git -C d:\GerenciadorTSP add supabase/migrations/20260702_indicadores_rls.sql
& $git -C d:\GerenciadorTSP commit -m "feat(db): RLS de leitura para o painel de Indicadores no Portal do Cliente"
```

---

### Task 2: store.js — `getClientIndicators(clientId)` e `_computeClientIndicators(...)`

**Files:**
- Modify: `js/store.js` (adicionar ao final da classe `TSPStore`, antes do fechamento `}` da classe — mesmo bloco onde vivem `getUserRole`/`getClientPortalTasks`, por volta da linha 931 em diante)

**Interfaces:**
- Consumes: `this.db`, `this.userId` (getters já existentes), mappers `_client()`, `_task()`, `_event()`, `_column()`, `_implementation()` (já existentes)
- Produces: `store.getClientIndicators(clientId): Promise<IndicatorsData>` e `store._computeClientIndicators(client, tasks, records, events, columns, implementations): IndicatorsData`, onde `IndicatorsData` é:
  ```js
  {
    client: { id, name, hoursTotal, ... }, // mesmo shape de _client(), SEM nunca ler clientPays/hourlyRate na renderização (Task 4)
    kpis: { tasksCompletedTotal, tasksCompletedThisMonth, tasksOpen, hoursUsed, hoursTotal, onTimeRate, avgCompletionDays },
    monthly: [{ month: 'YYYY-MM', completed: number, created: number }, ...], // 12 itens, mais antigo primeiro
    statusDistribution: [{ columnId, columnName, count }, ...],
    priorityDistribution: { [priorityValue]: count },
    timeline: [{ type: 'task'|'event'|'implementation', date: 'YYYY-MM-DD', title, description }, ...] // desc por data, máx 60
  }
  ```
  Usado por `app.js` (Task 4) e `ai.js` (Task 7).

- [ ] **Step 1: Adicionar o método `_computeClientIndicators` e `getClientIndicators`**

Inserir logo após o método `getClientPortalColumns` (linha 931 do arquivo atual):

```js
    // ── PAINEL DE INDICADORES ────────────────────────────────────────

    // Busca todos os dados de um cliente para o painel de Indicadores.
    // Nunca filtra por user_id — depende da RLS existente (consultor:
    // auth.uid()=user_id) e da nova RLS cross-user do papel 'client'
    // (user_roles.client_id = <tabela>.client_id). Funciona identicamente
    // para consultor e cliente-portal, mesma regra de getClientPortalTasks.
    async getClientIndicators(clientId) {
        const [clientRes, tasksRes, recordsRes, eventsRes, columnsRes, implLinksRes] = await Promise.all([
            this.db.from('clients').select('*').eq('id', clientId).single(),
            this.db.from('tasks').select('*').eq('client_id', clientId),
            this.db.from('records').select('minutes, date').eq('client_id', clientId),
            this.db.from('agenda_events').select('*').eq('client_id', clientId),
            this.db.from('kanban_columns').select('*').eq('client_id', clientId),
            this.db.from('implementation_clients')
                .select('implementation_id, implementations(*)')
                .eq('client_id', clientId)
        ]);
        if (clientRes.error) throw clientRes.error;
        if (tasksRes.error) throw tasksRes.error;
        if (recordsRes.error) throw recordsRes.error;
        if (eventsRes.error) throw eventsRes.error;
        if (columnsRes.error) throw columnsRes.error;
        if (implLinksRes.error) throw implLinksRes.error;

        const client = this._client(clientRes.data);
        const tasks = (tasksRes.data || []).map(r => this._task(r));
        const records = (recordsRes.data || []).map(r => ({ minutes: parseInt(r.minutes) || 0, date: r.date }));
        const events = (eventsRes.data || []).map(r => this._event(r));
        const columns = (columnsRes.data || []).map(r => this._column(r));
        const implementations = (implLinksRes.data || [])
            .map(l => l.implementations)
            .filter(Boolean)
            .map(r => this._implementation(r));

        return this._computeClientIndicators(client, tasks, records, events, columns, implementations);
    }

    // Cálculo puro (sem DB) — separado para poder ser testado isoladamente
    // no console do navegador sem depender de sessão/Supabase.
    _computeClientIndicators(client, tasks, records, events, columns, implementations) {
        const doneIds = new Set(columns.filter(c => c.isDone).map(c => c.id));
        doneIds.add('done'); // fallback legado (status pré-Kanban Fase 22)

        const completedTasks = tasks.filter(t => t.completed || doneIds.has(t.status));
        const thisMonth = new Date().toISOString().slice(0, 7);
        const tasksCompletedThisMonth = completedTasks.filter(t => t.completedAt && t.completedAt.startsWith(thisMonth)).length;

        const totalMinutesUsed = records.reduce((acc, r) => acc + r.minutes, 0);
        const hoursUsed = parseFloat((totalMinutesUsed / 60).toFixed(2));

        const tasksWithDueAndCompletion = completedTasks.filter(t => t.dueDate && t.completedAt);
        const onTimeCount = tasksWithDueAndCompletion.filter(t => t.completedAt.slice(0, 10) <= t.dueDate).length;
        const onTimeRate = tasksWithDueAndCompletion.length > 0
            ? Math.round((onTimeCount / tasksWithDueAndCompletion.length) * 100)
            : null;

        const durations = completedTasks
            .filter(t => t.createdAt && t.completedAt)
            .map(t => (new Date(t.completedAt) - new Date(t.createdAt)) / (1000 * 60 * 60 * 24));
        const avgCompletionDays = durations.length > 0
            ? parseFloat((durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1))
            : null;

        // Últimos 12 meses (mês corrente incluso), mais antigo primeiro
        const monthly = [];
        const now = new Date();
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = d.toISOString().slice(0, 7);
            monthly.push({
                month: key,
                completed: completedTasks.filter(t => t.completedAt && t.completedAt.startsWith(key)).length,
                created: tasks.filter(t => t.createdAt && t.createdAt.startsWith(key)).length
            });
        }

        const openTasks = tasks.filter(t => !t.completed && !doneIds.has(t.status));
        const statusDistribution = columns.map(c => ({
            columnId: c.id,
            columnName: c.name,
            count: tasks.filter(t => t.status === c.id).length
        }));

        const priorityDistribution = {};
        openTasks.forEach(t => {
            priorityDistribution[t.priority] = (priorityDistribution[t.priority] || 0) + 1;
        });

        const timelineItems = [];
        completedTasks.forEach(t => {
            if (t.completedAt) timelineItems.push({ type: 'task', date: t.completedAt.slice(0, 10), title: t.title, description: t.description || '' });
        });
        const todayIso = new Date().toISOString().slice(0, 10);
        events.filter(e => e.date <= todayIso).forEach(e => {
            timelineItems.push({ type: 'event', date: e.date, title: e.title, description: e.description || '' });
        });
        implementations.forEach(impl => {
            if (impl.implementationDate) timelineItems.push({ type: 'implementation', date: impl.implementationDate, title: impl.name, description: impl.description || '' });
        });
        timelineItems.sort((a, b) => b.date.localeCompare(a.date));

        return {
            client,
            kpis: {
                tasksCompletedTotal: completedTasks.length,
                tasksCompletedThisMonth,
                tasksOpen: openTasks.length,
                hoursUsed,
                hoursTotal: client.hoursTotal,
                onTimeRate,
                avgCompletionDays
            },
            monthly,
            statusDistribution,
            priorityDistribution,
            timeline: timelineItems.slice(0, 60)
        };
    }
```

- [ ] **Step 2: Verificar a função pura no console do navegador (sem precisar de login/Supabase)**

Com `python -m http.server 8080` rodando e `http://localhost:8080/index.html` aberto (não precisa logar — o `store` já existe em `window` antes da autenticação), colar no console do DevTools:

```js
const mockClient = { id: 'c1', name: 'Cliente Teste', hoursTotal: 40 };
const mockColumns = [
  { id: 'col1', name: 'Novas', isDone: false },
  { id: 'col2', name: 'Finalizadas', isDone: true }
];
const mockTasks = [
  { id: 't1', status: 'col2', completed: true, completedAt: new Date().toISOString(), createdAt: new Date(Date.now() - 3*86400000).toISOString(), dueDate: new Date().toISOString().slice(0,10), priority: 'medium', title: 'Tarefa 1' },
  { id: 't2', status: 'col1', completed: false, priority: 'high', title: 'Tarefa 2' }
];
const mockRecords = [{ minutes: 120, date: new Date().toISOString().slice(0,10) }];
const mockEvents = [{ date: new Date().toISOString().slice(0,10), title: 'Reunião', description: '' }];
const result = store._computeClientIndicators(mockClient, mockTasks, mockRecords, mockEvents, mockColumns, []);
console.log(JSON.stringify(result, null, 2));
```

Esperado: `kpis.tasksCompletedTotal === 1`, `kpis.tasksOpen === 1`, `kpis.hoursUsed === 2`, `kpis.onTimeRate === 100`, `statusDistribution` com 2 entradas (`Novas: 1`, `Finalizadas: 1`), `priorityDistribution` com `{ high: 1 }` (só a tarefa aberta), `timeline` com 2 itens (`task` e `event`).

- [ ] **Step 3: Commit**

```powershell
& $git -C d:\GerenciadorTSP add js/store.js
& $git -C d:\GerenciadorTSP commit -m "feat(store): getClientIndicators — agregação de dados para o painel de Indicadores"
```

---

### Task 3: index.html — nav item, view section, seletor de cliente (consultor)

**Files:**
- Modify: `index.html:137` (inserir novo `<li class="nav-item">` antes do item "Usuários")
- Modify: `index.html:853-855` (inserir nova `<section class="view-section" id="view-indicadores">` entre `view-users` e `</main>`)

**Interfaces:**
- Produces: elementos DOM `#indicadores-client-selector-wrap`, `#indicadores-client-select`, `#indicadores-container`, `#btn-indicadores-pdf` consumidos por `app.js` (Task 4-6, 8).

- [ ] **Step 1: Adicionar o nav-item, imediatamente antes da linha 138 (`<li class="nav-item" data-view="users"...`)**

```html
            <li class="nav-item" data-view="indicadores" title="Indicadores">
                <i data-lucide="line-chart"></i><span class="nav-label">Indicadores</span>
            </li>
```

- [ ] **Step 2: Adicionar a view section, entre `</section>` de `view-users` (linha 853) e `</main>` (linha 855)**

```html
        <section class="view-section" id="view-indicadores">
            <div class="view-header">
                <div class="view-header-left">
                    <h1>Indicadores</h1>
                    <div id="indicadores-client-selector-wrap" style="display:none;">
                        <select id="indicadores-client-select" class="form-control" onchange="app.onIndicadoresClientChange(this.value)"></select>
                    </div>
                </div>
                <div class="view-header-actions">
                    <button id="btn-indicadores-pdf" class="btn btn-secondary" onclick="app.exportIndicadoresPDF()">
                        <i data-lucide="file-down"></i>
                        <span class="nav-label">Exportar PDF</span>
                    </button>
                </div>
            </div>
            <div id="indicadores-container"></div>
        </section>
```

- [ ] **Step 3: Verificar visualmente**

Com o servidor local rodando, abrir `http://localhost:8080/index.html`, logar com o usuário de teste (`jorjaocorreia@gmail.com` / `Jhc1881//`), confirmar que o item "Indicadores" aparece na sidebar entre "Financeiro" e "Usuários", e que clicar nele mostra a `view-section` vazia (sem erros no console — `renderIndicadores()` ainda não existe, então o clique só troca a view visualmente via `switchView`, que já existe).

- [ ] **Step 4: Commit**

```powershell
& $git -C d:\GerenciadorTSP add index.html
& $git -C d:\GerenciadorTSP commit -m "feat(ui): scaffold HTML da view Indicadores (nav item + section)"
```

---

### Task 4: app.js — `VIEW_ORDER`, `renderAll()`, `renderIndicadores()` e render do conteúdo (KPIs, gráfico mensal, distribuição, timeline)

**Files:**
- Modify: `js/app.js:369` (`VIEW_ORDER`)
- Modify: `js/app.js` (constructor, por volta da linha 63 — adicionar novos campos de estado)
- Modify: `js/app.js` (dentro do `Promise.all` de `renderAll()`, por volta da linha ~2020 — adicionar `this.renderIndicadores()`)
- Modify: `js/app.js` (adicionar novos métodos `renderIndicadores`, `_ensureIndicadoresClientOptions`, `onIndicadoresClientChange`, `_renderIndicadoresContent`, `_animateIndicadoresBars` — no bloco de métodos de render, próximo a `renderProdutividade`/`renderFinanceiro`)

**Interfaces:**
- Consumes: `store.getClientIndicators(clientId)` e `store.getClients()` (Task 2, já existente), `this.userRole`/`this.userClientId` (já existentes, setados em `initAfterAuth`), `escapeHtml()`, `spinnerHtml`, `Toast.show()`, `lucide.createIcons()` (todos já existentes no arquivo)
- Produces: `app.renderIndicadores()`, `app.onIndicadoresClientChange(clientId)`, `this._indicadoresData` (cache do último resultado, consumido pelas Tasks 6 e 8), `this.indicadoresClientId`

- [ ] **Step 1: Atualizar `VIEW_ORDER` (linha 369)**

```js
        const VIEW_ORDER = ['dashboard','clients','records','tasks','agenda','apontamentos','implementations','trainings','chamados','produtividade','financeiro','indicadores','users'];
```

- [ ] **Step 2: Adicionar campos de estado no constructor, logo após `this.userClientId = null;` (linha 63)**

```js
        this.indicadoresClientId = null;  // cliente selecionado no painel (só papel 'consultant')
        this._indicadoresData = null;     // cache do último resultado de getClientIndicators()
        this._indicadoresChatHistory = []; // histórico do chat de IA, só em memória
```

- [ ] **Step 3: Adicionar `this.renderIndicadores()` ao `Promise.all` de `renderAll()`, junto de `this.renderFinanceiro()`**

Localizar o bloco (por volta da linha 2020):
```js
                this.renderProdutividade(),
                this.renderFinanceiro(),
                this.renderUsers()
```
Substituir por:
```js
                this.renderProdutividade(),
                this.renderFinanceiro(),
                this.renderIndicadores(),
                this.renderUsers()
```

- [ ] **Step 4: Adicionar os novos métodos de render** (inserir próximo a `renderFinanceiro`/`renderProdutividade`, no corpo da classe `AppController`)

```js
    // ── PAINEL DE INDICADORES ────────────────────────────────────────

    async renderIndicadores() {
        if (this.currentView !== 'indicadores') return;
        const container = document.getElementById('indicadores-container');
        if (!container) return;

        const selectorWrap = document.getElementById('indicadores-client-selector-wrap');
        let clientId = null;

        if (this.userRole === 'client') {
            clientId = this.userClientId;
            if (selectorWrap) selectorWrap.style.display = 'none';
        } else {
            if (selectorWrap) selectorWrap.style.display = '';
            await this._ensureIndicadoresClientOptions();
            clientId = this.indicadoresClientId;
        }

        if (!clientId) {
            container.innerHTML = '<p class="text-muted" style="padding:24px;">Selecione um cliente para ver os indicadores.</p>';
            return;
        }

        container.innerHTML = spinnerHtml;
        try {
            const data = await store.getClientIndicators(clientId);
            this._indicadoresData = data;
            container.innerHTML = this._renderIndicadoresContent(data);
            lucide.createIcons();
            this._animateIndicadoresBars();
        } catch (err) {
            container.innerHTML = `<p class="text-muted" style="padding:24px;">Erro ao carregar indicadores: ${err.message}</p>`;
        }
    }

    async _ensureIndicadoresClientOptions() {
        const select = document.getElementById('indicadores-client-select');
        if (!select || select.options.length > 0) return;
        const clients = await store.getClients();
        select.innerHTML = clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
        if (clients.length > 0 && !this.indicadoresClientId) this.indicadoresClientId = clients[0].id;
    }

    onIndicadoresClientChange(clientId) {
        this.indicadoresClientId = clientId;
        this._indicadoresChatHistory = [];
        this.renderIndicadores();
    }

    _renderIndicadoresContent(data) {
        const { kpis, monthly, statusDistribution, priorityDistribution, timeline } = data;
        const pct = kpis.hoursTotal > 0 ? Math.min(100, Math.round((kpis.hoursUsed / kpis.hoursTotal) * 100)) : 0;

        const kpiCards = `
            <div class="indicadores-kpi-grid">
                <div class="glass indicadores-kpi-card">
                    <span class="indicadores-kpi-label">Tarefas concluídas</span>
                    <span class="indicadores-kpi-value">${kpis.tasksCompletedTotal}</span>
                    <span class="indicadores-kpi-sub">${kpis.tasksCompletedThisMonth} este mês</span>
                </div>
                <div class="glass indicadores-kpi-card">
                    <span class="indicadores-kpi-label">Horas consumidas</span>
                    <span class="indicadores-kpi-value">${kpis.hoursUsed}h</span>
                    <span class="indicadores-kpi-sub">${kpis.hoursTotal}h contratadas (${pct}%)</span>
                </div>
                <div class="glass indicadores-kpi-card">
                    <span class="indicadores-kpi-label">Entregas no prazo</span>
                    <span class="indicadores-kpi-value">${kpis.onTimeRate !== null ? kpis.onTimeRate + '%' : '—'}</span>
                    <span class="indicadores-kpi-sub">${kpis.tasksOpen} tarefas em aberto</span>
                </div>
                <div class="glass indicadores-kpi-card">
                    <span class="indicadores-kpi-label">Tempo médio de conclusão</span>
                    <span class="indicadores-kpi-value">${kpis.avgCompletionDays !== null ? kpis.avgCompletionDays + ' dias' : '—'}</span>
                </div>
            </div>`;

        const maxMonthly = Math.max(...monthly.map(m => Math.max(m.completed, m.created)), 1);
        const monthlyRows = monthly.map(m => {
            const [y, mm] = m.month.split('-');
            const label = `${mm}/${y.slice(2)}`;
            const completedPct = Math.round(m.completed / maxMonthly * 100);
            return `
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">
                    <span style="width:42px;font-size:0.75rem;color:var(--text-muted);flex-shrink:0;">${label}</span>
                    <div style="flex:1;position:relative;height:14px;background:rgba(255,255,255,0.07);border-radius:4px;overflow:hidden;">
                        <div class="indicadores-bar-fill" data-w="${completedPct}" style="height:100%;width:0;background:linear-gradient(90deg,#22c55e,#16a34a);border-radius:4px;transition:width 0.55s ease;"></div>
                    </div>
                    <span style="width:70px;text-align:right;font-size:0.78rem;color:var(--text-muted);flex-shrink:0;">${m.completed} concl.</span>
                </div>`;
        }).join('');

        const statusRows = statusDistribution.map(s => `
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-color);">
                <span>${escapeHtml(s.columnName)}</span><span>${s.count}</span>
            </div>`).join('') || '<p class="text-muted">Sem colunas configuradas.</p>';

        const priorityRows = Object.entries(priorityDistribution).map(([p, count]) => `
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-color);">
                <span>${escapeHtml(p)}</span><span>${count}</span>
            </div>`).join('') || '<p class="text-muted">Sem tarefas em aberto.</p>';

        const timelineIcons = { task: 'check-circle', event: 'calendar', implementation: 'package' };
        const timelineRows = timeline.map(item => `
            <div class="indicadores-timeline-item">
                <i data-lucide="${timelineIcons[item.type] || 'circle'}"></i>
                <div>
                    <div class="indicadores-timeline-title">${escapeHtml(item.title)}</div>
                    <div class="indicadores-timeline-date">${item.date.split('-').reverse().join('/')}</div>
                </div>
            </div>`).join('') || '<p class="text-muted">Nenhum evento registrado ainda.</p>';

        return `
            <div id="indicadores-ai-section"></div>
            ${kpiCards}
            <div class="glass" style="padding:20px 24px;margin-bottom:16px;">
                <h3 style="margin:0 0 16px;font-size:1rem;">Tarefas concluídas por mês</h3>
                ${monthlyRows}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
                <div class="glass" style="padding:20px 24px;">
                    <h3 style="margin:0 0 10px;font-size:1rem;">Tarefas por status</h3>
                    ${statusRows}
                </div>
                <div class="glass" style="padding:20px 24px;">
                    <h3 style="margin:0 0 10px;font-size:1rem;">Tarefas abertas por prioridade</h3>
                    ${priorityRows}
                </div>
            </div>
            <div class="glass" style="padding:20px 24px;margin-bottom:16px;">
                <h3 style="margin:0 0 16px;font-size:1rem;">Linha do tempo do projeto</h3>
                <div class="indicadores-timeline">${timelineRows}</div>
            </div>
        `;
    }

    _animateIndicadoresBars() {
        document.querySelectorAll('#indicadores-container .indicadores-bar-fill').forEach(el => {
            const w = el.dataset.w;
            requestAnimationFrame(() => requestAnimationFrame(() => { el.style.width = w + '%'; }));
        });
    }
```

Nota: `#indicadores-ai-section` fica vazio nesta task — populado pela Task 6 (resumo + chat de IA).

- [ ] **Step 5: Verificar em produção (requer login + dados reais — Supabase não autentica em `localhost`)**

Fazer commit + push, deploy manual no Easypanel (`CLAUDE.md`), depois em `https://jorge-gerenciador-tsp.27pl2o.easypanel.host`:
1. Logar com `jorjaocorreia@gmail.com` / `Jhc1881//`.
2. Abrir a view "Indicadores" — deve aparecer o seletor de cliente populado.
3. Selecionar um cliente com tarefas concluídas e horas lançadas — os 4 KPI cards, o gráfico mensal, as distribuições e a timeline devem aparecer preenchidos (sem erros no console).
4. Trocar de cliente no seletor — o painel deve recarregar para o novo cliente.

- [ ] **Step 6: Commit**

```powershell
& $git -C d:\GerenciadorTSP add js/app.js
& $git -C d:\GerenciadorTSP commit -m "feat(ui): renderIndicadores — KPIs, gráfico mensal, distribuição e timeline"
```

---

### Task 5: app.js — Portal do Cliente: liberar nav item "Indicadores" e navegação entre `tasks`/`indicadores`

**Files:**
- Modify: `js/app.js:169-178` (listener de clique nos `.nav-item`)
- Modify: `js/app.js:1956-1981` (`enterClientPortalMode`)

**Interfaces:**
- Produces: `app.switchClientPortalView(view)`, usado pelo listener de clique quando `this.userRole === 'client'`.

**Contexto do problema:** hoje, quando `this.userRole === 'client'`, o listener de clique em qualquer `.nav-item` (linha 172-175) sempre chama `this.renderClientPortalTasks()`, ignorando qual view foi clicada — e `enterClientPortalMode()` (linha 1958) só exibe o item `data-view="tasks"` no menu, escondendo todos os outros. Sem alterar isso, o cliente nunca conseguiria acessar "Indicadores" mesmo com o item visível.

- [ ] **Step 1: Atualizar o listener de clique (linhas 169-178)**

Código atual:
```js
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const view = e.currentTarget.getAttribute('data-view');
                if (this.userRole === 'client') {
                    this.renderClientPortalTasks();
                    return;
                }
                this.switchView(view);
            });
        });
```

Substituir por:
```js
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const view = e.currentTarget.getAttribute('data-view');
                if (this.userRole === 'client') {
                    this.switchClientPortalView(view);
                    return;
                }
                this.switchView(view);
            });
        });
```

- [ ] **Step 2: Adicionar `switchClientPortalView(view)`, logo após `enterClientPortalMode()` (após a linha 1981)**

```js
    // Navegação dentro do Portal do Cliente — só 'tasks' e 'indicadores'
    // são liberados (ver filtro de visibilidade em enterClientPortalMode).
    switchClientPortalView(view) {
        if (!['tasks', 'indicadores'].includes(view)) return;
        this.currentView = view;
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.getAttribute('data-view') === view);
        });
        document.querySelectorAll('.view-section').forEach(section => {
            section.classList.toggle('active', section.id === `view-${view}`);
        });
        if (view === 'tasks') {
            this.renderClientPortalTasks();
        } else {
            this.renderIndicadores();
        }
    }
```

- [ ] **Step 3: Atualizar `enterClientPortalMode()` para liberar o item "Indicadores" no menu (linha 1958)**

Código atual:
```js
        document.querySelectorAll('.nav-item').forEach(item => {
            item.style.display = item.getAttribute('data-view') === 'tasks' ? '' : 'none';
        });
```

Substituir por:
```js
        document.querySelectorAll('.nav-item').forEach(item => {
            const view = item.getAttribute('data-view');
            item.style.display = ['tasks', 'indicadores'].includes(view) ? '' : 'none';
        });
```

- [ ] **Step 4: Verificar em produção com um usuário de papel `client`**

Se ainda não existir um usuário de teste com papel `client` vinculado a um `client_id` de teste, criar um via view "Usuários" → "Convidar" (logado como consultor), escolhendo um cliente de teste. Depois:
1. Logar com o usuário-cliente.
2. Confirmar que a sidebar mostra apenas "Tarefas" e "Indicadores".
3. Clicar em "Indicadores" — deve renderizar o painel do próprio `client_id` (sem seletor de cliente).
4. Clicar em "Tarefas" — deve voltar ao Kanban read-only normalmente (regressão da Fase 45).
5. Abrir o DevTools → Network e confirmar que nenhuma requisição inclui `client_id` de outro cliente.

- [ ] **Step 5: Commit**

```powershell
& $git -C d:\GerenciadorTSP add js/app.js
& $git -C d:\GerenciadorTSP commit -m "feat(portal): navegação entre Tarefas e Indicadores no Portal do Cliente"
```

---

### Task 6: ai-proxy — resolver `user_ai_config` do consultor dono do cliente via `service_role`

**Files:**
- Modify: `supabase/functions/ai-proxy/index.ts` (trecho de resolução de `user_ai_config`, atualmente linhas ~40-49)

**Interfaces:**
- Consumes: tabela `user_roles` (`role`, `client_id`), tabela `clients` (`user_id`) — já existentes
- Produces: mesmo contrato de resposta (`{ content }` ou `{ error }`), sem mudança na assinatura HTTP consumida por `ai.js` (Task 7)

- [ ] **Step 1: Adicionar um cliente `service_role` e a lógica de resolução do "dono" da config**

Localizar o bloco atual (dentro do `serve(async (req) => { try { ... } })`, logo após obter `user` via `supabase.auth.getUser()`):
```ts
    const { action, systemPrompt, userPrompt } = await req.json();

    if (action !== "complete") {
      return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: corsHeaders });
    }

    // Busca config de IA do usuário
    const { data: config, error: configError } = await supabase
      .from("user_ai_config")
      .select("provider, api_key, model")
      .eq("user_id", user.id)
      .single();
```

Substituir por:
```ts
    const { action, systemPrompt, userPrompt } = await req.json();

    if (action !== "complete") {
      return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: corsHeaders });
    }

    // Resolve de qual usuário buscar a config de IA: o próprio (papel
    // 'consultant') ou o consultor dono do client_id vinculado (papel
    // 'client' — Painel de Indicadores no Portal do Cliente). Usa
    // service_role porque RLS normal bloqueia o cliente de ler a config
    // do consultor.
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    let configOwnerId = user.id;
    const { data: roleRow } = await adminClient
      .from("user_roles")
      .select("role, client_id")
      .eq("user_id", user.id)
      .single();

    if (roleRow?.role === "client" && roleRow.client_id) {
      const { data: clientRow } = await adminClient
        .from("clients")
        .select("user_id")
        .eq("id", roleRow.client_id)
        .single();
      if (clientRow?.user_id) configOwnerId = clientRow.user_id;
    }

    // Busca config de IA do usuário resolvido acima
    const { data: config, error: configError } = await adminClient
      .from("user_ai_config")
      .select("provider, api_key, model")
      .eq("user_id", configOwnerId)
      .single();
```

- [ ] **Step 2: Configurar o secret `SUPABASE_SERVICE_ROLE_KEY` na função (se ainda não existir)**

No Supabase Dashboard → Edge Functions → `ai-proxy` → Secrets, confirmar/adicionar `SUPABASE_SERVICE_ROLE_KEY` (mesmo valor já usado em `whatsapp-bot`, disponível em Project Settings → API → service_role key).

- [ ] **Step 3: Deploy da função**

```powershell
$env:SUPABASE_ACCESS_TOKEN = "PLACEHOLDER_SUPABASE_TOKEN_VER_MEMORIA"
npx supabase@latest functions deploy ai-proxy --project-ref klimkamnydfnzqetqlqm
```

Esperado: saída `Deployed Function ai-proxy` sem erros.

- [ ] **Step 4: Verificar que o comportamento do consultor não regrediu**

Logado como consultor (`jorjaocorreia@gmail.com`) com IA já configurada, abrir qualquer view com botão de IA existente (ex: gerar insight no Dashboard) e confirmar que ainda funciona normalmente — a resolução `configOwnerId = user.id` para papel `consultant` preserva o comportamento atual.

- [ ] **Step 5: Commit**

```powershell
& $git -C d:\GerenciadorTSP add supabase/functions/ai-proxy/index.ts
& $git -C d:\GerenciadorTSP commit -m "feat(ai-proxy): resolve config de IA do consultor dono do cliente via service_role"
```

---

### Task 7: ai.js — resumo automático e chat de IA sobre os indicadores

**Files:**
- Modify: `js/ai.js` (adicionar métodos à classe `TSPAIClient`, antes de `window.aiClient = new TSPAIClient();`)

**Interfaces:**
- Consumes: `this.complete(systemPrompt, userPrompt)` (já existente), `IndicatorsData` (shape definido na Task 2)
- Produces: `aiClient.generateClientIndicatorsSummary(data): Promise<string>`, `aiClient.chatAboutClientIndicators(data, question, history): Promise<string>`, onde `history` é `[{ role: 'user'|'assistant', content: string }]`

- [ ] **Step 1: Adicionar o builder de contexto e os dois métodos**

Inserir antes de `window.aiClient = new TSPAIClient();` (final do arquivo, após `generateAgendaReportNarrative`):

```js
    // ── PAINEL DE INDICADORES ────────────────────────────────────────

    // Contexto textual compacto reaproveitado pelo resumo e pelo chat.
    // Nunca inclui client_pays/hourly_rate/consultant_bonus — esses
    // campos simplesmente não existem em IndicatorsData (store.js).
    _buildIndicadoresContext(data) {
        const { client, kpis, monthly, statusDistribution, priorityDistribution, timeline } = data;
        const monthlyLines = monthly.map(m => `${m.month}: ${m.completed} concluídas, ${m.created} criadas`).join('\n');
        const statusLines = statusDistribution.map(s => `${s.columnName}: ${s.count}`).join(', ');
        const priorityLines = Object.entries(priorityDistribution).map(([p, c]) => `${p}: ${c}`).join(', ');
        const timelineLines = timeline.slice(0, 20).map(t => `${t.date} [${t.type}] ${t.title}`).join('\n');

        return `Cliente: ${client.name}
Tarefas concluídas (total): ${kpis.tasksCompletedTotal} (${kpis.tasksCompletedThisMonth} este mês)
Tarefas em aberto: ${kpis.tasksOpen}
Horas consumidas: ${kpis.hoursUsed}h de ${kpis.hoursTotal}h contratadas
Taxa de entrega no prazo: ${kpis.onTimeRate !== null ? kpis.onTimeRate + '%' : 'sem dados suficientes'}
Tempo médio de conclusão: ${kpis.avgCompletionDays !== null ? kpis.avgCompletionDays + ' dias' : 'sem dados suficientes'}

Evolução mensal (tarefas):
${monthlyLines}

Tarefas por status: ${statusLines}
Tarefas abertas por prioridade: ${priorityLines}

Eventos recentes do projeto (mais recente primeiro):
${timelineLines}`;
    }

    async generateClientIndicatorsSummary(data) {
        const system = `Você é um consultor de TI resumindo a evolução de um projeto para quem está acompanhando (pode ser o próprio cliente ou o consultor responsável).
Escreva um resumo curto (4-6 frases), direto, destacando ritmo de entregas, saúde do consumo de horas e pontos de atenção se houver.
Nunca mencione valores financeiros, comissão ou preço — esses dados não fazem parte do contexto e não devem ser inventados.
Responda apenas com o texto do resumo, sem markdown, sem título.`;
        const user = this._buildIndicadoresContext(data);
        return this.complete(system, user);
    }

    async chatAboutClientIndicators(data, question, history = []) {
        const system = `Você é um assistente que responde dúvidas sobre o andamento de um projeto de consultoria, com base nos dados fornecidos.
Responda apenas com base nos dados abaixo — se a pergunta não puder ser respondida com esses dados, diga isso claramente em vez de inventar.
Nunca mencione valores financeiros, comissão ou preço — esses dados não fazem parte do contexto e não devem ser inventados.
Seja direto e objetivo, poucas frases.

Dados do projeto:
${this._buildIndicadoresContext(data)}`;

        const historyText = history.map(h => `${h.role === 'user' ? 'Usuário' : 'Assistente'}: ${h.content}`).join('\n');
        const user = historyText ? `${historyText}\nUsuário: ${question}` : question;

        return this.complete(system, user);
    }
```

- [ ] **Step 2: Verificar a montagem do contexto no console (sem precisar de IA configurada)**

No DevTools, com a página carregada:
```js
const mockData = {
  client: { name: 'Cliente Teste' },
  kpis: { tasksCompletedTotal: 5, tasksCompletedThisMonth: 2, tasksOpen: 3, hoursUsed: 10, hoursTotal: 40, onTimeRate: 80, avgCompletionDays: 3.5 },
  monthly: [{ month: '2026-06', completed: 2, created: 3 }],
  statusDistribution: [{ columnName: 'Novas', count: 3 }],
  priorityDistribution: { high: 1, medium: 2 },
  timeline: [{ date: '2026-07-01', type: 'task', title: 'Tarefa X' }]
};
console.log(aiClient._buildIndicadoresContext(mockData));
```

Esperado: texto formatado sem nenhuma menção a valores monetários, incluindo todas as seções (KPIs, evolução mensal, status, prioridade, timeline).

- [ ] **Step 3: Commit**

```powershell
& $git -C d:\GerenciadorTSP add js/ai.js
& $git -C d:\GerenciadorTSP commit -m "feat(ai): resumo e chat de IA sobre os indicadores do cliente"
```

---

### Task 8: app.js — UI do resumo e chat de IA no painel

**Files:**
- Modify: `js/app.js` (método `_renderIndicadoresContent`, criado na Task 4 — alterar o preenchimento de `#indicadores-ai-section`)
- Modify: `js/app.js` (adicionar métodos `generateIndicadoresSummary`, `sendIndicadoresChatMessage`, `_appendIndicadoresChatBubble`)
- Modify: `js/app.js` (logout handler, linha ~10351, para resetar `_indicadoresChatHistory`/`_indicadoresData`/`indicadoresClientId`)

**Interfaces:**
- Consumes: `aiClient.isConfigured`, `aiClient.generateClientIndicatorsSummary(data)`, `aiClient.chatAboutClientIndicators(data, question, history)` (Task 7), `this._indicadoresData`, `this._indicadoresChatHistory` (Task 4)
- Produces: `app.generateIndicadoresSummary()`, `app.sendIndicadoresChatMessage()`

- [ ] **Step 1: Alterar `_renderIndicadoresContent` para preencher a seção de IA condicionalmente**

Localizar, dentro de `_renderIndicadoresContent` (Task 4), a linha:
```js
        return `
            <div id="indicadores-ai-section"></div>
```

Substituir o bloco `return` inteiro (mantendo tudo igual, só trocando essa primeira linha do template) por:
```js
        const aiSummarySection = aiClient.isConfigured ? `
            <div class="glass" style="padding:20px 24px;margin-bottom:16px;" id="indicadores-ai-summary-box">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                    <h3 style="margin:0;font-size:1rem;">Resumo (IA)</h3>
                    <button class="btn btn-secondary btn-sm" onclick="app.generateIndicadoresSummary()"><i data-lucide="sparkles"></i> Gerar resumo</button>
                </div>
                <div id="indicadores-ai-summary-text" class="text-muted">Clique em "Gerar resumo" para uma análise do andamento do projeto.</div>
            </div>` : '';

        const aiChatSection = aiClient.isConfigured ? `
            <div class="glass" style="padding:20px 24px;" id="indicadores-ai-chat-box">
                <h3 style="margin:0 0 10px;font-size:1rem;">Tire suas dúvidas</h3>
                <div id="indicadores-chat-messages" class="indicadores-chat-messages"></div>
                <div style="display:flex;gap:8px;margin-top:10px;">
                    <input type="text" id="indicadores-chat-input" class="form-control" placeholder="Pergunte sobre o projeto..." onkeydown="if(event.key==='Enter') app.sendIndicadoresChatMessage();">
                    <button class="btn btn-primary" onclick="app.sendIndicadoresChatMessage()"><i data-lucide="send"></i></button>
                </div>
            </div>` : '';

        return `
            ${aiSummarySection}
```

E, no final do mesmo template literal (onde hoje termina com a timeline e o fechamento `` ` `` ``), adicionar `${aiChatSection}` logo após o bloco da timeline, antes do fechamento:
```js
            <div class="glass" style="padding:20px 24px;margin-bottom:16px;">
                <h3 style="margin:0 0 16px;font-size:1rem;">Linha do tempo do projeto</h3>
                <div class="indicadores-timeline">${timelineRows}</div>
            </div>
            ${aiChatSection}
        `;
    }
```

- [ ] **Step 2: Adicionar os métodos de interação com IA** (inserir logo após `_animateIndicadoresBars`, criado na Task 4)

```js
    async generateIndicadoresSummary() {
        if (!this._indicadoresData) return;
        const box = document.getElementById('indicadores-ai-summary-text');
        if (!box) return;
        box.textContent = 'Gerando resumo...';
        try {
            const summary = await aiClient.generateClientIndicatorsSummary(this._indicadoresData);
            box.textContent = summary;
        } catch (err) {
            box.textContent = 'Erro ao gerar resumo: ' + err.message;
        }
    }

    async sendIndicadoresChatMessage() {
        const input = document.getElementById('indicadores-chat-input');
        const messagesBox = document.getElementById('indicadores-chat-messages');
        if (!input || !messagesBox || !this._indicadoresData) return;
        const question = input.value.trim();
        if (!question) return;
        input.value = '';

        this._indicadoresChatHistory.push({ role: 'user', content: question });
        this._appendIndicadoresChatBubble('user', question);

        const loadingId = 'indicadores-chat-loading-' + Date.now();
        messagesBox.insertAdjacentHTML('beforeend', `<div id="${loadingId}" class="indicadores-chat-bubble indicadores-chat-bubble-ai">Pensando...</div>`);
        messagesBox.scrollTop = messagesBox.scrollHeight;

        try {
            const historyBeforeQuestion = this._indicadoresChatHistory.slice(0, -1);
            const answer = await aiClient.chatAboutClientIndicators(this._indicadoresData, question, historyBeforeQuestion);
            document.getElementById(loadingId)?.remove();
            this._indicadoresChatHistory.push({ role: 'assistant', content: answer });
            this._appendIndicadoresChatBubble('ai', answer);
        } catch (err) {
            document.getElementById(loadingId)?.remove();
            this._appendIndicadoresChatBubble('ai', 'Erro ao responder: ' + err.message);
        }
    }

    _appendIndicadoresChatBubble(who, text) {
        const messagesBox = document.getElementById('indicadores-chat-messages');
        if (!messagesBox) return;
        const cls = who === 'user' ? 'indicadores-chat-bubble-user' : 'indicadores-chat-bubble-ai';
        messagesBox.insertAdjacentHTML('beforeend', `<div class="indicadores-chat-bubble ${cls}">${escapeHtml(text)}</div>`);
        messagesBox.scrollTop = messagesBox.scrollHeight;
    }
```

- [ ] **Step 3: Resetar estado no logout**

Localizar, no handler de `btn-logout` (por volta da linha 10351):
```js
            window.app._agendaTasksCache = null;
        }
```

Substituir por:
```js
            window.app._agendaTasksCache = null;
            window.app.indicadoresClientId = null;
            window.app._indicadoresData = null;
            window.app._indicadoresChatHistory = [];
        }
```

- [ ] **Step 4: Verificar em produção (requer IA configurada)**

Com o consultor (`jorjaocorreia@gmail.com`) já com IA configurada (Configurações de IA na sidebar):
1. Abrir "Indicadores", clicar em "Gerar resumo" — texto deve aparecer em alguns segundos, sem menção a valores financeiros.
2. Digitar uma pergunta no chat (ex: "quantas tarefas estão em aberto?") e enviar — resposta deve chegar coerente com os KPIs exibidos.
3. Repetir o teste logado como o usuário-cliente criado na Task 5 — o resumo/chat devem funcionar usando a config de IA do consultor (Task 6), mesmo sem o cliente ter `user_ai_config` própria.

- [ ] **Step 5: Commit**

```powershell
& $git -C d:\GerenciadorTSP add js/app.js
& $git -C d:\GerenciadorTSP commit -m "feat(ui): resumo e chat de IA no painel de Indicadores"
```

---

### Task 9: Exportação em PDF + estilos CSS

**Files:**
- Modify: `js/app.js` (adicionar `exportIndicadoresPDF`, próximo a `exportProdutividadePDF`)
- Modify: `styles/main.css` (adicionar classes `.indicadores-kpi-grid`, `.indicadores-kpi-card`, `.indicadores-kpi-label/value/sub`, `.indicadores-timeline`, `.indicadores-timeline-item`, `.indicadores-timeline-title/date`, `.indicadores-chat-messages`, `.indicadores-chat-bubble` — usadas desde a Task 4/8)

**Interfaces:**
- Consumes: `this._indicadoresData` (Task 4), `window.jspdf` (já carregado via CDN)
- Produces: `app.exportIndicadoresPDF()`, consumido pelo botão `#btn-indicadores-pdf` (Task 3)

- [ ] **Step 1: Adicionar `exportIndicadoresPDF`, logo após `_appendIndicadoresChatBubble` (Task 8)**

```js
    async exportIndicadoresPDF() {
        const data = this._indicadoresData;
        if (!data) { Toast.show('Carregue os indicadores antes de exportar.', 'info'); return; }
        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            const { client, kpis, monthly, timeline } = data;

            doc.setFontSize(16);
            doc.text(`Indicadores — ${client.name}`, 14, 18);
            doc.setFontSize(10);
            doc.text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')}`, 14, 26);

            doc.setFontSize(11);
            doc.text(`Tarefas concluídas: ${kpis.tasksCompletedTotal} (${kpis.tasksCompletedThisMonth} este mês)`, 14, 38);
            doc.text(`Horas consumidas: ${kpis.hoursUsed}h de ${kpis.hoursTotal}h contratadas`, 14, 44);
            doc.text(`Entregas no prazo: ${kpis.onTimeRate !== null ? kpis.onTimeRate + '%' : 'sem dados'}`, 14, 50);
            doc.text(`Tempo médio de conclusão: ${kpis.avgCompletionDays !== null ? kpis.avgCompletionDays + ' dias' : 'sem dados'}`, 14, 56);

            const monthlyRows = monthly.map(m => [m.month, String(m.completed), String(m.created)]);
            doc.autoTable({
                startY: 64,
                head: [["Mês", "Concluídas", "Criadas"]],
                body: monthlyRows,
                styles: { fontSize: 8 },
                headStyles: { fillColor: [79, 70, 229] },
            });

            const timelineRows = timeline.slice(0, 30).map(t => [t.date.split('-').reverse().join('/'), t.type, t.title.substring(0, 60)]);
            doc.autoTable({
                startY: doc.lastAutoTable.finalY + 10,
                head: [["Data", "Tipo", "Item"]],
                body: timelineRows,
                styles: { fontSize: 8 },
                headStyles: { fillColor: [79, 70, 229] },
            });

            doc.save(`indicadores_${client.name.replace(/\s+/g, '_')}_${new Date().getTime()}.pdf`);
        } catch (err) {
            Toast.show('Erro ao gerar PDF: ' + err.message, 'error');
        }
    }
```

- [ ] **Step 2: Adicionar as classes CSS ao final de `styles/main.css`**

```css
/* Painel de Indicadores */
.indicadores-kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
    margin-bottom: 16px;
}
.indicadores-kpi-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 18px 20px;
}
.indicadores-kpi-label {
    font-size: 0.78rem;
    color: var(--text-muted);
}
.indicadores-kpi-value {
    font-size: 1.6rem;
    font-weight: 700;
}
.indicadores-kpi-sub {
    font-size: 0.75rem;
    color: var(--text-muted);
}
.indicadores-timeline {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-height: 420px;
    overflow-y: auto;
}
.indicadores-timeline-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
}
.indicadores-timeline-item i {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--primary);
}
.indicadores-timeline-title {
    font-size: 0.88rem;
}
.indicadores-timeline-date {
    font-size: 0.75rem;
    color: var(--text-muted);
}
.indicadores-chat-messages {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 320px;
    overflow-y: auto;
}
.indicadores-chat-bubble {
    padding: 8px 12px;
    border-radius: 10px;
    font-size: 0.85rem;
    max-width: 85%;
}
.indicadores-chat-bubble-user {
    align-self: flex-end;
    background: var(--primary);
    color: #fff;
}
.indicadores-chat-bubble-ai {
    align-self: flex-start;
    background: rgba(255,255,255,0.07);
}
```

- [ ] **Step 3: Verificar em produção**

Na view "Indicadores" já carregada com dados, clicar em "Exportar PDF" — deve baixar um arquivo `indicadores_<nome>_<timestamp>.pdf` com cabeçalho, KPIs em texto, tabela de evolução mensal e tabela de timeline, sem erros no console. Verificar visualmente que os KPI cards, o gráfico de barras mensal, a timeline e o chat têm aparência consistente com o resto do app (mesmo estilo `.glass`, mesma paleta).

- [ ] **Step 4: Commit**

```powershell
& $git -C d:\GerenciadorTSP add js/app.js styles/main.css
& $git -C d:\GerenciadorTSP commit -m "feat(ui): exportação em PDF e estilos do painel de Indicadores"
```

---

### Task 10: Verificação final end-to-end e push

**Files:** nenhum arquivo novo — task de verificação e integração.

- [ ] **Step 1: Revisar que nenhum dado financeiro vaza para o papel `client`**

Logado como o usuário-cliente de teste, no DevTools → Network, abrir a resposta da query a `clients` feita por `getClientIndicators` e confirmar que, mesmo a policy liberando a linha inteira (Task 1), a UI (Task 4) e o contexto de IA (Task 7) nunca leem/exibem `client_pays`/`hourly_rate`/`consultant_bonus` — inspecionar o HTML renderizado do painel e o texto do resumo/chat gerado.

- [ ] **Step 2: Regressão rápida no consultor**

Logado como `jorjaocorreia@gmail.com`: navegar por Dashboard, Clientes, Tarefas, Agenda, Financeiro e Usuários — confirmar que nada quebrou com a adição de `indicadores` ao `VIEW_ORDER` e ao `Promise.all` de `renderAll()` (sem novos erros no console, sem lentidão perceptível adicional).

- [ ] **Step 3: Push final**

```powershell
& $git -C d:\GerenciadorTSP push origin main
```

- [ ] **Step 4: Lembrete de deploy manual**

Avisar que o deploy automático (webhook Easypanel) está quebrado — é preciso acionar o deploy manualmente no Easypanel (`CLAUDE.md`) antes de considerar a feature disponível para os usuários reais.

- [ ] **Step 5: Atualizar `CLAUDE.md`**

Adicionar à tabela de fases (seção "Fases implementadas") uma nova linha `| 46 | Painel de Indicadores: evolução do cliente (KPIs, gráfico mensal, timeline, resumo + chat de IA, exportação PDF) — consultor com seletor de cliente, cliente via Portal restrito ao próprio client_id |`, e documentar como armadilha conhecida (seguindo o padrão das demais entradas do arquivo): a resolução de `user_ai_config` via `service_role` no `ai-proxy` para o papel `client`, e que `getClientIndicators` nunca filtra por `user_id` (mesma regra do Portal do Cliente).

---

## Self-Review

**Cobertura da spec:**
- View nova + navegação (consultor com seletor / cliente sem seletor) → Tasks 3, 4, 5 ✅
- Dados sem tabelas novas, sob demanda → Task 2 ✅
- RLS estendida para `client` → Task 1 ✅
- KPIs, gráfico mensal, distribuição, timeline → Task 4 ✅
- Resumo IA + chat → Tasks 6, 7, 8 ✅
- IA do cliente usa config do consultor dono → Task 6 ✅
- Exportação PDF → Task 9 ✅
- Ocultação de dados financeiros → verificado explicitamente na Task 10, Step 1, e garantido estruturalmente por `_computeClientIndicators`/`_buildIndicadoresContext` nunca lerem esses campos (Tasks 2, 7) ✅

**Placeholders:** nenhum "TBD"/"implementar depois" — todo passo tem código completo ou comando exato.

**Consistência de tipos:** `IndicatorsData` definido na Task 2 é consumido identicamente em `_renderIndicadoresContent` (Task 4), `_buildIndicadoresContext` (Task 7) e `exportIndicadoresPDF` (Task 9) — mesmos nomes de campo (`kpis`, `monthly`, `statusDistribution`, `priorityDistribution`, `timeline`) em todo lugar.
