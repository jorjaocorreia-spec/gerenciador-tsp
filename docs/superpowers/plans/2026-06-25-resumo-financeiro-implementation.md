# Resumo Financeiro Mensal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar uma nova view "Financeiro" que mostra, por mês, o valor total a receber e a comissão do consultor por cliente, mais um gráfico comparativo dos últimos 12 meses.

**Architecture:** Lógica pura de elegibilidade/cálculo isolada em `js/financial-calc.js` (mesmo padrão de `js/productivity-calc.js`, testável com Node puro sem mocks de Supabase). `js/store.js` ganha dois métodos novos que buscam `clients`+`records` e delegam o cálculo a essa lógica pura. `js/app.js` ganha uma nova view seguindo o padrão exato de `renderProdutividade()`/`_buildProdChart()`. Nenhuma migration de banco é necessária — tudo é calculado em tempo real a partir de campos já existentes (`billing_model`, `client_pays`, `consultant_bonus`, `hourly_rate`, `created_at`, `status`).

**Tech Stack:** JavaScript ES6+ vanilla (sem build step), Supabase JS client, Node.js (apenas para o test runner da lógica pura — sem framework, usando `assert` nativo).

## Global Constraints

- Sem nova tabela/migration no Supabase — todo o cálculo é em memória a partir de `clients` e `records` já existentes.
- Comissão do consultor só se aplica a clientes com `billingModel === 'fixed'`; clientes `'hourly'` nunca geram comissão.
- Fórmula de comissão: `clientPays * 0.43 + (consultantBonus || 0)` — idêntica à já usada em `js/app.js:2337-2339`.
- Elegibilidade de um cliente em um mês: se o mês selecionado é o mês atual ou futuro, só conta se `status === 'active'`; se é um mês passado, conta independente do status atual, desde que `createdAt` seja anterior ou igual ao mês em questão.
- Valores monetários na UI sempre dentro de `<span class="money-value">` (respeita `sessionStorage.moneyHidden` via blur, já implementado em `styles/main.css:2279-2288`).
- Nenhuma chamada ao store dentro de `forEach`/loop de render — sempre buscar os dados primeiro, montar HTML depois (armadilha já documentada no CLAUDE.md).
- Seguir o padrão de cache-busting de versão em `index.html`: todo arquivo `.js` modificado tem sua query string `?v=N` incrementada.

---

### Task 1: Módulo de cálculo puro `js/financial-calc.js`

**Files:**
- Create: `js/financial-calc.js`
- Create: `tests/financial-calc.test.js`

**Interfaces:**
- Produces: `global.TSPFinancial = { isEligible(client, year, month, now), computeEntry(client, year, month, minutesInMonth, eligible), monthsWindow(monthsBack, endYear, endMonth) }`. `year`/`month` usam `month` 1-12. `client` é o objeto já mapeado por `_client()` em `js/store.js` (tem `status`, `createdAt`, `billingModel`, `clientPays`, `consultantBonus`, `hourlyRate`, `id`, `name`). `now` é opcional (default `new Date()`), existe só para tornar a função testável com uma data fixa.

- [ ] **Step 1: Escrever o teste (vai falhar pois o módulo não existe ainda)**

Criar `tests/financial-calc.test.js`:

```js
const assert = require('assert');
require('../js/financial-calc.js');
const TSPFinancial = global.TSPFinancial;

function run(name, fn) {
    try {
        fn();
        console.log(`OK   ${name}`);
    } catch (err) {
        console.error(`FAIL ${name}`);
        console.error(err);
        process.exitCode = 1;
    }
}

const NOW = new Date(2026, 5, 25); // 25/06/2026 (mês 6 = índice 5)

run('isEligible: cliente ativo, mês atual -> true', () => {
    const client = { status: 'active', createdAt: '2026-01-10' };
    assert.strictEqual(TSPFinancial.isEligible(client, 2026, 6, NOW), true);
});

run('isEligible: cliente finalizado, mês atual -> false', () => {
    const client = { status: 'finished', createdAt: '2026-01-10' };
    assert.strictEqual(TSPFinancial.isEligible(client, 2026, 6, NOW), false);
});

run('isEligible: cliente finalizado, mês passado em que existia -> true', () => {
    const client = { status: 'finished', createdAt: '2026-01-10' };
    assert.strictEqual(TSPFinancial.isEligible(client, 2026, 3, NOW), true);
});

run('isEligible: mês anterior à criação do cliente -> false', () => {
    const client = { status: 'active', createdAt: '2026-05-01' };
    assert.strictEqual(TSPFinancial.isEligible(client, 2026, 2, NOW), false);
});

run('isEligible: mês futuro, cliente ativo -> true', () => {
    const client = { status: 'active', createdAt: '2026-01-01' };
    assert.strictEqual(TSPFinancial.isEligible(client, 2026, 12, NOW), true);
});

run('isEligible: mês futuro, cliente finalizado -> false', () => {
    const client = { status: 'finished', createdAt: '2026-01-01' };
    assert.strictEqual(TSPFinancial.isEligible(client, 2026, 12, NOW), false);
});

run('computeEntry: não elegível -> null', () => {
    const client = { billingModel: 'fixed', clientPays: 1000 };
    assert.strictEqual(TSPFinancial.computeEntry(client, 2026, 6, 0, false), null);
});

run('computeEntry: fixo elegível -> valor e comissão corretos', () => {
    const client = { billingModel: 'fixed', clientPays: 2000, consultantBonus: 50 };
    const entry = TSPFinancial.computeEntry(client, 2026, 6, 0, true);
    assert.strictEqual(entry.valor, 2000);
    assert.strictEqual(entry.comissao, 2000 * 0.43 + 50);
    assert.strictEqual(entry.detalhe, null);
});

run('computeEntry: fixo sem bônus -> comissão só 43%', () => {
    const client = { billingModel: 'fixed', clientPays: 1000, consultantBonus: 0 };
    const entry = TSPFinancial.computeEntry(client, 2026, 6, 0, true);
    assert.strictEqual(entry.comissao, 430);
});

run('computeEntry: por hora elegível -> valor = horas x rate, sem comissão', () => {
    const client = { billingModel: 'hourly', hourlyRate: 150 };
    const entry = TSPFinancial.computeEntry(client, 2026, 6, 750, true); // 750 min = 12.5h
    assert.strictEqual(entry.valor, 12.5 * 150);
    assert.strictEqual(entry.comissao, 0);
    assert.strictEqual(entry.detalhe.horas, 12.5);
    assert.strictEqual(entry.detalhe.rate, 150);
});

run('computeEntry: por hora sem registros no mês -> valor 0, ainda elegível', () => {
    const client = { billingModel: 'hourly', hourlyRate: 150 };
    const entry = TSPFinancial.computeEntry(client, 2026, 6, 0, true);
    assert.strictEqual(entry.valor, 0);
});

run('monthsWindow: 12 meses terminando em 2026-06 -> de 2025-07 a 2026-06', () => {
    const w = TSPFinancial.monthsWindow(12, 2026, 6);
    assert.strictEqual(w.length, 12);
    assert.deepStrictEqual(w[0], { year: 2025, month: 7 });
    assert.deepStrictEqual(w[11], { year: 2026, month: 6 });
});

run('monthsWindow: janela cruzando virada de ano', () => {
    const w = TSPFinancial.monthsWindow(3, 2026, 1);
    assert.deepStrictEqual(w, [
        { year: 2025, month: 11 },
        { year: 2025, month: 12 },
        { year: 2026, month: 1 }
    ]);
});

if (process.exitCode) {
    console.error('\nALGUM TESTE FALHOU');
} else {
    console.log('\nTODOS OS TESTES PASSARAM');
}
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node tests/financial-calc.test.js`
Expected: erro `Cannot find module '../js/financial-calc.js'`

- [ ] **Step 3: Implementar `js/financial-calc.js`**

```js
(function (global) {
    function isEligible(client, year, month, now) {
        now = now || new Date();
        const selectedYM = year * 12 + (month - 1);
        const currentYM = now.getFullYear() * 12 + now.getMonth();
        let createdYM = -Infinity;
        if (client.createdAt) {
            const created = new Date(client.createdAt);
            createdYM = created.getFullYear() * 12 + created.getMonth();
        }
        if (selectedYM < createdYM) return false;
        if (selectedYM >= currentYM) {
            return client.status === 'active';
        }
        return true;
    }

    function computeEntry(client, year, month, minutesInMonth, eligible) {
        if (!eligible) return null;
        if (client.billingModel === 'hourly') {
            const horas = (minutesInMonth || 0) / 60;
            const valor = horas * (client.hourlyRate || 0);
            return { client, valor, comissao: 0, detalhe: { horas, rate: client.hourlyRate || 0 } };
        }
        const valor = client.clientPays || 0;
        const comissao = (client.clientPays || 0) * 0.43 + (client.consultantBonus || 0);
        return { client, valor, comissao, detalhe: null };
    }

    function monthsWindow(monthsBack, endYear, endMonth) {
        const result = [];
        let y = endYear, m = endMonth;
        for (let i = 0; i < monthsBack; i++) {
            result.unshift({ year: y, month: m });
            m -= 1;
            if (m < 1) { m = 12; y -= 1; }
        }
        return result;
    }

    global.TSPFinancial = { isEligible, computeEntry, monthsWindow };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node tests/financial-calc.test.js`
