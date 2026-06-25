# Cobrança "Por Hora" por Cliente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que um cliente seja cobrado "Por Hora" (valor/hora × horas apontadas no mês) como alternativa ao modelo "Valor Fixo" atual, sem afetar nenhum cliente existente.

**Architecture:** Adiciona 2 colunas (`billing_model`, `hourly_rate`) à tabela `clients`. Um radio toggle no modal de Cliente alterna entre os dois blocos de campos. O cálculo (`hoursUsed × hourlyRate`) é feito em memória na renderização (`renderClients()`, `renderDashboard()`), reaproveitando o `hoursUsed` que `getBatchStats()`/`getClientStats()` já calculam — zero queries extras.

**Tech Stack:** JavaScript ES6+ vanilla (sem build step), Supabase (Postgres + RLS), HTML5, Playwright para verificação E2E contra produção.

## Global Constraints

- Nenhuma mudança de comportamento para clientes existentes — `billing_model` tem `DEFAULT 'fixed'`.
- Modelo "Por Hora" não calcula comissão (43% / bônus) — apenas o valor total faturado.
- Fonte das horas: apenas tabela `records` (Atendimentos), mês atual — mesmo `hoursUsed` já usado em `_computeClientStats`.
- Não introduzir refactor do parâmetro posicional de `addClient`/`updateClient` para objeto — manter convenção posicional existente, anexando os 2 novos parâmetros ao final da lista.
- Não alterar a função de migração legada de localStorage (`js/app.js` ~linha 5591) — já está fora de escopo e desalinhada antes desta feature.
- Todo valor monetário novo usa `class="money-value"` para respeitar o toggle de ocultar dinheiro (`sessionStorage.moneyHidden`).
- Este projeto não tem login funcional em `localhost` (Supabase Auth não autentica fora do domínio de produção) — qualquer verificação interativa de UI precisa ser feita após deploy, contra `https://jorge-gerenciador-tsp.27pl2o.easypanel.host`.
- Deploy é sempre manual no Easypanel (webhook quebrado) — avisar o usuário antes de pedir para ele rodar o deploy.

---

### Task 1: Migration SQL no Supabase

**Files:**
- Nenhum arquivo de código — execução manual no Supabase SQL Editor (projeto `klimkamnydfnzqetqlqm`).

**Interfaces:**
- Produz: colunas `clients.billing_model TEXT DEFAULT 'fixed'` e `clients.hourly_rate NUMERIC DEFAULT 0`, consumidas por todas as tarefas seguintes.

- [ ] **Step 1: Apresentar a migration ao usuário e pedir confirmação antes de rodar**

Esta é uma alteração de schema em banco de produção (sem ambiente de staging). Mostrar a SQL abaixo ao usuário e pedir confirmação explícita antes de executar (via Supabase SQL Editor, manualmente, ou via API de management se o usuário autorizar):

```sql
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS billing_model TEXT DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC DEFAULT 0;
```

- [ ] **Step 2: Rodar a migration (Supabase SQL Editor)**

Acessar https://supabase.com/dashboard/project/klimkamnydfnzqetqlqm/sql/new, colar a SQL do Step 1 e executar.

- [ ] **Step 3: Verificar que as colunas existem**

Rodar no mesmo SQL Editor:

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'clients' AND column_name IN ('billing_model', 'hourly_rate');
```

Esperado: 2 linhas — `billing_model` (`text`, default `'fixed'::text`) e `hourly_rate` (`numeric`, default `0`).

- [ ] **Step 4: Verificar que clientes existentes não foram afetados**

```sql
SELECT id, name, billing_model, hourly_rate FROM clients LIMIT 5;
```

Esperado: `billing_model = 'fixed'` e `hourly_rate = 0` em todas as linhas existentes.

(Nenhum commit neste task — é uma alteração de infraestrutura, não de código.)

---

### Task 2: `js/store.js` — mapper e CRUD de cliente

**Files:**
- Modify: `js/store.js:7-17` (`_client()`)
- Modify: `js/store.js:97-110` (`addClient()`)
- Modify: `js/store.js:112-124` (`updateClient()`)

**Interfaces:**
- Consome: colunas `billing_model`/`hourly_rate` da Task 1.
- Produz: `client.billingModel` (`'fixed'` | `'hourly'`) e `client.hourlyRate` (number) em todo objeto client retornado pelo store; `addClient(..., billingModel, hourlyRate)` e `updateClient(..., billingModel, hourlyRate)` aceitam os 2 novos parâmetros como últimos da lista posicional.

- [ ] **Step 1: Atualizar o mapper `_client()`**

Em `js/store.js`, substituir:

```js
    _client(r) {
        return { id: r.id, name: r.name, hoursTotal: parseFloat(r.hours_total) || 0,
            csName: r.cs_name || '', projectNum: r.project_num || '',
            clientPays: parseFloat(r.client_pays) || 0,
            consultantBonus: parseFloat(r.consultant_bonus) || 0,
            notes: r.notes || '', status: r.status || 'active',
            initialBalanceMinutes: parseInt(r.initial_balance_minutes) || 0,
            balanceStartDate: r.balance_start_date || null,
            otoboCustomerId: r.otobo_customer_id || '',
            createdAt: r.created_at };
    }
