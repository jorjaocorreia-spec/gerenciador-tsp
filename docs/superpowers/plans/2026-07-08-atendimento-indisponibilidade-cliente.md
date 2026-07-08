# Indisponibilidade do Cliente em Atendimentos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir lançar em Atendimentos um registro de "horas perdidas por indisponibilidade do cliente" que conta como hora aplicada no Dashboard/Clientes/Saldo, mas nunca é cobrada de clientes "Por Hora" nem afeta a Produtividade.

**Architecture:** Nova coluna booleana `is_unavailability` na tabela `records` (reaproveitando 100% da infraestrutura de Atendimentos); quando `true`, `start_time`/`end_time` ficam vazios e `minutes` vem de um campo de horas decimais digitado pelo usuário em vez de calculado por horário. As agregações de minutos que alimentam Dashboard/Clientes/Saldo já somam `records.minutes` sem distinção — nenhuma mudança ali. A única exclusão ativa é nas duas queries do Financeiro, que já são as únicas consumidoras da soma de minutos usada na fórmula de clientes "Por Hora".

**Tech Stack:** JavaScript ES6+ vanilla (sem build step), Supabase (Postgres + RLS), servido localmente via `python -m http.server 8080`.

## Global Constraints

- Sem framework de testes automatizados de unidade neste projeto — a verificação de cada task é manual, no navegador, contra o servidor de dev local (`http://localhost:8080`). Não criar arquivos de teste novos.
- Deploy em produção é sempre manual (Easypanel) — nenhuma task deste plano faz deploy; ao final, avisar o usuário para publicar manualmente antes de testar em produção.
- Nunca colar segredos literais (tokens) em arquivos do repositório — usar variável de ambiente já configurada na sessão (`$env:SUPABASE_ACCESS_TOKEN`) sem escrever o valor em nenhum arquivo.
- `js/config.js` local (com credenciais Supabase) já deve existir para rodar `python -m http.server 8080` e logar no app — se não existir, o executor deve avisar e parar (não é possível testar sem ele).

---

### Task 1: Migration — coluna `is_unavailability` em `records`

**Files:**
- Nenhum arquivo do repositório — execução direta contra o Postgres do Supabase via Management API.

**Interfaces:**
- Produces: coluna `records.is_unavailability BOOLEAN DEFAULT false`, consumida pelas Tasks 2, 4, 6.

- [ ] **Step 1: Aplicar a migration via Management API**

Rodar no PowerShell (o token pessoal já deve estar em `$env:SUPABASE_ACCESS_TOKEN`; se não estiver, pedir ao usuário para configurá-lo antes de continuar — nunca colar o valor literal em nenhum arquivo):

```powershell
$sql = "ALTER TABLE records ADD COLUMN IF NOT EXISTS is_unavailability BOOLEAN DEFAULT false;"
Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/klimkamnydfnzqetqlqm/database/query" `
  -Method POST `
  -Headers @{ "Authorization" = "Bearer $env:SUPABASE_ACCESS_TOKEN"; "Content-Type" = "application/json" } `
  -Body (@{ query = $sql } | ConvertTo-Json)
```

Expected: resposta JSON sem erro (`[]` ou similar), sem `"error"` no corpo.

- [ ] **Step 2: Verificar que a coluna existe**

```powershell
$sql = "SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = 'records' AND column_name = 'is_unavailability';"
Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/klimkamnydfnzqetqlqm/database/query" `
  -Method POST `
  -Headers @{ "Authorization" = "Bearer $env:SUPABASE_ACCESS_TOKEN"; "Content-Type" = "application/json" } `
  -Body (@{ query = $sql } | ConvertTo-Json)
```

Expected: uma linha retornada com `column_name = "is_unavailability"`, `data_type = "boolean"`.

Nenhum commit nesta task (não há arquivo alterado no repositório).

---

### Task 2: `store.js` — mapper e CRUD de `records` com `isUnavailability`

**Files:**
- Modify: `js/store.js:21-26` (mapper `_record`)
- Modify: `js/store.js:173-181` (`addRecord`)
- Modify: `js/store.js:183-191` (`updateRecord`)

**Interfaces:**
- Consumes: coluna `records.is_unavailability` (Task 1).
- Produces: `_record(r).isUnavailability: boolean`; `store.addRecord(clientId, date, startTime, endTime, minutes, description, isUnavailability)`; `store.updateRecord(id, clientId, date, startTime, endTime, minutes, description, isUnavailability)` — novo 7º parâmetro opcional (default `false`) em ambos, consumido pela Task 4.

- [ ] **Step 1: Atualizar o mapper `_record`**

Substituir (`js/store.js:21-26`):

```javascript
    _record(r) {
        return { id: r.id, clientId: r.client_id, date: r.date,
            startTime: r.start_time || '', endTime: r.end_time || '',
            minutes: parseInt(r.minutes) || 0, description: r.description || '',
            createdAt: r.created_at };
    }
