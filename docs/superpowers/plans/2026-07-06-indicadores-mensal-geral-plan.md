# Painel de Indicadores — Abas Mensal e Geral Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dividir o painel de Indicadores em duas abas — Mensal (padrão, navegável mês a mês) e Geral (panorama acumulado, comportamento atual preservado) — sem novas queries ao trocar de aba/mês e sem migrations.

**Architecture:** `store.js` passa a devolver os arrays brutos já buscados (`raw`) dentro do resultado de `getClientIndicators()`, junto de uma nova função pura `_computeMonthlyIndicators(raw, monthStr)` que recorta esses arrays por mês em memória. `app.js` guarda o mês/aba selecionados em estado da instância e re-renderiza a partir do cache (`_indicadoresData`/`_indicadoresMonthlyData`) sem tocar o Supabase ao trocar de aba ou navegar entre meses. `ai.js` ganha duas novas funções espelhando as existentes, mas com contexto mensal. PDF ganha uma função de export mensal ao lado da existente (Geral), com um dispatcher único no botão do header.

**Tech Stack:** JavaScript ES6+ vanilla (sem build step), Supabase JS client, jsPDF+AutoTable, Lucide Icons — mesmos already usados no projeto.

## Global Constraints

- Sem novas tabelas nem migrations — tudo calculado em memória a partir de dados já buscados.
- Nunca expor `clientPays`/`hourlyRate`/`consultantBonus` nos dados devolvidos ao Portal do Cliente ou enviados à IA — o `raw.client` deve ser sempre o `safeClient` já whitelisted, nunca o objeto bruto de `_client()`.
- Trocar de aba ou navegar de mês não deve gerar nenhuma nova query ao Supabase — tudo reaproveita `data.raw` já em memória.
- Não avançar a navegação de mês além do mês atual (mesmo padrão de `dashNavMonth`).
- Resumo/chat de IA nunca deve mencionar valores financeiros (mesma regra da versão Geral existente).
- Seguir o padrão de teste já estabelecido no projeto para funções puras de cálculo (`_computeClientStats`, `_computeClientIndicators`): verificação manual no console do navegador, sem introduzir framework de testes unitários (Jest etc.) — este projeto não tem um, e não é o escopo desta feature adicionar um.

---

## Estado atual (referência)

- `js/store.js:960-992` — `getClientIndicators(clientId)`: 6 queries paralelas, monta `client`/`tasks`/`records`/`events`/`columns`/`implementations` e chama `_computeClientIndicators`.
- `js/store.js:996-1081` — `_computeClientIndicators(client, tasks, records, events, columns, implementations)`: cálculo puro, retorna `{ client: safeClient, kpis, monthly, statusDistribution, priorityDistribution, timeline }`.
- `js/app.js:64-66` — estado do painel no construtor do `AppController`.
- `js/app.js:6495-6746` — `renderIndicadores()`, `_ensureIndicadoresClientOptions()`, `onIndicadoresClientChange()`, `_renderIndicadoresContent(data)`, `_animateIndicadoresBars()`, `generateIndicadoresSummary()`, `sendIndicadoresChatMessage()`, `_appendIndicadoresChatBubble()`, `exportIndicadoresPDF()`.
- `js/app.js:10736-10745` — bloco de limpeza de estado no logout.
- `js/ai.js:256-307` — `_buildIndicadoresContext()`, `generateClientIndicatorsSummary()`, `chatAboutClientIndicators()`.
- `styles/main.css:4444-4517` — CSS do painel (`.indicadores-kpi-*`, `.indicadores-timeline*`, `.indicadores-chat-*`).
- `index.html:874-891` — markup estático da view (header + `#indicadores-container` vazio); **não precisa mudar** — as abas e a navegação de mês são geradas dinamicamente dentro do container.

---

### Task 1: `store.js` — cálculo mensal puro + arrays brutos no retorno

**Files:**
- Modify: `js/store.js:996-1081` (`_computeClientIndicators`)

**Interfaces:**
- Produces: `_computeClientIndicators(...)` agora retorna também `raw: { client, tasks, records, events, columns, implementations }` (mesmos arrays já normalizados que a função já recebe como parâmetro — `client` aqui é o `safeClient` whitelisted).
- Produces: novo método `TSPStore.prototype._computeMonthlyIndicators(raw, monthStr)` → `{ client, month: monthStr, kpis: { tasksCompletedInMonth, hoursUsedInMonth, onTimeRateInMonth, avgCompletionDaysInMonth }, timeline: [{ type, date, title, description }] }`.
- Consumes: nada de tasks anteriores (é a base).

- [ ] **Step 1: Adicionar `raw` ao retorno de `_computeClientIndicators`**

Em `js/store.js`, dentro de `_computeClientIndicators`, o `return` final (linhas ~1065-1080) passa a incluir o campo `raw`:

```javascript
        return {
            client: safeClient,
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
            timeline: timelineItems.slice(0, 60),
            raw: { client: safeClient, tasks, records, events, columns, implementations }
        };
```