```

por:

```js
    _client(r) {
        return { id: r.id, name: r.name, hoursTotal: parseFloat(r.hours_total) || 0,
            csName: r.cs_name || '', projectNum: r.project_num || '',
            clientPays: parseFloat(r.client_pays) || 0,
            consultantBonus: parseFloat(r.consultant_bonus) || 0,
            billingModel: r.billing_model || 'fixed',
            hourlyRate: parseFloat(r.hourly_rate) || 0,
            notes: r.notes || '', status: r.status || 'active',
            initialBalanceMinutes: parseInt(r.initial_balance_minutes) || 0,
            balanceStartDate: r.balance_start_date || null,
            otoboCustomerId: r.otobo_customer_id || '',
            createdAt: r.created_at };
    }
```

- [ ] **Step 2: Atualizar `addClient()`**

Substituir:

```js
    async addClient(name, hoursTotal, csName, projectNum, clientPays, consultantBonus, notes, status, initialBalanceMinutes, balanceStartDate, otoboCustomerId) {
        const { data, error } = await this.db.from('clients').insert({
            user_id: this.userId, name,
            hours_total: parseFloat(hoursTotal) || 0, cs_name: csName || '',
            project_num: projectNum || '', client_pays: parseFloat(clientPays) || 0,
            consultant_bonus: parseFloat(consultantBonus) || 0,
            notes: notes || '', status: status || 'active',
            initial_balance_minutes: parseInt(initialBalanceMinutes) || 0,
            balance_start_date: balanceStartDate || null,
            otobo_customer_id: otoboCustomerId || null
        }).select().single();
        if (error) throw error;
        return this._client(data);
    }
```

por:

```js
    async addClient(name, hoursTotal, csName, projectNum, clientPays, consultantBonus, notes, status, initialBalanceMinutes, balanceStartDate, otoboCustomerId, billingModel, hourlyRate) {
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
            hourly_rate: parseFloat(hourlyRate) || 0
        }).select().single();
        if (error) throw error;
        return this._client(data);
    }
```

- [ ] **Step 3: Atualizar `updateClient()`**

Substituir:

```js
    async updateClient(id, name, hoursTotal, csName, projectNum, clientPays, consultantBonus, notes, status, initialBalanceMinutes, balanceStartDate, otoboCustomerId) {
        const { data, error } = await this.db.from('clients').update({
            name, hours_total: parseFloat(hoursTotal) || 0, cs_name: csName || '',
            project_num: projectNum || '', client_pays: parseFloat(clientPays) || 0,
            consultant_bonus: parseFloat(consultantBonus) || 0,
            notes: notes || '', status: status || 'active',
            initial_balance_minutes: parseInt(initialBalanceMinutes) || 0,
            balance_start_date: balanceStartDate || null,
            otobo_customer_id: otoboCustomerId || null
        }).eq('id', id).select().single();
        if (error) throw error;
        return this._client(data);
    }
```

por:

```js
    async updateClient(id, name, hoursTotal, csName, projectNum, clientPays, consultantBonus, notes, status, initialBalanceMinutes, balanceStartDate, otoboCustomerId, billingModel, hourlyRate) {
        const { data, error } = await this.db.from('clients').update({
            name, hours_total: parseFloat(hoursTotal) || 0, cs_name: csName || '',
            project_num: projectNum || '', client_pays: parseFloat(clientPays) || 0,
            consultant_bonus: parseFloat(consultantBonus) || 0,
            notes: notes || '', status: status || 'active',
            initial_balance_minutes: parseInt(initialBalanceMinutes) || 0,
            balance_start_date: balanceStartDate || null,
            otobo_customer_id: otoboCustomerId || null,
            billing_model: billingModel || 'fixed',
            hourly_rate: parseFloat(hourlyRate) || 0
        }).eq('id', id).select().single();
        if (error) throw error;
        return this._client(data);
    }
```

- [ ] **Step 4: Verificar sintaxe**

Run: `node --check js/store.js`
Expected: nenhuma saída (sintaxe válida).

- [ ] **Step 5: Commit**

```bash
git add js/store.js
git commit -m "feat: adiciona billing_model e hourly_rate ao store de clientes"
```

---

### Task 3: `index.html` — toggle de modelo de cobrança no modal de Cliente

**Files:**
- Modify: `index.html:792-823`

**Interfaces:**
- Consome: nenhuma (HTML puro).
- Produz: elementos `#field-client-pays`, `#billing-model-fixed`, `#billing-model-hourly`, `#field-hourly-rate`, `#client-hourly-rate`, `#row-consultant-fields` — todos consumidos por `toggleBillingModel()` na Task 4.

- [ ] **Step 1: Substituir o bloco de campos de valores do modal de cliente**

Em `index.html`, localizar o bloco que vai de `Status`/`Cliente Paga (R$)` até o fechamento da linha de `Total Consultor` (linhas 792–823):