```

por:

```javascript
    _record(r) {
        return { id: r.id, clientId: r.client_id, date: r.date,
            startTime: r.start_time || '', endTime: r.end_time || '',
            minutes: parseInt(r.minutes) || 0, description: r.description || '',
            isUnavailability: !!r.is_unavailability,
            createdAt: r.created_at };
    }
```

- [ ] **Step 2: Atualizar `addRecord` e `updateRecord`**

Substituir (`js/store.js:173-191`):

```javascript
    async addRecord(clientId, date, startTime, endTime, minutes, description) {
        const { data, error } = await this.db.from('records').insert({
            user_id: this.userId, client_id: clientId, date,
            start_time: startTime || '', end_time: endTime || '',
            minutes: parseInt(minutes) || 0, description: description || ''
        }).select().single();
        if (error) throw error;
        return this._record(data);
    }

    async updateRecord(id, clientId, date, startTime, endTime, minutes, description) {
        const { data, error } = await this.db.from('records').update({
            client_id: clientId, date, start_time: startTime || '',
            end_time: endTime || '', minutes: parseInt(minutes) || 0,
            description: description || ''
        }).eq('id', id).select().single();
        if (error) throw error;
        return this._record(data);
    }
```

por:

```javascript
    async addRecord(clientId, date, startTime, endTime, minutes, description, isUnavailability = false) {
        const { data, error } = await this.db.from('records').insert({
            user_id: this.userId, client_id: clientId, date,
            start_time: startTime || '', end_time: endTime || '',
            minutes: parseInt(minutes) || 0, description: description || '',
            is_unavailability: !!isUnavailability
        }).select().single();
        if (error) throw error;
        return this._record(data);
    }

    async updateRecord(id, clientId, date, startTime, endTime, minutes, description, isUnavailability = false) {
        const { data, error } = await this.db.from('records').update({
            client_id: clientId, date, start_time: startTime || '',
            end_time: endTime || '', minutes: parseInt(minutes) || 0,
            description: description || '',
            is_unavailability: !!isUnavailability
        }).eq('id', id).select().single();
        if (error) throw error;
        return this._record(data);
    }
```

- [ ] **Step 3: Verificação manual no console do navegador**

Com `python -m http.server 8080` rodando e login feito em `http://localhost:8080/index.html`, abrir o DevTools Console e rodar:

```javascript
const uid = Auth.getUserId();
const clients = await store.getClients();
const testClientId = clients[0].id;
const rec = await store.addRecord(testClientId, '2026-06-15', '', '', 180, 'Teste manual de indisponibilidade', true);
console.log(rec.isUnavailability, rec.minutes, rec.startTime, rec.endTime);
```

Expected: `true 180 ""  ""` no console.

- [ ] **Step 4: Limpar o registro de teste**

```javascript
await store.deleteRecord(rec.id);
```

- [ ] **Step 5: Commit**

```powershell
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.6.2\resources\app\git\cmd\git.exe"
& $git add js/store.js
& $git commit -m "feat: suporte a is_unavailability no CRUD de records"
```

(Se o caminho do GitHub Desktop mudou, localizar a versão atual com `Get-ChildItem "C:\Users\jorge\AppData\Local\GitHubDesktop" -Directory -Filter "app-*" | Sort-Object Name -Descending | Select-Object -First 1` antes de montar o comando.)

---

### Task 3: `index.html` — UI do modal de Atendimento

**Files:**
- Modify: `index.html:1245-1276` (modal `#modal-record`)

**Interfaces:**
- Produces: elementos `#record-unavailability` (checkbox), `#record-time-fields` (wrapper dos campos de horário existentes), `#record-unavailability-hours-group` (novo grupo, oculto por padrão) com input `#record-unavailability-hours`, `#record-desc-label` (label da descrição, agora com id) — todos consumidos pela Task 4.