Expected: todas as linhas `OK   ...` e `TODOS OS TESTES PASSARAM` no final, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add js/financial-calc.js tests/financial-calc.test.js
git commit -m "feat: módulo de cálculo puro do resumo financeiro"
```

---

### Task 2: Métodos `getFinancialSummary` e `getFinancialHistory` em `js/store.js`

**Files:**
- Modify: `js/store.js` (adicionar 2 métodos novos na classe `TSPStore`, próximo a `getBatchStats()`, linha 615)

**Interfaces:**
- Consumes: `global.TSPFinancial.isEligible`, `global.TSPFinancial.computeEntry`, `global.TSPFinancial.monthsWindow` (Task 1). `this._client(r)` (mapper existente, linhas 7-19). `this.db`, `this.userId` (getters existentes).
- Produces: `store.getFinancialSummary(year, month)` → `Promise<{ items: Array<{client, valor, comissao, detalhe}>, totalValor: number, totalComissao: number }>`. `store.getFinancialHistory(monthsBack, endYear, endMonth)` → `Promise<Array<{year, month, totalValor}>>` ordenado cronologicamente.

- [ ] **Step 1: Adicionar `getFinancialSummary` imediatamente após o fechamento de `getBatchStats()` (linha 615 de `js/store.js`, antes do próximo método da classe)**

```js
async getFinancialSummary(year, month) {
    const uid = this.userId;
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    const lastDay = new Date(year, month, 0).getDate();
    const [clientsRes, recordsRes] = await Promise.all([
        this.db.from('clients').select('*').eq('user_id', uid).order('created_at'),
        this.db.from('records').select('client_id, minutes, date').eq('user_id', uid)
            .gte('date', `${monthStr}-01`).lte('date', `${monthStr}-${String(lastDay).padStart(2, '0')}`)
    ]);
    if (clientsRes.error) throw clientsRes.error;
    if (recordsRes.error) throw recordsRes.error;

    const clients = (clientsRes.data || []).map(r => this._client(r));
    const minutesByClient = {};
    (recordsRes.data || []).forEach(r => {
        minutesByClient[r.client_id] = (minutesByClient[r.client_id] || 0) + (parseInt(r.minutes) || 0);
    });

    const items = [];
    let totalValor = 0, totalComissao = 0;
    clients.forEach(client => {
        const eligible = TSPFinancial.isEligible(client, year, month);
        const entry = TSPFinancial.computeEntry(client, year, month, minutesByClient[client.id] || 0, eligible);
        if (entry) {
            items.push(entry);
            totalValor += entry.valor;
            totalComissao += entry.comissao;
        }
    });

    return { items, totalValor, totalComissao };
}