```html
                <div style="display: flex; gap: 16px;">
                    <div class="form-group" style="flex: 1;">
                        <label>Status</label>
                        <select id="client-status" class="form-control" required>
                            <option value="active" selected>Ativo</option>
                            <option value="finished">Finalizado</option>
                        </select>
                    </div>
                    <div class="form-group" style="flex: 1;">
                        <label>Cliente Paga (R$)</label>
                        <input type="number" step="0.01" id="client-pays" class="form-control money-value" placeholder="Ex: 5000" oninput="app.calculateConsultantValue()">
                    </div>
                </div>

                <div style="display: flex; gap: 16px; align-items: flex-end; margin-bottom: 16px;">
                    <div class="form-group" style="flex: 1; margin-bottom: 0;">
                        <label style="white-space: nowrap;">Recebe 43%</label>
                        <input type="text" id="consultant-receives" class="form-control money-value"
                            style="background: rgba(0,0,0,0.2); cursor: not-allowed; color: var(--primary-color); font-weight: bold;"
                            readonly>
                    </div>
                    <div class="form-group" style="flex: 1; margin-bottom: 0;">
                        <label style="white-space: nowrap;">Valor Adicional (R$)</label>
                        <input type="number" step="0.01" id="consultant-bonus" class="form-control money-value" placeholder="Ex: 500" oninput="app.calculateConsultantValue()">
                    </div>
                    <div class="form-group" style="flex: 1; margin-bottom: 0;">
                        <label style="white-space: nowrap;">Total Consultor</label>
                        <input type="text" id="consultant-total" class="form-control money-value"
                            style="background: rgba(0,0,0,0.2); cursor: not-allowed; color: #4ade80; font-weight: bold;"
                            readonly>
                    </div>
                </div>
```

por:

```html
                <div style="display: flex; gap: 16px;">
                    <div class="form-group" style="flex: 1;">
                        <label>Status</label>
                        <select id="client-status" class="form-control" required>
                            <option value="active" selected>Ativo</option>
                            <option value="finished">Finalizado</option>
                        </select>
                    </div>
                    <div class="form-group" style="flex: 1;" id="field-client-pays">
                        <label>Cliente Paga (R$)</label>
                        <input type="number" step="0.01" id="client-pays" class="form-control money-value" placeholder="Ex: 5000" oninput="app.calculateConsultantValue()">
                    </div>
                </div>

                <div class="form-group">
                    <label>Modelo de Cobrança</label>
                    <div style="display: flex; gap: 20px; margin-top: 6px;">
                        <label style="display: flex; align-items: center; gap: 6px; font-weight: normal; cursor: pointer;">
                            <input type="radio" name="client-billing-model" id="billing-model-fixed" value="fixed" checked onchange="app.toggleBillingModel()">
                            Valor Fixo
                        </label>
                        <label style="display: flex; align-items: center; gap: 6px; font-weight: normal; cursor: pointer;">
                            <input type="radio" name="client-billing-model" id="billing-model-hourly" value="hourly" onchange="app.toggleBillingModel()">
                            Por Hora
                        </label>
                    </div>
                </div>

                <div class="form-group" id="field-hourly-rate" style="display: none;">
                    <label>Valor por Hora (R$)</label>
                    <input type="number" step="0.01" id="client-hourly-rate" class="form-control money-value" placeholder="Ex: 150">
                </div>

                <div style="display: flex; gap: 16px; align-items: flex-end; margin-bottom: 16px;" id="row-consultant-fields">
                    <div class="form-group" style="flex: 1; margin-bottom: 0;">
                        <label style="white-space: nowrap;">Recebe 43%</label>
                        <input type="text" id="consultant-receives" class="form-control money-value"
                            style="background: rgba(0,0,0,0.2); cursor: not-allowed; color: var(--primary-color); font-weight: bold;"
                            readonly>
                    </div>
                    <div class="form-group" style="flex: 1; margin-bottom: 0;">
                        <label style="white-space: nowrap;">Valor Adicional (R$)</label>
                        <input type="number" step="0.01" id="consultant-bonus" class="form-control money-value" placeholder="Ex: 500" oninput="app.calculateConsultantValue()">
                    </div>
                    <div class="form-group" style="flex: 1; margin-bottom: 0;">
                        <label style="white-space: nowrap;">Total Consultor</label>
                        <input type="text" id="consultant-total" class="form-control money-value"
                            style="background: rgba(0,0,0,0.2); cursor: not-allowed; color: #4ade80; font-weight: bold;"
                            readonly>
                    </div>
                </div>
```

- [ ] **Step 2: Verificar que os IDs novos aparecem exatamente uma vez**