- [ ] **Step 1: Adicionar o checkbox e envolver os campos de horário em um wrapper com id**

Substituir (`index.html:1245-1254`):

```html
                <div style="display: flex; gap: 16px;">
                    <div class="form-group" style="flex: 1;">
                        <label>Horário Inicial</label>
                        <input type="time" id="record-start" class="form-control" required>
                    </div>
                    <div class="form-group" style="flex: 1;">
                        <label>Horário Final</label>
                        <input type="time" id="record-end" class="form-control" required>
                    </div>
                </div>
```

por:

```html
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                    <input type="checkbox" id="record-unavailability" style="width: auto; cursor: pointer; accent-color: var(--primary-color);" onchange="app.toggleRecordUnavailability(this.checked)">
                    <label for="record-unavailability" style="cursor: pointer; color: var(--text-muted); font-size: 0.85rem; margin: 0;">
                        Indisponibilidade do Cliente (horas perdidas)
                    </label>
                </div>
                <div id="record-time-fields" style="display: flex; gap: 16px;">
                    <div class="form-group" style="flex: 1;">
                        <label>Horário Inicial</label>
                        <input type="time" id="record-start" class="form-control" required>
                    </div>
                    <div class="form-group" style="flex: 1;">
                        <label>Horário Final</label>
                        <input type="time" id="record-end" class="form-control" required>
                    </div>
                </div>
                <div class="form-group" id="record-unavailability-hours-group" style="display: none;">
                    <label>Quantidade de horas perdidas</label>
                    <input type="number" id="record-unavailability-hours" class="form-control" step="0.25" min="0" placeholder="Ex: 3.5">
                </div>
```

- [ ] **Step 2: Dar id ao label da descrição**

Substituir (`index.html:1267-1276`):

```html
                <div class="form-group">
                    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
                        <label style="margin:0;">Descrição do que foi feito</label>
                        <button type="button" id="btn-ai-improve-record" onclick="app.improveRecordDescription()" class="btn btn-ghost" style="font-size:0.78rem; padding:3px 10px; color:var(--primary-color); border:1px solid rgba(139,92,246,0.35); display:none;">
                            <i data-lucide="sparkles" style="width:13px;height:13px;"></i> Melhorar com IA
                        </button>
                    </div>
                    <textarea id="record-desc" class="form-control" rows="3" placeholder="Detalhes da atividade..."
                        required spellcheck="true" oninput="app.onRecordDescInput()"></textarea>
                </div>
```

por:

```html
                <div class="form-group">
                    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
                        <label id="record-desc-label" style="margin:0;">Descrição do que foi feito</label>
                        <button type="button" id="btn-ai-improve-record" onclick="app.improveRecordDescription()" class="btn btn-ghost" style="font-size:0.78rem; padding:3px 10px; color:var(--primary-color); border:1px solid rgba(139,92,246,0.35); display:none;">
                            <i data-lucide="sparkles" style="width:13px;height:13px;"></i> Melhorar com IA
                        </button>
                    </div>
                    <textarea id="record-desc" class="form-control" rows="3" placeholder="Detalhes da atividade..."
                        required spellcheck="true" oninput="app.onRecordDescInput()"></textarea>
                </div>
```

- [ ] **Step 3: Verificação manual**

Abrir `http://localhost:8080/index.html`, logar, ir em Atendimentos → "Novo Atendimento". Verificar no DevTools que `document.getElementById('record-unavailability-hours-group').style.display === 'none'` e que o checkbox `#record-unavailability` existe e está desmarcado.

- [ ] **Step 4: Commit**

```powershell
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.6.2\resources\app\git\cmd\git.exe"
& $git add index.html
& $git commit -m "feat: UI de indisponibilidade do cliente no modal de Atendimento"
```

---

### Task 4: `app.js` — toggle, submit e edição do formulário

**Files:**
- Modify: `js/app.js:538-544` (bloco `modal-record` dentro de `closeModal`)
- Modify: `js/app.js:714-750` (`handleRecordSubmit`)
- Modify: `js/app.js:780-796` (`handleEditRecord`)
- Create (novo método na classe `AppController`, inserir logo antes de `handleRecordSubmit`, ou seja, antes da linha 714): `toggleRecordUnavailability`