async getFinancialHistory(monthsBack, endYear, endMonth) {
    const uid = this.userId;
    const monthsArr = TSPFinancial.monthsWindow(monthsBack, endYear, endMonth);
    const first = monthsArr[0];
    const last = monthsArr[monthsArr.length - 1];
    const startDate = `${first.year}-${String(first.month).padStart(2, '0')}-01`;
    const lastDayOfLast = new Date(last.year, last.month, 0).getDate();
    const endDate = `${last.year}-${String(last.month).padStart(2, '0')}-${String(lastDayOfLast).padStart(2, '0')}`;

    const [clientsRes, recordsRes] = await Promise.all([
        this.db.from('clients').select('*').eq('user_id', uid).order('created_at'),
        this.db.from('records').select('client_id, minutes, date').eq('user_id', uid)
            .gte('date', startDate).lte('date', endDate)
    ]);
    if (clientsRes.error) throw clientsRes.error;
    if (recordsRes.error) throw recordsRes.error;

    const clients = (clientsRes.data || []).map(r => this._client(r));
    const minutesByClientMonth = {};
    (recordsRes.data || []).forEach(r => {
        const ym = r.date.slice(0, 7);
        const key = `${r.client_id}|${ym}`;
        minutesByClientMonth[key] = (minutesByClientMonth[key] || 0) + (parseInt(r.minutes) || 0);
    });

    return monthsArr.map(({ year, month }) => {
        let totalValor = 0;
        clients.forEach(client => {
            const eligible = TSPFinancial.isEligible(client, year, month);
            const key = `${client.id}|${year}-${String(month).padStart(2, '0')}`;
            const entry = TSPFinancial.computeEntry(client, year, month, minutesByClientMonth[key] || 0, eligible);
            if (entry) totalValor += entry.valor;
        });
        return { year, month, totalValor };
    });
}
```

- [ ] **Step 2: Verificar manualmente que o arquivo não tem erro de sintaxe**

Run: `node -c js/store.js`
Expected: nenhuma saída (exit code 0). `node -c` apenas faz parse/check de sintaxe, não executa o arquivo (que depende de `window`/Supabase).

- [ ] **Step 3: Commit**

```bash
git add js/store.js
git commit -m "feat: store.getFinancialSummary e getFinancialHistory"
```

---

### Task 3: HTML — script tag, item de menu e estrutura da view "Financeiro"

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: nenhum (apenas markup estático).
- Produces: elementos DOM que as Tasks 4-6 vão popular: `#financeiro-month-label`, `#financeiro-tbody`, `#financeiro-tfoot`, `#financeiro-chart-container`. Botões com `onclick="app.financeiroNavigateMonth(...)"`, `onclick="app.financeiroGoToToday()"`, `onclick="app.financeiroNavigateHistory(...)"` (implementados na Task 4).

- [ ] **Step 1: Adicionar o script tag do novo módulo, antes de `store.js` (linha 2406 de `index.html`)**

Old:
```html
    <script src="js/holidays.js?v=1"></script>
    <script src="js/productivity-calc.js?v=1"></script>
    <script src="js/store.js?v=27"></script>
```

New:
```html
    <script src="js/holidays.js?v=1"></script>
    <script src="js/productivity-calc.js?v=1"></script>
    <script src="js/financial-calc.js?v=1"></script>
    <script src="js/store.js?v=28"></script>
```

- [ ] **Step 2: Bumpar a versão de `app.js` (linha 2409)**

Old:
```html
    <script src="js/app.js?v=40"></script>
```

New:
```html
    <script src="js/app.js?v=41"></script>
```

- [ ] **Step 3: Adicionar o item de navegação no sidebar, imediatamente após o item "Produtividade"**

Old:
```html
                <li class="nav-item" data-view="produtividade" title="Produtividade">
                    <i data-lucide="trending-up"></i><span class="nav-label">Produtividade</span>
                </li>
```

New:
```html
                <li class="nav-item" data-view="produtividade" title="Produtividade">
                    <i data-lucide="trending-up"></i><span class="nav-label">Produtividade</span>
                </li>
                <li class="nav-item" data-view="financeiro" title="Financeiro">
                    <i data-lucide="wallet"></i><span class="nav-label">Financeiro</span>
                </li>
```

(Confirmar a indentação exata olhando o arquivo real antes de aplicar — usar a indentação do item "Produtividade" como referência.)

- [ ] **Step 4: Adicionar a nova `<section class="view-section" id="view-financeiro">`, imediatamente após o fechamento da section "Produtividade"**

Old (fim da section Produtividade):
```html
    <div id="produtividade-container"></div>
</section>
```

