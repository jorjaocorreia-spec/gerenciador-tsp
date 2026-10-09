# Vendas Diretas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nova aba "Vendas Diretas" em Financeiro para controlar serviços (à vista/parcelados) e mensalidades de clientes fora da Tecinco, visível só para duas contas.

**Architecture:** Módulo puro `js/direct-sales-calc.js` (regras e totais, testado em Node) + 4 tabelas Supabase com RLS por `user_id` e função `direct_sales_allowed()` (lista de e-mails) + funções SQL transacionais (geração, reajuste, cancelamento) + métodos novos em `TSPStore` + aba nova em `#view-financeiro` renderizada por `AppController`.

**Tech Stack:** JS vanilla ES6, Supabase (Postgres/RLS/RPC), Node (testes unitários, `assert`), Playwright (E2E em produção).

**Spec:** [docs/superpowers/specs/2026-10-09-vendas-diretas-design.md](../specs/2026-10-09-vendas-diretas-design.md)

## Global Constraints

- Dinheiro sempre em **centavos inteiros** (`*_cents`); nunca float no banco nem nos cálculos. Só formatar na tela.
- Datas de vencimento/pagamento em `DATE` (`YYYY-MM-DD`); competência em texto `YYYY-MM`. "Hoje" e "mês corrente" sempre em **data local** (`getFullYear/getMonth/getDate`), nunca `toISOString()`.
- Contas com acesso: exatamente `jorge.henrique@tecinco.com.br` e `testes@teste.com`. Constante front `DIRECT_SALES_ALLOWED_EMAILS` e função SQL `direct_sales_allowed()` devem ter a mesma lista.
- Métodos do `store` que **leem** começam com `get` (ou `_`); todo o resto é tratado como escrita e bloqueado em Modo Supervisão. Métodos `get*` **nunca** escrevem.
- Nada retroativo: mensalidade com `start_month` >= mês corrente; 1ª parcela de serviço >= hoje.
- Totais: Faturado/A receber por `competence`; Recebido por `paid_at` no mês; Atrasado = todas as `pending` com `due_date < hoje`, de qualquer mês.
- Aba Tecinco e suas funções (`getFinancialSummary`, `getFinancialHistory`, `TSPFinancial`) **não são alteradas**.
- Seguir CLAUDE.md: `await` nunca dentro de `forEach` de render; IDs de HTML estáveis; modais via `openModal()`; labels com `for=`; deletes destrutivos via `_twostepDelete`; valores monetários na tela com classe `.money-value`.
- Trabalhar direto em `main`; `git push origin main` após cada commit; rodapé de commit `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Nunca colar token/segredo literal em arquivo; token do Supabase fica no arquivo de memória `reference_supabase_token.md` (ler o arquivo completo na hora; já expirou 2 vezes).

## Review Focus

- Duas abas abertas gerando/cancelando ao mesmo tempo → nunca cobrança pendente após `cancelled_from` (RPC com `FOR UPDATE` + trigger) — Task 2.
- Conta `testes@teste.com` tentando apontar contrato/cobrança para linha do Jorge → bloqueado por FK composta — Task 2/8.
- Consultor fora da lista inserindo linha com o próprio `user_id` → negado pela cláusula de e-mail — Task 8.
- Parcela de serviço com data editada para outro mês → `competence` acompanha o `due_date` — Task 1 e 6.
- Reajustes fora de ordem/repetidos no mesmo mês → valor da competência segue o ajuste de maior `from_month` — Task 1 e 2.
- Aba Vendas Diretas ativa durante `renderAll()` ou logout/login de outro usuário → sem vazar dado nem recarregar Tecinco — Task 5.
- Valores ocultos pelo botão de olho incluindo cards, lista, prévia e gráfico — Task 5/7.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `js/direct-sales-calc.js` (novo) | Regras puras: parcelas, vencimentos, valor por competência, geração, totais, formatação/parse de dinheiro. Global `TSPDirectSales`. |
| `tests/direct-sales-calc.test.js` (novo) | Testes unitários do módulo acima. |
| `supabase/migrations/20261009_direct_sales.sql` (novo) | Tabelas, constraints, `direct_sales_allowed()`, policies, triggers, RPCs. |
| `js/store.js` | Mappers + métodos `*Direct*`. |
| `index.html` | Abas em `#view-financeiro`, painel Vendas Diretas, 8 modais, `<script>` do novo módulo. |
| `js/app.js` | Estado/aba, gating de acesso, `renderDirectSales()`, handlers de modais, gráfico. |
| `tests/e2e-direct-sales.js` (novo) | E2E Playwright (produção) + checagens de isolamento. |
| `CLAUDE.md` | Fase 54 + armadilhas. |

---

### Task 1: Módulo puro `TSPDirectSales` + testes

**Files:**
- Create: `js/direct-sales-calc.js`
- Create: `tests/direct-sales-calc.test.js`

**Interfaces:**
- Produces (global `TSPDirectSales`):
  - `toIsoLocal(date) -> 'YYYY-MM-DD'`, `currentMonthLocal(now?) -> 'YYYY-MM'`
  - `addMonths(ym, n) -> 'YYYY-MM'`, `daysInMonth(ym) -> number`
  - `dueDateFor(ym, day) -> 'YYYY-MM-DD'` (clamp no último dia)
  - `addMonthsKeepingDay(iso, k) -> 'YYYY-MM-DD'` (sempre parte do dia original)
  - `splitInstallments(totalCents, n) -> number[]` (lança erro se `n<1`, total não inteiro/<=0 ou total < n)
  - `serviceCharges(totalCents, n, firstDueIso) -> [{chargeKey:'i:1', competence, dueDate, amountCents}]`
  - `amountFor(contract, adjustments, competence) -> cents` (`contract.monthlyAmountCents`; ajustes `{fromMonth,newAmountCents}`)
  - `subscriptionCompetences(startMonth, cancelledFrom|null, untilMonth) -> string[]`
  - `ensureUntil(viewMonth, currentMonth) -> 'YYYY-MM'` (= max(view, current) + 3 meses)
  - `isOverdue(charge, todayIso) -> boolean` (`status==='pending' && dueDate < todayIso`)
  - `computeMonthTotals({charges, paidInMonth, overdue}) -> {faturado, recebido, aReceber, atrasado}` (centavos)
  - `computeHistory(window, charges) -> [{year, month, faturado, recebido}]` (`window` = saída de `TSPFinancial.monthsWindow`; `charges` pode ter ids repetidos, deduplica por `id`)
  - `parseMoneyToCents(str) -> number|null`, `formatCents(cents) -> 'R$ 1.234,56'`
- Charge object (camelCase, igual ao mapper do store): `{id, contractId, chargeKey, competence, dueDate, amountCents, status, paidAt, manuallyEdited}`.

- [ ] **Step 1: Escrever os testes (falham)**

Criar `tests/direct-sales-calc.test.js`:

```javascript
const assert = require('assert');
require('../js/direct-sales-calc.js');
const D = global.TSPDirectSales;

function run(name, fn) {
    try { fn(); console.log(`OK   ${name}`); }
    catch (err) { console.error(`FAIL ${name}`); console.error(err); process.exitCode = 1; }
}

run('addMonths: vira o ano para frente e para trás', () => {
    assert.strictEqual(D.addMonths('2026-11', 3), '2027-02');
    assert.strictEqual(D.addMonths('2026-01', -1), '2025-12');
    assert.strictEqual(D.addMonths('2026-10', 0), '2026-10');
});

run('dueDateFor: dia 31 em fevereiro vira último dia (ano comum e bissexto)', () => {
    assert.strictEqual(D.dueDateFor('2026-02', 31), '2026-02-28');
    assert.strictEqual(D.dueDateFor('2028-02', 31), '2028-02-29');
    assert.strictEqual(D.dueDateFor('2026-04', 31), '2026-04-30');
    assert.strictEqual(D.dueDateFor('2026-10', 5), '2026-10-05');
});

run('addMonthsKeepingDay: 31/01 -> 28/02 -> 31/03 (não encadeia o clamp)', () => {
    assert.strictEqual(D.addMonthsKeepingDay('2026-01-31', 1), '2026-02-28');
    assert.strictEqual(D.addMonthsKeepingDay('2026-01-31', 2), '2026-03-31');
});

run('splitInstallments: resto de centavos vai para a última parcela', () => {
    assert.deepStrictEqual(D.splitInstallments(10000, 3), [3333, 3333, 3334]);
    assert.deepStrictEqual(D.splitInstallments(10000, 1), [10000]);
    assert.strictEqual(D.splitInstallments(12345, 4).reduce((a, b) => a + b, 0), 12345);
});

run('splitInstallments: entradas inválidas lançam erro', () => {
    assert.throws(() => D.splitInstallments(10000, 0));
    assert.throws(() => D.splitInstallments(0, 2));
    assert.throws(() => D.splitInstallments(1, 2)); // total < n
    assert.throws(() => D.splitInstallments(100.5, 2));
});

run('serviceCharges: competence acompanha o mês do vencimento e chaves i:N', () => {
    const rows = D.serviceCharges(30000, 3, '2026-11-30');
    assert.deepStrictEqual(rows.map(r => r.chargeKey), ['i:1', 'i:2', 'i:3']);
    assert.deepStrictEqual(rows.map(r => r.dueDate), ['2026-11-30', '2026-12-30', '2027-01-30']);
    assert.deepStrictEqual(rows.map(r => r.competence), ['2026-11', '2026-12', '2027-01']);
    assert.deepStrictEqual(rows.map(r => r.amountCents), [10000, 10000, 10000]);
});

run('amountFor: sem ajustes usa o valor mensal', () => {
    assert.strictEqual(D.amountFor({ monthlyAmountCents: 50000 }, [], '2026-10'), 50000);
});

run('amountFor: ajustes fora de ordem seguem o de maior fromMonth <= competência', () => {
    const c = { monthlyAmountCents: 10000 };
    const adj = [
        { fromMonth: '2026-11', newAmountCents: 15000 },
        { fromMonth: '2026-12', newAmountCents: 20000 }
    ];
    assert.strictEqual(D.amountFor(c, adj, '2026-10'), 10000);
    assert.strictEqual(D.amountFor(c, adj, '2026-11'), 15000);
    assert.strictEqual(D.amountFor(c, adj, '2027-03'), 20000);
    // ajuste "tardio" cadastrado depois com from_month anterior não vence o de dezembro
    adj.push({ fromMonth: '2026-11', newAmountCents: 15000 });
    assert.strictEqual(D.amountFor(c, adj, '2026-12'), 20000);
});

run('subscriptionCompetences: respeita cancelamento e limite', () => {
    assert.deepStrictEqual(D.subscriptionCompetences('2026-10', null, '2027-01'),
        ['2026-10', '2026-11', '2026-12', '2027-01']);
    assert.deepStrictEqual(D.subscriptionCompetences('2026-10', '2026-12', '2027-03'),
        ['2026-10', '2026-11']);
    assert.deepStrictEqual(D.subscriptionCompetences('2026-10', '2026-10', '2027-03'), []);
    assert.deepStrictEqual(D.subscriptionCompetences('2026-12', null, '2026-10'), []);
});

run('ensureUntil: usa o maior entre mês visto e mês corrente, +3', () => {
    assert.strictEqual(D.ensureUntil('2026-10', '2026-10'), '2027-01');
    assert.strictEqual(D.ensureUntil('2026-05', '2026-10'), '2027-01'); // olhando o passado
    assert.strictEqual(D.ensureUntil('2027-02', '2026-10'), '2027-05');
});

run('isOverdue: só pendente com vencimento anterior a hoje', () => {
    assert.strictEqual(D.isOverdue({ status: 'pending', dueDate: '2026-10-08' }, '2026-10-09'), true);
    assert.strictEqual(D.isOverdue({ status: 'pending', dueDate: '2026-10-09' }, '2026-10-09'), false);
    assert.strictEqual(D.isOverdue({ status: 'paid', dueDate: '2026-01-01' }, '2026-10-09'), false);
});

run('computeMonthTotals: Faturado/A receber por competência, Recebido por paid_at, Atrasado global', () => {
    const charges = [
        { status: 'paid', amountCents: 10000 },
        { status: 'pending', amountCents: 5000 }
    ];
    const paidInMonth = [{ amountCents: 10000 }, { amountCents: 7000 }]; // 7000 = de outra competência
    const overdue = [{ amountCents: 5000 }, { amountCents: 3000 }];      // 3000 = de mês anterior
    assert.deepStrictEqual(D.computeMonthTotals({ charges, paidInMonth, overdue }),
        { faturado: 15000, recebido: 17000, aReceber: 5000, atrasado: 8000 });
});

run('computeHistory: Faturado por competência, Recebido por paid_at, deduplica por id', () => {
    const window = [{ year: 2026, month: 9 }, { year: 2026, month: 10 }];
    const charges = [
        { id: 'a', competence: '2026-09', amountCents: 10000, status: 'paid', paidAt: '2026-10-03' },
        { id: 'a', competence: '2026-09', amountCents: 10000, status: 'paid', paidAt: '2026-10-03' },
        { id: 'b', competence: '2026-10', amountCents: 5000, status: 'pending', paidAt: null }
    ];
    assert.deepStrictEqual(D.computeHistory(window, charges), [
        { year: 2026, month: 9, faturado: 10000, recebido: 0 },
        { year: 2026, month: 10, faturado: 5000, recebido: 10000 }
    ]);
});

run('parseMoneyToCents: formatos BR e inválidos', () => {
    assert.strictEqual(D.parseMoneyToCents('1.234,56'), 123456);
    assert.strictEqual(D.parseMoneyToCents('R$ 500'), 50000);
    assert.strictEqual(D.parseMoneyToCents('500,5'), 50050);
    assert.strictEqual(D.parseMoneyToCents('0,01'), 1);
    assert.strictEqual(D.parseMoneyToCents('abc'), null);
    assert.strictEqual(D.parseMoneyToCents(''), null);
    assert.strictEqual(D.parseMoneyToCents('10,999'), null);
});

run('formatCents: milhar e centavos', () => {
    assert.strictEqual(D.formatCents(123456), 'R$ 1.234,56');
    assert.strictEqual(D.formatCents(5), 'R$ 0,05');
    assert.strictEqual(D.formatCents(0), 'R$ 0,00');
    assert.strictEqual(D.formatCents(100000000), 'R$ 1.000.000,00');
});

run('toIsoLocal/currentMonthLocal: usam data local', () => {
    const d = new Date(2026, 9, 9, 23, 30); // 09/10/2026 23:30 local
    assert.strictEqual(D.toIsoLocal(d), '2026-10-09');
    assert.strictEqual(D.currentMonthLocal(d), '2026-10');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/direct-sales-calc.test.js`