**Interfaces:**
- Consumes: `#record-unavailability`, `#record-time-fields`, `#record-unavailability-hours-group`, `#record-unavailability-hours`, `#record-desc-label` (Task 3); `store.addRecord(...isUnavailability)` / `store.updateRecord(...isUnavailability)` (Task 2); `r.isUnavailability` do mapper (Task 2).
- Produces: `app.toggleRecordUnavailability(checked: boolean)`, chamado pelo `onchange` do checkbox (Task 3) e internamente por `handleEditRecord`/`closeModal`.

- [ ] **Step 1: Criar `toggleRecordUnavailability`**

Inserir imediatamente antes de `async handleRecordSubmit(e) {` (linha 714 atual):

```javascript
    toggleRecordUnavailability(checked) {
        const timeFields = document.getElementById('record-time-fields');
        const hoursGroup = document.getElementById('record-unavailability-hours-group');
        const startInput = document.getElementById('record-start');
        const endInput = document.getElementById('record-end');
        const hoursInput = document.getElementById('record-unavailability-hours');
        const descLabel = document.getElementById('record-desc-label');
        const calcInput = document.getElementById('record-calculated');

        document.getElementById('record-unavailability').checked = checked;
        timeFields.style.display = checked ? 'none' : 'flex';
        hoursGroup.style.display = checked ? 'block' : 'none';
        startInput.required = !checked;
        endInput.required = !checked;
        hoursInput.required = checked;
        descLabel.innerText = checked ? 'Justificativa' : 'Descrição do que foi feito';

        if (checked) {
            startInput.value = '';
            endInput.value = '';
            calcInput.value = '';
            calcInput.dataset.minutes = 0;
        } else {
            hoursInput.value = '';
        }
    }
```

- [ ] **Step 2: Atualizar `handleRecordSubmit`**

Substituir (`js/app.js:714-750`):

```javascript
    async handleRecordSubmit(e) {
        e.preventDefault();
        const recordId = document.getElementById('record-id').value;
        const clientId = document.getElementById('record-client').value;
        const date = document.getElementById('record-date').value;
        const startTime = document.getElementById('record-start').value;
        const endTime = document.getElementById('record-end').value;
        const minutes = document.getElementById('record-calculated').dataset.minutes;
        const desc = document.getElementById('record-desc').value;

        if (!minutes || minutes <= 0) {
            Toast.show('Preencha horários válidos.', 'error');
            return;
        }

        const btn = e.target.querySelector('[type="submit"]');
        this._btnPending(btn);

        try {
            if (recordId) {
                await store.updateRecord(recordId, clientId, date, startTime, endTime, minutes, desc);
            } else {
                await store.addRecord(clientId, date, startTime, endTime, minutes, desc);
            }
            await this._btnSuccess(btn);
            e.target.reset();
            document.getElementById('record-id').value = '';
            document.getElementById('record-calculated').dataset.minutes = 0;
            document.getElementById('record-date').valueAsDate = new Date();
            this.closeModal('modal-record');
            await this.renderAll();
            Toast.show(recordId ? 'Atendimento atualizado.' : 'Atendimento lançado.', 'success');
        } catch (err) {
            this._btnError(btn);
            Toast.show('Erro ao salvar atendimento: ' + err.message, 'error');
        }
    }
```

por:

```javascript
    async handleRecordSubmit(e) {
        e.preventDefault();
        const recordId = document.getElementById('record-id').value;
        const clientId = document.getElementById('record-client').value;
        const date = document.getElementById('record-date').value;
        const isUnavailability = document.getElementById('record-unavailability').checked;
        const desc = document.getElementById('record-desc').value;

        let startTime, endTime, minutes;
        if (isUnavailability) {
            const hours = parseFloat(document.getElementById('record-unavailability-hours').value);
            if (!hours || hours <= 0) {
                Toast.show('Preencha a quantidade de horas perdidas.', 'error');
                return;
            }
            startTime = '';
            endTime = '';
            minutes = Math.round(hours * 60);
        } else {
            startTime = document.getElementById('record-start').value;
            endTime = document.getElementById('record-end').value;
            minutes = document.getElementById('record-calculated').dataset.minutes;
            if (!minutes || minutes <= 0) {
                Toast.show('Preencha horários válidos.', 'error');
                return;
            }
        }

        const btn = e.target.querySelector('[type="submit"]');
        this._btnPending(btn);

        try {
            if (recordId) {
                await store.updateRecord(recordId, clientId, date, startTime, endTime, minutes, desc, isUnavailability);
            } else {
                await store.addRecord(clientId, date, startTime, endTime, minutes, desc, isUnavailability);
            }
            await this._btnSuccess(btn);
            e.target.reset();
            document.getElementById('record-id').value = '';
            document.getElementById('record-calculated').dataset.minutes = 0;
            document.getElementById('record-date').valueAsDate = new Date();
            this.toggleRecordUnavailability(false);
            this.closeModal('modal-record');
            await this.renderAll();
            Toast.show(recordId ? 'Atendimento atualizado.' : 'Atendimento lançado.', 'success');
        } catch (err) {
            this._btnError(btn);
            Toast.show('Erro ao salvar atendimento: ' + err.message, 'error');
        }
    }
```

- [ ] **Step 3: Atualizar `handleEditRecord`**

Substituir (`js/app.js:780-796`):

```javascript
    async handleEditRecord(id) {
        const r = await store.getRecord(id);
        if (!r) return;
        document.getElementById('record-id').value = r.id;
        document.getElementById('record-client').value = r.clientId;
        document.getElementById('record-date').value = r.date;
        document.getElementById('record-start').value = r.startTime;
        document.getElementById('record-end').value = r.endTime;
        document.getElementById('record-desc').value = r.description;

        document.getElementById('record-calculated').value = r.minutes + ' min';
        document.getElementById('record-calculated').dataset.minutes = r.minutes;

        this.openModal('modal-record');
        // Exibe botão IA se já há descrição e IA configurada
        setTimeout(() => this.onRecordDescInput(), 50);
    }
```

por:

```javascript
    async handleEditRecord(id) {
        const r = await store.getRecord(id);
        if (!r) return;
        document.getElementById('record-id').value = r.id;
        document.getElementById('record-client').value = r.clientId;
        document.getElementById('record-date').value = r.date;
        document.getElementById('record-desc').value = r.description;

        this.toggleRecordUnavailability(r.isUnavailability);
        if (r.isUnavailability) {
            document.getElementById('record-unavailability-hours').value = (r.minutes / 60).toString();
        } else {
            document.getElementById('record-start').value = r.startTime;
            document.getElementById('record-end').value = r.endTime;
            document.getElementById('record-calculated').value = r.minutes + ' min';
            document.getElementById('record-calculated').dataset.minutes = r.minutes;
        }

        this.openModal('modal-record');
        // Exibe botão IA se já há descrição e IA configurada
        setTimeout(() => this.onRecordDescInput(), 50);
    }
```

- [ ] **Step 4: Resetar o toggle ao fechar o modal**

Substituir (`js/app.js:538-544`):

```javascript
        if (modalId === 'modal-record') {
            document.getElementById('form-record').reset();
            document.getElementById('record-id').value = '';
            document.getElementById('record-date').valueAsDate = new Date();
            document.getElementById('record-calculated').value = '';
            document.getElementById('record-calculated').dataset.minutes = 0;
        }
```

por:

```javascript
        if (modalId === 'modal-record') {
            document.getElementById('form-record').reset();
            document.getElementById('record-id').value = '';
            document.getElementById('record-date').valueAsDate = new Date();
            document.getElementById('record-calculated').value = '';
            document.getElementById('record-calculated').dataset.minutes = 0;
            this.toggleRecordUnavailability(false);
        }
```

- [ ] **Step 5: Verificação manual completa**

No navegador (`http://localhost:8080`, logado):
1. Ir em Atendimentos → "Novo Atendimento". Marcar o checkbox "Indisponibilidade do Cliente" — confirmar que os campos de horário somem e o campo "Quantidade de horas perdidas" aparece, e que o label da descrição vira "Justificativa".
2. Preencher cliente, data, `3.5` horas perdidas, justificativa "Teste — cliente não disponibilizou horário", salvar. Confirmar toast de sucesso e que o registro aparece na lista de Atendimentos (a task 6 ainda não deu o badge visual, então por ora vai aparecer sem horário, o que já é o comportamento esperado).
3. Editar esse mesmo registro (ícone lápis) — confirmar que o checkbox volta marcado, o campo de horas mostra `3.5`, e a justificativa está preenchida.
4. Desmarcar o checkbox nesse mesmo modal — confirmar que os campos de horário voltam a aparecer vazios e o label volta para "Descrição do que foi feito".
5. Fechar o modal sem salvar, abrir "Novo Atendimento" de novo — confirmar que o checkbox está desmarcado e os campos de horário aparecem normalmente (sem "vazamento" de estado do teste anterior).
6. Apagar o registro de teste criado no passo 2.