- [ ] **Step 2: Adicionar `_computeMonthlyIndicators` logo depois de `_computeClientIndicators`**

Inserir este novo método em `js/store.js`, imediatamente após o fechamento de `_computeClientIndicators` (depois da linha `}` que fecha o método, antes de `async addColumn(...)`):

```javascript
    // Cálculo puro (sem DB) para a aba Mensal do painel de Indicadores —
    // reaproveita os arrays já buscados por getClientIndicators() (data.raw),
    // sem nova query ao trocar de mês. Testável isoladamente no console do
    // navegador: store._computeMonthlyIndicators(data.raw, '2026-06').
    _computeMonthlyIndicators(raw, monthStr) {
        const { client, tasks, records, events, columns, implementations } = raw;
        const doneIds = new Set(columns.filter(c => c.isDone).map(c => c.id));
        doneIds.add('done'); // fallback legado (status pré-Kanban Fase 22)

        const completedTasks = tasks.filter(t => t.completed || doneIds.has(t.status));
        const completedInMonth = completedTasks.filter(t => t.completedAt && t.completedAt.startsWith(monthStr));

        const hoursUsedInMonth = parseFloat((records
            .filter(r => r.date && r.date.startsWith(monthStr))
            .reduce((acc, r) => acc + r.minutes, 0) / 60).toFixed(2));

        const withDueAndCompletion = completedInMonth.filter(t => t.dueDate);
        const onTimeCount = withDueAndCompletion.filter(t => t.completedAt.slice(0, 10) <= t.dueDate).length;
        const onTimeRateInMonth = withDueAndCompletion.length > 0
            ? Math.round((onTimeCount / withDueAndCompletion.length) * 100)
            : null;

        const durations = completedInMonth
            .filter(t => t.createdAt)
            .map(t => (new Date(t.completedAt) - new Date(t.createdAt)) / (1000 * 60 * 60 * 24));
        const avgCompletionDaysInMonth = durations.length > 0
            ? parseFloat((durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1))
            : null;

        const now0 = new Date();
        const todayIsoLocal = `${now0.getFullYear()}-${String(now0.getMonth() + 1).padStart(2, '0')}-${String(now0.getDate()).padStart(2, '0')}`;

        const timelineItems = [];
        completedInMonth.forEach(t => {
            timelineItems.push({ type: 'task', date: t.completedAt.slice(0, 10), title: t.title, description: t.description || '' });
        });
        events.filter(e => e.date && e.date.startsWith(monthStr) && e.date <= todayIsoLocal).forEach(e => {
            timelineItems.push({ type: 'event', date: e.date, title: e.title, description: e.description || '' });
        });
        implementations.forEach(impl => {
            if (impl.implementationDate && impl.implementationDate.startsWith(monthStr)) {
                timelineItems.push({ type: 'implementation', date: impl.implementationDate, title: impl.name, description: impl.description || '' });
            }
        });
        timelineItems.sort((a, b) => b.date.localeCompare(a.date));

        return {
            client,
            month: monthStr,
            kpis: {
                tasksCompletedInMonth: completedInMonth.length,
                hoursUsedInMonth,
                onTimeRateInMonth,
                avgCompletionDaysInMonth
            },
            timeline: timelineItems
        };
    }

```

- [ ] **Step 3: Verificação manual no console do navegador**

Iniciar o servidor dev (`python -m http.server 8080`), abrir `http://localhost:8080/index.html`, logar como `testes@teste.com` / `123testes`, abrir DevTools → Console e rodar:

```javascript
const data = await store.getClientIndicators('<ID_DE_UM_CLIENTE_COM_TAREFAS_CONCLUIDAS>');
console.log(data.raw); // deve conter tasks/records/events/columns/implementations
const monthly = store._computeMonthlyIndicators(data.raw, '2026-06');
console.log(monthly);
```

Esperado: `monthly.kpis.tasksCompletedInMonth` bate com a contagem manual de tarefas daquele cliente com `completedAt` iniciando em `2026-06`; `monthly.timeline` só contém itens de junho/2026; `monthly.client` é o mesmo objeto whitelisted (sem `clientPays`/`hourlyRate`).

- [ ] **Step 4: Commit**

```powershell
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.6.2\resources\app\git\cmd\git.exe"
& $git add js/store.js
& $git commit -m "feat: adiciona calculo mensal puro de indicadores (_computeMonthlyIndicators)"
```

---

### Task 2: `js/ai.js` — resumo e chat de IA escopados por mês

**Files:**
- Modify: `js/ai.js:294-307` (logo após `chatAboutClientIndicators`, antes do fechamento da classe)

**Interfaces:**
- Consumes: shape de `monthlyData` produzido por `store._computeMonthlyIndicators` (Task 1): `{ client, month, kpis: { tasksCompletedInMonth, hoursUsedInMonth, onTimeRateInMonth, avgCompletionDaysInMonth }, timeline }`.
- Produces: `aiClient.generateClientIndicatorsMonthSummary(monthlyData, monthLabel)` → `Promise<string>`; `aiClient.chatAboutClientIndicatorsMonth(monthlyData, monthLabel, question, history=[])` → `Promise<string>`.