Run (PowerShell):
```powershell
Select-String -Path index.html -Pattern 'field-client-pays|billing-model-fixed|billing-model-hourly|field-hourly-rate|client-hourly-rate|row-consultant-fields' | Measure-Object | Select-Object Count
```
Expected: `Count` deve refletir 1 ocorrência de cada um dos 6 IDs (id + qualquer referência futura ainda não criada — nesta task, 6 ocorrências no total).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: adiciona toggle de modelo de cobranca no modal de cliente"
```

---

### Task 4: `js/app.js` — `toggleBillingModel()`, submit e edição do modal

**Files:**
- Modify: `js/app.js:430-447` (`closeModal`, bloco `modal-client`)
- Modify: `js/app.js:544-587` (`handleClientSubmit`)
- Modify: `js/app.js:589-604` (logo após `calculateConsultantValue()`, novo método)
- Modify: `js/app.js:2338-2359` (`openEditClientModal`)

**Interfaces:**
- Consome: elementos HTML da Task 3 (`#billing-model-fixed`, `#billing-model-hourly`, `#field-client-pays`, `#field-hourly-rate`, `#row-consultant-fields`, `#client-hourly-rate`); `store.addClient`/`store.updateClient` da Task 2.
- Produz: `app.toggleBillingModel()` — usado pelos radios no `onchange` (Task 3) e chamado internamente em `openEditClientModal()` e `closeModal('modal-client')`.

- [ ] **Step 1: Adicionar `toggleBillingModel()` logo após `calculateConsultantValue()`**

Em `js/app.js`, localizar o fim de `calculateConsultantValue()`:

```js
    calculateConsultantValue() {
        const inputPays = document.getElementById('client-pays').value;
        const inputBonus = document.getElementById('consultant-bonus').value;
        const inputReceives = document.getElementById('consultant-receives');
        const inputTotal = document.getElementById('consultant-total');
        const fmt = v => `R$ ${v.toFixed(2).replace('.', ',')}`;
        if (inputPays && !isNaN(inputPays)) {
            const base = parseFloat(inputPays) * 0.43;
            const bonus = (inputBonus && !isNaN(inputBonus)) ? parseFloat(inputBonus) : 0;
            inputReceives.value = fmt(base);
            inputTotal.value = fmt(base + bonus);
        } else {
            inputReceives.value = '';
            inputTotal.value = '';
        }
    }
```

Inserir imediatamente depois (antes de `onCentesimalToggle()`):

```js

    toggleBillingModel() {
        const isHourly = document.getElementById('billing-model-hourly').checked;
        document.getElementById('field-client-pays').style.display = isHourly ? 'none' : '';
        document.getElementById('row-consultant-fields').style.display = isHourly ? 'none' : '';
        document.getElementById('field-hourly-rate').style.display = isHourly ? '' : 'none';
    }
```

- [ ] **Step 2: Ler o modelo de cobrança em `handleClientSubmit()`**

Substituir:

```js
        const clientPays = document.getElementById('client-pays').value;
        const consultantBonus = document.getElementById('consultant-bonus').value;
```

por:

```js
        const clientPays = document.getElementById('client-pays').value;
        const consultantBonus = document.getElementById('consultant-bonus').value;
        const billingModel = document.getElementById('billing-model-hourly').checked ? 'hourly' : 'fixed';
        const hourlyRate = document.getElementById('client-hourly-rate').value;
```

- [ ] **Step 3: Passar os novos parâmetros para `store.addClient`/`store.updateClient`**

Substituir:

```js
            if (id) {
                await store.updateClient(id, name, hours, csName, projectNum, clientPays, consultantBonus, notes, status, initialBalanceMinutes, balanceStartDate || null, otoboCustomerId || null);
            } else {
                await store.addClient(name, hours, csName, projectNum, clientPays, consultantBonus, notes, status, initialBalanceMinutes, balanceStartDate || null, otoboCustomerId || null);
            }
```

por:

```js
            if (id) {
                await store.updateClient(id, name, hours, csName, projectNum, clientPays, consultantBonus, notes, status, initialBalanceMinutes, balanceStartDate || null, otoboCustomerId || null, billingModel, hourlyRate);
            } else {
                await store.addClient(name, hours, csName, projectNum, clientPays, consultantBonus, notes, status, initialBalanceMinutes, balanceStartDate || null, otoboCustomerId || null, billingModel, hourlyRate);
            }
```

- [ ] **Step 4: Popular o toggle e o campo de valor/hora em `openEditClientModal()`**

Substituir:

```js
        document.getElementById('client-pays').value = client.clientPays || '';
        document.getElementById('consultant-bonus').value = client.consultantBonus || '';
        document.getElementById('client-notes').value = client.notes || '';
```

por:

```js
        document.getElementById('client-pays').value = client.clientPays || '';
        document.getElementById('consultant-bonus').value = client.consultantBonus || '';
        document.getElementById('client-hourly-rate').value = client.hourlyRate || '';
        document.getElementById('billing-model-hourly').checked = client.billingModel === 'hourly';
        document.getElementById('billing-model-fixed').checked = client.billingModel !== 'hourly';
        this.toggleBillingModel();
        document.getElementById('client-notes').value = client.notes || '';
```

- [ ] **Step 5: Sincronizar a visibilidade ao fechar/resetar o modal**

Em `closeModal()`, localizar o bloco:

```js
        if (modalId === 'modal-client') {
            document.getElementById('form-client').reset();
            document.getElementById('client-id').value = '';
            document.getElementById('modal-client-title').innerText = 'Novo Cliente';
            this.switchClientModalTab('dados');
        }
```

e substituir por:

```js
        if (modalId === 'modal-client') {
            document.getElementById('form-client').reset();
            document.getElementById('client-id').value = '';
            document.getElementById('modal-client-title').innerText = 'Novo Cliente';
            this.switchClientModalTab('dados');
            this.toggleBillingModel();
        }
```

(`form.reset()` restaura o radio "Valor Fixo" marcado por padrão, mas não desfaz os `style.display` setados via JS — `toggleBillingModel()` sincroniza isso.)

- [ ] **Step 6: Verificar sintaxe**

Run: `node --check js/app.js`
Expected: nenhuma saída (sintaxe válida).

- [ ] **Step 7: Commit**

```bash
git add js/app.js
git commit -m "feat: adiciona toggleBillingModel e wiring do modal de cliente"
```

---

### Task 5: `renderClients()` — exibir valor/hora e faturado no mês

**Files:**
- Modify: `js/app.js:2297-2314` (dentro de `renderClients()`)

**Interfaces:**
- Consome: `c.billingModel`, `c.hourlyRate` (Task 2); `stat.hoursUsed` (já existente em `_computeClientStats`, sem mudança).
- Produz: nenhuma interface nova — é a camada final de apresentação.

- [ ] **Step 1: Substituir o cálculo e o `detailsHtml` dentro do `forEach`**

Em `renderClients()`, substituir:

```js
            const clientPaysStr = formatMoney(c.clientPays);
            const base43 = (c.clientPays && !isNaN(c.clientPays)) ? c.clientPays * 0.43 : 0;
            const bonus = c.consultantBonus || 0;
            const totalConsultant = base43 + bonus;
            const consultantReceives = formatMoney(totalConsultant);
            const detailsHtml = `
                <div style="font-size: 0.85rem; margin-top: 4px; color: var(--text-muted)">
                    <span><strong>CS:</strong> ${escapeHtml(c.csName) || '-'}</span> |
                    <span><strong>Proj:</strong> ${escapeHtml(c.projectNum) || '-'}</span> <br>
                    <span><strong>Paga:</strong> <span class="money-value">${clientPaysStr}</span></span> |
                    <span><strong>Recebe:</strong> <span class="money-value">${consultantReceives}</span></span>${bonus > 0 ? ` <span class="money-value" style="color: #4ade80; font-size:0.8rem">(+R$ ${bonus.toFixed(2).replace('.',',')} adicional)</span>` : ''}
                    <div style="margin-top:2px; font-style:italic; font-size: 0.8rem">Obs: ${escapeHtml(c.notes) || '-'}</div>
                </div>
            `;
```

por:

```js
            const isHourlyBilling = c.billingModel === 'hourly';
            const hoursUsedThisMonth = stat ? stat.hoursUsed : 0;

            let billingLineHtml;
            if (isHourlyBilling) {
                const hourlyRateStr = formatMoney(c.hourlyRate);
                const monthlyValueStr = formatMoney(hoursUsedThisMonth * (c.hourlyRate || 0));
                billingLineHtml = `
                    <span><strong>Valor/hora:</strong> <span class="money-value">${hourlyRateStr}</span></span> |
                    <span><strong>Faturado no mês:</strong> <span class="money-value">${monthlyValueStr}</span></span>
                    <span class="text-muted" style="font-size:0.8rem">(${hoursUsedThisMonth.toFixed(1)}h apontadas)</span>`;
            } else {
                const clientPaysStr = formatMoney(c.clientPays);
                const base43 = (c.clientPays && !isNaN(c.clientPays)) ? c.clientPays * 0.43 : 0;
                const bonus = c.consultantBonus || 0;
                const consultantReceives = formatMoney(base43 + bonus);
                billingLineHtml = `
                    <span><strong>Paga:</strong> <span class="money-value">${clientPaysStr}</span></span> |
                    <span><strong>Recebe:</strong> <span class="money-value">${consultantReceives}</span></span>${bonus > 0 ? ` <span class="money-value" style="color: #4ade80; font-size:0.8rem">(+R$ ${bonus.toFixed(2).replace('.',',')} adicional)</span>` : ''}`;
            }

            const detailsHtml = `
                <div style="font-size: 0.85rem; margin-top: 4px; color: var(--text-muted)">
                    <span><strong>CS:</strong> ${escapeHtml(c.csName) || '-'}</span> |
                    <span><strong>Proj:</strong> ${escapeHtml(c.projectNum) || '-'}</span> <br>
                    ${billingLineHtml}
                    <div style="margin-top:2px; font-style:italic; font-size: 0.8rem">Obs: ${escapeHtml(c.notes) || '-'}</div>
                </div>
            `;
```

- [ ] **Step 2: Verificar sintaxe**

Run: `node --check js/app.js`
Expected: nenhuma saída.

- [ ] **Step 3: Commit**