New:
```html
    <div id="produtividade-container"></div>
</section>

<!-- VIEW: FINANCEIRO -->
<section class="view-section" id="view-financeiro">
    <div class="view-header">
        <div class="view-header-left">
            <h1>Financeiro</h1>
            <div class="apontamentos-date-nav" id="financeiro-month-nav">
                <button id="btn-financeiro-prev" class="btn-icon" title="Mês anterior" onclick="app.financeiroNavigateMonth(-1)">
                    <i data-lucide="chevron-left"></i>
                </button>
                <span id="financeiro-month-label" class="apt-date-label"></span>
                <button id="btn-financeiro-next" class="btn-icon" title="Próximo mês" onclick="app.financeiroNavigateMonth(1)">
                    <i data-lucide="chevron-right"></i>
                </button>
                <button id="btn-financeiro-today" class="btn btn-secondary btn-sm" onclick="app.financeiroGoToToday()">Hoje</button>
            </div>
        </div>
    </div>

    <table class="data-table" id="financeiro-table">
        <thead>
            <tr>
                <th>Cliente</th>
                <th>Modelo</th>
                <th>Detalhe</th>
                <th>Valor a receber</th>
                <th>Comissão consultor</th>
            </tr>
        </thead>
        <tbody id="financeiro-tbody">
            <!-- Tabela renderizada via JS -->
        </tbody>
        <tfoot id="financeiro-tfoot"></tfoot>
    </table>

    <div class="view-header" style="margin-top:24px;">
        <div class="view-header-left">
            <h2 style="margin:0;font-size:1rem;">Histórico (12 meses)</h2>
        </div>
        <div class="view-header-actions">
            <button id="btn-financeiro-hist-prev" class="btn-icon" title="12 meses anteriores" onclick="app.financeiroNavigateHistory(-1)">
                <i data-lucide="chevron-left"></i>
            </button>
            <button id="btn-financeiro-hist-next" class="btn-icon" title="12 meses seguintes" onclick="app.financeiroNavigateHistory(1)">
                <i data-lucide="chevron-right"></i>
            </button>
        </div>
    </div>
    <div id="financeiro-chart-container"></div>
</section>
```

- [ ] **Step 5: Verificar visualmente no navegador que a página ainda carrega sem erro de JS no console**

Run: `python -m http.server 8080` (na raiz do projeto, em outro terminal) e abrir `http://localhost:8080/index.html`.
Expected: tela de login aparece normalmente, sem erro no console (o item "Financeiro" aparece no menu mas ainda não responde, pois os métodos do `AppController` só são criados na Task 4 — clicar nele agora vai gerar um erro JS esperado, que será corrigido na próxima task).

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: markup da view Financeiro (sidebar + tabela + gráfico)"
```

---

### Task 4: Estado e navegação do `AppController` em `js/app.js`

**Files:**
- Modify: `js/app.js`

**Interfaces:**
- Consumes: nenhum método novo de store ainda (chamado na Task 5).
- Produces: `this.financeiroYear`, `this.financeiroMonth` (mês selecionado, 1-12), `this.financeiroHistEndYear`, `this.financeiroHistEndMonth` (fim da janela de 12 meses do gráfico), `this._financeiroSummary`, `this._financeiroHistory` (cache do último render). Métodos `financeiroNavigateMonth(delta)`, `financeiroGoToToday()`, `financeiroNavigateHistory(direction)` — todos chamam `this.renderFinanceiro()` (implementado na Task 5; por isso o teste manual desta task só confirma a navegação dos números de estado via console, a renderização completa só é validada na Task 5/6).

- [ ] **Step 1: Adicionar estado no construtor, imediatamente após a linha `this._prodConfigHolidays = [];` (linha 67 de `js/app.js`)**

Old:
```javascript
    this.prodRefDate = TSPProductivity.toIsoLocal(new Date());
    this._prodSummary = null;
    this._prodConfigHolidays = [];
```

New:
```javascript
    this.prodRefDate = TSPProductivity.toIsoLocal(new Date());
    this._prodSummary = null;
    this._prodConfigHolidays = [];
    this.financeiroYear = new Date().getFullYear();
    this.financeiroMonth = new Date().getMonth() + 1; // 1-12
    this.financeiroHistEndYear = this.financeiroYear;
    this.financeiroHistEndMonth = this.financeiroMonth;
    this._financeiroSummary = null;
    this._financeiroHistory = null;
```

- [ ] **Step 2: Adicionar os métodos de navegação, imediatamente após a função `prodGoToToday()` (linhas 5829-5832 de `js/app.js`)**

Old:
```javascript
    prodGoToToday() {
        this.prodRefDate = TSPProductivity.toIsoLocal(new Date());
        this.renderProdutividade();
    }