- [ ] **Step 6: Commit**

```powershell
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.6.2\resources\app\git\cmd\git.exe"
& $git add js/app.js
& $git commit -m "feat: fluxo de indisponibilidade do cliente no formulario de Atendimento"
```

---

### Task 5: Badge visual nas 3 listagens + PDF

**Files:**
- Modify: `js/app.js:3336-3339` (`renderRecords`)
- Modify: `js/app.js:3489-3496` (`exportFilteredToPDF`)
- Modify: `js/app.js:3606-3608` (`renderMonthRecords`)

**Interfaces:**
- Consumes: `r.isUnavailability` (Task 2).
- Produces: nenhuma interface nova — só apresentação.

Nas 3 funções, `timeRange` já fica vazio automaticamente quando `startTime`/`endTime` são `''` (nenhuma mudança necessária nisso). Falta só adicionar o rótulo indicando que é indisponibilidade.

- [ ] **Step 1: Badge em `renderRecords` (lista da view Atendimentos)**

Substituir (`js/app.js:3336-3339`):

```javascript
                const client = clientsMap[r.clientId];
                const clientName = client ? escapeHtml(client.name) : '&lt;Deletado&gt;';
                const hoursStr = (r.minutes / 60).toFixed(2) + 'h';
                const timeRange = (r.startTime && r.endTime) ? `<br><small class="text-muted">${r.startTime} às ${r.endTime}<\small>` : '';
```

por:

```javascript
                const client = clientsMap[r.clientId];
                const clientName = client ? escapeHtml(client.name) : '&lt;Deletado&gt;';
                const hoursStr = (r.minutes / 60).toFixed(2) + 'h';
                const timeRange = r.isUnavailability
                    ? '<br><small style="color:#f59e0b;">⚠ Indisponibilidade do Cliente</small>'
                    : ((r.startTime && r.endTime) ? `<br><small class="text-muted">${r.startTime} às ${r.endTime}<\small>` : '');
```

- [ ] **Step 2: Badge em `exportFilteredToPDF` (relatório em PDF)**

Substituir (`js/app.js:3489-3496`):

```javascript
                const client = clientsMap[r.clientId];
                const clientName = client ? client.name : '<Deletado>';
                const hoursStr = (r.minutes / 60).toFixed(2) + 'h';
                const timeRange = (r.startTime && r.endTime) ? `\n${r.startTime} às ${r.endTime}` : '';
                const partLabel = groupSize > 1 ? `\nParte ${idx + 1}\${groupSize}` : '';

                const dateText = `${r.date.split('-').reverse().join('/')}${timeRange}${partLabel}`;
                const timeText = `${r.minutes} min\n(${hoursStr})`;
```

por:

```javascript
                const client = clientsMap[r.clientId];
                const clientName = client ? client.name : '<Deletado>';
                const hoursStr = (r.minutes / 60).toFixed(2) + 'h';
                const timeRange = r.isUnavailability
                    ? '\n⚠ Indisponibilidade do Cliente'
                    : ((r.startTime && r.endTime) ? `\n${r.startTime} às ${r.endTime}` : '');
                const partLabel = groupSize > 1 ? `\nParte ${idx + 1}\${groupSize}` : '';

                const dateText = `${r.date.split('-').reverse().join('/')}${timeRange}${partLabel}`;
                const timeText = `${r.minutes} min\n(${hoursStr})`;
```

- [ ] **Step 3: Badge em `renderMonthRecords` (drilldown de cliente)**

Substituir (`js/app.js:3606-3608`):

```javascript
                const hoursStr = (r.minutes / 60).toFixed(2) + 'h';
                const timeRange = (r.startTime && r.endTime) ? `<br><small class="text-muted">${r.startTime} às ${r.endTime}</small>` : '';
                const partLabel = groupSize > 1 ? `<br><small class="text-muted" style="opacity:.7">Parte ${idx + 1}/${groupSize}</small>` : '';
```