```bash
git add js/app.js
git commit -m "feat: exibe valor por hora e faturado no mes na tela Clientes"
```

---

### Task 6: `renderDashboard()` — exibir valor faturado nos cards

**Files:**
- Modify: `js/app.js:2064-2077` (card modo mensal normal)
- Modify: `js/app.js:1972-1999` (cards do modo "Totalizar Horas", ambos os branches)

**Interfaces:**
- Consome: `stat.client.billingModel`, `stat.client.hourlyRate`, `stat.hoursUsed` (modo mensal); `client.billingModel`, `client.hourlyRate`, `b.totalAppliedH`, `totalApplied` (modo Totalizar Horas).
- Produz: nenhuma interface nova.

- [ ] **Step 1: Card do modo mensal normal**

Em `renderDashboard()`, localizar:

```js
            card.innerHTML = `
                <div class="stat-header">
                    <span class="client-name">${escapeHtml(stat.client.name)}</span>
                    <span style="font-weight: 600; color: ${statusColor}" class="dash-hours-value" data-target="${stat.hoursUsed}" data-total="${stat.hoursTotal}">${hoursLabel}</span>
                </div>
                <div class="progress-container">
                    <div class="progress-bar ${isCritical}" style="width: ${barWidth};${slideDir ? ' transition: none;' : ''}"></div>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-top: 8px;">
                    <span class="text-muted">${stat.percentage}% utilizado</span>
                    <span class="text-muted">${stat.hoursRemaining}h restantes</span>
                </div>
            `;
```

Substituir por:

```js
            const dashBillingLineHtml = stat.client.billingModel === 'hourly'
                ? `<div style="font-size: 0.8rem; margin-top: 6px;"><span class="money-value" style="color: #4ade80; font-weight: 600;">R$ ${(stat.hoursUsed * (stat.client.hourlyRate || 0)).toFixed(2).replace('.', ',')}</span> <span class="text-muted">faturado no mês</span></div>`
                : '';

            card.innerHTML = `
                <div class="stat-header">
                    <span class="client-name">${escapeHtml(stat.client.name)}</span>
                    <span style="font-weight: 600; color: ${statusColor}" class="dash-hours-value" data-target="${stat.hoursUsed}" data-total="${stat.hoursTotal}">${hoursLabel}</span>
                </div>
                <div class="progress-container">
                    <div class="progress-bar ${isCritical}" style="width: ${barWidth};${slideDir ? ' transition: none;' : ''}"></div>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-top: 8px;">
                    <span class="text-muted">${stat.percentage}% utilizado</span>
                    <span class="text-muted">${stat.hoursRemaining}h restantes</span>
                </div>
                ${dashBillingLineHtml}
            `;
```

- [ ] **Step 2: Cards do modo "Totalizar Horas" — branch `hasTracking`**

Localizar:

```js
                    card.innerHTML = `
                        <div class="stat-header">
                            <span class="client-name">${escapeHtml(client.name)}</span>
                            <span style="font-weight: 700; color: ${balanceColor}; font-size: 1.05rem;">${balanceSign}${b.balanceH.toFixed(1)}h</span>
                        </div>
                        <div class="progress-container">
                            <div class="progress-bar ${isCritical}" style="width: ${pct}%; background: linear-gradient(90deg, #a855f7, #7c3aed);"></div>
                        </div>
                        <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-top: 8px;">
                            <span class="text-muted">${b.totalAppliedH.toFixed(1)}h aplicadas</span>
                            <span class="text-muted">${client.hoursTotal}h mensais contratadas</span>
                        </div>
                        <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 4px;">Controle na plataforma desde ${startLabel} · ${b.monthsCount} ${b.monthsCount === 1 ? 'mês' : 'meses'}</div>
                    `;
```

Substituir por:

```js
                    const totalBillingLineHtml = client.billingModel === 'hourly'
                        ? `<div style="font-size: 0.78rem; margin-top: 4px;"><span class="money-value" style="color: #4ade80; font-weight: 600;">R$ ${(b.totalAppliedH * (client.hourlyRate || 0)).toFixed(2).replace('.', ',')}</span> <span class="text-muted">faturado (total acumulado)</span></div>`
                        : '';
                    card.innerHTML = `
                        <div class="stat-header">
                            <span class="client-name">${escapeHtml(client.name)}</span>
                            <span style="font-weight: 700; color: ${balanceColor}; font-size: 1.05rem;">${balanceSign}${b.balanceH.toFixed(1)}h</span>
                        </div>
                        <div class="progress-container">
                            <div class="progress-bar ${isCritical}" style="width: ${pct}%; background: linear-gradient(90deg, #a855f7, #7c3aed);"></div>
                        </div>
                        <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-top: 8px;">
                            <span class="text-muted">${b.totalAppliedH.toFixed(1)}h aplicadas</span>
                            <span class="text-muted">${client.hoursTotal}h mensais contratadas</span>
                        </div>
                        <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 4px;">Controle na plataforma desde ${startLabel} · ${b.monthsCount} ${b.monthsCount === 1 ? 'mês' : 'meses'}</div>
                        ${totalBillingLineHtml}
                    `;
```