```

New:
```javascript
    prodGoToToday() {
        this.prodRefDate = TSPProductivity.toIsoLocal(new Date());
        this.renderProdutividade();
    }

    financeiroNavigateMonth(delta) {
        this.financeiroMonth += delta;
        if (this.financeiroMonth < 1) { this.financeiroMonth = 12; this.financeiroYear -= 1; }
        else if (this.financeiroMonth > 12) { this.financeiroMonth = 1; this.financeiroYear += 1; }
        this.renderFinanceiro();
    }

    financeiroGoToToday() {
        const now = new Date();
        this.financeiroYear = now.getFullYear();
        this.financeiroMonth = now.getMonth() + 1;
        this.renderFinanceiro();
    }

    financeiroNavigateHistory(direction) {
        this.financeiroHistEndMonth += direction * 12;
        while (this.financeiroHistEndMonth > 12) { this.financeiroHistEndMonth -= 12; this.financeiroHistEndYear += 1; }
        while (this.financeiroHistEndMonth < 1) { this.financeiroHistEndMonth += 12; this.financeiroHistEndYear -= 1; }
        this.renderFinanceiro();
    }
```

(`this.renderFinanceiro()` ainda não existe — será criado na Task 5. Isso é esperado; o arquivo só fica 100% funcional ao final da Task 5.)

- [ ] **Step 3: Adicionar `'financeiro'` ao array `VIEW_ORDER` dentro de `switchView()` (linha ~351 de `js/app.js`)**

Old:
```javascript
        const VIEW_ORDER = ['dashboard','clients','records','tasks','agenda','apontamentos','implementations','trainings','chamados','produtividade'];
```

New:
```javascript
        const VIEW_ORDER = ['dashboard','clients','records','tasks','agenda','apontamentos','implementations','trainings','chamados','produtividade','financeiro'];
```

- [ ] **Step 4: Adicionar `this.renderFinanceiro()` ao `Promise.all()` de `renderAll()` (linhas 1834-1869 de `js/app.js`)**

Old:
```javascript
            this.renderChamados(),
            this.renderProdutividade()
        ]);
```

New:
```javascript
            this.renderChamados(),
            this.renderProdutividade(),
            this.renderFinanceiro()
        ]);
```

- [ ] **Step 5: Verificar sintaticamente**

Run: `node -c js/app.js`
Expected: nenhuma saída (exit code 0).

- [ ] **Step 6: Commit**

```bash
git add js/app.js
git commit -m "feat: estado e navegação de mês/histórico da view Financeiro"
```

---

### Task 5: `renderFinanceiro()` — tabela do mês

**Files:**
- Modify: `js/app.js`

**Interfaces:**
- Consumes: `store.getFinancialSummary(year, month)` e `store.getFinancialHistory(monthsBack, endYear, endMonth)` (Task 2). `this.financeiroYear`, `this.financeiroMonth`, `this.financeiroHistEndYear`, `this.financeiroHistEndMonth` (Task 4). `escapeHtml()` (função global já existente em `js/app.js`, usada em `renderClients()`). `spinnerHtml` (const script-scoped já existente).
- Produces: `async renderFinanceiro()` (chamada por `renderAll()` e pelos métodos de navegação da Task 4). `this._buildFinanceiroChart(history)` (assinatura usada nesta task, implementação completa na Task 6 — nesta task criar como stub que retorna um `<div>` vazio, para a view já renderizar sem erro; a Task 6 substitui o stub pela implementação real).

- [ ] **Step 1: Adicionar `renderFinanceiro()` e o stub `_buildFinanceiroChart()`, imediatamente após o fechamento de `renderProdutividade()` (linhas 5934-5962 de `js/app.js`)**

```javascript
    async renderFinanceiro() {
        if (this.currentView !== 'financeiro') return;
        const tbody = document.getElementById('financeiro-tbody');
        const tfoot = document.getElementById('financeiro-tfoot');
        const chartContainer = document.getElementById('financeiro-chart-container');
        if (!tbody || !tfoot || !chartContainer) return;

        const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
        const labelEl = document.getElementById('financeiro-month-label');
        if (labelEl) labelEl.textContent = `${monthNames[this.financeiroMonth - 1]} ${this.financeiroYear}`;

        tbody.innerHTML = `<tr><td colspan="5" class="text-muted">Carregando...</td></tr>`;
        tfoot.innerHTML = '';
        chartContainer.innerHTML = spinnerHtml;

        try {
            const [summary, history] = await Promise.all([
                store.getFinancialSummary(this.financeiroYear, this.financeiroMonth),
                store.getFinancialHistory(12, this.financeiroHistEndYear, this.financeiroHistEndMonth)
            ]);
            this._financeiroSummary = summary;
            this._financeiroHistory = history;

            const formatMoney = (val) => (val && !isNaN(val)) ? `R$ ${parseFloat(val).toFixed(2).replace('.', ',')}` : 'R$ 0,00';

            if (summary.items.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" class="text-muted">Nenhum cliente elegível neste mês.</td></tr>`;
            } else {
                tbody.innerHTML = summary.items.map(({ client, valor, comissao, detalhe }) => {
                    const modelo = client.billingModel === 'hourly' ? 'Por Hora' : 'Fixo';
                    const detalheStr = detalhe ? `${detalhe.horas.toFixed(1)}h × ${formatMoney(detalhe.rate)}` : '—';
                    const comissaoStr = client.billingModel === 'hourly' ? '—' : `<span class="money-value">${formatMoney(comissao)}</span>`;
                    return `
                        <tr>
                            <td>${escapeHtml(client.name)}</td>
                            <td>${modelo}</td>
                            <td>${detalheStr}</td>
                            <td><span class="money-value">${formatMoney(valor)}</span></td>
                            <td>${comissaoStr}</td>
                        </tr>`;
                }).join('');
            }

            tfoot.innerHTML = `
                <tr style="font-weight:600;">
                    <td colspan="3">Total</td>
                    <td><span class="money-value">${formatMoney(summary.totalValor)}</span></td>
                    <td><span class="money-value">${formatMoney(summary.totalComissao)}</span></td>
                </tr>`;

            chartContainer.innerHTML = '';
            chartContainer.appendChild(this._buildFinanceiroChart(history));
            lucide.createIcons();
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-muted">Erro ao carregar: ${escapeHtml(err.message)}</td></tr>`;
            chartContainer.innerHTML = '';
        }
    }

    _buildFinanceiroChart(history) {
        const wrap = document.createElement('div');
        return wrap; // implementado na Task 6
    }