por:

```javascript
                const hoursStr = (r.minutes / 60).toFixed(2) + 'h';
                const timeRange = r.isUnavailability
                    ? '<br><small style="color:#f59e0b;">⚠ Indisponibilidade do Cliente</small>'
                    : ((r.startTime && r.endTime) ? `<br><small class="text-muted">${r.startTime} às ${r.endTime}</small>` : '');
                const partLabel = groupSize > 1 ? `<br><small class="text-muted" style="opacity:.7">Parte ${idx + 1}/${groupSize}</small>` : '';
```

- [ ] **Step 4: Verificação manual**

No navegador: criar novamente um registro de indisponibilidade (mesmo fluxo da Task 4 Step 5) e confirmar:
1. Na lista de Atendimentos, aparece "⚠ Indisponibilidade do Cliente" em âmbar no lugar do horário.
2. Abrir o drilldown do cliente (Clientes → clicar no cliente → mês correspondente) e confirmar o mesmo badge lá.
3. Exportar PDF (botão de exportar em Atendimentos, sem filtro ou filtrando por esse cliente) e abrir o PDF gerado — confirmar que a linha do registro mostra "⚠ Indisponibilidade do Cliente" em vez de horário.
4. Apagar o registro de teste.

- [ ] **Step 5: Commit**

```powershell
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.6.2\resources\app\git\cmd\git.exe"
& $git add js/app.js
& $git commit -m "feat: badge de indisponibilidade do cliente nas listagens e no PDF"
```

---

### Task 6: Excluir indisponibilidade do cálculo Financeiro

**Files:**
- Modify: `js/store.js:623-654` (`getFinancialSummary`)
- Modify: `js/store.js:656-690` (`getFinancialHistory`)

**Interfaces:**
- Consumes: `is_unavailability` (coluna, Task 1).
- Produces: nenhuma interface nova — só corrige a agregação interna de minutos usada por `TSPFinancial.computeEntry` (`js/financial-calc.js:22-32`, já existente, sem mudanças nesse arquivo).

- [ ] **Step 1: Atualizar `getFinancialSummary`**

Substituir (`js/store.js:627-639`):

```javascript
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
```

por:

```javascript
        const [clientsRes, recordsRes] = await Promise.all([
            this.db.from('clients').select('*').eq('user_id', uid).order('created_at'),
            this.db.from('records').select('client_id, minutes, date, is_unavailability').eq('user_id', uid)
                .gte('date', `${monthStr}-01`).lte('date', `${monthStr}-${String(lastDay).padStart(2, '0')}`)
        ]);
        if (clientsRes.error) throw clientsRes.error;
        if (recordsRes.error) throw recordsRes.error;

        const clients = (clientsRes.data || []).map(r => this._client(r));
        const minutesByClient = {};
        (recordsRes.data || []).forEach(r => {
            if (r.is_unavailability) return;
            minutesByClient[r.client_id] = (minutesByClient[r.client_id] || 0) + (parseInt(r.minutes) || 0);
        });
```

- [ ] **Step 2: Atualizar `getFinancialHistory`**

Substituir (`js/store.js:665-679`):

```javascript
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
```

por:

```javascript
        const [clientsRes, recordsRes] = await Promise.all([
            this.db.from('clients').select('*').eq('user_id', uid).order('created_at'),
            this.db.from('records').select('client_id, minutes, date, is_unavailability').eq('user_id', uid)
                .gte('date', startDate).lte('date', endDate)
        ]);
        if (clientsRes.error) throw clientsRes.error;
        if (recordsRes.error) throw recordsRes.error;

        const clients = (clientsRes.data || []).map(r => this._client(r));
        const minutesByClientMonth = {};
        (recordsRes.data || []).forEach(r => {
            if (r.is_unavailability) return;
            const ym = r.date.slice(0, 7);
            const key = `${r.client_id}|${ym}`;
            minutesByClientMonth[key] = (minutesByClientMonth[key] || 0) + (parseInt(r.minutes) || 0);
        });
```

- [ ] **Step 3: Verificação manual**

Pré-requisito: ter pelo menos um cliente com `billingModel = 'hourly'` (Clientes → editar cliente → aba de cobrança → "Por Hora"). Se não houver, criar um cliente de teste com esse modelo.