- [ ] **Step 1: Adicionar os três novos métodos em `js/ai.js`**

Inserir logo após o método `chatAboutClientIndicators` existente (depois do `return this.complete(system, user);` dele, antes do `}` que fecha a classe `TSPAIClient`):

```javascript

    // Mesmas regras de _buildIndicadoresContext, mas escopado a um único mês
    // (usado pela aba Mensal do painel). Nunca inclui client_pays/hourly_rate/
    // consultant_bonus — mesma garantia estrutural do contexto Geral.
    _buildIndicadoresMonthContext(data, monthLabel) {
        const { client, kpis, timeline } = data;
        const timelineLines = timeline.slice(0, 20).map(t => `${t.date} [${t.type}] ${t.title}`).join('\n');

        return `Cliente: ${client.name}
Mês de referência: ${monthLabel}
Tarefas concluídas no mês: ${kpis.tasksCompletedInMonth}
Horas consumidas no mês: ${kpis.hoursUsedInMonth}h
Taxa de entrega no prazo no mês: ${kpis.onTimeRateInMonth !== null ? kpis.onTimeRateInMonth + '%' : 'sem dados suficientes'}
Tempo médio de conclusão no mês: ${kpis.avgCompletionDaysInMonth !== null ? kpis.avgCompletionDaysInMonth + ' dias' : 'sem dados suficientes'}

Eventos do mês (mais recente primeiro):
${timelineLines}`;
    }

    async generateClientIndicatorsMonthSummary(data, monthLabel) {
        const system = `Você é um consultor de TI resumindo o que aconteceu em um mês específico de um projeto, para quem está acompanhando (pode ser o próprio cliente ou o consultor responsável).
Escreva um resumo curto (3-5 frases), direto, destacando o que foi entregue no mês e pontos de atenção se houver.
Nunca mencione valores financeiros, comissão ou preço — esses dados não fazem parte do contexto e não devem ser inventados.
Responda apenas com o texto do resumo, sem markdown, sem título.`;
        const user = this._buildIndicadoresMonthContext(data, monthLabel);
        return this.complete(system, user);
    }

    async chatAboutClientIndicatorsMonth(data, monthLabel, question, history = []) {
        const system = `Você é um assistente que responde dúvidas sobre o andamento de um projeto de consultoria em um mês específico, com base nos dados fornecidos.
Responda apenas com base nos dados abaixo — se a pergunta não puder ser respondida com esses dados, diga isso claramente em vez de inventar.
Nunca mencione valores financeiros, comissão ou preço — esses dados não fazem parte do contexto e não devem ser inventados.
Seja direto e objetivo, poucas frases.

Dados do mês:
${this._buildIndicadoresMonthContext(data, monthLabel)}`;

        const historyText = history.map(h => `${h.role === 'user' ? 'Usuário' : 'Assistente'}: ${h.content}`).join('\n');
        const user = historyText ? `${historyText}\nUsuário: ${question}` : question;

        return this.complete(system, user);
    }
```

- [ ] **Step 2: Verificação manual no console do navegador**

Com IA já configurada no usuário de teste (sidebar → Configurar IA), no console:

```javascript
const data = await store.getClientIndicators('<ID_DE_CLIENTE>');
const monthly = store._computeMonthlyIndicators(data.raw, '2026-06');
const summary = await aiClient.generateClientIndicatorsMonthSummary(monthly, 'Junho/2026');
console.log(summary);
```

Esperado: string de 3-5 frases, sem menção a valores financeiros, sem markdown.

- [ ] **Step 3: Commit**

```powershell
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.6.2\resources\app\git\cmd\git.exe"
& $git add js/ai.js
& $git commit -m "feat: adiciona resumo e chat de IA escopados por mes para Indicadores"
```

---

### Task 3: `styles/main.css` — CSS das abas

**Files:**
- Modify: `styles/main.css` (logo após o bloco `/* Painel de Indicadores */`, linha 4517, fim do bloco existente)

**Interfaces:**
- Produces: classes `.indicadores-tabs`, `.indicadores-tab`, `.indicadores-tab.active`.

- [ ] **Step 1: Adicionar as classes de aba**

Inserir depois da linha 4517 (`.indicadores-chat-bubble-ai { ... }`), como continuação do bloco `/* Painel de Indicadores */`:

```css
.indicadores-tabs {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    margin-bottom: 16px;
}
.indicadores-tab {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 500;
    padding: 10px 16px;
    margin-bottom: -1px;
    transition: color 0.15s, border-color 0.15s;
}
.indicadores-tab:hover { color: var(--text-primary); }
.indicadores-tab.active {
    color: var(--primary-color);
    border-bottom-color: var(--primary-color);
}
```

- [ ] **Step 2: Commit**

```powershell
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.6.2\resources\app\git\cmd\git.exe"
& $git add styles/main.css
& $git commit -m "style: adiciona classes de abas do painel de Indicadores"
```

---

### Task 4: `js/app.js` — estado, navegação de mês e roteamento de render

