# Controle de Comissão CS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar o cálculo e a gestão mensal da comissão do setor de Customer Success (bônus por cancelamento, horas apontadas, comissão de vendas e de mensalidade), com o Gerente gerenciando tudo a partir de um cliente administrativo único, e cada consultor participante vendo o próprio resultado somado ao total da view Financeiro.

**Architecture:** Duas tabelas novas (`cs_commission_periods`, `cs_commission_participants`) com RLS assimétrica (Gerente lê/escreve tudo; consultor comum só lê a própria linha + totais do período em que participa). Um novo campo `clients.is_cs_project` identifica o cliente administrativo do setor. Toda a fórmula de cálculo vive num módulo JS puro (`js/cs-commission-calc.js`), reaproveitado tanto pela grade de gestão do Gerente (dentro do modal de Cliente) quanto pela linha extra injetada na tabela da view Financeiro.

**Tech Stack:** Supabase Postgres (SQL migration + RLS + trigger via Management API), JavaScript ES6 vanilla (sem build step), Node.js para os testes do módulo de cálculo puro.

## Global Constraints

- Sem TypeScript, sem framework, sem bundler — HTML/CSS/JS vanilla, mesmo padrão do restante do app.
- Toda alteração de schema Supabase precisa de arquivo de migration em `supabase/migrations/` E ser aplicada à produção via Supabase Management API (não existe ambiente de staging) — nunca colar o token de acesso literal em nenhum arquivo; usar `$env:SUPABASE_ACCESS_TOKEN` já exportado na sessão do usuário.
- Texto de UI em português do Brasil, consistente com o restante do app.
- Toda chamada ao `store` é `async/await`; nunca `await` dentro de `forEach`.
- Reaproveitar componentes/padrões já existentes: `.info-tooltip` (tooltip), `_twostepDelete` (exclusão com confirmação), `Toast.show` (feedback), `this._btnPending/_btnSuccess/_btnError` (estado de botão), `escapeHtml`, `spinnerHtml`.
- Métodos do `store` que só leem devem começar com `get`/`_` (o guard de Modo Supervisão do Gerente bloqueia qualquer outro nome durante supervisão — ver `js/store.js:1648-1664`).
- Bump do parâmetro de cache-busting (`?v=N`) em qualquer script cujo conteúdo mude (`index.html` linhas 2706/2708) — `nginx.conf` já força `no-cache` no HTML/JS, mas o app já segue essa convenção.
- Não implementar nada listado como "Fora de escopo" na spec (`docs/superpowers/specs/2026-08-04-comissao-cs-design.md`): sem integração automática de cancelamentos, sem histórico de auditoria de participantes, sem suporte a múltiplos clientes administrativos, sem exportação em PDF.

---

### Task 1: Migration — schema, RLS e trigger

**Files:**
- Create: `supabase/migrations/20260804_cs_commission.sql`

**Interfaces:**
- Produces: coluna `clients.is_cs_project` (BOOLEAN); tabelas `cs_commission_periods` e `cs_commission_participants` com as colunas exatas descritas no design; trigger `trg_sync_cs_commission_participant_count`.

- [ ] **Step 1: Escrever a migration**

```sql
-- Comissão CS: cliente administrativo do setor + tabelas de período/participantes.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_cs_project BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS cs_commission_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_month DATE NOT NULL UNIQUE,
  cancellations_count INT NOT NULL DEFAULT 0,
  sales_total NUMERIC NOT NULL DEFAULT 0,
  monthly_increase_total NUMERIC NOT NULL DEFAULT 0,
  participant_count INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE cs_commission_periods ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS cs_commission_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID REFERENCES cs_commission_periods ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users NOT NULL,
  hours_apontadas NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (period_id, user_id)
);
ALTER TABLE cs_commission_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "managers_all_cs_periods" ON cs_commission_periods FOR ALL
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'manager'));

CREATE POLICY "participants_read_own_cs_period" ON cs_commission_periods FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM cs_commission_participants p
    WHERE p.period_id = cs_commission_periods.id AND p.user_id = auth.uid()
  ));

CREATE POLICY "managers_all_cs_participants" ON cs_commission_participants FOR ALL
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'manager'));

CREATE POLICY "consultants_read_own_cs_participation" ON cs_commission_participants FOR SELECT
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION sync_cs_commission_participant_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE cs_commission_periods
  SET participant_count = (
    SELECT count(*) FROM cs_commission_participants
    WHERE period_id = COALESCE(NEW.period_id, OLD.period_id)
  )
  WHERE id = COALESCE(NEW.period_id, OLD.period_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_sync_cs_commission_participant_count ON cs_commission_participants;
CREATE TRIGGER trg_sync_cs_commission_participant_count
AFTER INSERT OR DELETE ON cs_commission_participants
FOR EACH ROW EXECUTE FUNCTION sync_cs_commission_participant_count();
```

- [ ] **Step 2: Aplicar a migration na produção via Management API**

```powershell
# Pressupõe $env:SUPABASE_ACCESS_TOKEN já definido na sessão (token pessoal de Jorge — NUNCA colar o valor literal em nenhum arquivo).
$sql = Get-Content -Raw "supabase\migrations\20260804_cs_commission.sql"
Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/klimkamnydfnzqetqlqm/database/query" `
  -Method POST `
  -Headers @{ "Authorization" = "Bearer $env:SUPABASE_ACCESS_TOKEN"; "Content-Type" = "application/json" } `
  -Body (@{ query = $sql } | ConvertTo-Json)
```

Expected: retorno JSON sem `error`, indicando sucesso do DDL.

- [ ] **Step 3: Verificar que as tabelas/coluna existem**

```powershell
$verifySql = @"
SELECT column_name FROM information_schema.columns WHERE table_name = 'clients' AND column_name = 'is_cs_project';
"@
Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/klimkamnydfnzqetqlqm/database/query" `
  -Method POST `
  -Headers @{ "Authorization" = "Bearer $env:SUPABASE_ACCESS_TOKEN"; "Content-Type" = "application/json" } `
  -Body (@{ query = $verifySql } | ConvertTo-Json)
```

Expected: array com uma linha `{ "column_name": "is_cs_project" }`. Repetir consulta similar para `cs_commission_periods`/`cs_commission_participants` em `information_schema.tables` se quiser confirmar as duas tabelas novas.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260804_cs_commission.sql
git commit -m "feat(cs): migration da comissão CS (clients.is_cs_project + cs_commission_periods/participants)"
```

---