No console do navegador, logado:
```javascript
const clients = await store.getClients();
const hourlyClient = clients.find(c => c.billingModel === 'hourly');
const today = new Date().toISOString().slice(0,10);
const before = await store.getFinancialSummary(new Date().getFullYear(), new Date().getMonth() + 1);
const beforeEntry = before.items.find(i => i.client.id === hourlyClient.id);
const rec = await store.addRecord(hourlyClient.id, today, '', '', 120, 'Teste indisponibilidade financeiro', true);
const after = await store.getFinancialSummary(new Date().getFullYear(), new Date().getMonth() + 1);
const afterEntry = after.items.find(i => i.client.id === hourlyClient.id);
console.log('valor antes:', beforeEntry?.valor, 'valor depois:', afterEntry?.valor);
await store.deleteRecord(rec.id);
```

Expected: `valor antes` e `valor depois` são **iguais** (as 2h de indisponibilidade não entraram na conta). Repetir o mesmo teste passando `false` no lugar do último argumento de `addRecord` para confirmar que, sem a flag, o valor **aumenta** normalmente — validando que a exclusão é específica da flag, não um bug que ignora tudo.

- [ ] **Step 4: Commit**

```powershell
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.6.2\resources\app\git\cmd\git.exe"
& $git add js/store.js
& $git commit -m "fix: excluir horas de indisponibilidade do calculo financeiro Por Hora"
```

---

### Task 7: Atualizar `CLAUDE.md` e publicar

**Files:**
- Modify: `CLAUDE.md` (seção "Armadilhas conhecidas" de Atendimentos/Financeiro — adicionar bloco novo; e tabela de "Fases implementadas", incrementando para a próxima fase, ex. Fase 48)

**Interfaces:**
- Nenhuma — documentação apenas.

- [ ] **Step 1: Adicionar entrada nas Armadilhas conhecidas**

Inserir um novo parágrafo, seguindo o padrão dos demais blocos de armadilha já existentes no arquivo (ex.: logo após o bloco de "Cobrança Por Hora"), com o seguinte conteúdo:

```markdown
- **Indisponibilidade do Cliente: `records.is_unavailability`** — registro de Atendimento sem horário real, usado quando o cliente não disponibiliza a agenda; `start_time`/`end_time` ficam `''` (mesma convenção de "dia inteiro" da Agenda) e `minutes` vem de um campo de horas decimais digitado no modal, não de cálculo de horário. Conta normalmente em `hoursUsed`/Dashboard/Clientes/Saldo (nenhum código especial — já somam `records.minutes` sem distinção). **Excluído deliberadamente** da soma de minutos em `store.getFinancialSummary`/`getFinancialHistory` (`js/store.js`), que é a única consumidora dessa soma para a fórmula de clientes "Por Hora" — clientes Fixos não usam essa soma, então a exclusão não tem efeito neles. **Nunca conta na Produtividade** — `productivity-calc.js` usa exclusivamente a tabela `apontamentos`, sem nenhuma relação com `records`. Migration: `ALTER TABLE records ADD COLUMN IF NOT EXISTS is_unavailability BOOLEAN DEFAULT false;`.
```

- [ ] **Step 2: Incrementar a tabela de fases implementadas**

Adicionar uma nova linha na tabela de fases (seguindo o padrão numérico existente, próxima fase livre), por exemplo:

```markdown
| 48 | Atendimentos: indisponibilidade do cliente — lançamento sem horário com quantidade de horas perdidas, conta em Dashboard/Clientes/Saldo, excluída do Financeiro Por Hora e da Produtividade |
```

- [ ] **Step 3: Commit**

```powershell
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.6.2\resources\app\git\cmd\git.exe"
& $git add CLAUDE.md
& $git commit -m "docs: documentar indisponibilidade do cliente em Atendimentos"
```

- [ ] **Step 4: Push e aviso de deploy manual**

```powershell
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.6.2\resources\app\git\cmd\git.exe"
& $git push origin main
```

Depois do push, avisar o usuário: **o deploy automático (webhook Easypanel) está quebrado — é preciso publicar manualmente no Easypanel antes de testar em produção**, e recomendar rodar a suíte Playwright contra produção após o deploy, conforme prática já estabelecida no projeto.