**Files:**
- Modify: `js/app.js:64-66` (construtor)
- Modify: `js/app.js:6495-6647` (`renderIndicadores`, `onIndicadoresClientChange`, `_renderIndicadoresContent`)

**Interfaces:**
- Consumes: `store._computeMonthlyIndicators(raw, monthStr)` (Task 1); `data.raw` no retorno de `store.getClientIndicators()` (Task 1).
- Produces: estado `this.indicadoresTab` (`'mensal'|'geral'`), `this.indicadoresMonth` (`YYYY-MM`), `this._indicadoresMonthlyData`, `this._indicadoresChatHistoryMensal`, `this._indicadoresChatHistoryGeral`; métodos `switchIndicadoresTab(tab)`, `indicadoresNavMonth(delta)`, `indicadoresGoToCurrentMonth()`, `_renderIndicadoresPanel()`, `_renderIndicadoresGeralContent(data)`, `_renderIndicadoresMensalContent(monthlyData)`. Estes últimos dois são consumidos pela Task 5 (que só adiciona/roteia geração de IA e PDF, não re-renderiza conteúdo).

- [ ] **Step 1: Atualizar estado no construtor**

Em `js/app.js`, substituir as linhas 64-66:

```javascript
        this.indicadoresClientId = null;  // cliente selecionado no painel (só papel 'consultant')
        this._indicadoresData = null;     // cache do último resultado de getClientIndicators()
        this._indicadoresChatHistory = []; // histórico do chat de IA, só em memória
```

por:

```javascript
        this.indicadoresClientId = null;  // cliente selecionado no painel (só papel 'consultant')
        this.indicadoresTab = 'mensal';   // aba ativa: 'mensal' | 'geral'
        this.indicadoresMonth = new Date().toISOString().slice(0, 7); // YYYY-MM da aba Mensal
        this._indicadoresData = null;         // cache do último resultado de getClientIndicators() (inclui .raw)
        this._indicadoresMonthlyData = null;  // cache do recorte mensal (_computeMonthlyIndicators)
        this._indicadoresChatHistoryMensal = []; // histórico do chat de IA da aba Mensal, só em memória
        this._indicadoresChatHistoryGeral = [];  // histórico do chat de IA da aba Geral, só em memória
```

- [ ] **Step 2: Reescrever `renderIndicadores()` e `onIndicadoresClientChange()`**

Substituir (linhas 6495-6541 aproximadamente, de `async renderIndicadores() {` até o fechamento de `onIndicadoresClientChange`):

```javascript
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
            this._renderIndicadoresPanel();
        } catch (err) {
            container.innerHTML = `<p class="text-muted" style="padding:24px;">Erro ao carregar indicadores: ${escapeHtml(err.message)}</p>`;
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
        this.indicadoresTab = 'mensal';
        this.indicadoresMonth = new Date().toISOString().slice(0, 7);
        this._indicadoresChatHistoryMensal = [];
        this._indicadoresChatHistoryGeral = [];
        this.renderIndicadores();
    }

    switchIndicadoresTab(tab) {
        if (this.indicadoresTab === tab) return;
        this.indicadoresTab = tab;
        this._renderIndicadoresPanel();
    }

    indicadoresNavMonth(delta) {
        const [y, m] = this.indicadoresMonth.split('-').map(Number);
        const d = new Date(y, m - 1 + delta, 1);
        const newMonth = d.toISOString().slice(0, 7);
        const currentMonth = new Date().toISOString().slice(0, 7);
        if (newMonth > currentMonth) return;
        this.indicadoresMonth = newMonth;
        this._indicadoresChatHistoryMensal = [];
        this._renderIndicadoresPanel();
    }

    indicadoresGoToCurrentMonth() {
        this.indicadoresMonth = new Date().toISOString().slice(0, 7);
        this._indicadoresChatHistoryMensal = [];
        this._renderIndicadoresPanel();
    }

    _renderIndicadoresPanel() {
        const container = document.getElementById('indicadores-container');
        const data = this._indicadoresData;
        if (!container || !data) return;

        const tabsHtml = `
            <div class="indicadores-tabs">
                <button type="button" class="indicadores-tab ${this.indicadoresTab === 'mensal' ? 'active' : ''}" onclick="app.switchIndicadoresTab('mensal')">Mensal</button>
                <button type="button" class="indicadores-tab ${this.indicadoresTab === 'geral' ? 'active' : ''}" onclick="app.switchIndicadoresTab('geral')">Geral</button>
            </div>`;

        let bodyHtml;
        if (this.indicadoresTab === 'mensal') {
            this._indicadoresMonthlyData = store._computeMonthlyIndicators(data.raw, this.indicadoresMonth);
            const currentMonth = new Date().toISOString().slice(0, 7);
            const isCurrentMonth = this.indicadoresMonth === currentMonth;
            const monthNavHtml = `
                <div id="indicadores-month-nav" style="display:flex;align-items:center;gap:6px;margin-bottom:16px;">
                    <button id="btn-indicadores-prev-month" onclick="app.indicadoresNavMonth(-1)" class="btn btn-ghost" style="padding:6px 10px;" title="Mês anterior">
                        <i data-lucide="chevron-left" style="width:16px;height:16px;"></i>
                    </button>
                    <span id="indicadores-month-label" style="font-weight:600;min-width:120px;text-align:center;font-size:0.95rem;">${this._formatDashboardMonth(this.indicadoresMonth)}</span>
                    <button id="btn-indicadores-next-month" onclick="app.indicadoresNavMonth(1)" class="btn btn-ghost" style="padding:6px 10px;" title="Próximo mês" ${isCurrentMonth ? 'disabled' : ''}>
                        <i data-lucide="chevron-right" style="width:16px;height:16px;"></i>
                    </button>
                    <button id="btn-indicadores-current-month" onclick="app.indicadoresGoToCurrentMonth()" class="btn btn-ghost" style="display:${isCurrentMonth ? 'none' : ''};font-size:0.8rem;padding:6px 12px;color:var(--primary-color);border:1px solid var(--primary-color);" title="Voltar ao mês atual">
                        Mês atual
                    </button>
                </div>`;
            bodyHtml = monthNavHtml + this._renderIndicadoresMensalContent(this._indicadoresMonthlyData);
        } else {
            bodyHtml = this._renderIndicadoresGeralContent(data);
        }

        container.innerHTML = tabsHtml + bodyHtml;
        lucide.createIcons();
        this._animateIndicadoresBars();
    }
```