### Task 2: Módulo de cálculo puro (`js/cs-commission-calc.js`)

**Files:**
- Create: `js/cs-commission-calc.js`
- Test: `tests/cs-commission-calc.test.js`

**Interfaces:**
- Produces: `window.TSPCsCommission.computePercentual(hours) -> number` (0 a 1); `window.TSPCsCommission.computeConsultantResult(hours, participantCount, cancellationsCount, salesTotal, monthlyIncreaseTotal) -> { percentual, bonus, comissaoVendas, comissaoMensalidade, total }`.

- [ ] **Step 1: Escrever o teste (vai falhar — módulo ainda não existe)**

```javascript
// tests/cs-commission-calc.test.js
const assert = require('assert');
require('../js/cs-commission-calc.js');
const TSPCsCommission = global.TSPCsCommission;

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

run('computePercentual: 0h -> 0%', () => {
    assert.strictEqual(TSPCsCommission.computePercentual(0), 0);
});

run('computePercentual: 3h -> 20%', () => {
    assert.strictEqual(TSPCsCommission.computePercentual(3), 0.2);
});

run('computePercentual: 5h -> 33,33%', () => {
    assert.ok(Math.abs(TSPCsCommission.computePercentual(5) - (5 / 15)) < 1e-9);
});

run('computePercentual: 15h -> 100%', () => {
    assert.strictEqual(TSPCsCommission.computePercentual(15), 1);
});

run('computePercentual: 18h -> 100% (capado em 15)', () => {
    assert.strictEqual(TSPCsCommission.computePercentual(18), 1);
});

run('computeConsultantResult: exemplo da spec — Gabriel (15h, sem cancelamento)', () => {
    const r = TSPCsCommission.computeConsultantResult(15, 3, 0, 24444, 2362);
    assert.ok(Math.abs(r.total - 1608.47) < 0.01, `total foi ${r.total}`);
    assert.strictEqual(r.bonus, 400);
});

run('computeConsultantResult: exemplo da spec — Gabriel (15h, com cancelamento)', () => {
    const r = TSPCsCommission.computeConsultantResult(15, 3, 1, 24444, 2362);
    assert.ok(Math.abs(r.total - 1208.47) < 0.01, `total foi ${r.total}`);
    assert.strictEqual(r.bonus, 0);
});

run('computeConsultantResult: Lally (0h) -> só o bônus, sem comissão', () => {
    const r = TSPCsCommission.computeConsultantResult(0, 3, 0, 24444, 2362);
    assert.strictEqual(r.percentual, 0);
    assert.strictEqual(r.comissaoVendas, 0);
    assert.strictEqual(r.comissaoMensalidade, 0);
    assert.strictEqual(r.total, 400);
});

run('computeConsultantResult: participantCount 0 não gera divisão por zero', () => {
    const r = TSPCsCommission.computeConsultantResult(10, 0, 0, 1000, 500);
    assert.ok(Number.isFinite(r.total));
});

if (process.exitCode) {
    console.error('\nALGUM TESTE FALHOU');
} else {
    console.log('\nTODOS OS TESTES PASSARAM');
}
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

Run: `node tests/cs-commission-calc.test.js`
Expected: erro `Cannot find module '../js/cs-commission-calc.js'`.

- [ ] **Step 3: Implementar o módulo**

```javascript
// js/cs-commission-calc.js
(function (global) {
    function computePercentual(hours) {
        const h = parseFloat(hours) || 0;
        return Math.min(h, 15) / 15;
    }

    function computeConsultantResult(hours, participantCount, cancellationsCount, salesTotal, monthlyIncreaseTotal) {
        const percentual = computePercentual(hours);
        const bonus = (parseInt(cancellationsCount) || 0) === 0 ? 400 : 0;
        const poolVendas = (parseFloat(salesTotal) || 0) * 0.10;
        const poolMensalidade = (parseFloat(monthlyIncreaseTotal) || 0) * 0.50;
        const n = Math.max(1, parseInt(participantCount) || 0);
        const comissaoVendas = (poolVendas / n) * percentual;
        const comissaoMensalidade = (poolMensalidade / n) * percentual;
        const total = bonus + comissaoVendas + comissaoMensalidade;
        return { percentual, bonus, comissaoVendas, comissaoMensalidade, total };
    }

    global.TSPCsCommission = { computePercentual, computeConsultantResult };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Rodar o teste para confirmar que passa**

Run: `node tests/cs-commission-calc.test.js`
Expected: `TODOS OS TESTES PASSARAM`, exit code 0.

- [ ] **Step 5: Registrar o script no `index.html`**

Modify: `index.html` — adicionar a linha abaixo imediatamente depois de `<script src="js/financial-calc.js?v=1"></script>` (linha 2705) e antes de `<script src="js/store.js?v=28"></script>`:

```html
    <script src="js/cs-commission-calc.js?v=1"></script>
```

- [ ] **Step 6: Commit**

```bash
git add js/cs-commission-calc.js tests/cs-commission-calc.test.js index.html
git commit -m "feat(cs): módulo de cálculo puro da comissão CS"
```

---

### Task 3: Store — `clients.isCsProject` (mapper + CRUD)

**Files:**
- Modify: `js/store.js:7-19` (mapper `_client`), `js/store.js:101-132` (`addClient`/`updateClient`)
- Modify: `js/app.js:713-758` (`handleClientSubmit`), `js/app.js:3018-3043` (`openEditClientModal`), `js/app.js:606-612` (`closeModal` reset)
- Modify: `index.html` (checkbox no formulário de cliente)

**Interfaces:**
- Consumes: nenhuma (é a base para as próximas tasks).
- Produces: `client.isCsProject` (boolean) em todo objeto retornado por `store.getClient(s)`; `store.addClient(..., isCsProject)` / `store.updateClient(..., isCsProject)` — `isCsProject` é o novo último parâmetro posicional de ambas as funções.

- [ ] **Step 1: Adicionar o checkbox no HTML**

Modify: `index.html` — dentro de `<form id="form-client">`, imediatamente antes do bloco `<div class="form-group"><label for="client-notes">Observações</label>` (linha 1050), inserir:

```html
                <div class="form-group" style="display:flex;align-items:center;gap:8px;">
                    <input type="checkbox" id="client-is-cs-project" style="width:18px;height:18px;cursor:pointer;accent-color:var(--primary-color);" onchange="app.toggleCsProjectTab()">
                    <label for="client-is-cs-project" style="margin:0;cursor:pointer;font-weight:normal;">Este é o projeto de Comissão CS</label>
                </div>
```

- [ ] **Step 2: Atualizar o mapper `_client` em `js/store.js`**

Modify (linha 7-19), adicionar o campo `isCsProject` ao objeto retornado:

```javascript
    _client(r) {
        return { id: r.id, name: r.name, hoursTotal: parseFloat(r.hours_total) || 0,
            csName: r.cs_name || '', projectNum: r.project_num || '',
            clientPays: parseFloat(r.client_pays) || 0,
            consultantBonus: parseFloat(r.consultant_bonus) || 0,
            billingModel: r.billing_model || 'fixed',
            hourlyRate: parseFloat(r.hourly_rate) || 0,
            isCsProject: !!r.is_cs_project,
            notes: r.notes || '', status: r.status || 'active',
            initialBalanceMinutes: parseInt(r.initial_balance_minutes) || 0,
            balanceStartDate: r.balance_start_date || null,
            otoboCustomerId: r.otobo_customer_id || '',
            createdAt: r.created_at };
    }
```

- [ ] **Step 3: Atualizar `addClient`/`updateClient` em `js/store.js`**

Modify (linhas 101-132):

```javascript
    async addClient(name, hoursTotal, csName, projectNum, clientPays, consultantBonus, notes, status, initialBalanceMinutes, balanceStartDate, otoboCustomerId, billingModel, hourlyRate, isCsProject) {
        const { data, error } = await this.db.from('clients').insert({
            user_id: this.userId, name,
            hours_total: parseFloat(hoursTotal) || 0, cs_name: csName || '',
            project_num: projectNum || '', client_pays: parseFloat(clientPays) || 0,
            consultant_bonus: parseFloat(consultantBonus) || 0,
            notes: notes || '', status: status || 'active',
            initial_balance_minutes: parseInt(initialBalanceMinutes) || 0,
            balance_start_date: balanceStartDate || null,
            otobo_customer_id: otoboCustomerId || null,
            billing_model: billingModel || 'fixed',
            hourly_rate: parseFloat(hourlyRate) || 0,
            is_cs_project: !!isCsProject
        }).select().single();
        if (error) throw error;
        return this._client(data);
    }

    async updateClient(id, name, hoursTotal, csName, projectNum, clientPays, consultantBonus, notes, status, initialBalanceMinutes, balanceStartDate, otoboCustomerId, billingModel, hourlyRate, isCsProject) {
        const { data, error } = await this.db.from('clients').update({
            name, hours_total: parseFloat(hoursTotal) || 0, cs_name: csName || '',
            project_num: projectNum || '', client_pays: parseFloat(clientPays) || 0,
            consultant_bonus: parseFloat(consultantBonus) || 0,
            notes: notes || '', status: status || 'active',
            initial_balance_minutes: parseInt(initialBalanceMinutes) || 0,
            balance_start_date: balanceStartDate || null,
            otobo_customer_id: otoboCustomerId || null,
            billing_model: billingModel || 'fixed',
            hourly_rate: parseFloat(hourlyRate) || 0,
            is_cs_project: !!isCsProject
        }).eq('id', id).select().single();
        if (error) throw error;
        return this._client(data);
    }
```

- [ ] **Step 4: Atualizar `handleClientSubmit` em `js/app.js`**

Modify (linhas 713-758) — adicionar leitura do checkbox e repassar nas duas chamadas:

```javascript
    async handleClientSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('client-id').value;
        const name = document.getElementById('client-name').value;
        const hours = document.getElementById('client-hours').value;
        const projectNum = document.getElementById('client-project').value;
        const csName = document.getElementById('client-cs').value;
        const clientPays = document.getElementById('client-pays').value;
        const consultantBonus = document.getElementById('consultant-bonus').value;
        const billingModel = document.getElementById('billing-model-hourly').checked ? 'hourly' : 'fixed';
        const hourlyRate = document.getElementById('client-hourly-rate').value;
        const isCsProject = document.getElementById('client-is-cs-project').checked;
        const notes = document.getElementById('client-notes').value;
        const status = document.getElementById('client-status').value;
        const otoboCustomerId = document.getElementById('client-otobo-id').value.trim();
        const initialBalanceH = document.getElementById('client-initial-balance').value;
        const balanceStartDate = document.getElementById('client-balance-start').value;
        const btn = e.target.querySelector('[type="submit"]');

        // Saldo inicial preenchido exige data de início
        if (initialBalanceH !== '' && !balanceStartDate) {
            Toast.show('Informe a data de início do controle para usar saldo inicial.', 'error');
            return;
        }

        const initialBalanceMinutes = initialBalanceH !== ''
            ? Math.round(parseFloat(initialBalanceH) * 60)
            : 0;

        this._btnPending(btn);
        try {
            if (id) {
                await store.updateClient(id, name, hours, csName, projectNum, clientPays, consultantBonus, notes, status, initialBalanceMinutes, balanceStartDate || null, otoboCustomerId || null, billingModel, hourlyRate, isCsProject);
            } else {
                await store.addClient(name, hours, csName, projectNum, clientPays, consultantBonus, notes, status, initialBalanceMinutes, balanceStartDate || null, otoboCustomerId || null, billingModel, hourlyRate, isCsProject);
            }
            await this._btnSuccess(btn);
            e.target.reset();
            document.getElementById('client-id').value = '';
            this.closeModal('modal-client');
            await this.renderAll();
            Toast.show(id ? 'Cliente atualizado.' : 'Cliente cadastrado.', 'success');
        } catch (err) {
            this._btnError(btn);
            Toast.show(this._friendlyErrorMessage(err), 'error');
        }
    }
```

- [ ] **Step 5: Pré-popular o checkbox em `openEditClientModal`**

Modify: `js/app.js:3018-3043` — adicionar a linha abaixo imediatamente depois de `document.getElementById('client-balance-start').value = client.balanceStartDate || '';` (linha 3039):

```javascript
        document.getElementById('client-is-cs-project').checked = !!client.isCsProject;
```

- [ ] **Step 6: Resetar o checkbox ao fechar o modal**

Modify: `js/app.js:606-612` — dentro do bloco `if (modalId === 'modal-client') { ... }`, adicionar após `document.getElementById('client-id').value = '';`:

```javascript
            document.getElementById('client-is-cs-project').checked = false;
```

- [ ] **Step 7: Checagem de sintaxe**

Run: `node --check js/store.js` e `node --check js/app.js`
Expected: nenhuma saída (sintaxe válida).

- [ ] **Step 8: Commit**

```bash
git add js/store.js js/app.js index.html
git commit -m "feat(cs): campo is_cs_project no cadastro de cliente"
```

---

### Task 4: Store — períodos e participantes da comissão CS

**Files:**
- Modify: `js/store.js:1641` (inserir novo bloco de métodos imediatamente antes do `}` de fechamento da classe, linha 1642)

**Interfaces:**
- Consumes: `this.userId`, `this.db` (já existentes na classe `TSPStore`).
- Produces:
  - `store.getCsProjectClient() -> Promise<{id, projectNum, ...} | null>`
  - `store.getCsCommissionPeriodByMonth(referenceMonth: 'YYYY-MM-DD') -> Promise<{id, referenceMonth, cancellationsCount, salesTotal, monthlyIncreaseTotal, participantCount, createdBy, createdAt, updatedAt} | null>`
  - `store.createCsCommissionPeriod(referenceMonth) -> Promise<periodo>`
  - `store.updateCsCommissionPeriodValues(periodId, cancellationsCount, salesTotal, monthlyIncreaseTotal) -> Promise<periodo>`
  - `store.getCsCommissionParticipants(periodId) -> Promise<Array<{id, periodId, userId, hoursApontadas, createdAt}>>`
  - `store.getCsHoursForUser(targetUserId, referenceMonthYYYYMM: 'YYYY-MM', csProjectNum: string) -> Promise<number>` (horas, não minutos)
  - `store.addCsCommissionParticipant(periodId, targetUserId, hoursApontadas) -> Promise<participante>`
  - `store.updateCsCommissionParticipantHours(participantId, hoursApontadas) -> Promise<participante>`
  - `store.removeCsCommissionParticipant(participantId) -> Promise<void>`
  - `store.getMyCsCommissionForMonth(referenceMonth) -> Promise<{period, participant} | null>`

- [ ] **Step 1: Inserir os mappers e métodos em `js/store.js`**

Modify: inserir o bloco abaixo imediatamente antes da linha `}` que fecha a classe `TSPStore` (linha 1642 — depois do método `markNotificationsSeen`):

```javascript

    // ── COMISSÃO CS ──────────────────────────────────────────────

    _csPeriod(r) {
        return { id: r.id, referenceMonth: r.reference_month,
            cancellationsCount: parseInt(r.cancellations_count) || 0,
            salesTotal: parseFloat(r.sales_total) || 0,
            monthlyIncreaseTotal: parseFloat(r.monthly_increase_total) || 0,
            participantCount: parseInt(r.participant_count) || 0,
            createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at };
    }

    _csParticipant(r) {
        return { id: r.id, periodId: r.period_id, userId: r.user_id,
            hoursApontadas: parseFloat(r.hours_apontadas) || 0, createdAt: r.created_at };
    }

    async getCsProjectClient() {
        const { data, error } = await this.db.from('clients').select('*')
            .eq('user_id', this.userId).eq('is_cs_project', true).limit(1).maybeSingle();
        if (error) throw error;
        return data ? this._client(data) : null;
    }

    async getCsCommissionPeriodByMonth(referenceMonth) {
        const { data, error } = await this.db.from('cs_commission_periods').select('*')
            .eq('reference_month', referenceMonth).maybeSingle();
        if (error) throw error;
        return data ? this._csPeriod(data) : null;
    }

    async createCsCommissionPeriod(referenceMonth) {
        const { data, error } = await this.db.from('cs_commission_periods').insert({
            reference_month: referenceMonth, created_by: this.userId
        }).select().single();
        if (error) throw error;
        return this._csPeriod(data);
    }

    async updateCsCommissionPeriodValues(periodId, cancellationsCount, salesTotal, monthlyIncreaseTotal) {
        const { data, error } = await this.db.from('cs_commission_periods').update({
            cancellations_count: parseInt(cancellationsCount) || 0,
            sales_total: parseFloat(salesTotal) || 0,
            monthly_increase_total: parseFloat(monthlyIncreaseTotal) || 0,
            updated_at: new Date().toISOString()
        }).eq('id', periodId).select().single();
        if (error) throw error;
        return this._csPeriod(data);
    }

    async getCsCommissionParticipants(periodId) {
        const { data, error } = await this.db.from('cs_commission_participants').select('*')
            .eq('period_id', periodId).order('created_at');
        if (error) throw error;
        return (data || []).map(r => this._csParticipant(r));
    }

    async getCsHoursForUser(targetUserId, referenceMonthYYYYMM, csProjectNum) {
        const [y, m] = referenceMonthYYYYMM.split('-').map(Number);
        const lastDay = new Date(y, m, 0).getDate();
        const monthStr = `${y}-${String(m).padStart(2, '0')}`;
        const { data, error } = await this.db.from('apontamentos').select('minutes')
            .eq('user_id', targetUserId)
            .eq('project_num', csProjectNum)
            .gte('date', `${monthStr}-01`).lte('date', `${monthStr}-${String(lastDay).padStart(2, '0')}`);
        if (error) throw error;
        const totalMinutes = (data || []).reduce((sum, r) => sum + (parseInt(r.minutes) || 0), 0);
        return totalMinutes / 60;
    }

    async addCsCommissionParticipant(periodId, targetUserId, hoursApontadas) {
        const { data, error } = await this.db.from('cs_commission_participants').insert({
            period_id: periodId, user_id: targetUserId, hours_apontadas: parseFloat(hoursApontadas) || 0
        }).select().single();
        if (error) throw error;
        return this._csParticipant(data);
    }

    async updateCsCommissionParticipantHours(participantId, hoursApontadas) {
        const { data, error } = await this.db.from('cs_commission_participants').update({
            hours_apontadas: parseFloat(hoursApontadas) || 0
        }).eq('id', participantId).select().single();
        if (error) throw error;
        return this._csParticipant(data);
    }

    async removeCsCommissionParticipant(participantId) {
        const { error } = await this.db.from('cs_commission_participants').delete().eq('id', participantId);
        if (error) throw error;
    }

    async getMyCsCommissionForMonth(referenceMonth) {
        const period = await this.getCsCommissionPeriodByMonth(referenceMonth);
        if (!period) return null;
        const { data, error } = await this.db.from('cs_commission_participants').select('*')
            .eq('period_id', period.id).eq('user_id', this.userId).maybeSingle();
        if (error) throw error;
        if (!data) return null;
        return { period, participant: this._csParticipant(data) };
    }
```

- [ ] **Step 2: Checagem de sintaxe**

Run: `node --check js/store.js`
Expected: nenhuma saída.

- [ ] **Step 3: Bump da versão do script no `index.html`**

Modify: `index.html` — trocar `<script src="js/store.js?v=28"></script>` por `<script src="js/store.js?v=29"></script>`.

- [ ] **Step 4: Commit**

```bash
git add js/store.js index.html
git commit -m "feat(cs): métodos de store para períodos e participantes da comissão CS"
```

---

### Task 5: Modal de Cliente — aba "Comissão CS" (estrutura e navegação)

**Files:**
- Modify: `index.html` (tabs do modal-client, novo painel `tab-client-cs`)
- Modify: `js/app.js` (`switchClientModalTab`, novo método `toggleCsProjectTab`, chamada em `openEditClientModal`, reset em `closeModal`)

**Interfaces:**
- Consumes: `store.getCsProjectClient()` (Task 4), `this.userRole` (já existente).
- Produces: `app.toggleCsProjectTab()`; aba `tab-client-cs` navegável via `app.switchClientModalTab('cs')`; propriedade de instância `this.csCommissionMonth` (string `'YYYY-MM'`).

- [ ] **Step 1: Adicionar o botão de aba no HTML**

Modify: `index.html` — dentro de `<div class="modal-tabs" id="modal-client-tabs" ...>`, imediatamente depois do botão `tab-btn-report` (linha 968, fechamento `</button>`), adicionar:

```html
                <button type="button" class="modal-tab" role="tab" aria-selected="false" id="tab-btn-cs" style="display:none;" onclick="app.switchClientModalTab('cs')">
                    <i data-lucide="percent" style="width:14px;height:14px;"></i> Comissão CS
                </button>
```

- [ ] **Step 2: Adicionar o painel no HTML**

Modify: `index.html` — imediatamente depois do fechamento do painel `<!-- Painel: Agendamento -->` `<div id="tab-client-scheduling" ...> ... </div>` (procurar o `</div>` que fecha esse painel, antes do próximo elemento de nível superior do modal), adicionar:

```html
            <!-- Painel: Comissão CS -->
            <div id="tab-client-cs" style="display:none; padding: 0 24px 24px;">
                <div id="client-cs-commission-container">
                    <!-- preenchido via JS -->
                </div>
            </div>
```

- [ ] **Step 3: Implementar `toggleCsProjectTab` em `js/app.js`**

Modify: adicionar imediatamente depois do método `toggleBillingModel()` (linhas 777-780, após seu `}` de fechamento):

```javascript
    toggleCsProjectTab() {
        const btn = document.getElementById('tab-btn-cs');
        if (!btn) return;
        const checked = document.getElementById('client-is-cs-project').checked;
        const clientId = document.getElementById('client-id').value;
        const canShow = checked && !!clientId && this.userRole === 'manager';
        btn.style.display = canShow ? '' : 'none';
    }
```

- [ ] **Step 4: Chamar `toggleCsProjectTab` em `openEditClientModal`**

Modify: `js/app.js` — imediatamente depois da linha adicionada na Task 3 Step 5 (`document.getElementById('client-is-cs-project').checked = !!client.isCsProject;`), adicionar:

```javascript
        this.toggleCsProjectTab();
```

- [ ] **Step 5: Resetar estado da aba no `closeModal`**

Modify: `js/app.js:606-612` — dentro do bloco `if (modalId === 'modal-client') { ... }`, adicionar após a linha `document.getElementById('client-is-cs-project').checked = false;` (Task 3 Step 6):

```javascript
            document.getElementById('tab-btn-cs').style.display = 'none';
            this.csCommissionMonth = null;
            this._csUsersListCache = null;
```

- [ ] **Step 6: Estender `switchClientModalTab` para a nova aba**

Modify: `js/app.js:8855` (`switchClientModalTab`) — trocar a função inteira por:

```javascript
    switchClientModalTab(tab) {
        const dados = document.getElementById('tab-client-dados');
        const sched = document.getElementById('tab-client-scheduling');
        const rep   = document.getElementById('tab-client-report');
        const cs    = document.getElementById('tab-client-cs');
        const btnDados = document.getElementById('tab-btn-dados');
        const btnSched = document.getElementById('tab-btn-scheduling');
        const btnRep   = document.getElementById('tab-btn-report');
        const btnCs    = document.getElementById('tab-btn-cs');
        if (!dados || !sched) return;

        dados.style.display = 'none';
        sched.style.display = 'none';
        if (rep) rep.style.display = 'none';
        if (cs) cs.style.display = 'none';
        [btnDados, btnSched, btnRep, btnCs].forEach(b => {
            if (!b) return;
            b.classList.remove('active');
            b.setAttribute('aria-selected', 'false');
        });

        if (tab === 'scheduling') {
            sched.style.display = 'block';
            btnSched.classList.add('active');
            btnSched.setAttribute('aria-selected', 'true');
            const clientId = document.getElementById('client-id').value;
            if (clientId) this._renderClientSchedulingTab(clientId);
            else {
                document.getElementById('client-scheduling-rules-list').innerHTML =
                    '<p class="text-muted" style="text-align:center;padding:20px 0;">Salve o cliente primeiro para gerenciar regras de agendamento.</p>';
            }
        } else if (tab === 'report') {
            if (rep) rep.style.display = 'block';
            if (btnRep) { btnRep.classList.add('active'); btnRep.setAttribute('aria-selected', 'true'); }
            const clientId = document.getElementById('client-id').value;
            if (clientId) {
                const today = new Date();
                const first = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
                const last  = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];
                const startEl = document.getElementById('report-date-start-inline');
                const endEl   = document.getElementById('report-date-end-inline');
                if (startEl && !startEl.value) startEl.value = first;
                if (endEl   && !endEl.value)   endEl.value   = last;
                this._reportInlineClientId = clientId;
            }
        } else if (tab === 'cs') {
            if (cs) cs.style.display = 'block';
            if (btnCs) { btnCs.classList.add('active'); btnCs.setAttribute('aria-selected', 'true'); }
            if (!this.csCommissionMonth) this.csCommissionMonth = new Date().toISOString().slice(0, 7);
            this._renderCsCommissionPanel();
        } else {
            dados.style.display = '';
```

**Atenção:** o restante da função original (o `else` final e o que vem depois dele, incluindo o corpo completo já existente) deve ser preservado — ler `js/app.js` a partir da linha 8898 em diante antes de editar, para não truncar nenhum código que já existia após o `else`.

- [ ] **Step 7: Checagem de sintaxe**

Run: `node --check js/app.js`
Expected: nenhuma saída.

- [ ] **Step 8: Commit**

```bash
git add js/app.js index.html
git commit -m "feat(cs): aba de Comissão CS no modal de cliente (estrutura e navegação)"
```

---

### Task 6: Modal de Cliente — formulário de valores do período + criação/gestão de participantes

**Files:**
- Modify: `js/app.js` (novo método `_renderCsCommissionPanel` e handlers relacionados)

**Interfaces:**
- Consumes: `store.getCsProjectClient`, `store.getCsCommissionPeriodByMonth`, `store.createCsCommissionPeriod`, `store.updateCsCommissionPeriodValues`, `store.getCsCommissionParticipants`, `store.getCsHoursForUser`, `store.addCsCommissionParticipant`, `store.updateCsCommissionParticipantHours`, `store.removeCsCommissionParticipant` (todos da Task 4); `window.TSPCsCommission.computeConsultantResult` (Task 2); `this._manageUsersFetch('list')` (já existente).
- Produces: `app._renderCsCommissionPanel()`, `app.csCommissionNavMonth(delta)`, `app.createCsCommissionPeriodForMonth()`, `app.saveCsCommissionValues(periodId)`, `app.confirmAddCsParticipant(periodId, csProjectNum)`, `app.updateCsParticipantHoursInline(participantId, value)`, `app.removeCsParticipantRow(btn, participantId)`.

- [ ] **Step 1: Implementar o bloco de métodos**

Modify: `js/app.js` — adicionar imediatamente depois do método `switchClientModalTab` (fim do bloco editado na Task 5, antes do próximo método na classe):

```javascript
    csCommissionNavMonth(delta) {
        const [y, m] = this.csCommissionMonth.split('-').map(Number);
        const d = new Date(y, m - 1 + delta, 1);
        this.csCommissionMonth = d.toISOString().slice(0, 7);
        this._renderCsCommissionPanel();
    }

    async createCsCommissionPeriodForMonth() {
        try {
            await store.createCsCommissionPeriod(`${this.csCommissionMonth}-01`);
            await this._renderCsCommissionPanel();
        } catch (err) {
            Toast.show('Erro ao criar período: ' + err.message, 'error');
        }
    }

    async saveCsCommissionValues(periodId) {
        const cancellations = document.getElementById('cs-cancellations').value;
        const sales = document.getElementById('cs-sales-total').value;
        const increase = document.getElementById('cs-monthly-increase').value;
        try {
            await store.updateCsCommissionPeriodValues(periodId, cancellations, sales, increase);
            await this._renderCsCommissionPanel();
            Toast.show('Valores da comissão CS salvos.', 'success');
        } catch (err) {
            Toast.show('Erro ao salvar: ' + err.message, 'error');
        }
    }

    async confirmAddCsParticipant(periodId, csProjectNum) {
        const select = document.getElementById('cs-add-participant-select');
        const userId = select.value;
        if (!userId) { Toast.show('Selecione um consultor.', 'error'); return; }
        try {
            const hours = await store.getCsHoursForUser(userId, this.csCommissionMonth, csProjectNum);
            await store.addCsCommissionParticipant(periodId, userId, hours);
            await this._renderCsCommissionPanel();
            Toast.show('Consultor adicionado à comissão CS.', 'success');
        } catch (err) {
            Toast.show('Erro ao adicionar participante: ' + err.message, 'error');
        }
    }

    async updateCsParticipantHoursInline(participantId, value) {
        try {
            await store.updateCsCommissionParticipantHours(participantId, value);
            await this._renderCsCommissionPanel();
        } catch (err) {
            Toast.show('Erro ao atualizar horas: ' + err.message, 'error');
        }
    }

    removeCsParticipantRow(btn, participantId) {
        this._twostepDelete(btn, async () => {
            try {
                await store.removeCsCommissionParticipant(participantId);
                await this._renderCsCommissionPanel();
            } catch (err) {
                Toast.show('Erro ao remover participante: ' + err.message, 'error');
            }
        });
    }

    async _renderCsCommissionPanel() {
        const container = document.getElementById('client-cs-commission-container');
        if (!container) return;
        container.innerHTML = spinnerHtml;
        try {
            const referenceMonth = `${this.csCommissionMonth}-01`;
            const csClient = await store.getCsProjectClient();
            if (!csClient) {
                container.innerHTML = '<p class="text-muted" style="padding:16px 0;">Marque este cliente como "Projeto de Comissão CS" e salve antes de gerenciar a comissão.</p>';
                return;
            }

            const [y, m] = this.csCommissionMonth.split('-').map(Number);
            const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
            const monthLabel = `${monthNames[m - 1]} ${y}`;
            const navHtml = `
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:16px;">
                    <button type="button" class="btn btn-ghost" style="padding:6px 10px;" onclick="app.csCommissionNavMonth(-1)"><i data-lucide="chevron-left" style="width:16px;height:16px;"></i></button>
                    <span style="font-weight:600;min-width:120px;text-align:center;">${monthLabel}</span>
                    <button type="button" class="btn btn-ghost" style="padding:6px 10px;" onclick="app.csCommissionNavMonth(1)"><i data-lucide="chevron-right" style="width:16px;height:16px;"></i></button>
                </div>`;

            const period = await store.getCsCommissionPeriodByMonth(referenceMonth);
            if (!period) {
                container.innerHTML = navHtml + `
                    <p class="text-muted" style="padding:16px 0;">Nenhum período cadastrado para ${monthLabel}.</p>
                    <button type="button" class="btn btn-primary" onclick="app.createCsCommissionPeriodForMonth()">Criar período de ${monthLabel}</button>`;
                lucide.createIcons();
                return;
            }

            const participants = await store.getCsCommissionParticipants(period.id);
            if (!this._csUsersListCache) {
                const result = await this._manageUsersFetch('list');
                this._csUsersListCache = result.users.filter(u => u.role === 'consultant' || u.role === 'manager');
            }
            const usersList = this._csUsersListCache;
            const emailByUserId = {};
            usersList.forEach(u => { emailByUserId[u.userId] = u.email; });
            const availableUsers = usersList.filter(u => !participants.some(p => p.userId === u.userId));

            const fmt = v => `R$ ${v.toFixed(2).replace('.', ',')}`;
            const rowsHtml = participants.map(p => {
                const result = TSPCsCommission.computeConsultantResult(
                    p.hoursApontadas, period.participantCount, period.cancellationsCount,
                    period.salesTotal, period.monthlyIncreaseTotal);
                return `
                    <tr>
                        <td>${escapeHtml(emailByUserId[p.userId] || p.userId)}</td>
                        <td><input type="number" step="0.01" min="0" value="${p.hoursApontadas}" class="form-control" style="width:90px;" onchange="app.updateCsParticipantHoursInline('${p.id}', this.value)"></td>
                        <td>${(result.percentual * 100).toFixed(1)}%</td>
                        <td>${fmt(result.bonus)}</td>
                        <td>${fmt(result.comissaoVendas)}</td>
                        <td>${fmt(result.comissaoMensalidade)}</td>
                        <td><strong>${fmt(result.total)}</strong></td>
                        <td><button type="button" class="btn btn-danger btn-sm" onclick="app.removeCsParticipantRow(this, '${p.id}')"><i data-lucide="trash-2" style="width:13px;height:13px;"></i></button></td>
                    </tr>`;
            }).join('');

            container.innerHTML = navHtml + `
                <div style="display:flex; gap:16px; margin-bottom:16px;">
                    <div class="form-group" style="flex:1;">
                        <label for="cs-cancellations">Cancelamentos no mês</label>
                        <input type="number" min="0" step="1" id="cs-cancellations" class="form-control" value="${period.cancellationsCount}">
                    </div>
                    <div class="form-group" style="flex:1;">
                        <label for="cs-sales-total">Valor total vendido (R$)</label>
                        <input type="number" step="0.01" id="cs-sales-total" class="form-control money-value" value="${period.salesTotal}">
                    </div>
                    <div class="form-group" style="flex:1;">
                        <label for="cs-monthly-increase">Acréscimo de mensalidade (R$)</label>
                        <input type="number" step="0.01" id="cs-monthly-increase" class="form-control money-value" value="${period.monthlyIncreaseTotal}">
                    </div>
                </div>
                <button type="button" class="btn btn-secondary" style="margin-bottom:16px;" onclick="app.saveCsCommissionValues('${period.id}')">Salvar valores do mês</button>

                <div style="display:flex; gap:8px; align-items:flex-end; margin-bottom:12px;">
                    <div class="form-group" style="flex:1; margin-bottom:0;">
                        <label for="cs-add-participant-select">Adicionar consultor</label>
                        <select id="cs-add-participant-select" class="form-control">
                            <option value="">Selecione...</option>
                            ${availableUsers.map(u => `<option value="${u.userId}">${escapeHtml(u.email)}</option>`).join('')}
                        </select>
                    </div>
                    <button type="button" class="btn btn-primary" onclick="app.confirmAddCsParticipant('${period.id}', '${csClient.projectNum}')">
                        <i data-lucide="plus"></i> Adicionar
                    </button>
                </div>

                <div style="overflow-x:auto;">
                <table class="data-table">
                    <thead><tr><th>Consultor</th><th>Horas</th><th>%</th><th>Bônus</th><th>Com. Vendas</th><th>Com. Mensalidade</th><th>Total</th><th></th></tr></thead>
                    <tbody>${rowsHtml || '<tr><td colspan="8" class="text-muted">Nenhum participante neste mês.</td></tr>'}</tbody>
                </table>
                </div>`;
            lucide.createIcons();
        } catch (err) {
            container.innerHTML = `<p class="text-muted">Erro ao carregar comissão CS: ${escapeHtml(err.message)}</p>`;
        }
    }
```

- [ ] **Step 2: Checagem de sintaxe**

Run: `node --check js/app.js`
Expected: nenhuma saída.

- [ ] **Step 3: Bump da versão do script no `index.html`**

Modify: `index.html` — trocar `<script src="js/app.js?v=42"></script>` por `<script src="js/app.js?v=43"></script>`.

- [ ] **Step 4: Commit**

```bash
git add js/app.js index.html
git commit -m "feat(cs): formulário de valores do período e gestão de participantes no modal de cliente"
```

---

### Task 7: View Financeiro — linha "Comissão CS" com tooltip e soma no total

**Files:**
- Modify: `js/app.js:6842-6899` (`renderFinanceiro`)

**Interfaces:**
- Consumes: `store.getMyCsCommissionForMonth` (Task 4), `TSPCsCommission.computeConsultantResult` (Task 2).
- Produces: nenhuma nova função pública — altera apenas o corpo de `renderFinanceiro()`.

- [ ] **Step 1: Substituir `renderFinanceiro` por completo**

Modify: `js/app.js:6842-6899` — trocar toda a função por:

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
            const referenceMonth = `${this.financeiroYear}-${String(this.financeiroMonth).padStart(2, '0')}-01`;
            const [summary, history, myCs] = await Promise.all([
                store.getFinancialSummary(this.financeiroYear, this.financeiroMonth),
                store.getFinancialHistory(12, this.financeiroHistEndYear, this.financeiroHistEndMonth),
                store.getMyCsCommissionForMonth(referenceMonth).catch(() => null)
            ]);
            this._financeiroSummary = summary;
            this._financeiroHistory = history;

            const formatMoney = (val) => (val && !isNaN(val)) ? `R$ ${parseFloat(val).toFixed(2).replace('.', ',')}` : 'R$ 0,00';

            let csRowHtml = '';
            let csTotal = 0;
            if (myCs) {
                const result = TSPCsCommission.computeConsultantResult(
                    myCs.participant.hoursApontadas, myCs.period.participantCount,
                    myCs.period.cancellationsCount, myCs.period.salesTotal, myCs.period.monthlyIncreaseTotal);
                csTotal = result.total;
                const detailText = `${myCs.participant.hoursApontadas.toFixed(1)}h (${(result.percentual * 100).toFixed(1)}%) · Bônus ${formatMoney(result.bonus)} · Vendas ${formatMoney(result.comissaoVendas)} · Mensalidade ${formatMoney(result.comissaoMensalidade)}`;
                csRowHtml = `
                    <tr>
                        <td>Comissão CS
                            <span class="info-tooltip" tabindex="0" aria-label="Detalhamento da comissão CS" aria-describedby="tooltip-cs-financeiro">
                                <i data-lucide="info" style="width: 14px; height: 14px; color: var(--primary-color); margin-left:4px; vertical-align:middle;"></i>
                                <span class="info-tooltip-text" id="tooltip-cs-financeiro" role="tooltip">${escapeHtml(detailText)}</span>
                            </span>
                        </td>
                        <td>—</td>
                        <td>—</td>
                        <td>—</td>
                        <td><span class="money-value">${formatMoney(csTotal)}</span></td>
                    </tr>`;
            }

            const itemsHtml = summary.items.map(({ client, valor, comissao, detalhe }) => {
                const modelo = client.billingModel === 'hourly' ? 'Por Hora' : 'Fixo';
                const detalheStr = detalhe ? `${detalhe.horas.toFixed(1)}h × ${formatMoney(detalhe.rate)}` : '—';
                const comissaoStr = client.billingModel === 'hourly' ? `<span class="money-value">${formatMoney(valor)}</span>` : `<span class="money-value">${formatMoney(comissao)}</span>`;
                return `
                    <tr>
                        <td>${escapeHtml(client.name)}</td>
                        <td>${modelo}</td>
                        <td>${detalheStr}</td>
                        <td><span class="money-value">${formatMoney(valor)}</span></td>
                        <td>${comissaoStr}</td>
                    </tr>`;
            }).join('');

            const combinedHtml = itemsHtml + csRowHtml;
            tbody.innerHTML = combinedHtml || `<tr><td colspan="5" class="text-muted">Nenhum cliente elegível neste mês.</td></tr>`;

            const grandTotalComissao = summary.totalComissao + csTotal;
            tfoot.innerHTML = `
                <tr style="font-weight:600;">
                    <td colspan="3">Total</td>
                    <td><span class="money-value">${formatMoney(summary.totalValor)}</span></td>
                    <td><span class="money-value">${formatMoney(grandTotalComissao)}</span></td>
                </tr>`;

            chartContainer.innerHTML = '';
            chartContainer.appendChild(this._buildFinanceiroChart(history));
            lucide.createIcons();
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-muted">Erro ao carregar: ${escapeHtml(err.message)}</td></tr>`;
            chartContainer.innerHTML = '';
        }
    }