```

- [ ] **Step 2: Verificar sintaticamente**

Run: `node -c js/app.js`
Expected: nenhuma saída (exit code 0).

- [ ] **Step 3: Testar manualmente no navegador**

Run: `python -m http.server 8080` (se não estiver rodando) e abrir `http://localhost:8080/index.html`. Login com `jorjaocorreia@gmail.com` / `Jhc1881//`. Clicar em "Financeiro" no menu lateral.
Expected: a tabela do mês atual carrega sem erro no console, mostrando os clientes elegíveis com valor a receber e comissão (ou "Nenhum cliente elegível neste mês." se não houver nenhum). Os botões `<` `>` e "Hoje" trocam o mês exibido no label e recarregam a tabela. A área do gráfico aparece vazia (esperado — Task 6 ainda não implementada).

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat: renderFinanceiro - tabela do mês selecionado"
```

---

### Task 6: Gráfico histórico (12 meses) em `_buildFinanceiroChart()`

**Files:**
- Modify: `js/app.js`

**Interfaces:**
- Consumes: `history` (array `{year, month, totalValor}`, produzido por `store.getFinancialHistory`, Task 2). `this.financeiroYear`, `this.financeiroMonth` (Task 4, usados para destacar a barra do mês selecionado).
- Produces: `_buildFinanceiroChart(history)` retorna um nó DOM com o gráfico de barras completo (substitui o stub da Task 5).

- [ ] **Step 1: Substituir o stub de `_buildFinanceiroChart()` (criado na Task 5) pela implementação completa**

Old:
```javascript
    _buildFinanceiroChart(history) {
        const wrap = document.createElement('div');
        return wrap; // implementado na Task 6
    }
```

New:
```javascript
    _buildFinanceiroChart(history) {
        const wrap = document.createElement('div');
        wrap.className = 'glass';
        wrap.style.padding = '20px 24px';

        const monthAbbr = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        const maxValor = Math.max(...history.map(h => h.totalValor), 1);
        const formatMoney = (val) => (val && !isNaN(val)) ? `R$ ${parseFloat(val).toFixed(2).replace('.', ',')}` : 'R$ 0,00';

        const bars = history.map(h => {
            const pct = Math.round((h.totalValor / maxValor) * 100);
            const isSelected = h.year === this.financeiroYear && h.month === this.financeiroMonth;
            const barColor = isSelected ? 'linear-gradient(180deg,#38bdf8,#0ea5e9)' : 'linear-gradient(180deg,#22c55e,#16a34a)';
            return `
                <div style="display:flex;flex-direction:column;align-items:center;flex:1;gap:6px;">
                    <div style="height:140px;width:100%;display:flex;align-items:flex-end;">
                        <div class="fin-bar-fill money-value" data-h="${pct}" title="${formatMoney(h.totalValor)}"
                            style="width:60%;margin:0 auto;height:0;background:${barColor};border-radius:4px 4px 0 0;transition:height 0.55s ease;"></div>
                    </div>
                    <span style="font-size:0.72rem;color:var(--text-muted);">${monthAbbr[h.month - 1]}/${String(h.year).slice(2)}</span>
                </div>`;
        }).join('');

        wrap.innerHTML = `<h3 style="margin:0 0 16px;font-size:1rem;">Total a receber por mês</h3><div style="display:flex;align-items:flex-end;gap:4px;">${bars}</div>`;

        requestAnimationFrame(() => requestAnimationFrame(() => {
            wrap.querySelectorAll('.fin-bar-fill').forEach(bar => {
                bar.style.height = bar.dataset.h + '%';
            });
        }));

        return wrap;
    }