- [ ] **Step 3: Cards do modo "Totalizar Horas" — branch sem tracking (`else`)**

Localizar:

```js
                } else {
                    // Sem balanceStartDate: exibe total histórico sem cálculo de saldo
                    const totalApplied = allRecords
                        .filter(r => r.clientId === client.id)
                        .reduce((s, r) => s + r.minutes, 0) / 60;
                    card.innerHTML = `
                        <div class="stat-header">
                            <span class="client-name">${escapeHtml(client.name)}</span>
                            <span class="text-muted" style="font-size: 0.82rem;">sem controle</span>
                        </div>
                        <div style="border-top: 1px solid rgba(255,255,255,0.06); margin: 10px 0;"></div>
                        <div style="font-size: 0.85rem; color: var(--text-muted);">${totalApplied.toFixed(1)}h aplicadas (total histórico)</div>
                    `;
                }
```

Substituir por:

```js
                } else {
                    // Sem balanceStartDate: exibe total histórico sem cálculo de saldo
                    const totalApplied = allRecords
                        .filter(r => r.clientId === client.id)
                        .reduce((s, r) => s + r.minutes, 0) / 60;
                    const totalBillingLineHtml = client.billingModel === 'hourly'
                        ? `<div style="font-size: 0.78rem; margin-top: 4px;"><span class="money-value" style="color: #4ade80; font-weight: 600;">R$ ${(totalApplied * (client.hourlyRate || 0)).toFixed(2).replace('.', ',')}</span> <span class="text-muted">faturado (total histórico)</span></div>`
                        : '';
                    card.innerHTML = `
                        <div class="stat-header">
                            <span class="client-name">${escapeHtml(client.name)}</span>
                            <span class="text-muted" style="font-size: 0.82rem;">sem controle</span>
                        </div>
                        <div style="border-top: 1px solid rgba(255,255,255,0.06); margin: 10px 0;"></div>
                        <div style="font-size: 0.85rem; color: var(--text-muted);">${totalApplied.toFixed(1)}h aplicadas (total histórico)</div>
                        ${totalBillingLineHtml}
                    `;
                }
```

- [ ] **Step 4: Verificar sintaxe**

Run: `node --check js/app.js`
Expected: nenhuma saída.

- [ ] **Step 5: Commit**

```bash
git add js/app.js
git commit -m "feat: exibe valor faturado nos cards do dashboard para clientes por hora"
```

---

### Task 7: Documentação — `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (tabela de Fases, seção de armadilhas, remoção do item do backlog)

**Interfaces:**
- Nenhuma — apenas documentação.

- [ ] **Step 1: Remover o item do backlog (feature implementada)**

Em `CLAUDE.md`, localizar e remover a linha:

```
- **Cobrança "Por Hora" por cliente** — novo modelo de cobrança (coexistindo com o "Valor Fixo" atual): campo `hourly_rate` por cliente, valor faturado no mês calculado a partir de `hoursUsed × hourly_rate` (mesma fonte de horas do Dashboard/Clientes, sem comissão). Design completo aprovado em [docs/superpowers/specs/2026-06-25-cobranca-por-hora-design.md](docs/superpowers/specs/2026-06-25-cobranca-por-hora-design.md); falta apenas o plano de implementação.
```

- [ ] **Step 2: Adicionar a fase na tabela "Fases implementadas"**

Na tabela de fases (seção `### Fases implementadas (1–42, todas ✅)` → ajustar título do range, ex. `(1–44, todas ✅)`), adicionar a linha:

```
| 44 | Cobrança "Por Hora" por cliente: `billing_model`/`hourly_rate`, toggle no modal, exibição em Clientes/Dashboard sem comissão |
```

(Ajustar o número da fase para o próximo disponível, caso outra fase tenha sido adicionada entre a criação deste plano e a execução.)

- [ ] **Step 3: Adicionar armadilha de migration obrigatória**

Na seção de armadilhas (próximo às demais armadilhas de "Saldo de horas"/"Kanban" que documentam migrations obrigatórias), adicionar:

```
- **Cobrança Por Hora: migration obrigatória antes do deploy** — sem `billing_model` e `hourly_rate` na tabela `clients`, `addClient`/`updateClient` lançarão erro 400. Rodar: `ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_model TEXT DEFAULT 'fixed', ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC DEFAULT 0;`. Clientes existentes ficam automaticamente em `billing_model = 'fixed'` — nenhuma mudança de comportamento para eles.
- **Cobrança Por Hora: sem comissão** — diferente do modelo Valor Fixo (43% + bônus), o modelo Por Hora (`billing_model === 'hourly'`) calcula apenas `hoursUsed × hourlyRate` como valor faturado; não há cálculo de comissão do consultor para esse modelo. `toggleBillingModel()` em `js/app.js` esconde/mostra os blocos de campos no modal de cliente; chamado no `onchange` dos radios, em `openEditClientModal()` e em `closeModal('modal-client')` (este último porque `form.reset()` não desfaz `style.display` setado via JS).
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: documenta fase de cobranca por hora por cliente"
```