Nota: `_renderIndicadoresPanel()` reaproveita `this._formatDashboardMonth(yyyyMM)` (já existente em `js/app.js`, usado pela navegação de mês do Dashboard) — nenhuma nova função de formatação de mês é necessária.

- [ ] **Step 3: Renomear `_renderIndicadoresContent` para `_renderIndicadoresGeralContent`**

Substituir a função existente (`_renderIndicadoresContent`, linhas ~6543-6647) por esta — mesmo corpo, só o nome muda:

```javascript
    _renderIndicadoresGeralContent(data) {
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
            ${aiChatSection}
        `;
    }
```

Apenas o nome da função muda (`_renderIndicadoresContent` → `_renderIndicadoresGeralContent`); nenhuma linha interna muda.

- [ ] **Step 4: Adicionar `_renderIndicadoresMensalContent(monthlyData)`**

Inserir logo depois de `_renderIndicadoresGeralContent` (antes de `_animateIndicadoresBars`):

```javascript
    _renderIndicadoresMensalContent(monthlyData) {
        const { kpis, timeline } = monthlyData;

        const kpiCards = `
            <div class="indicadores-kpi-grid">
                <div class="glass indicadores-kpi-card">
                    <span class="indicadores-kpi-label">Tarefas concluídas no mês</span>
                    <span class="indicadores-kpi-value">${kpis.tasksCompletedInMonth}</span>
                </div>
                <div class="glass indicadores-kpi-card">
                    <span class="indicadores-kpi-label">Horas consumidas no mês</span>
                    <span class="indicadores-kpi-value">${kpis.hoursUsedInMonth}h</span>
                </div>
                <div class="glass indicadores-kpi-card">
                    <span class="indicadores-kpi-label">Entregas no prazo</span>
                    <span class="indicadores-kpi-value">${kpis.onTimeRateInMonth !== null ? kpis.onTimeRateInMonth + '%' : '—'}</span>
                </div>
                <div class="glass indicadores-kpi-card">
                    <span class="indicadores-kpi-label">Tempo médio de conclusão</span>
                    <span class="indicadores-kpi-value">${kpis.avgCompletionDaysInMonth !== null ? kpis.avgCompletionDaysInMonth + ' dias' : '—'}</span>
                </div>
            </div>`;

        const timelineIcons = { task: 'check-circle', event: 'calendar', implementation: 'package' };
        const timelineRows = timeline.map(item => `
            <div class="indicadores-timeline-item">
                <i data-lucide="${timelineIcons[item.type] || 'circle'}"></i>
                <div>
                    <div class="indicadores-timeline-title">${escapeHtml(item.title)}</div>
                    <div class="indicadores-timeline-date">${item.date.split('-').reverse().join('/')}</div>
                </div>
            </div>`).join('') || '<p class="text-muted">Nenhum evento registrado neste mês.</p>';

        const aiSummarySection = aiClient.isConfigured ? `
            <div class="glass" style="padding:20px 24px;margin-bottom:16px;" id="indicadores-ai-summary-box">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                    <h3 style="margin:0;font-size:1rem;">Resumo do mês (IA)</h3>
                    <button class="btn btn-secondary btn-sm" onclick="app.generateIndicadoresSummary()"><i data-lucide="sparkles"></i> Gerar resumo</button>
                </div>
                <div id="indicadores-ai-summary-text" class="text-muted">Clique em "Gerar resumo" para uma análise do mês selecionado.</div>
            </div>` : '';

        const aiChatSection = aiClient.isConfigured ? `
            <div class="glass" style="padding:20px 24px;" id="indicadores-ai-chat-box">
                <h3 style="margin:0 0 10px;font-size:1rem;">Tire suas dúvidas sobre o mês</h3>
                <div id="indicadores-chat-messages" class="indicadores-chat-messages"></div>
                <div style="display:flex;gap:8px;margin-top:10px;">
                    <input type="text" id="indicadores-chat-input" class="form-control" placeholder="Pergunte sobre o mês..." onkeydown="if(event.key==='Enter') app.sendIndicadoresChatMessage();">
                    <button class="btn btn-primary" onclick="app.sendIndicadoresChatMessage()"><i data-lucide="send"></i></button>
                </div>
            </div>` : '';

        return `
            ${aiSummarySection}
            ${kpiCards}
            <div class="glass" style="padding:20px 24px;margin-bottom:16px;">
                <h3 style="margin:0 0 16px;font-size:1rem;">Linha do tempo do mês</h3>
                <div class="indicadores-timeline">${timelineRows}</div>
            </div>
            ${aiChatSection}
        `;
    }