Expected: erro `Cannot find module '../js/direct-sales-calc.js'`.

- [ ] **Step 3: Implementar o módulo**

Criar `js/direct-sales-calc.js`:

```javascript
(function (global) {
    const pad2 = (n) => String(n).padStart(2, '0');

    function toIsoLocal(d) {
        return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    }

    function currentMonthLocal(now) {
        now = now || new Date();
        return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
    }

    function addMonths(ym, n) {
        const [y, m] = ym.split('-').map(Number);
        const t = y * 12 + (m - 1) + n;
        return `${Math.floor(t / 12)}-${pad2((t % 12) + 1)}`;
    }

    function daysInMonth(ym) {
        const [y, m] = ym.split('-').map(Number);
        return new Date(y, m, 0).getDate();
    }

    function dueDateFor(ym, day) {
        return `${ym}-${pad2(Math.min(day, daysInMonth(ym)))}`;
    }

    // Sempre parte do dia ORIGINAL (31 -> 28 -> 31), nunca encadeia o clamp.
    function addMonthsKeepingDay(iso, k) {
        const day = parseInt(iso.slice(8, 10), 10);
        return dueDateFor(addMonths(iso.slice(0, 7), k), day);
    }

    function splitInstallments(totalCents, n) {
        if (!Number.isInteger(totalCents) || totalCents <= 0) throw new Error('Valor total inválido');
        if (!Number.isInteger(n) || n < 1) throw new Error('Número de parcelas inválido');
        if (totalCents < n) throw new Error('Valor total menor que o número de parcelas');
        const base = Math.floor(totalCents / n);
        const parts = new Array(n).fill(base);
        parts[n - 1] = totalCents - base * (n - 1);
        return parts;
    }

    function serviceCharges(totalCents, n, firstDueIso) {
        const amounts = splitInstallments(totalCents, n);
        return amounts.map((amountCents, i) => {
            const dueDate = addMonthsKeepingDay(firstDueIso, i);
            return { chargeKey: `i:${i + 1}`, competence: dueDate.slice(0, 7), dueDate, amountCents };
        });
    }

    function amountFor(contract, adjustments, competence) {
        let best = null;
        (adjustments || []).forEach(a => {
            if (a.fromMonth <= competence && (best === null || a.fromMonth > best.fromMonth)) best = a;
        });
        return best ? best.newAmountCents : contract.monthlyAmountCents;
    }

    function subscriptionCompetences(startMonth, cancelledFrom, untilMonth) {
        let last = untilMonth;
        if (cancelledFrom) {
            const limit = addMonths(cancelledFrom, -1);
            if (limit < last) last = limit;
        }
        const out = [];
        let cur = startMonth;
        while (cur <= last) { out.push(cur); cur = addMonths(cur, 1); }
        return out;
    }

    function ensureUntil(viewMonth, currentMonth) {
        const base = viewMonth > currentMonth ? viewMonth : currentMonth;
        return addMonths(base, 3);
    }

    function isOverdue(charge, todayIso) {
        return charge.status === 'pending' && charge.dueDate < todayIso;
    }

    const sum = (arr) => arr.reduce((acc, c) => acc + (c.amountCents || 0), 0);

    function computeMonthTotals({ charges, paidInMonth, overdue }) {
        return {
            faturado: sum(charges),
            recebido: sum(paidInMonth),
            aReceber: sum(charges.filter(c => c.status === 'pending')),
            atrasado: sum(overdue)
        };
    }

    function computeHistory(window, charges) {
        const seen = new Map();
        charges.forEach(c => { if (!seen.has(c.id)) seen.set(c.id, c); });
        const unique = Array.from(seen.values());
        return window.map(({ year, month }) => {
            const ym = `${year}-${pad2(month)}`;
            const faturado = sum(unique.filter(c => c.competence === ym));
            const recebido = sum(unique.filter(c => c.status === 'paid' && c.paidAt && c.paidAt.slice(0, 7) === ym));
            return { year, month, faturado, recebido };
        });
    }

    function parseMoneyToCents(str) {
        if (str === null || str === undefined) return null;
        const clean = String(str).replace(/R\$/gi, '').replace(/\s/g, '').replace(/\./g, '');
        if (!/^\d+(,\d{1,2})?$/.test(clean)) return null;
        const [intPart, decPart = ''] = clean.split(',');
        return parseInt(intPart, 10) * 100 + parseInt((decPart + '0').slice(0, 2), 10);
    }

    function formatCents(cents) {
        const neg = cents < 0;
        const abs = Math.abs(Math.round(cents || 0));
        const intPart = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return `${neg ? '-' : ''}R$ ${intPart},${pad2(abs % 100)}`;
    }

    global.TSPDirectSales = {
        toIsoLocal, currentMonthLocal, addMonths, daysInMonth, dueDateFor, addMonthsKeepingDay,
        splitInstallments, serviceCharges, amountFor, subscriptionCompetences, ensureUntil,
        isOverdue, computeMonthTotals, computeHistory, parseMoneyToCents, formatCents
    };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node tests/direct-sales-calc.test.js`
Expected: todas as linhas `OK`, nenhuma `FAIL`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add js/direct-sales-calc.js tests/direct-sales-calc.test.js
git commit -m "feat(vendas-diretas): módulo puro de cálculo e testes"
git push origin main
```

---

### Task 2: Migration SQL (tabelas, constraints, policies, triggers, RPCs)

**Files:**
- Create: `supabase/migrations/20261009_direct_sales.sql`

**Interfaces:**
- Produces (banco):
  - Tabelas `direct_clients`, `direct_contracts`, `direct_charges`, `direct_contract_adjustments`.
  - `direct_sales_allowed() -> boolean`.
  - `direct_amount_for(p_contract uuid, p_competence text) -> bigint`, `direct_due_date(p_competence text, p_due_day int) -> date`.
  - `ensure_direct_charges(p_contract_id uuid, p_until text) -> integer` (nº de cobranças criadas).
  - `adjust_direct_contract(p_contract_id uuid, p_from_month text, p_new_amount_cents bigint) -> void`.
  - `cancel_direct_contract(p_contract_id uuid, p_from_month text) -> void`.

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migrations/20261009_direct_sales.sql`:

```sql
-- Vendas Diretas (Financeiro): serviços e mensalidades fora dos contratos Tecinco.
-- Acesso restrito a duas contas via direct_sales_allowed() + RLS por user_id.
-- Sem nenhuma policy para manager/client (Modo Supervisão e Portal nunca enxergam).
-- Para alterar a lista de contas: CREATE OR REPLACE FUNCTION direct_sales_allowed()
-- e atualizar DIRECT_SALES_ALLOWED_EMAILS em js/app.js.

CREATE OR REPLACE FUNCTION direct_sales_allowed() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((auth.jwt() ->> 'email') IN ('jorge.henrique@tecinco.com.br', 'testes@teste.com'), false)
$$;

CREATE TABLE IF NOT EXISTS direct_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  contact TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (id, user_id)
);

CREATE TABLE IF NOT EXISTS direct_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  client_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('service', 'subscription')),
  description TEXT NOT NULL DEFAULT '',
  total_amount_cents BIGINT,
  installments INTEGER,
  monthly_amount_cents BIGINT,
  due_day INTEGER,
  start_month TEXT NOT NULL CHECK (start_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  cancelled_from TEXT CHECK (cancelled_from IS NULL OR cancelled_from ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (id, user_id),
  FOREIGN KEY (client_id, user_id) REFERENCES direct_clients (id, user_id) ON DELETE RESTRICT,
  CHECK (
    (kind = 'service' AND total_amount_cents > 0 AND installments >= 1
       AND monthly_amount_cents IS NULL AND due_day IS NULL AND cancelled_from IS NULL)
    OR
    (kind = 'subscription' AND monthly_amount_cents > 0 AND due_day BETWEEN 1 AND 31
       AND total_amount_cents IS NULL AND installments IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS direct_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  contract_id UUID NOT NULL,
  charge_key TEXT NOT NULL,
  competence TEXT NOT NULL CHECK (competence ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  due_date DATE NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  paid_at DATE,
  manually_edited BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (contract_id, charge_key),
  FOREIGN KEY (contract_id, user_id) REFERENCES direct_contracts (id, user_id) ON DELETE CASCADE,
  CHECK ((status = 'paid') = (paid_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_direct_charges_user_competence ON direct_charges (user_id, competence);
CREATE INDEX IF NOT EXISTS idx_direct_charges_user_paid_at ON direct_charges (user_id, paid_at);
CREATE INDEX IF NOT EXISTS idx_direct_charges_user_status_due ON direct_charges (user_id, status, due_date);

CREATE TABLE IF NOT EXISTS direct_contract_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  contract_id UUID NOT NULL,
  from_month TEXT NOT NULL CHECK (from_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  new_amount_cents BIGINT NOT NULL CHECK (new_amount_cents > 0),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (contract_id, from_month),
  FOREIGN KEY (contract_id, user_id) REFERENCES direct_contracts (id, user_id) ON DELETE CASCADE
);

-- RLS: dono + conta permitida (leitura E escrita)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['direct_clients', 'direct_contracts', 'direct_charges', 'direct_contract_adjustments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS ds_own ON %I', t);
    EXECUTE format(
      'CREATE POLICY ds_own ON %I FOR ALL USING (user_id = auth.uid() AND direct_sales_allowed()) WITH CHECK (user_id = auth.uid() AND direct_sales_allowed())',
      t);
  END LOOP;
END $$;

-- Funções auxiliares (SECURITY INVOKER: RLS continua valendo)
CREATE OR REPLACE FUNCTION direct_due_date(p_competence text, p_due_day int) RETURNS date
LANGUAGE sql IMMUTABLE AS $$
  SELECT (to_date(p_competence || '-01', 'YYYY-MM-DD')
    + (LEAST(p_due_day,
        EXTRACT(day FROM (to_date(p_competence || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day'))::int) - 1))::date
$$;

CREATE OR REPLACE FUNCTION direct_amount_for(p_contract uuid, p_competence text) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT a.new_amount_cents FROM direct_contract_adjustments a
      WHERE a.contract_id = p_contract AND a.from_month <= p_competence
      ORDER BY a.from_month DESC LIMIT 1),
    (SELECT c.monthly_amount_cents FROM direct_contracts c WHERE c.id = p_contract))
$$;

-- Cobrança nunca nasce em competência cancelada
CREATE OR REPLACE FUNCTION direct_charges_check_cancel() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE cf text;
BEGIN
  SELECT cancelled_from INTO cf FROM direct_contracts WHERE id = NEW.contract_id;
  IF cf IS NOT NULL AND NEW.competence >= cf THEN
    RAISE EXCEPTION 'Contrato cancelado a partir de %', cf;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_direct_charges_check_cancel ON direct_charges;
CREATE TRIGGER trg_direct_charges_check_cancel BEFORE INSERT ON direct_charges
  FOR EACH ROW EXECUTE FUNCTION direct_charges_check_cancel();

-- Contrato com cobrança paga não pode ser apagado (vale mesmo via API direta)
CREATE OR REPLACE FUNCTION direct_contracts_block_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM direct_charges WHERE contract_id = OLD.id AND status = 'paid') THEN
    RAISE EXCEPTION 'Contrato possui cobranças pagas e não pode ser excluído';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_direct_contracts_block_delete ON direct_contracts;
CREATE TRIGGER trg_direct_contracts_block_delete BEFORE DELETE ON direct_contracts
  FOR EACH ROW EXECUTE FUNCTION direct_contracts_block_delete();

-- Geração idempotente e atômica das mensalidades
CREATE OR REPLACE FUNCTION ensure_direct_charges(p_contract_id uuid, p_until text) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  c direct_contracts%ROWTYPE;
  cur date; last_m date; comp text; n int := 0;
BEGIN
  SELECT * INTO c FROM direct_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND OR c.kind <> 'subscription' THEN RETURN 0; END IF;
  cur := to_date(c.start_month || '-01', 'YYYY-MM-DD');
  last_m := to_date(p_until || '-01', 'YYYY-MM-DD');
  IF c.cancelled_from IS NOT NULL THEN
    IF (to_date(c.cancelled_from || '-01', 'YYYY-MM-DD') - interval '1 month')::date < last_m THEN
      last_m := (to_date(c.cancelled_from || '-01', 'YYYY-MM-DD') - interval '1 month')::date;
    END IF;
  END IF;
  WHILE cur <= last_m LOOP
    comp := to_char(cur, 'YYYY-MM');
    INSERT INTO direct_charges (user_id, contract_id, charge_key, competence, due_date, amount_cents)
    VALUES (c.user_id, c.id, 'm:' || comp, comp, direct_due_date(comp, c.due_day), direct_amount_for(c.id, comp))
    ON CONFLICT (contract_id, charge_key) DO NOTHING;
    IF FOUND THEN n := n + 1; END IF;
    cur := (cur + interval '1 month')::date;
  END LOOP;
  RETURN n;
END $$;

-- Reajuste: grava o ajuste e recalcula cada pendente não editada pela mesma função de valor
CREATE OR REPLACE FUNCTION adjust_direct_contract(p_contract_id uuid, p_from_month text, p_new_amount_cents bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE c direct_contracts%ROWTYPE;
BEGIN
  SELECT * INTO c FROM direct_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND OR c.kind <> 'subscription' THEN RAISE EXCEPTION 'Contrato de mensalidade não encontrado'; END IF;
  IF p_new_amount_cents IS NULL OR p_new_amount_cents <= 0 THEN RAISE EXCEPTION 'Valor inválido'; END IF;
  IF p_from_month < c.start_month THEN RAISE EXCEPTION 'Mês anterior ao início do contrato'; END IF;
  IF c.cancelled_from IS NOT NULL AND p_from_month >= c.cancelled_from THEN
    RAISE EXCEPTION 'Mês posterior ao cancelamento do contrato';
  END IF;
  INSERT INTO direct_contract_adjustments (user_id, contract_id, from_month, new_amount_cents)
  VALUES (c.user_id, c.id, p_from_month, p_new_amount_cents)
  ON CONFLICT (contract_id, from_month) DO UPDATE SET new_amount_cents = EXCLUDED.new_amount_cents;
  UPDATE direct_charges
     SET amount_cents = direct_amount_for(contract_id, competence)
   WHERE contract_id = c.id AND status = 'pending' AND manually_edited = false
     AND competence >= p_from_month;
END $$;

-- Cancelamento: define cancelled_from e apaga as pendentes dessa competência em diante
CREATE OR REPLACE FUNCTION cancel_direct_contract(p_contract_id uuid, p_from_month text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE c direct_contracts%ROWTYPE;
BEGIN
  SELECT * INTO c FROM direct_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND OR c.kind <> 'subscription' THEN RAISE EXCEPTION 'Contrato de mensalidade não encontrado'; END IF;
  IF p_from_month < c.start_month THEN RAISE EXCEPTION 'Mês anterior ao início do contrato'; END IF;
  UPDATE direct_contracts SET cancelled_from = p_from_month WHERE id = c.id;
  DELETE FROM direct_charges
   WHERE contract_id = c.id AND status = 'pending' AND competence >= p_from_month;
END $$;
```