```

- [ ] **Step 2: Checagem de sintaxe**

Run: `node --check js/app.js`
Expected: nenhuma saída.

- [ ] **Step 3: Commit**

```bash
git add js/app.js
git commit -m "feat(cs): linha de Comissão CS na view Financeiro"
```

---

### Task 8: Verificação end-to-end e deploy

**Files:**
- Nenhum arquivo novo — apenas verificação manual e push.

**Interfaces:**
- Consumes: tudo das Tasks 1-7.
- Produces: confirmação de que a feature funciona em produção.

- [ ] **Step 1: Rodar os testes do módulo de cálculo uma última vez**

Run: `node tests/cs-commission-calc.test.js` e `node tests/financial-calc.test.js`
Expected: `TODOS OS TESTES PASSARAM` nos dois.

- [ ] **Step 2: Push para o GitHub**

```powershell
$git = (Get-ChildItem "C:\Users\jorge\AppData\Local\GitHubDesktop" -Directory -Filter "app-*" | Sort-Object Name -Descending | Select-Object -First 1).FullName + "\resources\app\git\cmd\git.exe"
& $git push origin main
```

- [ ] **Step 3: Avisar o usuário para fazer o deploy manual no Easypanel**

O webhook de deploy automático está quebrado (documentado em `CLAUDE.md`) — pedir para o usuário abrir o Easypanel e disparar o deploy manualmente antes do próximo passo.

- [ ] **Step 4: Roteiro de verificação manual em produção (login como Gerente — `testes@teste.com` / `123testes`, ou a conta real de Jorge)**

1. Criar/editar um cliente, marcar "Este é o projeto de Comissão CS", informar um número de projeto, salvar.
2. Reabrir esse mesmo cliente — a aba "Comissão CS" deve aparecer.
3. Na aba, criar o período do mês atual, informar cancelamentos = 0, vendas = 24444, mensalidade = 2362.
4. Adicionar 2-3 consultores como participantes; confirmar que as horas vêm pré-calculadas (0 se não houver apontamentos com aquele project_num) e são editáveis.
5. Confirmar que a grade mostra %, bônus, comissão de vendas, comissão de mensalidade e total corretos para cada linha (comparar com os exemplos da spec: 15h/3 participantes/sem cancelamento → total R$ 1.608,47).
6. Abrir a view Financeiro logado como um dos consultores participantes — confirmar que a linha "Comissão CS" aparece, o tooltip ⓘ mostra o detalhamento, e o total geral da coluna "Comissão consultor" inclui esse valor.
7. Logar como um consultor que NÃO foi adicionado como participante naquele mês — confirmar que a linha "Comissão CS" não aparece em Financeiro.
8. Confirmar que um consultor comum (não Gerente) não vê a aba "Comissão CS" ao abrir o cliente administrativo (mesmo que consiga abri-lo, o que só ocorre se ele for o dono — o botão da aba deve ficar oculto).

- [ ] **Step 5: Atualizar o `CLAUDE.md` com a nova fase**

Adicionar entrada na tabela de fases implementadas e, se necessário, uma seção de "armadilhas conhecidas" com qualquer comportamento não-óbvio descoberto durante a verificação manual (ex.: se algum passo do roteiro acima revelar um comportamento surpreendente).

- [ ] **Step 6: Commit final (se houver alterações no CLAUDE.md)**

```bash
git add CLAUDE.md
git commit -m "docs: documenta a feature de Comissão CS no CLAUDE.md"
git push origin main
```

---

## Self-Review

**Cobertura da spec:** bônus por cancelamento (Task 2/6), horas automáticas com override manual (Task 4/6), comissão de vendas e mensalidade (Task 2), divisão em duas etapas (Task 2), total final (Task 2/6/7), cadastro de participantes variável por mês (Task 4/6), RLS assimétrica Gerente/consultor (Task 1), integração com Financeiro (Task 7), campo `is_cs_project` no cliente (Task 3) — todas as seções da spec têm task correspondente.

**Placeholders:** nenhum "TBD"/"implementar depois" — todo código está completo e executável, exceto o aviso explícito na Task 5 Step 6 de preservar código pré-existente (não é um placeholder, é uma instrução de cautela ao editar uma função grande).

**Consistência de tipos:** `referenceMonth` é sempre string `'YYYY-MM-DD'` nos métodos de store (`getCsCommissionPeriodByMonth`, `createCsCommissionPeriod`, `getMyCsCommissionForMonth`) e `'YYYY-MM'` em `this.csCommissionMonth`/`getCsHoursForUser` (nome do parâmetro reflete isso: `referenceMonthYYYYMM`) — checado em todas as chamadas cruzadas entre Tasks 4, 6 e 7.