```

- [ ] **Step 5: Teste manual no navegador**

Rodar servidor dev, logar como `testes@teste.com`, ir em Indicadores. Verificar:
- Abre direto na aba **Mensal**, mês atual, KPIs e timeline recalculados.
- Clicar em **Geral** mostra o painel completo de antes (KPIs acumulados, gráfico 12 meses, distribuição, timeline geral) — sem erro no console.
- Clicar em ◀ navega para o mês anterior sem nenhuma nova requisição de rede (checar aba Network do DevTools — nenhuma chamada ao Supabase deve ocorrer ao trocar de mês/aba).
- Botão ▶ fica desabilitado no mês atual; botão "Mês atual" só aparece fora do mês atual.
- Trocar de cliente no seletor reseta para aba Mensal, mês atual.

- [ ] **Step 6: Commit**

```powershell
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.6.2\resources\app\git\cmd\git.exe"
& $git add js/app.js
& $git commit -m "feat: abas Mensal/Geral no painel de Indicadores com navegacao de mes"
```

---

### Task 5: `js/app.js` — IA e PDF por aba

**Files:**
- Modify: `js/app.js:6656-6745` (`generateIndicadoresSummary`, `sendIndicadoresChatMessage`, `exportIndicadoresPDF`)

**Interfaces:**
- Consumes: `aiClient.generateClientIndicatorsMonthSummary`/`chatAboutClientIndicatorsMonth` (Task 2); `this.indicadoresTab`, `this._indicadoresMonthlyData`, `this._indicadoresChatHistoryMensal`/`Geral` (Task 4); `this._formatDashboardMonth` (já existente).
- Produces: `exportIndicadoresPDF()` (dispatcher, mesmo nome usado pelo `onclick` do botão no `index.html` — nenhuma mudança de HTML necessária), `_exportIndicadoresGeralPDF()`, `_exportIndicadoresMensalPDF()`.

- [ ] **Step 1: Atualizar `generateIndicadoresSummary()`**

Substituir o método existente por:

```javascript
    async generateIndicadoresSummary() {
        const box = document.getElementById('indicadores-ai-summary-text');
        if (!box) return;
        box.textContent = 'Gerando resumo...';
        try {
            let summary;
            if (this.indicadoresTab === 'mensal') {
                if (!this._indicadoresMonthlyData) return;
                summary = await aiClient.generateClientIndicatorsMonthSummary(this._indicadoresMonthlyData, this._formatDashboardMonth(this.indicadoresMonth));
            } else {
                if (!this._indicadoresData) return;
                summary = await aiClient.generateClientIndicatorsSummary(this._indicadoresData);
            }
            box.textContent = summary;
        } catch (err) {
            box.textContent = 'Erro ao gerar resumo: ' + err.message;
        }
    }
```

- [ ] **Step 2: Atualizar `sendIndicadoresChatMessage()`**

Substituir o método existente por:

```javascript
    async sendIndicadoresChatMessage() {
        const input = document.getElementById('indicadores-chat-input');
        const messagesBox = document.getElementById('indicadores-chat-messages');
        if (!input || !messagesBox) return;
        const question = input.value.trim();
        if (!question) return;
        input.value = '';

        const isMensal = this.indicadoresTab === 'mensal';
        if (isMensal && !this._indicadoresMonthlyData) return;
        if (!isMensal && !this._indicadoresData) return;
        const history = isMensal ? this._indicadoresChatHistoryMensal : this._indicadoresChatHistoryGeral;

        history.push({ role: 'user', content: question });
        this._appendIndicadoresChatBubble('user', question);

        const loadingId = 'indicadores-chat-loading-' + Date.now();
        messagesBox.insertAdjacentHTML('beforeend', `<div id="${loadingId}" class="indicadores-chat-bubble indicadores-chat-bubble-ai">Pensando...</div>`);
        messagesBox.scrollTop = messagesBox.scrollHeight;

        try {
            const historyBeforeQuestion = history.slice(0, -1);
            const answer = isMensal
                ? await aiClient.chatAboutClientIndicatorsMonth(this._indicadoresMonthlyData, this._formatDashboardMonth(this.indicadoresMonth), question, historyBeforeQuestion)
                : await aiClient.chatAboutClientIndicators(this._indicadoresData, question, historyBeforeQuestion);
            document.getElementById(loadingId)?.remove();
            history.push({ role: 'assistant', content: answer });
            this._appendIndicadoresChatBubble('ai', answer);
        } catch (err) {
            document.getElementById(loadingId)?.remove();
            this._appendIndicadoresChatBubble('ai', 'Erro ao responder: ' + err.message);
        }
    }