---

### Task 8: Deploy e verificação E2E contra produção

**Files:**
- Nenhum arquivo de código — deploy manual + script Playwright temporário em `skills/playwright-skill/`.

**Interfaces:**
- Consome: todas as tasks anteriores já commitadas e com `git push` feito.

- [ ] **Step 1: Push e aviso de deploy manual**

```bash
git push origin main
```

Avisar o usuário: "Deploy automático está quebrado — é necessário fazer o deploy manual no Easypanel (serviço `gerenciador-tsp`) antes de testar em produção."

- [ ] **Step 2: Aguardar confirmação do usuário de que o deploy foi feito**

Não prosseguir para o Step 3 sem essa confirmação — testar contra a versão antiga em produção invalidaria a verificação.

- [ ] **Step 3: Criar o script de verificação E2E**

Criar `skills/playwright-skill/.temp-billing-model-check.js`:

```js
const { chromium } = require('playwright');

const TARGET_URL = 'https://jorge-gerenciador-tsp.27pl2o.easypanel.host';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto(TARGET_URL);
  await page.fill('input[type="email"]', 'jorjaocorreia@gmail.com');
  await page.fill('input[type="password"]', 'Jhc1881//');
  await page.click('button[type="submit"]');
  await page.waitForSelector('#app-container, .sidebar', { timeout: 15000 }).catch(() => {});

  await page.getByText('Clientes', { exact: true }).first().click();
  await page.waitForTimeout(1000);

  // Cria um cliente de teste no modelo Por Hora
  await page.click('button:has-text("Novo Cliente")');
  await page.waitForTimeout(500);
  await page.fill('#client-name', 'TESTE Cobranca Por Hora');
  await page.fill('#client-hours', '10');

  // Antes de marcar "Por Hora": campos fixos visíveis, campo de hora oculto
  const paysVisibleBefore = await page.isVisible('#field-client-pays');
  const hourlyVisibleBefore = await page.isVisible('#field-hourly-rate');
  console.log('Antes do toggle — Cliente Paga visível:', paysVisibleBefore, '| Valor/hora visível:', hourlyVisibleBefore);

  await page.click('#billing-model-hourly');
  await page.waitForTimeout(300);

  const paysVisibleAfter = await page.isVisible('#field-client-pays');
  const hourlyVisibleAfter = await page.isVisible('#field-hourly-rate');
  console.log('Depois do toggle — Cliente Paga visível:', paysVisibleAfter, '| Valor/hora visível:', hourlyVisibleAfter);

  await page.fill('#client-hourly-rate', '150');
  await page.click('#form-client button[type="submit"]');
  await page.waitForTimeout(1500);

  const bodyText = await page.textContent('body');
  const hasHourlyLine = bodyText.includes('Valor/hora') && bodyText.includes('Faturado no mês');
  console.log('Lista de Clientes mostra Valor/hora e Faturado no mês?', hasHourlyLine);

  // Reabrir o cliente recém-criado e confirmar persistência do toggle
  await page.click('text=TESTE Cobranca Por Hora');
  await page.waitForTimeout(300);
  const card = page.locator('tr', { hasText: 'TESTE Cobranca Por Hora' });
  await card.locator('button:has-text("Editar")').click();
  await page.waitForTimeout(500);
  const hourlyCheckedAfterReload = await page.isChecked('#billing-model-hourly');
  const hourlyRateValue = await page.inputValue('#client-hourly-rate');
  console.log('Radio "Por Hora" marcado ao reabrir?', hourlyCheckedAfterReload, '| Valor/hora persistido:', hourlyRateValue);

  await page.screenshot({ path: 'C:\\Users\\jorge\\AppData\\Local\\Temp\\billing-model-check.png', fullPage: true });

  await browser.close();

  const allOk = !paysVisibleAfter && hourlyVisibleAfter && hasHourlyLine && hourlyCheckedAfterReload && hourlyRateValue === '150';
  if (!allOk) {
    console.error('FALHA: alguma verificação não passou — revisar log acima.');
    process.exit(1);
  }
  console.log('OK: toggle de modelo de cobranca funcionando e persistindo corretamente.');
})();
```

- [ ] **Step 4: Rodar o script**

Run: `node run.js "skills/playwright-skill/.temp-billing-model-check.js"` (a partir de `d:\GerenciadorTSP\skills\playwright-skill`)
Expected: `OK: toggle de modelo de cobranca funcionando e persistindo corretamente.` e exit code 0.

- [ ] **Step 5: Limpar o cliente de teste**

Acessar a tela Clientes em produção e apagar manualmente o cliente "TESTE Cobranca Por Hora" criado no Step 3 (usar o botão "Apagar" com confirmação em duas etapas).

- [ ] **Step 6: Remover o script temporário**

```bash
rm skills/playwright-skill/.temp-billing-model-check.js
```

(Sem commit — arquivo temporário, nunca chega a ser staged.)