- [ ] **Step 2: Aplicar via Management API**

Ler o token completo em `C:\Users\jorge\.claude\projects\d--GerenciadorTSP\memory\reference_supabase_token.md` e o método em `reference_supabase_management_api_sql.md` (nunca colar o token em arquivo). Projeto: `klimkamnydfnzqetqlqm`. Exemplo de chamada (PowerShell), com o token já em `$env:SUPABASE_ACCESS_TOKEN`:

```powershell
$sql = Get-Content "d:\GerenciadorTSP\supabase\migrations\20261009_direct_sales.sql" -Raw
$body = @{ query = $sql } | ConvertTo-Json
Invoke-RestMethod -Method Post `
  -Uri "https://api.supabase.com/v1/projects/klimkamnydfnzqetqlqm/database/query" `
  -Headers @{ "Authorization" = "Bearer $env:SUPABASE_ACCESS_TOKEN"; "Content-Type" = "application/json" } `
  -Body $body
```

Expected: resposta sem erro (array vazio). Se der 401, o token expirou: parar e pedir um novo ao Jorge.

- [ ] **Step 3: Verificar que os objetos existem**

Mesma chamada, com a query:

```sql
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_name IN ('direct_clients','direct_contracts','direct_charges','direct_contract_adjustments')) AS tabelas,
  (SELECT count(*) FROM pg_policies WHERE policyname = 'ds_own') AS policies,
  (SELECT count(*) FROM pg_proc WHERE proname IN ('direct_sales_allowed','ensure_direct_charges','adjust_direct_contract','cancel_direct_contract','direct_amount_for','direct_due_date')) AS funcoes,
  (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_direct_charges_check_cancel','trg_direct_contracts_block_delete')) AS triggers;
```

Expected: `tabelas=4, policies=4, funcoes=6, triggers=2`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261009_direct_sales.sql
git commit -m "feat(vendas-diretas): migration com tabelas, RLS, triggers e RPCs"
git push origin main
```

---

### Task 3: Métodos do store

**Files:**
- Modify: `js/store.js` (mappers logo após `_quickNote(r)` ~linha 77-91; métodos logo antes do `}` que fecha a classe `TSPStore`, depois de `linkExistingItemsToProcess`, ~linha 2119)

**Interfaces:**
- Consumes: `TSPDirectSales` (Task 1), RPCs da Task 2, `TSPFinancial.monthsWindow` (já existe).
- Produces (`store.*`):
  - Leitura: `getDirectClients() -> Client[]`, `getDirectContracts() -> Contract[]`, `getDirectCharges(ym) -> Charge[]`, `getDirectOverdue(todayIso) -> Charge[]`, `getDirectPaidInMonth(ym) -> Charge[]`, `getDirectHistory(monthsBack, endYear, endMonth) -> Charge[]` (união deduplicada).
  - Escrita: `addDirectClient({name,contact,notes}) -> Client`, `updateDirectClient(id, patch) -> Client`, `addDirectService({clientId, description, totalCents, installments, firstDueDate, charges}) -> Contract`, `addDirectSubscription({clientId, description, monthlyCents, dueDay, startMonth}) -> Contract`, `ensureDirectCharges(contractId, untilMonth) -> void`, `markDirectChargePaid(id, paidAt)`, `unmarkDirectChargePaid(id)`, `updateDirectCharge(id, {amountCents, dueDate, competence}) -> Charge`, `updateDirectContract(id, {description, clientId}) -> Contract`, `adjustDirectContract(id, fromMonth, newCents)`, `cancelDirectContract(id, fromMonth)`, `reactivateDirectContract(id)`, `deleteDirectContract(id)`.
- Shapes camelCase: Client `{id,name,contact,notes,active,createdAt}`; Contract `{id,clientId,kind,description,totalAmountCents,installments,monthlyAmountCents,dueDay,startMonth,cancelledFrom,createdAt}`; Charge `{id,contractId,chargeKey,competence,dueDate,amountCents,status,paidAt,manuallyEdited}`.

- [ ] **Step 1: Adicionar os mappers** logo depois do fechamento de `_quickNote(r) { ... }`:

```javascript
    _directClient(r) {
        return { id: r.id, name: r.name, contact: r.contact || '', notes: r.notes || '',
            active: r.active !== false, createdAt: r.created_at };
    }

    _directContract(r) {
        return { id: r.id, clientId: r.client_id, kind: r.kind, description: r.description || '',
            totalAmountCents: r.total_amount_cents, installments: r.installments,
            monthlyAmountCents: r.monthly_amount_cents, dueDay: r.due_day,
            startMonth: r.start_month, cancelledFrom: r.cancelled_from || null, createdAt: r.created_at };
    }

    _directCharge(r) {
        return { id: r.id, contractId: r.contract_id, chargeKey: r.charge_key,
            competence: r.competence, dueDate: r.due_date, amountCents: Number(r.amount_cents),
            status: r.status, paidAt: r.paid_at || null, manuallyEdited: !!r.manually_edited };
    }
```

- [ ] **Step 2: Adicionar os métodos** antes do `}` de fechamento da classe (logo após `linkExistingItemsToProcess`):

```javascript
    // ===== Vendas Diretas (Fase 54) =====
    // Leitura: prefixo get (passa pelo Proxy de Modo Supervisão). NUNCA escrevem.
    async getDirectClients() {
        const { data, error } = await this.db.from('direct_clients').select('*')
            .eq('user_id', this.userId).order('name');
        if (error) throw error;
        return data.map(r => this._directClient(r));
    }

    async getDirectContracts() {
        const { data, error } = await this.db.from('direct_contracts').select('*')
            .eq('user_id', this.userId).order('created_at', { ascending: false });
        if (error) throw error;
        return data.map(r => this._directContract(r));
    }

    async getDirectCharges(ym) {
        const { data, error } = await this.db.from('direct_charges').select('*')
            .eq('user_id', this.userId).eq('competence', ym).order('due_date');
        if (error) throw error;
        return data.map(r => this._directCharge(r));
    }

    async getDirectOverdue(todayIso) {
        const { data, error } = await this.db.from('direct_charges').select('*')
            .eq('user_id', this.userId).eq('status', 'pending').lt('due_date', todayIso).order('due_date');
        if (error) throw error;
        return data.map(r => this._directCharge(r));
    }

    async getDirectPaidInMonth(ym) {
        const next = TSPDirectSales.addMonths(ym, 1);
        const { data, error } = await this.db.from('direct_charges').select('*')
            .eq('user_id', this.userId).eq('status', 'paid')
            .gte('paid_at', `${ym}-01`).lt('paid_at', `${next}-01`).order('paid_at');
        if (error) throw error;
        return data.map(r => this._directCharge(r));
    }

    async getDirectHistory(monthsBack, endYear, endMonth) {
        const win = TSPFinancial.monthsWindow(monthsBack, endYear, endMonth);
        const pad = (n) => String(n).padStart(2, '0');
        const startYm = `${win[0].year}-${pad(win[0].month)}`;
        const endYm = `${endYear}-${pad(endMonth)}`;
        const afterEnd = TSPDirectSales.addMonths(endYm, 1);
        const [byCompetence, byPaid] = await Promise.all([
            this.db.from('direct_charges').select('*').eq('user_id', this.userId)
                .gte('competence', startYm).lte('competence', endYm),
            this.db.from('direct_charges').select('*').eq('user_id', this.userId).eq('status', 'paid')
                .gte('paid_at', `${startYm}-01`).lt('paid_at', `${afterEnd}-01`)
        ]);
        if (byCompetence.error) throw byCompetence.error;
        if (byPaid.error) throw byPaid.error;
        const map = new Map();
        [...byCompetence.data, ...byPaid.data].forEach(r => map.set(r.id, this._directCharge(r)));
        return Array.from(map.values());
    }

    // Escrita
    async addDirectClient({ name, contact, notes }) {
        const { data, error } = await this.db.from('direct_clients').insert({
            user_id: this.userId, name: (name || '').trim(), contact: contact || '', notes: notes || ''
        }).select().single();
        if (error) throw error;
        return this._directClient(data);
    }

    async updateDirectClient(id, patch) {
        const payload = {};
        if (patch.name !== undefined) payload.name = patch.name.trim();
        if (patch.contact !== undefined) payload.contact = patch.contact;
        if (patch.notes !== undefined) payload.notes = patch.notes;
        if (patch.active !== undefined) payload.active = !!patch.active;
        const { data, error } = await this.db.from('direct_clients').update(payload)
            .eq('id', id).eq('user_id', this.userId).select().single();
        if (error) throw error;
        return this._directClient(data);
    }

    // charges: [{chargeKey, competence, dueDate, amountCents, manuallyEdited}] já calculadas/editadas pela UI
    async addDirectService({ clientId, description, totalCents, installments, firstDueDate, charges }) {
        const { data: contract, error } = await this.db.from('direct_contracts').insert({
            user_id: this.userId, client_id: clientId, kind: 'service', description: description || '',
            total_amount_cents: totalCents, installments, start_month: firstDueDate.slice(0, 7)
        }).select().single();
        if (error) throw error;
        const rows = charges.map(c => ({
            user_id: this.userId, contract_id: contract.id, charge_key: c.chargeKey,
            competence: c.competence, due_date: c.dueDate, amount_cents: c.amountCents,
            manually_edited: !!c.manuallyEdited
        }));
        const { error: chErr } = await this.db.from('direct_charges').insert(rows);
        if (chErr) {
            await this.db.from('direct_contracts').delete().eq('id', contract.id).eq('user_id', this.userId);
            throw chErr;
        }
        return this._directContract(contract);
    }

    async addDirectSubscription({ clientId, description, monthlyCents, dueDay, startMonth }) {
        const { data, error } = await this.db.from('direct_contracts').insert({
            user_id: this.userId, client_id: clientId, kind: 'subscription', description: description || '',
            monthly_amount_cents: monthlyCents, due_day: dueDay, start_month: startMonth
        }).select().single();
        if (error) throw error;
        return this._directContract(data);
    }

    async ensureDirectCharges(contractId, untilMonth) {
        const { error } = await this.db.rpc('ensure_direct_charges', { p_contract_id: contractId, p_until: untilMonth });
        if (error) throw error;
    }

    async markDirectChargePaid(id, paidAt) {
        const { error } = await this.db.from('direct_charges')
            .update({ status: 'paid', paid_at: paidAt }).eq('id', id).eq('user_id', this.userId);
        if (error) throw error;
    }

    async unmarkDirectChargePaid(id) {
        const { error } = await this.db.from('direct_charges')
            .update({ status: 'pending', paid_at: null }).eq('id', id).eq('user_id', this.userId);
        if (error) throw error;
    }

    async updateDirectCharge(id, { amountCents, dueDate, competence }) {
        const payload = { manually_edited: true };
        if (amountCents !== undefined) payload.amount_cents = amountCents;
        if (dueDate !== undefined) payload.due_date = dueDate;
        if (competence !== undefined) payload.competence = competence;
        const { data, error } = await this.db.from('direct_charges').update(payload)
            .eq('id', id).eq('user_id', this.userId).select().single();
        if (error) throw error;
        return this._directCharge(data);
    }

    async updateDirectContract(id, { description, clientId }) {
        const payload = {};
        if (description !== undefined) payload.description = description;
        if (clientId !== undefined) payload.client_id = clientId;
        const { data, error } = await this.db.from('direct_contracts').update(payload)
            .eq('id', id).eq('user_id', this.userId).select().single();
        if (error) throw error;
        return this._directContract(data);
    }

    async adjustDirectContract(id, fromMonth, newCents) {
        const { error } = await this.db.rpc('adjust_direct_contract',
            { p_contract_id: id, p_from_month: fromMonth, p_new_amount_cents: newCents });
        if (error) throw error;
    }

    async cancelDirectContract(id, fromMonth) {
        const { error } = await this.db.rpc('cancel_direct_contract',
            { p_contract_id: id, p_from_month: fromMonth });
        if (error) throw error;
    }

    async reactivateDirectContract(id) {
        const { error } = await this.db.from('direct_contracts')
            .update({ cancelled_from: null }).eq('id', id).eq('user_id', this.userId);
        if (error) throw error;
    }

    async deleteDirectContract(id) {
        const { error } = await this.db.from('direct_contracts').delete()
            .eq('id', id).eq('user_id', this.userId);
        if (error) throw error;
    }
```

- [ ] **Step 3: Bump de cache dos scripts** em `index.html`: `js/store.js?v=35` → `?v=36`.

- [ ] **Step 4: Verificar sintaxe**

Run: `node --check js/store.js`
Expected: sem saída (exit 0).

- [ ] **Step 5: Commit**

```bash
git add js/store.js index.html
git commit -m "feat(vendas-diretas): métodos do store e mappers"
git push origin main
```

---

### Task 4: HTML — abas, painel e modais

**Files:**
- Modify: `index.html` (`#view-financeiro` ~linhas 952-1007; novos modais perto de `modal-invite-user` ~1538; novo `<script>` ~3064)

**Interfaces:**
- Produces (IDs usados pelo `app.js` das Tasks 5-7; não renomear):
  - Abas: container `#financeiro-tabs` (nasce `display:none`), botões `#fin-tab-tecinco`, `#fin-tab-direct`; painéis `#financeiro-panel-tecinco`, `#financeiro-panel-direct`.
  - Painel direct: `#ds-cards`, `#ds-filter` (botões `data-filter="all|pending|overdue|paid"`), `#ds-charges-tbody`, `#ds-contracts-tbody`, `#ds-chart-container`, `#btn-ds-hist-prev`, `#btn-ds-hist-next`, botões `#btn-ds-new-service`, `#btn-ds-new-subscription`, `#btn-ds-clients`.
  - Modais: `modal-ds-clients`, `modal-ds-service`, `modal-ds-subscription`, `modal-ds-pay`, `modal-ds-adjust`, `modal-ds-cancel`, `modal-ds-charge`, `modal-ds-contract-edit`.

- [ ] **Step 1: Envolver o conteúdo Tecinco e criar as abas.** Em `#view-financeiro`, logo após o `</div>` que fecha `.view-header` (antes de `<div style="overflow-x: auto;">`), inserir:

```html
            <div class="status-filter-tabs" id="financeiro-tabs" role="tablist" aria-label="Origem das receitas" style="display:none; margin-bottom:16px;">
                <button type="button" class="status-filter-tab active" id="fin-tab-tecinco" role="tab" aria-selected="true" onclick="app.setFinanceiroTab('tecinco')">Tecinco</button>
                <button type="button" class="status-filter-tab" id="fin-tab-direct" role="tab" aria-selected="false" onclick="app.setFinanceiroTab('direct')">Vendas Diretas</button>
            </div>

            <div id="financeiro-panel-tecinco">
```

e fechar esse `<div>` imediatamente antes de `</section>` de `view-financeiro` (depois de `<div id="financeiro-chart-container"></div>`), seguido do painel novo:

```html
            </div>

            <div id="financeiro-panel-direct" style="display:none;">
                <div class="view-header" style="margin-top:0;">
                    <div class="view-header-left"><h2 style="margin:0;font-size:1rem;">Vendas Diretas</h2></div>
                    <div class="view-header-actions">
                        <button class="btn btn-secondary" id="btn-ds-clients" onclick="app.openDsClients()"><i data-lucide="users"></i> Clientes</button>
                        <button class="btn btn-secondary" id="btn-ds-new-subscription" onclick="app.openDsSubscription()"><i data-lucide="repeat"></i> Nova mensalidade</button>
                        <button class="btn btn-primary" id="btn-ds-new-service" onclick="app.openDsService()"><i data-lucide="plus"></i> Nova venda</button>
                    </div>
                </div>

                <div id="ds-cards" class="stats-grid" style="margin-bottom:16px;"></div>

                <div class="status-filter-tabs" id="ds-filter" role="tablist" aria-label="Filtrar cobranças" style="margin-bottom:12px;">
                    <button type="button" class="status-filter-tab active" role="tab" aria-selected="true" data-filter="all" onclick="app.setDsFilter('all')">Todas</button>
                    <button type="button" class="status-filter-tab" role="tab" aria-selected="false" data-filter="pending" onclick="app.setDsFilter('pending')">Pendentes</button>
                    <button type="button" class="status-filter-tab" role="tab" aria-selected="false" data-filter="overdue" onclick="app.setDsFilter('overdue')">Atrasadas</button>
                    <button type="button" class="status-filter-tab" role="tab" aria-selected="false" data-filter="paid" onclick="app.setDsFilter('paid')">Pagas</button>
                </div>
                <div style="overflow-x:auto;">
                <table class="data-table" id="ds-charges-table">
                    <thead><tr>
                        <th>Cliente</th><th>Descrição</th><th>Competência</th><th>Vencimento</th><th>Valor</th><th>Status</th><th>Ações</th>
                    </tr></thead>
                    <tbody id="ds-charges-tbody"></tbody>
                </table>
                </div>

                <div class="view-header" style="margin-top:24px;">
                    <div class="view-header-left"><h2 style="margin:0;font-size:1rem;">Contratos</h2></div>
                </div>
                <div style="overflow-x:auto;">
                <table class="data-table" id="ds-contracts-table">
                    <thead><tr>
                        <th>Cliente</th><th>Tipo</th><th>Descrição</th><th>Valor</th><th>Situação</th><th>Ações</th>
                    </tr></thead>
                    <tbody id="ds-contracts-tbody"></tbody>
                </table>
                </div>

                <div class="view-header" style="margin-top:24px;">
                    <div class="view-header-left"><h2 style="margin:0;font-size:1rem;">Histórico (12 meses)</h2></div>
                    <div class="view-header-actions">
                        <button id="btn-ds-hist-prev" class="btn-icon" title="12 meses anteriores" onclick="app.dsNavigateHistory(-1)"><i data-lucide="chevron-left"></i></button>
                        <button id="btn-ds-hist-next" class="btn-icon" title="12 meses seguintes" onclick="app.dsNavigateHistory(1)"><i data-lucide="chevron-right"></i></button>
                    </div>
                </div>
                <div id="ds-chart-container"></div>
            </div>
```

- [ ] **Step 2: Adicionar os modais** logo antes do comentário `<!-- MODAL: SUPERVISÃO GERENCIAL — ESCOLHER CONSULTOR -->`:

```html
    <!-- MODAIS: VENDAS DIRETAS -->
    <div class="modal-overlay" id="modal-ds-clients">
        <div class="modal glass" style="max-width:520px;">
            <div class="modal-header">
                <h2>Clientes de Vendas Diretas</h2>
                <button class="close-modal" onclick="app.closeModal('modal-ds-clients')"><i data-lucide="x"></i></button>
            </div>
            <div id="ds-clients-list" style="margin-bottom:16px;"></div>
            <form id="form-ds-client" onsubmit="app.handleDsClientSubmit(event)">
                <input type="hidden" id="ds-client-id">
                <div class="form-group">
                    <label class="form-label" for="ds-client-name">Nome</label>
                    <input type="text" id="ds-client-name" class="form-control" required>
                </div>
                <div class="form-group">
                    <label class="form-label" for="ds-client-contact">Contato</label>
                    <input type="text" id="ds-client-contact" class="form-control">
                </div>
                <div class="form-group">
                    <label class="form-label" for="ds-client-notes">Observações</label>
                    <textarea id="ds-client-notes" class="form-control" rows="2"></textarea>
                </div>
                <button type="submit" class="btn btn-primary" style="width:100%;">Salvar cliente</button>
            </form>
        </div>
    </div>

    <div class="modal-overlay" id="modal-ds-service">
        <div class="modal glass" style="max-width:560px;">
            <div class="modal-header">
                <h2>Nova venda (serviço)</h2>
                <button class="close-modal" onclick="app.closeModal('modal-ds-service')"><i data-lucide="x"></i></button>
            </div>
            <form id="form-ds-service" onsubmit="app.handleDsServiceSubmit(event)">
                <div class="form-group">
                    <label class="form-label" for="ds-svc-client">Cliente</label>
                    <select id="ds-svc-client" class="form-control"></select>
                </div>
                <div class="form-group">
                    <label class="form-label" for="ds-svc-new-client">Ou novo cliente (nome)</label>
                    <input type="text" id="ds-svc-new-client" class="form-control" placeholder="Preencha para criar e usar este cliente">
                </div>
                <div class="form-group">
                    <label class="form-label" for="ds-svc-desc">Descrição</label>
                    <input type="text" id="ds-svc-desc" class="form-control" required>
                </div>
                <div class="form-group">
                    <label class="form-label" for="ds-svc-total">Valor total (R$)</label>
                    <input type="text" id="ds-svc-total" class="form-control" inputmode="decimal" placeholder="1.500,00" required oninput="app.renderDsServicePreview()">
                </div>
                <div class="form-group">
                    <label class="form-label" for="ds-svc-n">Nº de parcelas (1 = à vista)</label>
                    <input type="number" id="ds-svc-n" class="form-control" min="1" max="60" value="1" required oninput="app.renderDsServicePreview()">
                </div>
                <div class="form-group">
                    <label class="form-label" for="ds-svc-first">Vencimento da 1ª parcela</label>
                    <input type="date" id="ds-svc-first" class="form-control" required onchange="app.renderDsServicePreview()">
                </div>
                <div id="ds-svc-preview" style="margin-bottom:12px;"></div>
                <button type="submit" class="btn btn-primary" style="width:100%;">Salvar venda</button>
            </form>
        </div>
    </div>

    <div class="modal-overlay" id="modal-ds-subscription">
        <div class="modal glass" style="max-width:480px;">
            <div class="modal-header">
                <h2>Nova mensalidade</h2>
                <button class="close-modal" onclick="app.closeModal('modal-ds-subscription')"><i data-lucide="x"></i></button>
            </div>
            <form id="form-ds-subscription" onsubmit="app.handleDsSubscriptionSubmit(event)">
                <div class="form-group">
                    <label class="form-label" for="ds-sub-client">Cliente</label>
                    <select id="ds-sub-client" class="form-control"></select>
                </div>
                <div class="form-group">
                    <label class="form-label" for="ds-sub-new-client">Ou novo cliente (nome)</label>
                    <input type="text" id="ds-sub-new-client" class="form-control" placeholder="Preencha para criar e usar este cliente">
                </div>
                <div class="form-group">
                    <label class="form-label" for="ds-sub-desc">Descrição</label>
                    <input type="text" id="ds-sub-desc" class="form-control" required>
                </div>
                <div class="form-group">
                    <label class="form-label" for="ds-sub-amount">Valor mensal (R$)</label>
                    <input type="text" id="ds-sub-amount" class="form-control" inputmode="decimal" placeholder="500,00" required>
                </div>
                <div class="form-group">
                    <label class="form-label" for="ds-sub-dueday">Dia de vencimento (1-31)</label>
                    <input type="number" id="ds-sub-dueday" class="form-control" min="1" max="31" value="10" required>
                </div>
                <div class="form-group">
                    <label class="form-label" for="ds-sub-start">Mês de início</label>
                    <input type="month" id="ds-sub-start" class="form-control" required>
                </div>
                <button type="submit" class="btn btn-primary" style="width:100%;">Salvar mensalidade</button>
            </form>
        </div>
    </div>

    <div class="modal-overlay" id="modal-ds-pay">
        <div class="modal glass" style="max-width:380px;">
            <div class="modal-header">
                <h2>Marcar como paga</h2>
                <button class="close-modal" onclick="app.closeModal('modal-ds-pay')"><i data-lucide="x"></i></button>
            </div>
            <form id="form-ds-pay" onsubmit="app.handleDsPaySubmit(event)">
                <input type="hidden" id="ds-pay-id">
                <div class="form-group">
                    <label class="form-label" for="ds-pay-date">Data do pagamento</label>
                    <input type="date" id="ds-pay-date" class="form-control" required>
                </div>
                <button type="submit" class="btn btn-primary" style="width:100%;">Confirmar pagamento</button>
            </form>
        </div>
    </div>

    <div class="modal-overlay" id="modal-ds-adjust">
        <div class="modal glass" style="max-width:380px;">
            <div class="modal-header">
                <h2>Reajustar mensalidade</h2>
                <button class="close-modal" onclick="app.closeModal('modal-ds-adjust')"><i data-lucide="x"></i></button>
            </div>
            <form id="form-ds-adjust" onsubmit="app.handleDsAdjustSubmit(event)">
                <input type="hidden" id="ds-adj-contract">
                <div class="form-group">
                    <label class="form-label" for="ds-adj-amount">Novo valor mensal (R$)</label>
                    <input type="text" id="ds-adj-amount" class="form-control" inputmode="decimal" required>
                </div>
                <div class="form-group">
                    <label class="form-label" for="ds-adj-month">A partir de</label>
                    <input type="month" id="ds-adj-month" class="form-control" required>
                </div>
                <p class="text-muted" style="font-size:0.8rem;">Altera apenas cobranças pendentes e não editadas manualmente a partir desse mês.</p>
                <button type="submit" class="btn btn-primary" style="width:100%;">Aplicar reajuste</button>
            </form>
        </div>
    </div>

    <div class="modal-overlay" id="modal-ds-cancel">
        <div class="modal glass" style="max-width:380px;">
            <div class="modal-header">
                <h2>Cancelar mensalidade</h2>
                <button class="close-modal" onclick="app.closeModal('modal-ds-cancel')"><i data-lucide="x"></i></button>
            </div>
            <form id="form-ds-cancel" onsubmit="return false;">
                <input type="hidden" id="ds-cancel-contract">
                <div class="form-group">
                    <label class="form-label" for="ds-cancel-month">Cancelar a partir de</label>
                    <input type="month" id="ds-cancel-month" class="form-control" required>
                </div>
                <p class="text-muted" style="font-size:0.8rem;">As cobranças pendentes desse mês em diante serão removidas. As pagas permanecem.</p>
                <button type="button" id="btn-ds-cancel-confirm" class="btn btn-secondary" style="width:100%;" onclick="app.handleDsCancelSubmit(this)">Cancelar mensalidade</button>
            </form>
        </div>
    </div>

    <div class="modal-overlay" id="modal-ds-charge">
        <div class="modal glass" style="max-width:380px;">
            <div class="modal-header">
                <h2>Editar cobrança</h2>
                <button class="close-modal" onclick="app.closeModal('modal-ds-charge')"><i data-lucide="x"></i></button>
            </div>
            <form id="form-ds-charge" onsubmit="app.handleDsChargeSubmit(event)">
                <input type="hidden" id="ds-ch-id">
                <div class="form-group">
                    <label class="form-label" for="ds-ch-amount">Valor (R$)</label>
                    <input type="text" id="ds-ch-amount" class="form-control" inputmode="decimal" required>
                </div>
                <div class="form-group">
                    <label class="form-label" for="ds-ch-due">Vencimento</label>
                    <input type="date" id="ds-ch-due" class="form-control" required>
                </div>
                <button type="submit" class="btn btn-primary" style="width:100%;">Salvar</button>
            </form>
        </div>
    </div>

    <div class="modal-overlay" id="modal-ds-contract-edit">
        <div class="modal glass" style="max-width:420px;">
            <div class="modal-header">
                <h2>Editar contrato</h2>
                <button class="close-modal" onclick="app.closeModal('modal-ds-contract-edit')"><i data-lucide="x"></i></button>
            </div>
            <form id="form-ds-contract-edit" onsubmit="app.handleDsContractEditSubmit(event)">
                <input type="hidden" id="ds-ce-id">
                <div class="form-group">
                    <label class="form-label" for="ds-ce-client">Cliente</label>
                    <select id="ds-ce-client" class="form-control"></select>
                </div>
                <div class="form-group">
                    <label class="form-label" for="ds-ce-desc">Descrição</label>
                    <input type="text" id="ds-ce-desc" class="form-control" required>
                </div>
                <p class="text-muted" style="font-size:0.8rem;">Para mudar valores use Reajustar (mensalidade) ou edite a parcela (serviço).</p>
                <button type="submit" class="btn btn-primary" style="width:100%;">Salvar</button>
            </form>
        </div>
    </div>
```

- [ ] **Step 3: Carregar o módulo.** Depois de `<script src="js/financial-calc.js?v=1"></script>` adicionar:

```html
    <script src="js/direct-sales-calc.js?v=1"></script>
```

e subir `js/app.js?v=56` para `?v=57`.

- [ ] **Step 4: Conferir que o HTML continua balanceado**

Run: `node -e "const h=require('fs').readFileSync('index.html','utf8');const o=(h.match(/<div/g)||[]).length,c=(h.match(/<\/div>/g)||[]).length;console.log(o,c);process.exit(o===c?0:1)"`
Expected: dois números iguais, exit 0.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(vendas-diretas): abas, painel e modais no HTML"
git push origin main
```

---

### Task 5: App — aba, gating de acesso, renderização do painel

**Files:**
- Modify: `js/app.js`
  - topo do arquivo (ao lado de outras `const` script-scoped, ex.: perto de `const Toast`): constante de e-mails
  - construtor (junto a `this.financeiroYear`, ~linha 103)
  - `renderFinanceiro()` (~linha 7437): despacho por aba
  - handler de logout (~linha 13406): limpeza
  - novos métodos logo antes de `renderFinanceiro()`

**Interfaces:**
- Consumes: `store.getDirect*` (Task 3), `TSPDirectSales` (Task 1), IDs da Task 4, `Auth.getUserEmail()`, `escapeHtml`, `spinnerHtml`, `Toast`.
- Produces: `app.financeiroTab` (`'tecinco'|'direct'`), `app._canUseDirectSales()`, `app.setFinanceiroTab(tab)`, `app.setDsFilter(f)`, `app.dsNavigateHistory(dir)`, `app.renderDirectSales()`, `app._ds` (cache `{clients, contracts, charges, overdue, paid, hist}`), `app.dsHistEndYear/dsHistEndMonth`, `app.dsFilter`.

- [ ] **Step 1: Constante de e-mails.** No nível do arquivo, antes da definição da classe `AppController` (junto das outras constantes script-scoped):

```javascript
// Deve ser idêntica à lista em direct_sales_allowed() (supabase/migrations/20261009_direct_sales.sql).
// Aqui só controla a visibilidade da aba; quem protege o dado é a RLS.
const DIRECT_SALES_ALLOWED_EMAILS = ['jorge.henrique@tecinco.com.br', 'testes@teste.com'];
```

- [ ] **Step 2: Estado no construtor**, logo após `this.financeiroHistEndYear = ...` e sua linha de mês:

```javascript
        this.financeiroTab = sessionStorage.getItem('financeiroTab') || 'tecinco';
        this.dsFilter = 'all';
        this.dsHistEndYear = this.financeiroYear;
        this.dsHistEndMonth = this.financeiroMonth;
        this._ds = null;
        this._dsRenderSeq = 0;
```

- [ ] **Step 3: Despacho em `renderFinanceiro()`.** Logo após a linha `if (this.currentView !== 'financeiro') return;` inserir:

```javascript
        const canDirect = this._canUseDirectSales();
        const tabsEl = document.getElementById('financeiro-tabs');
        if (tabsEl) tabsEl.style.display = canDirect ? 'flex' : 'none';
        if (!canDirect && this.financeiroTab === 'direct') this.financeiroTab = 'tecinco';
        this._applyFinanceiroTabUi();
        if (this.financeiroTab === 'direct') return this.renderDirectSales();
```

- [ ] **Step 4: Métodos novos**, inseridos imediatamente antes de `async renderFinanceiro() {`:

```javascript
    _canUseDirectSales() {
        if (this.isManagerView || this.userRole === 'client') return false;
        const email = (Auth.getUserEmail() || '').toLowerCase();
        return DIRECT_SALES_ALLOWED_EMAILS.includes(email);
    }

    _applyFinanceiroTabUi() {
        const isDirect = this.financeiroTab === 'direct';
        const tec = document.getElementById('financeiro-panel-tecinco');
        const dir = document.getElementById('financeiro-panel-direct');
        if (tec) tec.style.display = isDirect ? 'none' : '';
        if (dir) dir.style.display = isDirect ? '' : 'none';
        [['fin-tab-tecinco', !isDirect], ['fin-tab-direct', isDirect]].forEach(([id, on]) => {
            const b = document.getElementById(id);
            if (!b) return;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
    }

    setFinanceiroTab(tab) {
        if (tab === 'direct' && !this._canUseDirectSales()) return;
        this.financeiroTab = tab;
        try { sessionStorage.setItem('financeiroTab', tab); } catch (e) { /* ignora */ }
        this.renderFinanceiro();
    }

    setDsFilter(f) {
        this.dsFilter = f;
        document.querySelectorAll('#ds-filter .status-filter-tab').forEach(b => {
            const on = b.dataset.filter === f;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        this._renderDsChargesTable();
    }

    dsNavigateHistory(direction) {
        this.dsHistEndMonth += direction * 12;
        while (this.dsHistEndMonth > 12) { this.dsHistEndMonth -= 12; this.dsHistEndYear += 1; }
        while (this.dsHistEndMonth < 1) { this.dsHistEndMonth += 12; this.dsHistEndYear -= 1; }
        this.renderDirectSales();
    }

    async renderDirectSales() {
        if (this.currentView !== 'financeiro' || this.financeiroTab !== 'direct') return;
        const seq = ++this._dsRenderSeq;
        const cardsEl = document.getElementById('ds-cards');
        const chartEl = document.getElementById('ds-chart-container');
        if (!cardsEl || !chartEl) return;

        const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
        const labelEl = document.getElementById('financeiro-month-label');
        if (labelEl) labelEl.textContent = `${monthNames[this.financeiroMonth - 1]} ${this.financeiroYear}`;

        const D = TSPDirectSales;
        const ym = `${this.financeiroYear}-${String(this.financeiroMonth).padStart(2, '0')}`;
        const todayIso = D.toIsoLocal(new Date());
        cardsEl.innerHTML = spinnerHtml;
        chartEl.innerHTML = '';

        try {
            const [clients, contracts] = await Promise.all([store.getDirectClients(), store.getDirectContracts()]);
            const until = D.ensureUntil(ym, D.currentMonthLocal());
            await Promise.all(contracts.filter(c => c.kind === 'subscription')
                .map(c => store.ensureDirectCharges(c.id, until)));
            const [charges, overdue, paid, hist] = await Promise.all([
                store.getDirectCharges(ym),
                store.getDirectOverdue(todayIso),
                store.getDirectPaidInMonth(ym),
                store.getDirectHistory(12, this.dsHistEndYear, this.dsHistEndMonth)
            ]);
            if (seq !== this._dsRenderSeq) return; // render mais novo já em andamento
            this._ds = { clients, contracts, charges, overdue, paid, hist, todayIso, ym };

            const totals = D.computeMonthTotals({ charges, paidInMonth: paid, overdue });
            const card = (label, value, extra = '', tip = '') => `
                <div class="glass stat-card">
                    <div class="stat-header"><span class="client-name">${label}${tip}</span></div>
                    <div class="stat-value money-value" style="font-size:1.4rem;font-weight:700;${extra}">${D.formatCents(value)}</div>
                </div>`;
            const recebidoTip = `<span class="info-tooltip info-tooltip--start" tabindex="0" aria-label="Como o Recebido é calculado" aria-describedby="tooltip-ds-recebido"><i data-lucide="info" style="width:14px;height:14px;margin-left:4px;vertical-align:middle;"></i><span class="info-tooltip-text" id="tooltip-ds-recebido" role="tooltip">Recebido soma os pagamentos feitos neste mês (pela data do pagamento), mesmo de cobranças de outros meses. Por isso Faturado menos Recebido pode não ser igual a A receber.</span></span>`;
            const atrasadoTip = `<span class="info-tooltip info-tooltip--start" tabindex="0" aria-label="Como o Atrasado é calculado" aria-describedby="tooltip-ds-atrasado"><i data-lucide="info" style="width:14px;height:14px;margin-left:4px;vertical-align:middle;"></i><span class="info-tooltip-text" id="tooltip-ds-atrasado" role="tooltip">Atrasado soma todas as cobranças pendentes já vencidas, de qualquer mês.</span></span>`;
            cardsEl.innerHTML =
                card('Faturado', totals.faturado) +
                card('Recebido', totals.recebido, '', recebidoTip) +
                card('A receber', totals.aReceber) +
                card('Atrasado', totals.atrasado, totals.atrasado > 0 ? 'color:var(--danger-color);' : '', atrasadoTip);

            this._renderDsChargesTable();
            this._renderDsContractsTable();
            chartEl.innerHTML = '';
            chartEl.appendChild(this._buildDirectSalesChart(D.computeHistory(
                TSPFinancial.monthsWindow(12, this.dsHistEndYear, this.dsHistEndMonth), hist)));
            lucide.createIcons();
        } catch (err) {
            console.error('Erro ao carregar Vendas Diretas:', err);
            if (seq !== this._dsRenderSeq) return;
            cardsEl.innerHTML = `<p class="text-muted">Não foi possível carregar Vendas Diretas: ${escapeHtml(err.message || 'tente novamente.')}</p>`;
            Toast.show('Erro ao carregar Vendas Diretas.', 'error');
        }
    }

    _dsClientName(clientId) {
        const c = this._ds && this._ds.clients.find(x => x.id === clientId);
        return c ? c.name : '—';
    }

    _dsChargeDescription(charge) {
        const contract = this._ds.contracts.find(c => c.id === charge.contractId);
        if (!contract) return '—';
        if (contract.kind === 'subscription') return `Mensalidade${contract.description ? ' · ' + contract.description : ''}`;
        const k = charge.chargeKey.replace('i:', '');
        return `${contract.description || 'Serviço'} ${k}/${contract.installments}`;
    }

    _renderDsChargesTable() {
        const tbody = document.getElementById('ds-charges-tbody');
        if (!tbody || !this._ds) return;
        const D = TSPDirectSales;
        const { charges, overdue, todayIso, contracts } = this._ds;
        let list;
        if (this.dsFilter === 'overdue') list = overdue;
        else if (this.dsFilter === 'pending') list = charges.filter(c => c.status === 'pending');
        else if (this.dsFilter === 'paid') list = charges.filter(c => c.status === 'paid');
        else list = charges;

        if (!list.length) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-muted">Nenhuma cobrança neste filtro.</td></tr>`;
            return;
        }
        const fmtDate = (iso) => iso ? iso.split('-').reverse().join('/') : '—';
        tbody.innerHTML = list.map(ch => {
            const contract = contracts.find(c => c.id === ch.contractId);
            const late = D.isOverdue(ch, todayIso);
            const status = ch.status === 'paid'
                ? `Paga em ${fmtDate(ch.paidAt)}`
                : (late ? '<strong style="color:var(--danger-color);">Atrasada</strong>' : 'Pendente');
            const actions = ch.status === 'pending'
                ? `<button class="btn btn-secondary btn-sm" onclick="app.openDsPay('${ch.id}')">Marcar paga</button>
                   <button class="btn btn-secondary btn-sm" onclick="app.openDsChargeEdit('${ch.id}')">Editar</button>`
                : `<button class="btn btn-secondary btn-sm" onclick="app.dsUndoPay('${ch.id}')">Desfazer</button>`;
            return `<tr>
                <td>${escapeHtml(this._dsClientName(contract ? contract.clientId : null))}</td>
                <td>${escapeHtml(this._dsChargeDescription(ch))}</td>
                <td>${ch.competence}</td>
                <td>${fmtDate(ch.dueDate)}</td>
                <td><span class="money-value">${D.formatCents(ch.amountCents)}</span></td>
                <td>${status}</td>
                <td>${actions}</td>
            </tr>`;
        }).join('');
    }

    _renderDsContractsTable() {
        const tbody = document.getElementById('ds-contracts-tbody');
        if (!tbody || !this._ds) return;
        const D = TSPDirectSales;
        const { contracts } = this._ds;
        if (!contracts.length) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-muted">Nenhum contrato cadastrado.</td></tr>`;
            return;
        }
        tbody.innerHTML = contracts.map(c => {
            const isSub = c.kind === 'subscription';
            const valor = isSub ? `${D.formatCents(c.monthlyAmountCents)}/mês` : `${D.formatCents(c.totalAmountCents)} em ${c.installments}x`;
            const situacao = isSub ? (c.cancelledFrom ? `Cancelada desde ${c.cancelledFrom}` : 'Ativa') : 'Serviço';
            const subActions = isSub
                ? `<button class="btn btn-secondary btn-sm" onclick="app.openDsAdjust('${c.id}')">Reajustar</button>
                   ${c.cancelledFrom
                        ? `<button class="btn btn-secondary btn-sm" onclick="app.dsReactivate('${c.id}')">Reativar</button>`
                        : `<button class="btn btn-secondary btn-sm" onclick="app.openDsCancel('${c.id}')">Cancelar</button>`}`
                : '';
            return `<tr>
                <td>${escapeHtml(this._dsClientName(c.clientId))}</td>
                <td>${isSub ? 'Mensalidade' : 'Serviço'}</td>
                <td>${escapeHtml(c.description)}</td>
                <td><span class="money-value">${valor}</span></td>
                <td>${situacao}</td>
                <td>
                    <button class="btn btn-secondary btn-sm" onclick="app.openDsContractEdit('${c.id}')">Editar</button>
                    ${subActions}
                    <button class="btn btn-secondary btn-sm" onclick="app.dsDeleteContract(this, '${c.id}')">Excluir</button>
                </td>
            </tr>`;
        }).join('');
    }
```

(`_buildDirectSalesChart` é entregue na Task 7. Para esta task rodar sem erro, adicionar um stub temporário imediatamente: `_buildDirectSalesChart() { return document.createElement('div'); }` — a Task 7 o substitui.)

- [ ] **Step 5: Limpeza no logout.** No handler `btn-logout`, logo após `window.app._quickNotesCache = null;` adicionar:

```javascript
            window.app._ds = null;
            window.app._dsRenderSeq = (window.app._dsRenderSeq || 0) + 1;
            window.app.financeiroTab = 'tecinco';
            try { sessionStorage.removeItem('financeiroTab'); } catch (e) { /* ignora */ }
```

- [ ] **Step 6: Verificação manual local** (sem Supabase em localhost, só sintaxe):

Run: `node --check js/app.js`
Expected: sem saída (exit 0).

- [ ] **Step 7: Commit**

```bash
git add js/app.js
git commit -m "feat(vendas-diretas): aba, gating de acesso e renderização do painel"
git push origin main
```

---

### Task 6: App — modais e ações (cliente, serviço, mensalidade, pagamento, reajuste, cancelamento, edição, exclusão)

**Files:**
- Modify: `js/app.js` (novos métodos junto aos da Task 5)

**Interfaces:**
- Consumes: IDs de modais da Task 4; `store.*Direct*` (Task 3); `TSPDirectSales`; `app._ds`; `app._twostepDelete(btn, onConfirm)`; `openModal/closeModal`; `Toast.show(msg, type)`.
- Produces: `openDsClients/handleDsClientSubmit/dsEditClient/dsToggleClient`, `openDsService/renderDsServicePreview/handleDsServiceSubmit`, `openDsSubscription/handleDsSubscriptionSubmit`, `openDsPay/handleDsPaySubmit/dsUndoPay`, `openDsChargeEdit/handleDsChargeSubmit`, `openDsAdjust/handleDsAdjustSubmit`, `openDsCancel/handleDsCancelSubmit/dsReactivate`, `openDsContractEdit/handleDsContractEditSubmit`, `dsDeleteContract`.

- [ ] **Step 1: Adicionar os métodos** (logo depois de `_renderDsContractsTable`):

```javascript
    // ===== Vendas Diretas: ações =====
    _dsFillClientSelect(selectId, selectedId) {
        const sel = document.getElementById(selectId);
        const active = (this._ds ? this._ds.clients : []).filter(c => c.active || c.id === selectedId);
        sel.innerHTML = `<option value="">— selecione —</option>` +
            active.map(c => `<option value="${c.id}"${c.id === selectedId ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
    }

    // Resolve o cliente do modal: novo (por nome) tem prioridade sobre o select.
    async _dsResolveClientId(selectId, newNameId) {
        const newName = document.getElementById(newNameId).value.trim();
        if (newName) {
            const created = await store.addDirectClient({ name: newName });
            return created.id;
        }
        return document.getElementById(selectId).value || null;
    }

    _dsAfterMutation() {
        this._ds = null;
        return this.renderDirectSales();
    }

    // --- Clientes
    openDsClients() {
        document.getElementById('form-ds-client').reset();
        document.getElementById('ds-client-id').value = '';
        this._renderDsClientsList();
        this.openModal('modal-ds-clients');
    }

    _renderDsClientsList() {
        const el = document.getElementById('ds-clients-list');
        const list = this._ds ? this._ds.clients : [];
        if (!list.length) { el.innerHTML = '<p class="text-muted">Nenhum cliente cadastrado.</p>'; return; }
        el.innerHTML = list.map(c => `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-color);">
                <span>${escapeHtml(c.name)}${c.active ? '' : ' <span class="text-muted">(inativo)</span>'}</span>
                <span>
                    <button type="button" class="btn btn-secondary btn-sm" onclick="app.dsEditClient('${c.id}')">Editar</button>
                    <button type="button" class="btn btn-secondary btn-sm" onclick="app.dsToggleClient('${c.id}')">${c.active ? 'Inativar' : 'Reativar'}</button>
                </span>
            </div>`).join('');
    }

    dsEditClient(id) {
        const c = this._ds.clients.find(x => x.id === id);
        if (!c) return;
        document.getElementById('ds-client-id').value = c.id;
        document.getElementById('ds-client-name').value = c.name;
        document.getElementById('ds-client-contact').value = c.contact;
        document.getElementById('ds-client-notes').value = c.notes;
    }

    async dsToggleClient(id) {
        const c = this._ds.clients.find(x => x.id === id);
        if (!c) return;
        if (c.active && this._ds.contracts.some(k => k.clientId === id && k.kind === 'subscription' && !k.cancelledFrom)) {
            Toast.show('Cancele as mensalidades ativas deste cliente antes de inativá-lo.', 'error');
            return;
        }
        try {
            await store.updateDirectClient(id, { active: !c.active });
            await this._dsAfterMutation();
            this._renderDsClientsList();
        } catch (err) { Toast.show(err.message || 'Erro ao atualizar cliente.', 'error'); }
    }

    async handleDsClientSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('ds-client-id').value;
        const data = {
            name: document.getElementById('ds-client-name').value,
            contact: document.getElementById('ds-client-contact').value,
            notes: document.getElementById('ds-client-notes').value
        };
        try {
            if (id) await store.updateDirectClient(id, data); else await store.addDirectClient(data);
            await this._dsAfterMutation();
            document.getElementById('form-ds-client').reset();
            document.getElementById('ds-client-id').value = '';
            this._renderDsClientsList();
            Toast.show('Cliente salvo!', 'success');
        } catch (err) { Toast.show(err.message || 'Erro ao salvar cliente.', 'error'); }
    }

    // --- Serviço
    openDsService() {
        document.getElementById('form-ds-service').reset();
        this._dsFillClientSelect('ds-svc-client', null);
        const today = TSPDirectSales.toIsoLocal(new Date());
        const first = document.getElementById('ds-svc-first');
        first.min = today;
        first.value = today;
        document.getElementById('ds-svc-n').value = 1;
        this.renderDsServicePreview();
        this.openModal('modal-ds-service');
    }

    _dsServiceDraft() {
        const D = TSPDirectSales;
        const total = D.parseMoneyToCents(document.getElementById('ds-svc-total').value);
        const n = parseInt(document.getElementById('ds-svc-n').value, 10);
        const first = document.getElementById('ds-svc-first').value;
        if (!total || !n || !first) return null;
        try { return { total, n, first, rows: D.serviceCharges(total, n, first) }; } catch (e) { return null; }
    }

    renderDsServicePreview() {
        const el = document.getElementById('ds-svc-preview');
        const draft = this._dsServiceDraft();
        if (!draft) { el.innerHTML = '<p class="text-muted" style="font-size:0.8rem;">Preencha valor, parcelas e vencimento para ver a prévia.</p>'; return; }
        el.innerHTML = `<div style="font-size:0.8rem;margin-bottom:6px;" class="text-muted">Prévia das parcelas (editável):</div>` +
            draft.rows.map((r, i) => `
            <div style="display:flex;gap:8px;margin-bottom:6px;align-items:center;">
                <span style="width:28px;">${i + 1}.</span>
                <input type="date" class="form-control ds-svc-row-date" aria-label="Vencimento da parcela ${i + 1}" value="${r.dueDate}" min="${document.getElementById('ds-svc-first').min}" oninput="app._dsServiceSumWarning()">
                <input type="text" class="form-control ds-svc-row-amount money-value" aria-label="Valor da parcela ${i + 1}" value="${(r.amountCents / 100).toFixed(2).replace('.', ',')}" oninput="app._dsServiceSumWarning()">
            </div>`).join('') + `<div id="ds-svc-sum-warning" style="font-size:0.8rem;color:var(--warning-color);"></div>`;
    }

    _dsServiceSumWarning() {
        const draft = this._dsServiceDraft();
        const el = document.getElementById('ds-svc-sum-warning');
        if (!draft || !el) return;
        const sum = Array.from(document.querySelectorAll('.ds-svc-row-amount'))
            .reduce((acc, i) => acc + (TSPDirectSales.parseMoneyToCents(i.value) || 0), 0);
        el.textContent = sum === draft.total ? '' :
            `A soma das parcelas (${TSPDirectSales.formatCents(sum)}) difere do total (${TSPDirectSales.formatCents(draft.total)}).`;
    }

    async handleDsServiceSubmit(e) {
        e.preventDefault();
        const D = TSPDirectSales;
        const draft = this._dsServiceDraft();
        if (!draft) { Toast.show('Confira valor, parcelas e vencimento.', 'error'); return; }
        const today = D.toIsoLocal(new Date());
        const dates = Array.from(document.querySelectorAll('.ds-svc-row-date')).map(i => i.value);
        const amounts = Array.from(document.querySelectorAll('.ds-svc-row-amount')).map(i => D.parseMoneyToCents(i.value));
        if (dates.some(d => !d || d < today) || amounts.some(a => a === null)) {
            Toast.show('Datas não podem ser anteriores a hoje e valores precisam ser válidos.', 'error');
            return;
        }
        const charges = draft.rows.map((r, i) => ({
            chargeKey: r.chargeKey,
            competence: dates[i].slice(0, 7),
            dueDate: dates[i],
            amountCents: amounts[i],
            manuallyEdited: dates[i] !== r.dueDate || amounts[i] !== r.amountCents
        }));
        const btn = e.submitter;
        try {
            if (btn) this._btnPending(btn);
            const clientId = await this._dsResolveClientId('ds-svc-client', 'ds-svc-new-client');
            if (!clientId) { Toast.show('Escolha ou informe o cliente.', 'error'); if (btn) this._btnError(btn); return; }
            await store.addDirectService({
                clientId, description: document.getElementById('ds-svc-desc').value.trim(),
                totalCents: draft.total, installments: draft.n, firstDueDate: draft.first, charges
            });
            this.closeModal('modal-ds-service');
            await this._dsAfterMutation();
            Toast.show('Venda registrada!', 'success');
        } catch (err) {
            if (btn) this._btnError(btn);
            Toast.show(err.message || 'Erro ao salvar a venda.', 'error');
        }
    }

    // --- Mensalidade
    openDsSubscription() {
        document.getElementById('form-ds-subscription').reset();
        this._dsFillClientSelect('ds-sub-client', null);
        const cur = TSPDirectSales.currentMonthLocal();
        const start = document.getElementById('ds-sub-start');
        start.min = cur;
        start.value = cur;
        this.openModal('modal-ds-subscription');
    }

    async handleDsSubscriptionSubmit(e) {
        e.preventDefault();
        const D = TSPDirectSales;
        const monthly = D.parseMoneyToCents(document.getElementById('ds-sub-amount').value);
        const dueDay = parseInt(document.getElementById('ds-sub-dueday').value, 10);
        const start = document.getElementById('ds-sub-start').value;
        if (!monthly || monthly <= 0 || !(dueDay >= 1 && dueDay <= 31) || !start) {
            Toast.show('Confira valor, dia de vencimento e mês de início.', 'error'); return;
        }
        if (start < D.currentMonthLocal()) { Toast.show('O mês de início não pode ser anterior ao mês atual.', 'error'); return; }
        const btn = e.submitter;
        try {
            if (btn) this._btnPending(btn);
            const clientId = await this._dsResolveClientId('ds-sub-client', 'ds-sub-new-client');
            if (!clientId) { Toast.show('Escolha ou informe o cliente.', 'error'); if (btn) this._btnError(btn); return; }
            const contract = await store.addDirectSubscription({
                clientId, description: document.getElementById('ds-sub-desc').value.trim(),
                monthlyCents: monthly, dueDay, startMonth: start
            });
            await store.ensureDirectCharges(contract.id, D.ensureUntil(start, D.currentMonthLocal()));
            this.closeModal('modal-ds-subscription');
            await this._dsAfterMutation();
            Toast.show('Mensalidade cadastrada!', 'success');
        } catch (err) {
            if (btn) this._btnError(btn);
            Toast.show(err.message || 'Erro ao salvar a mensalidade.', 'error');
        }
    }

    // --- Pagamento
    openDsPay(id) {
        document.getElementById('ds-pay-id').value = id;
        document.getElementById('ds-pay-date').value = TSPDirectSales.toIsoLocal(new Date());
        this.openModal('modal-ds-pay');
    }

    async handleDsPaySubmit(e) {
        e.preventDefault();
        try {
            await store.markDirectChargePaid(document.getElementById('ds-pay-id').value,
                document.getElementById('ds-pay-date').value);
            this.closeModal('modal-ds-pay');
            await this._dsAfterMutation();
            Toast.show('Pagamento registrado!', 'success');
        } catch (err) { Toast.show(err.message || 'Erro ao registrar pagamento.', 'error'); }
    }

    async dsUndoPay(id) {
        const ch = [...this._ds.charges, ...this._ds.paid].find(c => c.id === id);
        const contract = ch && this._ds.contracts.find(c => c.id === ch.contractId);
        if (contract && contract.cancelledFrom && ch.competence >= contract.cancelledFrom
            && !window.confirm('Esta cobrança é de um período cancelado. Desfazer o pagamento a deixará pendente. Continuar?')) return;
        try {
            await store.unmarkDirectChargePaid(id);
            await this._dsAfterMutation();
        } catch (err) { Toast.show(err.message || 'Erro ao desfazer pagamento.', 'error'); }
    }

    // --- Editar cobrança isolada
    openDsChargeEdit(id) {
        const ch = this._ds.charges.find(c => c.id === id) || this._ds.overdue.find(c => c.id === id);
        if (!ch) return;
        document.getElementById('ds-ch-id').value = ch.id;
        document.getElementById('ds-ch-amount').value = (ch.amountCents / 100).toFixed(2).replace('.', ',');
        document.getElementById('ds-ch-due').value = ch.dueDate;
        this.openModal('modal-ds-charge');
    }

    async handleDsChargeSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('ds-ch-id').value;
        const ch = this._ds.charges.find(c => c.id === id) || this._ds.overdue.find(c => c.id === id);
        const cents = TSPDirectSales.parseMoneyToCents(document.getElementById('ds-ch-amount').value);
        const due = document.getElementById('ds-ch-due').value;
        if (cents === null || !due) { Toast.show('Confira valor e vencimento.', 'error'); return; }
        const contract = this._ds.contracts.find(c => c.id === ch.contractId);
        const patch = { amountCents: cents, dueDate: due };
        // Serviço: competence acompanha o vencimento. Mensalidade: competence é a chave (m:YYYY-MM) e não muda.
        if (contract && contract.kind === 'service') patch.competence = due.slice(0, 7);
        try {
            await store.updateDirectCharge(id, patch);
            this.closeModal('modal-ds-charge');
            await this._dsAfterMutation();
            Toast.show('Cobrança atualizada!', 'success');
        } catch (err) { Toast.show(err.message || 'Erro ao atualizar cobrança.', 'error'); }
    }

    // --- Reajuste / cancelamento / reativação
    openDsAdjust(contractId) {
        document.getElementById('form-ds-adjust').reset();
        document.getElementById('ds-adj-contract').value = contractId;
        const c = this._ds.contracts.find(x => x.id === contractId);
        const m = document.getElementById('ds-adj-month');
        m.min = c.startMonth;
        m.value = TSPDirectSales.currentMonthLocal() < c.startMonth ? c.startMonth : TSPDirectSales.currentMonthLocal();
        this.openModal('modal-ds-adjust');
    }

    async handleDsAdjustSubmit(e) {
        e.preventDefault();
        const cents = TSPDirectSales.parseMoneyToCents(document.getElementById('ds-adj-amount').value);
        if (!cents || cents <= 0) { Toast.show('Informe um valor válido.', 'error'); return; }
        try {
            await store.adjustDirectContract(document.getElementById('ds-adj-contract').value,
                document.getElementById('ds-adj-month').value, cents);
            this.closeModal('modal-ds-adjust');
            await this._dsAfterMutation();
            Toast.show('Reajuste aplicado!', 'success');
        } catch (err) { Toast.show(err.message || 'Erro ao reajustar.', 'error'); }
    }

    openDsCancel(contractId) {
        document.getElementById('ds-cancel-contract').value = contractId;
        const c = this._ds.contracts.find(x => x.id === contractId);
        const m = document.getElementById('ds-cancel-month');
        m.min = c.startMonth;
        m.value = TSPDirectSales.currentMonthLocal() < c.startMonth ? c.startMonth : TSPDirectSales.currentMonthLocal();
        const btn = document.getElementById('btn-ds-cancel-confirm');
        if (btn._origDeleteHtml) { btn.innerHTML = btn._origDeleteHtml; btn._origDeleteHtml = null; }
        this.openModal('modal-ds-cancel');
    }

    handleDsCancelSubmit(btn) {
        const id = document.getElementById('ds-cancel-contract').value;
        const month = document.getElementById('ds-cancel-month').value;
        if (!month) { Toast.show('Informe o mês de cancelamento.', 'error'); return; }
        this._twostepDelete(btn, async () => {
            try {
                await store.cancelDirectContract(id, month);
                this.closeModal('modal-ds-cancel');
                await this._dsAfterMutation();
                Toast.show('Mensalidade cancelada.', 'success');
            } catch (err) { Toast.show(err.message || 'Erro ao cancelar.', 'error'); }
        });
    }

    async dsReactivate(id) {
        try {
            await store.reactivateDirectContract(id);
            await this._dsAfterMutation();
            Toast.show('Mensalidade reativada.', 'success');
        } catch (err) { Toast.show(err.message || 'Erro ao reativar.', 'error'); }
    }

    // --- Editar / excluir contrato
    openDsContractEdit(id) {
        const c = this._ds.contracts.find(x => x.id === id);
        if (!c) return;
        document.getElementById('ds-ce-id').value = c.id;
        document.getElementById('ds-ce-desc').value = c.description;
        this._dsFillClientSelect('ds-ce-client', c.clientId);
        this.openModal('modal-ds-contract-edit');
    }

    async handleDsContractEditSubmit(e) {
        e.preventDefault();
        const clientId = document.getElementById('ds-ce-client').value;
        if (!clientId) { Toast.show('Escolha o cliente.', 'error'); return; }
        try {
            await store.updateDirectContract(document.getElementById('ds-ce-id').value, {
                description: document.getElementById('ds-ce-desc').value.trim(), clientId
            });
            this.closeModal('modal-ds-contract-edit');
            await this._dsAfterMutation();
            Toast.show('Contrato atualizado!', 'success');
        } catch (err) { Toast.show(err.message || 'Erro ao atualizar contrato.', 'error'); }
    }

    dsDeleteContract(btn, id) {
        this._twostepDelete(btn, async () => {
            try {
                await store.deleteDirectContract(id);
                await this._dsAfterMutation();
                Toast.show('Contrato excluído.', 'success');
            } catch (err) {
                Toast.show(/pagas/i.test(err.message || '') ? 'Contrato com cobranças pagas não pode ser excluído.' : (err.message || 'Erro ao excluir.'), 'error');
                await this._dsAfterMutation();
            }
        });
    }
```

- [ ] **Step 2: Verificar sintaxe**

Run: `node --check js/app.js`
Expected: sem saída (exit 0).

- [ ] **Step 3: Commit**

```bash
git add js/app.js
git commit -m "feat(vendas-diretas): modais e ações de clientes, vendas, pagamentos e contratos"
git push origin main
```

---

### Task 7: Gráfico Faturado vs Recebido

**Files:**
- Modify: `js/app.js` (substituir o stub `_buildDirectSalesChart` da Task 5)

**Interfaces:**
- Consumes: saída de `TSPDirectSales.computeHistory` → `[{year, month, faturado, recebido}]`.
- Produces: `app._buildDirectSalesChart(history) -> HTMLElement`.

- [ ] **Step 1: Substituir o stub** por:

```javascript
    _buildDirectSalesChart(history) {
        const D = TSPDirectSales;
        const wrap = document.createElement('div');
        wrap.className = 'glass';
        wrap.style.padding = '20px 24px';
        const monthAbbr = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        const maxVal = Math.max(...history.map(h => Math.max(h.faturado, h.recebido)), 1);
        const PRIMARY = 'linear-gradient(180deg,var(--primary-color),var(--secondary-color))';
        const SKY = 'linear-gradient(180deg,#38bdf8,#0ea5e9)';
        const bar = (value, bg, label) => `
            <div class="ds-bar-fill money-value" data-h="${Math.round((value / maxVal) * 100)}"
                 title="${label}: ${D.formatCents(value)}"
                 style="width:42%;height:0;background:${bg};border-radius:4px 4px 0 0;transition:height 0.55s ease;"></div>`;
        const cols = history.map(h => `
            <div style="display:flex;flex-direction:column;align-items:center;flex:1;gap:6px;">
                <div style="height:140px;width:100%;display:flex;align-items:flex-end;justify-content:center;gap:3px;">
                    ${bar(h.faturado, PRIMARY, 'Faturado')}${bar(h.recebido, SKY, 'Recebido')}
                </div>
                <span style="font-size:0.72rem;color:var(--text-muted);">${monthAbbr[h.month - 1]}/${String(h.year).slice(2)}</span>
            </div>`).join('');
        wrap.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin:0 0 16px;flex-wrap:wrap;gap:8px;">
                <h3 style="margin:0;font-size:1rem;">Faturado e recebido por mês</h3>
                <div style="display:flex;gap:14px;font-size:0.78rem;color:var(--text-muted);">
                    <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${PRIMARY};margin-right:4px;"></span>Faturado (competência)</span>
                    <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${SKY};margin-right:4px;"></span>Recebido (data do pagamento)</span>
                </div>
            </div>
            <div style="display:flex;align-items:flex-end;gap:4px;">${cols}</div>`;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            wrap.querySelectorAll('.ds-bar-fill').forEach(b => { b.style.height = b.dataset.h + '%'; });
        }));
        return wrap;
    }
```

- [ ] **Step 2: Verificar sintaxe**

Run: `node --check js/app.js`
Expected: sem saída (exit 0).

- [ ] **Step 3: Commit**

```bash
git add js/app.js
git commit -m "feat(vendas-diretas): gráfico de faturado e recebido"
git push origin main
```

---

### Task 8: Deploy, E2E e isolamento

**Files:**
- Create: `tests/e2e-direct-sales.js`

**Interfaces:**
- Consumes: app em produção `https://jorge-gerenciador-tsp.27pl2o.easypanel.host` (deploy manual do Jorge no Easypanel antes de rodar), contas `testes@teste.com` / senha em `CLAUDE.md` (seção "Usuários de teste") e `jorjaocorreia@gmail.com` (papel client; senha também em `CLAUDE.md`).
- Runner: `cd d:\GerenciadorTSP\skills\playwright-skill; node run.js "<caminho absoluto do script>"`.

- [ ] **Step 1: Pedir o deploy ao Jorge.** O webhook do Easypanel está quebrado: avisar "push feito, faça o deploy manual no Easypanel (serviço `gerenciador-tsp`) e me avise" e **parar** até a confirmação.

- [ ] **Step 2: Escrever o E2E.** Criar `tests/e2e-direct-sales.js` (as credenciais vêm do CLAUDE.md; ler lá, não colar em outro lugar além deste script de teste local — o script não deve ser commitado com senha: usar `process.env.TSP_TEST_PASSWORD` e `process.env.TSP_CLIENT_PASSWORD`):

```javascript
const { chromium } = require('playwright');
const assert = require('assert');

const BASE = 'https://jorge-gerenciador-tsp.27pl2o.easypanel.host';
const TEST_EMAIL = 'testes@teste.com';
const TEST_PASS = process.env.TSP_TEST_PASSWORD;
const CLIENT_EMAIL = 'jorjaocorreia@gmail.com';
const CLIENT_PASS = process.env.TSP_CLIENT_PASSWORD;
if (!TEST_PASS || !CLIENT_PASS) { console.error('Defina TSP_TEST_PASSWORD e TSP_CLIENT_PASSWORD'); process.exit(1); }

let failed = 0;
async function step(name, fn) {
    try { await fn(); console.log(`OK   ${name}`); }
    catch (e) { failed++; console.error(`FAIL ${name}\n`, e.message); }
}

async function login(page, email, pass) {
    await page.goto(`${BASE}/index.html`);
    await page.fill('#auth-email', email);
    await page.fill('#auth-password', pass);
    await page.click('#auth-form button[type=submit]');
    await page.waitForSelector('#auth-screen', { state: 'hidden', timeout: 20000 });
}

// Chama a API do Supabase com o JWT da sessão aberta na página
async function apiCount(page, table) {
    return page.evaluate(async (t) => {
        const { data, error } = await window.supabaseClient.from(t).select('id');
        return { n: data ? data.length : -1, error: error ? error.message : null };
    }, table);
}

(async () => {
    const browser = await chromium.launch({ headless: true });

    // ===== Conta permitida (testes@teste.com) =====
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, TEST_EMAIL, TEST_PASS);
    await page.click('.nav-item[data-view="financeiro"]');

    await step('aba Vendas Diretas visível para conta permitida', async () => {
        await page.waitForSelector('#fin-tab-direct', { state: 'visible', timeout: 10000 });
    });

    await step('abrir aba e ver os 4 cards', async () => {
        await page.click('#fin-tab-direct');
        await page.waitForSelector('#ds-cards .stat-card', { timeout: 15000 });
        assert.strictEqual(await page.locator('#ds-cards .stat-card').count(), 4);
    });

    await step('criar venda parcelada em 3x com cliente novo', async () => {
        await page.click('#btn-ds-new-service');
        await page.fill('#ds-svc-new-client', 'E2E Cliente Direto');
        await page.fill('#ds-svc-desc', 'E2E Serviço');
        await page.fill('#ds-svc-total', '300,00');
        await page.fill('#ds-svc-n', '3');
        await page.waitForSelector('.ds-svc-row-amount');
        assert.strictEqual(await page.locator('.ds-svc-row-amount').count(), 3);
        await page.click('#form-ds-service button[type=submit]');
        await page.waitForSelector('#modal-ds-service', { state: 'hidden' });
        await page.waitForSelector('#ds-charges-tbody tr td:has-text("E2E Serviço 1/3")');
    });

    await step('marcar a parcela 1 como paga e ver Recebido', async () => {
        const row = page.locator('#ds-charges-tbody tr', { hasText: 'E2E Serviço 1/3' });
        await row.getByText('Marcar paga').click();
        await page.click('#form-ds-pay button[type=submit]');
        await page.waitForSelector('#modal-ds-pay', { state: 'hidden' });
        await page.waitForSelector('#ds-charges-tbody tr:has-text("Paga em")');
        const recebido = await page.locator('#ds-cards .stat-card').nth(1).locator('.stat-value').innerText();
        assert.ok(recebido.includes('100,00'), `Recebido esperado 100,00, veio ${recebido}`);
    });

    await step('desfazer pagamento volta a pendente', async () => {
        const row = page.locator('#ds-charges-tbody tr', { hasText: 'E2E Serviço 1/3' });
        await row.getByText('Desfazer').click();
        await page.waitForSelector('#ds-charges-tbody tr:has-text("E2E Serviço 1/3"):has-text("Pendente")');
    });

    await step('criar mensalidade e gerar cobranças', async () => {
        await page.click('#btn-ds-new-subscription');
        await page.selectOption('#ds-sub-client', { label: 'E2E Cliente Direto' });
        await page.fill('#ds-sub-desc', 'E2E Mensal');
        await page.fill('#ds-sub-amount', '500,00');
        await page.fill('#ds-sub-dueday', '28');
        await page.click('#form-ds-subscription button[type=submit]');
        await page.waitForSelector('#modal-ds-subscription', { state: 'hidden' });
        await page.waitForSelector('#ds-contracts-tbody tr:has-text("E2E Mensal")');
    });

    await step('reajustar mensalidade', async () => {
        const row = page.locator('#ds-contracts-tbody tr', { hasText: 'E2E Mensal' });
        await row.getByText('Reajustar').click();
        await page.fill('#ds-adj-amount', '650,00');
        await page.click('#form-ds-adjust button[type=submit]');
        await page.waitForSelector('#modal-ds-adjust', { state: 'hidden' });
        await page.waitForSelector('#ds-charges-tbody tr:has-text("Mensalidade"):has-text("650,00")');
    });

    await step('cancelar mensalidade (2 passos) e reativar', async () => {
        const row = page.locator('#ds-contracts-tbody tr', { hasText: 'E2E Mensal' });
        await row.getByText('Cancelar').click();
        await page.click('#btn-ds-cancel-confirm');   // 1º clique: pede confirmação
        await page.click('#btn-ds-cancel-confirm');   // 2º clique: confirma
        await page.waitForSelector('#modal-ds-cancel', { state: 'hidden' });
        await page.waitForSelector('#ds-contracts-tbody tr:has-text("Cancelada desde")');
        await page.locator('#ds-contracts-tbody tr', { hasText: 'E2E Mensal' }).getByText('Reativar').click();
        await page.waitForSelector('#ds-contracts-tbody tr:has-text("E2E Mensal"):has-text("Ativa")');
    });

    await step('botão de ocultar valores esconde os valores novos', async () => {
        await page.click('#btn-toggle-money-fin');
        const hiddenCount = await page.evaluate(() =>
            Array.from(document.querySelectorAll('#financeiro-panel-direct .money-value'))
                .filter(el => getComputedStyle(el).visibility === 'hidden' || getComputedStyle(el).filter.includes('blur')).length);
        assert.ok(hiddenCount > 0, 'nenhum .money-value ficou oculto');
        await page.click('#btn-toggle-money-fin');
    });

    await step('aba Tecinco continua carregando', async () => {
        await page.click('#fin-tab-tecinco');
        await page.waitForSelector('#financeiro-table', { state: 'visible' });
        await page.waitForSelector('#financeiro-tbody tr', { timeout: 15000 });
    });

    // ===== Limpeza dos dados do teste (RLS permite apagar o que é seu) =====
    await step('limpeza: remover dados E2E', async () => {
        await page.evaluate(async () => {
            const db = window.supabaseClient;
            const { data: cs } = await db.from('direct_clients').select('id').eq('name', 'E2E Cliente Direto');
            for (const c of cs || []) {
                const { data: ks } = await db.from('direct_contracts').select('id').eq('client_id', c.id);
                for (const k of ks || []) {
                    await db.from('direct_charges').update({ status: 'pending', paid_at: null }).eq('contract_id', k.id);
                    await db.from('direct_contracts').delete().eq('id', k.id);
                }
                await db.from('direct_clients').delete().eq('id', c.id);
            }
        });
    });
    await ctx.close();

    // ===== Isolamento: papel client não vê nem escreve =====
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await login(page2, CLIENT_EMAIL, CLIENT_PASS);
    await step('papel client: SELECT nas 4 tabelas volta vazio/negado', async () => {
        for (const t of ['direct_clients', 'direct_contracts', 'direct_charges', 'direct_contract_adjustments']) {
            const r = await apiCount(page2, t);
            assert.ok(r.n === 0 || r.error, `${t} vazou ${r.n} linhas`);
        }
    });
    await step('papel client: INSERT em direct_clients é negado', async () => {
        const err = await page2.evaluate(async () => {
            const uid = (await window.supabaseClient.auth.getUser()).data.user.id;
            const { error } = await window.supabaseClient.from('direct_clients').insert({ user_id: uid, name: 'x' });
            return error ? error.message : null;
        });
        assert.ok(err, 'INSERT deveria ter sido negado pela RLS');
    });
    await step('papel client: aba Vendas Diretas oculta', async () => {
        assert.strictEqual(await page2.locator('#fin-tab-direct').isVisible().catch(() => false), false);
    });
    await ctx2.close();

    await browser.close();
    if (failed) { console.error(`${failed} verificação(ões) falharam`); process.exit(1); }
    console.log('Todas as verificações passaram');
})();
```

- [ ] **Step 3: Rodar contra produção** (após o deploy confirmado):

```powershell
$env:TSP_TEST_PASSWORD = "<senha da conta testes@teste.com, do CLAUDE.md>"
$env:TSP_CLIENT_PASSWORD = "<senha da conta jorjaocorreia@gmail.com, do CLAUDE.md>"
cd "d:\GerenciadorTSP\skills\playwright-skill"
node run.js "d:\GerenciadorTSP\tests\e2e-direct-sales.js"
```

Expected: todas as linhas `OK` e `Todas as verificações passaram`. Se algum seletor (`#auth-email`, `.nav-item[data-view="financeiro"]`, `#btn-toggle-money-fin`) divergir do HTML real, ajustar o seletor ao do `index.html` (não renomear IDs do app). Corrigir falhas reais no código (não no teste) e repetir.

- [ ] **Step 4: Verificar isolamento de FK e e-mail (API direta)**, com a sessão `testes@teste.com`, em `page.evaluate` ou console da produção: tentar `insert` em `direct_contracts` com um `client_id` aleatório (`crypto.randomUUID()`) deve falhar por FK composta; e confirmar via Management API que não ficou nenhuma linha órfã:

```sql
SELECT (SELECT count(*) FROM direct_clients WHERE name = 'E2E Cliente Direto') AS clientes_e2e,
       (SELECT count(*) FROM direct_contracts WHERE description LIKE 'E2E%') AS contratos_e2e;
```

Expected: `0, 0` (limpeza do Step 2 funcionou). Se sobrar lixo, remover por SQL com o mesmo método da Task 2.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e-direct-sales.js
git commit -m "test(vendas-diretas): E2E e checagens de isolamento"
git push origin main
```

---

### Task 9: Documentar no CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (tabela de fases, estrutura de arquivos, tabela de Banco, nova seção de armadilhas)

- [ ] **Step 1: Atualizar o CLAUDE.md** com:
  - linha na tabela "Fases implementadas": `| 54 | Vendas Diretas: aba em Financeiro para serviços (à vista/parcelados) e mensalidades fora da Tecinco; cobranças em direct_charges geradas por RPC; visível só para jorge.henrique@tecinco.com.br e testes@teste.com (direct_sales_allowed() + RLS), nunca para Gerente em Modo Supervisão nem Portal do Cliente |` (e ajustar o título "1–48" se necessário para refletir as fases atuais);
  - arquivos novos em "Estrutura de arquivos": `js/direct-sales-calc.js`, `tests/direct-sales-calc.test.js`, `tests/e2e-direct-sales.js`, `supabase/migrations/20261009_direct_sales.sql`;
  - as 4 tabelas na tabela "Banco de dados";
  - seção "### Vendas Diretas — armadilhas conhecidas" com: (1) a lista de e-mails existe em dois lugares (função SQL `direct_sales_allowed()` e `DIRECT_SALES_ALLOWED_EMAILS` em `js/app.js`) e precisa ser mudada junto, migration nova + deploy; (2) FKs compostas `(id, user_id)` evitam referência cruzada, a checagem de FK ignora RLS; (3) `charge_key` (`m:YYYY-MM`/`i:N`) é a chave de idempotência, o índice único não pode ser parcial por causa do `upsert`; (4) geração/reajuste/cancelamento são RPCs com `FOR UPDATE`, e `get*` do store nunca escrevem (o Proxy libera tudo que começa com `get`); (5) definições: Faturado/A receber por competência, Recebido por `paid_at`, Atrasado global; (6) nada retroativo; (7) `testes@teste.com` tem senha pública no repo, não colocar dado real nela; (8) o mês do cabeçalho de Financeiro é compartilhado entre as duas abas e `renderFinanceiro()` despacha por `financeiroTab`; (9) trigger bloqueia exclusão de contrato com cobrança paga e impede cobrança em competência cancelada.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: documenta Fase 54 (Vendas Diretas) e armadilhas"
git push origin main
```

- [ ] **Step 3: Avisar o Jorge** que o deploy manual no Easypanel é necessário para qualquer ajuste posterior.

---

## Self-review

- **Cobertura da spec:** dados/constraints/triggers/RPCs (Task 2); regras e totais (Task 1); store com convenção get/escrita (Task 3); abas, painel e modais (Task 4); gating, despacho por aba, mês compartilhado, `.money-value`, cache e logout (Task 5); clientes/serviço/mensalidade/pagamento/edição/reajuste/cancelamento/reativação/exclusão (Task 6); gráfico próprio com mês final parametrizável (Task 7); testes unitários, isolamento, E2E (Tasks 1 e 8); documentação (Task 9). Bloqueio de inativar cliente com mensalidade ativa está em `dsToggleClient`; bloqueio de retroativo em `handleDsServiceSubmit`/`handleDsSubscriptionSubmit`.
- **Placeholders:** nenhum; os trechos que dependem do ambiente real (senhas, seletores de login) estão explícitos como variáveis de ambiente ou com instrução de ajuste.
- **Consistência de tipos:** `chargeKey`/`amountCents`/`dueDate`/`paidAt`/`manuallyEdited` iguais em calc, mappers do store e app; `ensureUntil`, `computeMonthTotals` e `computeHistory` com as mesmas assinaturas nas Tasks 1, 3 e 5.
- **Pontos de atenção na execução:** o stub de `_buildDirectSalesChart` na Task 5 precisa ser removido na Task 7; `_btnPending/_btnError` já existem em `AppController`; `escapeHtml` e `spinnerHtml` são globais já usadas por `renderFinanceiro`.