```

(`_appendIndicadoresChatBubble` não muda — permanece exatamente como está hoje.)

- [ ] **Step 3: Dividir `exportIndicadoresPDF()` em dispatcher + duas funções**

Substituir o `exportIndicadoresPDF()` existente (linhas ~6704-6745) por:

```javascript
    async exportIndicadoresPDF() {
        if (this.indicadoresTab === 'mensal') {
            await this._exportIndicadoresMensalPDF();
        } else {
            await this._exportIndicadoresGeralPDF();
        }
    }

    async _exportIndicadoresGeralPDF() {
        const data = this._indicadoresData;
        if (!data) { Toast.show('Carregue os indicadores antes de exportar.', 'info'); return; }
        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            const { client, kpis, monthly, timeline } = data;

            doc.setFontSize(16);
            doc.text(`Indicadores (Geral) — ${client.name}`, 14, 18);
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

            doc.save(`indicadores_geral_${client.name.replace(/\s+/g, '_')}_${new Date().getTime()}.pdf`);
        } catch (err) {
            Toast.show('Erro ao gerar PDF: ' + err.message, 'error');
        }
    }

    async _exportIndicadoresMensalPDF() {
        const data = this._indicadoresMonthlyData;
        if (!data) { Toast.show('Carregue os indicadores antes de exportar.', 'info'); return; }
        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            const { client, kpis, timeline, month } = data;
            const monthLabel = this._formatDashboardMonth(month);

            doc.setFontSize(16);
            doc.text(`Indicadores (${monthLabel}) — ${client.name}`, 14, 18);
            doc.setFontSize(10);
            doc.text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')}`, 14, 26);

            doc.setFontSize(11);
            doc.text(`Tarefas concluídas no mês: ${kpis.tasksCompletedInMonth}`, 14, 38);
            doc.text(`Horas consumidas no mês: ${kpis.hoursUsedInMonth}h`, 14, 44);
            doc.text(`Entregas no prazo no mês: ${kpis.onTimeRateInMonth !== null ? kpis.onTimeRateInMonth + '%' : 'sem dados'}`, 14, 50);
            doc.text(`Tempo médio de conclusão no mês: ${kpis.avgCompletionDaysInMonth !== null ? kpis.avgCompletionDaysInMonth + ' dias' : 'sem dados'}`, 14, 56);

            const timelineRows = timeline.slice(0, 30).map(t => [t.date.split('-').reverse().join('/'), t.type, t.title.substring(0, 60)]);
            doc.autoTable({
                startY: 64,
                head: [["Data", "Tipo", "Item"]],
                body: timelineRows,
                styles: { fontSize: 8 },
                headStyles: { fillColor: [79, 70, 229] },
            });

            doc.save(`indicadores_${month}_${client.name.replace(/\s+/g, '_')}_${new Date().getTime()}.pdf`);
        } catch (err) {
            Toast.show('Erro ao gerar PDF: ' + err.message, 'error');
        }
    }
```

- [ ] **Step 4: Teste manual no navegador**

Na aba Mensal: clicar "Gerar resumo" (com IA configurada) e conferir texto sem valores financeiros; mandar uma pergunta no chat e conferir resposta; clicar "Exportar PDF" e abrir o arquivo baixado, conferir título "Indicadores (Mês/Ano) — Cliente" e tabela só com a timeline do mês (sem tabela de evolução de 12 meses).
Trocar para Geral: repetir os 3 testes, conferindo que o PDF salvo tem título "Indicadores (Geral)" e inclui a tabela de evolução mensal, igual ao comportamento anterior à mudança.

- [ ] **Step 5: Commit**

```powershell
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.6.2\resources\app\git\cmd\git.exe"
& $git add js/app.js
& $git commit -m "feat: resumo/chat de IA e export PDF separados por aba em Indicadores"
```

---

### Task 6: Limpeza de estado no logout

**Files:**
- Modify: `js/app.js:10743-10745`

**Interfaces:**
- Consumes: estado definido na Task 4 (`indicadoresTab`, `indicadoresMonth`, `_indicadoresMonthlyData`, `_indicadoresChatHistoryMensal`, `_indicadoresChatHistoryGeral`).

- [ ] **Step 1: Atualizar o bloco de limpeza do logout**

Substituir as linhas:

```javascript
            window.app.indicadoresClientId = null;
            window.app._indicadoresData = null;
            window.app._indicadoresChatHistory = [];