```

- [ ] **Step 2: Verificar sintaticamente**

Run: `node -c js/app.js`
Expected: nenhuma saída (exit code 0).

- [ ] **Step 3: Testar manualmente no navegador**

Run: `python -m http.server 8080` (se não estiver rodando) e abrir `http://localhost:8080/index.html`. Login e navegar até "Financeiro".
Expected: abaixo da tabela aparece o gráfico de barras com os últimos 12 meses, barras animando a altura ao carregar, a barra do mês atualmente selecionado na tabela em azul/ciano (`#38bdf8`) e as demais em verde. Tooltip nativo (passar o mouse) mostra o valor em R$. Trocar o mês na tabela (botões `<`/`>`/"Hoje") atualiza qual barra fica destacada. Os botões `<`/`>` ao lado de "Histórico (12 meses)" deslizam a janela inteira em blocos de 12 meses (testar clicando e confirmando que os meses exibidos mudam). Clicar no ícone de olho (ocultar valores) borra a tabela e as barras do gráfico (efeito de blur via `.money-value`).

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat: gráfico histórico de 12 meses no Financeiro"
```

---

### Task 7: Documentação e verificação final

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nenhum (apenas documentação).
- Produces: nenhum (fim do plano).

- [ ] **Step 1: Adicionar a nova view à tabela "Funcionalidades por view" em `CLAUDE.md`**

Localizar a tabela de views (seção `## Funcionalidades por view`) e adicionar uma linha após "Produtividade":

```markdown
| **Financeiro** | Resumo mensal de valor a receber por cliente (Fixo: valor cheio + comissão 43%; Por Hora: horas × valor/hora, sem comissão) e gráfico comparativo dos últimos 12 meses |
```

- [ ] **Step 2: Adicionar uma entrada nas "Armadilhas conhecidas" documentando a regra de elegibilidade**

Adicionar ao final da lista de armadilhas (próximo às entradas de Produtividade):

```markdown
- **Financeiro: elegibilidade de cliente "Finalizado" é uma aproximação** — não há histórico de mudança de `status`, só o valor atual. A regra em `js/financial-calc.js` (`isEligible`): para o mês atual/futuro, só conta cliente com `status === 'active'`; para meses passados, conta independente do status atual, desde que `createdAt` seja anterior ao mês. Se o `clientPays`/`hourlyRate` de um cliente mudar, o histórico recalculado usa o valor *atual* desses campos — não há "congelamento" de valores passados.
```

- [ ] **Step 3: Rodar a suíte completa de testes da lógica pura**

Run: `node tests/financial-calc.test.js`
Expected: `TODOS OS TESTES PASSARAM`, exit code 0.

- [ ] **Step 4: Smoke test final no navegador (fluxo completo)**

Run: `python -m http.server 8080` e abrir `http://localhost:8080/index.html`. Login → "Financeiro" → navegar 2-3 meses para trás e para frente na tabela → navegar a janela do histórico → conferir que os totais da tabela (linha "Total") batem com a soma manual das linhas → conferir no DevTools (aba Network) que não há mais de 2 queries Supabase por clique de navegação (uma para `clients` outra para `records`, sem N+1).
Expected: nenhum erro no console, valores consistentes, sem requisições redundantes.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: documentar view Financeiro e regra de elegibilidade"
```

- [ ] **Step 6: Push (com aviso de deploy manual)**

```bash
git push origin main
```

Após o push, **avisar o usuário para fazer o deploy manual no Easypanel** (webhook automático está quebrado, conforme já documentado em `CLAUDE.md`).