```

por:

```javascript
            window.app.indicadoresClientId = null;
            window.app.indicadoresTab = 'mensal';
            window.app.indicadoresMonth = new Date().toISOString().slice(0, 7);
            window.app._indicadoresData = null;
            window.app._indicadoresMonthlyData = null;
            window.app._indicadoresChatHistoryMensal = [];
            window.app._indicadoresChatHistoryGeral = [];
```

- [ ] **Step 2: Teste manual**

Logar, entrar em Indicadores, navegar para um mês passado, trocar para aba Geral, mandar uma pergunta no chat. Fazer logout e logar de novo (mesmo usuário ou outro) — a view Indicadores deve abrir do zero: aba Mensal, mês atual, sem histórico de chat anterior.

- [ ] **Step 3: Commit**

```powershell
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.6.2\resources\app\git\cmd\git.exe"
& $git add js/app.js
& $git commit -m "fix: reseta estado de abas/mes/chat de Indicadores no logout"
```

---

### Task 7: Documentação (CLAUDE.md) e push final

**Files:**
- Modify: `CLAUDE.md` (seção "Painel de Indicadores — armadilhas conhecidas" e tabela "Funcionalidades por view")

**Interfaces:** Nenhuma — apenas documentação.

- [ ] **Step 1: Atualizar a tabela de views em `CLAUDE.md`**

Na tabela "Funcionalidades por view", atualizar a descrição da linha correspondente (se existir uma entrada dedicada a Indicadores; senão, adicionar) para mencionar as duas abas. Caso não exista linha própria (o painel é acessado via "Tarefas"/"Indicadores" no menu, sem entrada na tabela principal hoje), pular este passo — confirmar isso lendo a tabela atual antes de editar.

- [ ] **Step 2: Adicionar entradas de armadilhas na seção "Painel de Indicadores — armadilhas conhecidas"**

Adicionar ao final da seção existente em `CLAUDE.md`:

```markdown
- **Indicadores: aba Mensal nunca refaz query ao trocar de mês/aba** — `getClientIndicators()` roda uma única vez por seleção de cliente; o resultado (incluindo `raw: {client, tasks, records, events, columns, implementations}`) fica em `app._indicadoresData`. `switchIndicadoresTab()`/`indicadoresNavMonth()`/`indicadoresGoToCurrentMonth()` só chamam `store._computeMonthlyIndicators(data.raw, mes)` (cálculo puro em memória) e `_renderIndicadoresPanel()` — nunca `renderIndicadores()` completo. Se um novo ponto precisar reagir a troca de mês/aba, nunca disparar nova query ali; sempre reaproveitar `this._indicadoresData.raw`.
- **Indicadores: `raw.client` é sempre o `safeClient` whitelisted** — nunca o objeto bruto de `_client()`. `_computeMonthlyIndicators` recebe esse mesmo `client` já sem `clientPays`/`hourlyRate`/`consultantBonus`; não trocar por uma leitura direta do cliente bruto.
- **Indicadores: IA e PDF são dispatchers que checam `app.indicadoresTab`** — `generateIndicadoresSummary()`, `sendIndicadoresChatMessage()` e `exportIndicadoresPDF()` decidem entre os dados/prompts da aba Mensal (`_indicadoresMonthlyData`, `_indicadoresChatHistoryMensal`) ou Geral (`_indicadoresData`, `_indicadoresChatHistoryGeral`) olhando `this.indicadoresTab`. Um novo botão de IA/export adicionado ao painel precisa seguir o mesmo padrão de dispatch, nunca assumir uma aba fixa.
- **Indicadores: navegação de mês usa o mesmo padrão (e a mesma pegadinha de fuso) do Dashboard** — `indicadoresNavMonth`/`indicadoresGoToCurrentMonth` usam `toISOString().slice(0,7)`, igual a `dashNavMonth`/`dashGoToCurrentMonth`; não avança além do mês atual.
```

- [ ] **Step 3: Commit e push**

```powershell
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.6.2\resources\app\git\cmd\git.exe"
& $git add CLAUDE.md
& $git commit -m "docs: documenta abas Mensal/Geral do painel de Indicadores"
& $git push origin main
```

- [ ] **Step 4: Lembrete de deploy manual**

Avisar o usuário para fazer o deploy manual no Easypanel (webhook automático está quebrado) antes de considerar a feature disponível em produção.

---

## Verificação final (checklist de aceite)

- [ ] Consultor: abrir Indicadores → abre em Mensal, mês atual; trocar cliente reseta para Mensal/mês atual.
- [ ] Consultor: navegar 2-3 meses para trás e voltar via "Mês atual" funciona sem erro e sem nova query.
- [ ] Consultor: aba Geral idêntica ao comportamento anterior à mudança (KPIs, gráfico 12 meses, distribuição, timeline, resumo/chat, PDF).
- [ ] Portal do Cliente (`jorjaocorreia@gmail.com`): mesma dinâmica de abas funciona, sem acesso a nenhum campo financeiro em nenhuma das duas abas (inspecionar `Network` → resposta das queries Supabase).
- [ ] Export PDF gera arquivos distintos e corretos para Mensal e Geral.
- [ ] Logout/login reseta todo o estado do painel.
