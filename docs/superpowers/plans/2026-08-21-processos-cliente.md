# Processos do Cliente Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao consultor uma timeline agregada, ordenada cronologicamente, de tudo que já foi feito, comunicado ou está pendente para uma implantação específica num cliente (ex.: "Tabela de Preços") — sem duplicar ou substituir o Kanban, a Agenda, os Atendimentos ou os Chamados já existentes.

**Architecture:** Duas tabelas novas (`process_types` catálogo reutilizável por usuário, `client_processes` instância de um tipo num cliente) mais uma coluna `process_id` nullable em `tasks`/`agenda_events`/`records`/`tickets`. Nenhuma tabela nova para "comunicações" — uma comunicação avulsa é uma Tarefa vinculada ao processo. Uma nova view "Processos" no sidebar lista as instâncias; abrir uma instância mostra uma timeline que mescla, em memória, os itens vinculados das 4 tabelas existentes (função pura testável, sem lógica no banco).

**Tech Stack:** JavaScript ES6 vanilla (sem build step), Supabase (Postgres + RLS), Lucide Icons — mesmo stack do restante do app.

**Spec:** `docs/superpowers/specs/2026-08-21-processos-cliente-design.md`

## Global Constraints

- Toda tabela nova tem `user_id UUID REFERENCES auth.users` + RLS `FOR ALL USING (auth.uid() = user_id)` — nenhuma policy cross-role (nem Gerente em Modo Supervisão, nem Portal do Cliente) nesta fase, conforme a spec.
- Todo novo campo `process_id` é nullable e `ON DELETE SET NULL` — nunca `NOT NULL`, nunca `CASCADE` (apagar um processo não pode apagar tarefa/evento/atendimento/chamado real).
- Mappers em `js/store.js` seguem o padrão camelCase↔snake_case já estabelecido (`_client`, `_task`, `_event`, etc. no topo da classe `TSPStore`).
- Métodos novos do store seguem a convenção de nomenclatura leitura=`get`/`_`, escrita=`add/update/delete/set` — é isso que o Proxy de Modo Supervisão (`_wrapStoreWithManagerGuard`, fim de `store.js`) usa para decidir o que bloquear; nomear errado quebra esse guard silenciosamente.
- Nenhuma mudança em `getBatchStats()`, nas colunas do Kanban existente, ou no Portal do Cliente.
- pt-BR em toda string voltada ao usuário (labels, toasts, títulos).
- Sem framework de teste de DOM neste projeto — funções puras de cálculo ganham teste Node (`tests/*.test.js`, padrão `assert` + `require`, ver `tests/cs-commission-calc.test.js`); mudanças de UI/store (chamadas Supabase) são verificadas manualmente rodando o app local (`python -m http.server 8080`) e, na tarefa final, com um script Playwright ponta-a-ponta — mesmo padrão já documentado em `CLAUDE.md` para o resto do app.

---

## File Structure

- **Create:** `supabase/migrations/20260821_client_processes.sql` — tabelas `process_types`/`client_processes` + colunas `process_id`.
- **Create:** `js/process-timeline.js` — função pura de merge/ordenação da timeline e cálculo de pendências (carregado como `<script>` global, mesmo padrão de `js/financial-calc.js`/`js/cs-commission-calc.js`).
- **Create:** `tests/process-timeline.test.js` — testes Node do módulo acima.
- **Modify:** `js/store.js` — mappers/CRUD de `process_types`/`client_processes`, suporte a `process_id` em tasks/agenda/records/tickets, agregador de detalhe de processo.
- **Modify:** `js/app.js` — nova view "Processos" (lista + filtro), modal de catálogo de tipos, modal de instância, sub-view de detalhe (timeline + pendências), modal "Vincular existente", campo "Processo" nos 4 modais existentes.
- **Modify:** `index.html` — item de sidebar, `<section id="view-processos">`, `<section id="view-process-detail">`, `modal-process-type`, `modal-client-process`, `modal-process-link-existing`, `<script src="js/process-timeline.js">`, campo "Processo" nos modais de Tarefa/Atendimento/Compromisso/Chamado.
- **Modify:** `CLAUDE.md` — nova seção "Processos do Cliente — armadilhas conhecidas" ao final da implementação (Task 15).

---

### Task 1: Migration SQL — tabelas e colunas novas

**Files:**
- Create: `supabase/migrations/20260821_client_processes.sql`

**Interfaces:**
- Produces: tabelas `process_types(id, user_id, name, description, color, created_at)` e `client_processes(id, user_id, client_id, process_type_id, status, started_at, completed_at, notes, created_at)`; colunas `process_id UUID` em `tasks`, `agenda_events`, `records`, `tickets`.

- [ ] **Step 1: Escrever a migration**

```sql
-- Processos do Cliente: catálogo reutilizável de tipos de processo (por
-- consultor) + instância de um tipo aplicada a um cliente. Timeline e
-- pendências são calculadas em memória (js/process-timeline.js) a partir
-- dos itens já existentes vinculados via process_id — nenhuma tabela de
-- "comunicações"/log nova; uma comunicação avulsa vira uma Tarefa
-- vinculada ao processo. Ver docs/superpowers/specs/2026-08-21-processos-cliente-design.md.

CREATE TABLE IF NOT EXISTS process_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  color TEXT DEFAULT '#8b5cf6',
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE process_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_process_types" ON process_types;
CREATE POLICY "users_own_process_types" ON process_types
  FOR ALL USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS client_processes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  client_id UUID REFERENCES clients ON DELETE CASCADE NOT NULL,
  process_type_id UUID REFERENCES process_types ON DELETE SET NULL,
  status TEXT DEFAULT 'active',
  started_at DATE DEFAULT CURRENT_DATE,
  completed_at DATE,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE client_processes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_client_processes" ON client_processes;
CREATE POLICY "users_own_client_processes" ON client_processes
  FOR ALL USING (auth.uid() = user_id);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS process_id UUID REFERENCES client_processes ON DELETE SET NULL;
ALTER TABLE agenda_events ADD COLUMN IF NOT EXISTS process_id UUID REFERENCES client_processes ON DELETE SET NULL;
ALTER TABLE records ADD COLUMN IF NOT EXISTS process_id UUID REFERENCES client_processes ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS process_id UUID REFERENCES client_processes ON DELETE SET NULL;
```

- [ ] **Step 2: Aplicar a migration no Supabase de produção**

Seguir o padrão já documentado na memória `reference_supabase_management_api_sql` (aplicar via Management API + access token, sem colar o token literal em nenhum arquivo do repo). Projeto: `klimkamnydfnzqetqlqm`.

- [ ] **Step 3: Verificar que as tabelas/colunas existem**

Rodar uma query de checagem via a mesma API (não precisa de script novo):

```sql
SELECT table_name, column_name FROM information_schema.columns
WHERE table_name IN ('process_types','client_processes')
   OR (table_name IN ('tasks','agenda_events','records','tickets') AND column_name = 'process_id')
ORDER BY table_name, column_name;
```

Esperado: `process_types` e `client_processes` com todas as colunas da Step 1, e `process_id` presente em `tasks`, `agenda_events`, `records`, `tickets`.

- [ ] **Step 4: Commit**

```powershell
$git = (Get-ChildItem "C:\Users\jorge\AppData\Local\GitHubDesktop" -Directory -Filter "app-*" | Sort-Object Name -Descending | Select-Object -First 1).FullName + "\resources\app\git\cmd\git.exe"
& $git add supabase/migrations/20260821_client_processes.sql
& $git commit -m "feat(processos): migration de process_types/client_processes + process_id"
```

---

### Task 2: Módulo puro de timeline e pendências

**Files:**
- Create: `js/process-timeline.js`
- Create: `tests/process-timeline.test.js`

**Interfaces:**
- Consumes: nada (função pura, sem dependência de `store`/`app`).
- Produces (usado pela Task 9): `TSPProcessTimeline.buildTimeline({ tasks, events, records, tickets })` → array de `{ kind: 'task'|'task_comment'|'agenda'|'record'|'ticket', at: ISOString, title, subtitle, sourceId }` ordenado por `at` decrescente. `TSPProcessTimeline.computePendencies(tasks, columnsById)` → array de tasks cuja coluna não é `isDone`.

- [ ] **Step 1: Escrever os testes (falhando)**

```javascript
// tests/process-timeline.test.js
const assert = require('assert');
require('../js/process-timeline.js');
const T = global.TSPProcessTimeline;

function run(name, fn) {
    try { fn(); console.log(`OK   ${name}`); }
    catch (err) { console.error(`FAIL ${name}`); console.error(err); process.exitCode = 1; }
}

run('buildTimeline: mescla tarefa, comentário, evento, atendimento e chamado ordenados por data desc', () => {
    const tasks = [{
        id: 't1', title: 'Levantamento de regras', createdAt: '2026-08-01T10:00:00.000Z',
        comments: [{ id: 'c1', type: 'comment', text: 'Cliente confirmou regras', createdAt: '2026-08-03T12:00:00.000Z' }]
    }];
    const events = [{ id: 'e1', title: 'Kickoff', date: '2026-08-02', startTime: '09:00' }];
    const records = [{ id: 'r1', date: '2026-08-04', minutes: 90, description: 'Configuração inicial' }];
    const tickets = [{ id: 'k1', ticketNumber: '1001', title: 'Erro na tabela', updatedAtOtobo: '2026-08-05T08:00:00.000Z' }];

    const timeline = T.buildTimeline({ tasks, events, records, tickets });

    assert.strictEqual(timeline.length, 5); // criação da tarefa + comentário + evento + atendimento + chamado
    assert.strictEqual(timeline[0].kind, 'ticket');
    assert.strictEqual(timeline[1].kind, 'record');
    assert.strictEqual(timeline[2].kind, 'task_comment');
    assert.strictEqual(timeline[3].kind, 'agenda');
    assert.strictEqual(timeline[4].kind, 'task');
});

run('buildTimeline: ignora comments que não são type=comment/status_change/completed/time_added', () => {
    const tasks = [{
        id: 't1', title: 'X', createdAt: '2026-08-01T10:00:00.000Z',
        comments: [{ id: 'c1', type: 'unknown_type', text: 'y', createdAt: '2026-08-02T10:00:00.000Z' }]
    }];
    const timeline = T.buildTimeline({ tasks, events: [], records: [], tickets: [] });
    assert.strictEqual(timeline.length, 1); // só a criação da tarefa
});

run('buildTimeline: lida com listas vazias/ausentes', () => {
    const timeline = T.buildTimeline({});
    assert.deepStrictEqual(timeline, []);
});

run('computePendencies: retorna só tarefas cuja coluna não é isDone', () => {
    const columnsById = {
        'col-todo': { id: 'col-todo', isDone: false },
        'col-done': { id: 'col-done', isDone: true },
    };
    const tasks = [
        { id: 't1', status: 'col-todo' },
        { id: 't2', status: 'col-done' },
        { id: 't3', status: 'col-inexistente' }, // coluna deletada: trata como pendente
    ];
    const pend = T.computePendencies(tasks, columnsById);
    assert.deepStrictEqual(pend.map(t => t.id), ['t1', 't3']);
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node tests/process-timeline.test.js`
Expected: erro `Cannot read properties of undefined` ou `TSPProcessTimeline is not defined` — o módulo ainda não existe.

- [ ] **Step 3: Implementar o módulo**

```javascript
// js/process-timeline.js
(function (global) {
    const COMMENT_KIND_LABELS = {
        comment: 'Comentário',
        status_change: 'Mudança de status',
        completed: 'Concluída',
        uncompleted: 'Reaberta',
        time_added: 'Tempo registrado',
    };

    function buildTimeline({ tasks = [], events = [], records = [], tickets = [] } = {}) {
        const items = [];

        (tasks || []).forEach(t => {
            if (t.createdAt) {
                items.push({ kind: 'task', at: t.createdAt, title: t.title, subtitle: 'Tarefa criada', sourceId: t.id });
            }
            (t.comments || []).forEach(c => {
                if (!c.createdAt || !COMMENT_KIND_LABELS[c.type]) return;
                items.push({
                    kind: 'task_comment', at: c.createdAt, title: t.title,
                    subtitle: c.type === 'comment' ? (c.text || '') : COMMENT_KIND_LABELS[c.type],
                    sourceId: t.id,
                });
            });
        });

        (events || []).forEach(e => {
            const at = e.startTime ? `${e.date}T${e.startTime}:00` : `${e.date}T00:00:00`;
            items.push({ kind: 'agenda', at, title: e.title || '(sem título)', subtitle: 'Compromisso', sourceId: e.id });
        });

        (records || []).forEach(r => {
            items.push({
                kind: 'record', at: `${r.date}T00:00:00`, title: r.description || '(sem descrição)',
                subtitle: `Atendimento — ${r.minutes || 0} min`, sourceId: r.id,
            });
        });

        (tickets || []).forEach(k => {
            if (!k.updatedAtOtobo) return;
            items.push({
                kind: 'ticket', at: k.updatedAtOtobo, title: k.title || '(sem título)',
                subtitle: `Chamado #${k.ticketNumber || k.ticketId || ''}`, sourceId: k.id,
            });
        });

        return items.sort((a, b) => new Date(b.at) - new Date(a.at));
    }

    function computePendencies(tasks, columnsById) {
        return (tasks || []).filter(t => {
            const col = columnsById ? columnsById[t.status] : null;
            return !col || !col.isDone;
        });
    }

    global.TSPProcessTimeline = { buildTimeline, computePendencies };
})(typeof window !== 'undefined' ? window : global);
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node tests/process-timeline.test.js`
Expected: 4 linhas `OK`, `process.exitCode` continua `0`.

- [ ] **Step 5: Registrar o script no HTML**

No `index.html`, localizar a linha que carrega `js/store.js` (`<script src="js/store.js"></script>`) e adicionar logo antes:

```html
<script src="js/process-timeline.js"></script>
```

- [ ] **Step 6: Commit**

```powershell
$git = (Get-ChildItem "C:\Users\jorge\AppData\Local\GitHubDesktop" -Directory -Filter "app-*" | Sort-Object Name -Descending | Select-Object -First 1).FullName + "\resources\app\git\cmd\git.exe"
& $git add js/process-timeline.js tests/process-timeline.test.js index.html
& $git commit -m "feat(processos): módulo puro de timeline e pendências + testes"
```

---

### Task 3: Store — catálogo de tipos de processo

**Files:**
- Modify: `js/store.js`

**Interfaces:**
- Consumes: `this.db` (supabaseClient), `this.userId` (getter já existente na classe `TSPStore`).
- Produces: `store._processType(r)`, `store.getProcessTypes()`, `store.addProcessType({name, description, color})`, `store.updateProcessType(id, {name, description, color})`, `store.deleteProcessType(id)`.

- [ ] **Step 1: Adicionar o mapper**

Logo após o mapper `_column(r)` (perto do fim do bloco de mappers, antes de `// ── CLIENTES`), adicionar:

```javascript
    _processType(r) {
        return { id: r.id, name: r.name, description: r.description || '',
            color: r.color || '#8b5cf6', createdAt: r.created_at };
    }
```

- [ ] **Step 2: Adicionar o CRUD**

No fim da classe `TSPStore`, logo antes do método `deleteQuickNote` fechar a classe (ou seja, como novo bloco de métodos após `deleteQuickNote`, ainda dentro de `class TSPStore { ... }`), adicionar:

```javascript
    // ── TIPOS DE PROCESSO (catálogo) ────────────────────────────────

    async getProcessTypes() {
        const { data, error } = await this.db.from('process_types').select('*')
            .eq('user_id', this.userId).order('name');
        if (error) throw error;
        return (data || []).map(r => this._processType(r));
    }

    async addProcessType({ name, description, color }) {
        const { data, error } = await this.db.from('process_types').insert({
            user_id: this.userId, name, description: description || '', color: color || '#8b5cf6'
        }).select().single();
        if (error) throw error;
        return this._processType(data);
    }

    async updateProcessType(id, { name, description, color }) {
        const { data, error } = await this.db.from('process_types').update({
            name, description: description || '', color: color || '#8b5cf6'
        }).eq('id', id).eq('user_id', this.userId).select().single();
        if (error) throw error;
        return this._processType(data);
    }

    async deleteProcessType(id) {
        const { error } = await this.db.from('process_types').delete()
            .eq('id', id).eq('user_id', this.userId);
        if (error) throw error;
    }
```

- [ ] **Step 3: Verificação manual**

Rodar `python -m http.server 8080`, abrir `http://localhost:8080/index.html`, logar com `testes@teste.com` / `123testes`, abrir o console do navegador e rodar:

```javascript
await store.addProcessType({ name: 'Tabela de Preços', description: 'Implantação padrão', color: '#8b5cf6' });
await store.getProcessTypes();
```

Expected: array com 1 item, `name === 'Tabela de Preços'`.

- [ ] **Step 4: Commit**

```powershell
$git = (Get-ChildItem "C:\Users\jorge\AppData\Local\GitHubDesktop" -Directory -Filter "app-*" | Sort-Object Name -Descending | Select-Object -First 1).FullName + "\resources\app\git\cmd\git.exe"
& $git add js/store.js
& $git commit -m "feat(processos): CRUD do catálogo de tipos de processo"
```

---

### Task 4: Store — instâncias de processo por cliente

**Files:**
- Modify: `js/store.js`

**Interfaces:**
- Consumes: `_processType` (Task 3).
- Produces: `store._clientProcess(r)`, `store.getClientProcesses()` (todas, com `processTypeName`/`processTypeColor` resolvidos via join), `store.getClientProcessesByClient(clientId)`, `store.getActiveClientProcessesByClient(clientId)`, `store.getAllActiveClientProcessesWithType()` (usado pela Task 11 para popular os selects "Processo" em memória), `store.addClientProcess({clientId, processTypeId, notes})`, `store.updateClientProcess(id, {status, notes, completedAt})`, `store.getClientProcess(id)`.

- [ ] **Step 1: Adicionar o mapper**

Logo após `_processType(r)`:

```javascript
    _clientProcess(r) {
        return { id: r.id, clientId: r.client_id, processTypeId: r.process_type_id,
            status: r.status || 'active', startedAt: r.started_at || null,
            completedAt: r.completed_at || null, notes: r.notes || '',
            createdAt: r.created_at,
            processTypeName: r.process_types?.name || '(tipo removido)',
            processTypeColor: r.process_types?.color || '#8b5cf6' };
    }
```

- [ ] **Step 2: Adicionar o CRUD**

Logo após o bloco de `process_types` (fim da Task 3):

```javascript
    // ── PROCESSOS DO CLIENTE (instâncias) ───────────────────────────

    async getClientProcesses() {
        const { data, error } = await this.db.from('client_processes')
            .select('*, process_types(name, color)')
            .eq('user_id', this.userId).order('created_at', { ascending: false });
        if (error) throw error;
        return (data || []).map(r => this._clientProcess(r));
    }

    async getClientProcess(id) {
        const { data, error } = await this.db.from('client_processes')
            .select('*, process_types(name, color)')
            .eq('id', id).eq('user_id', this.userId).single();
        if (error) return null;
        return this._clientProcess(data);
    }

    async getClientProcessesByClient(clientId) {
        const { data, error } = await this.db.from('client_processes')
            .select('*, process_types(name, color)')
            .eq('user_id', this.userId).eq('client_id', clientId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return (data || []).map(r => this._clientProcess(r));
    }

    async getActiveClientProcessesByClient(clientId) {
        const { data, error } = await this.db.from('client_processes')
            .select('*, process_types(name, color)')
            .eq('user_id', this.userId).eq('client_id', clientId).eq('status', 'active')
            .order('created_at', { ascending: false });
        if (error) throw error;
        return (data || []).map(r => this._clientProcess(r));
    }

    async getAllActiveClientProcessesWithType() {
        const { data, error } = await this.db.from('client_processes')
            .select('*, process_types(name, color)')
            .eq('user_id', this.userId).eq('status', 'active');
        if (error) throw error;
        return (data || []).map(r => this._clientProcess(r));
    }

    async addClientProcess({ clientId, processTypeId, notes }) {
        const { data, error } = await this.db.from('client_processes').insert({
            user_id: this.userId, client_id: clientId, process_type_id: processTypeId || null,
            status: 'active', started_at: new Date().toISOString().slice(0, 10), notes: notes || ''
        }).select('*, process_types(name, color)').single();
        if (error) throw error;
        return this._clientProcess(data);
    }

    async updateClientProcess(id, { status, notes, completedAt }) {
        const payload = {};
        if (status !== undefined) payload.status = status;
        if (notes !== undefined) payload.notes = notes;
        if (completedAt !== undefined) payload.completed_at = completedAt;
        const { data, error } = await this.db.from('client_processes').update(payload)
            .eq('id', id).eq('user_id', this.userId).select('*, process_types(name, color)').single();
        if (error) throw error;
        return this._clientProcess(data);
    }
```

- [ ] **Step 3: Verificação manual**

No console do navegador (app já logado):

```javascript
const client = (await store.getClients())[0];
const type = (await store.getProcessTypes())[0];
const proc = await store.addClientProcess({ clientId: client.id, processTypeId: type.id, notes: 'Teste' });
await store.getActiveClientProcessesByClient(client.id); // deve incluir `proc`
await store.updateClientProcess(proc.id, { status: 'completed', completedAt: new Date().toISOString().slice(0,10) });
await store.getActiveClientProcessesByClient(client.id); // não deve mais incluir `proc`
```

- [ ] **Step 4: Commit**

```powershell
$git = (Get-ChildItem "C:\Users\jorge\AppData\Local\GitHubDesktop" -Directory -Filter "app-*" | Sort-Object Name -Descending | Select-Object -First 1).FullName + "\resources\app\git\cmd\git.exe"
& $git add js/store.js
& $git commit -m "feat(processos): CRUD de instâncias de processo por cliente"
```

---

### Task 5: Store — vínculo `process_id` em Tarefas, Agenda e Atendimentos

**Files:**
- Modify: `js/store.js`

**Interfaces:**
- Consumes: nenhum novo (estende mappers/métodos já existentes: `_task`, `addTask`, `updateTask`, `_event`, `addAgendaEvent`, `updateAgendaEvent`, `_record`, `addRecord`, `updateRecord`).
- Produces: `task.processId`, `event.processId`, `record.processId` em todo retorno dessas entidades; `addTask`/`updateTask` aceitam `taskData.processId`; `addAgendaEvent`/`updateAgendaEvent` aceitam `eventData.processId`; `addRecord`/`updateRecord` ganham um 8º parâmetro posicional opcional `processId = null` (mantém compatibilidade com todas as chamadas existentes, que não passam esse argumento).

- [ ] **Step 1: Tarefas — mapper e CRUD**

Em `_task(r)`, adicionar `processId: r.process_id || null,` na linha após `hiddenFromClient: r.hidden_from_client || false,`.

Em `addTask(taskData)`, no objeto passado a `.insert({...})`, adicionar `process_id: taskData.processId || null,` logo após `hidden_from_client: taskData.hiddenFromClient || false`.

Em `updateTask(taskData)`, no objeto passado a `.update({...})`, adicionar `process_id: taskData.processId || null,` logo após `hidden_from_client: taskData.hiddenFromClient || false,`.

- [ ] **Step 2: Agenda — mapper e CRUD**

Em `_event(r)`, adicionar `processId: r.process_id || null,` logo após `calendarId: r.calendar_id || 'primary',`.

Em `addAgendaEvent(eventData)`, no `.insert({...})`, adicionar `process_id: eventData.processId || null,` logo após `calendar_id: eventData.calendarId || 'primary'`.

Em `updateAgendaEvent(eventData)`, no `.update({...})`, adicionar `process_id: eventData.processId || null,` no mesmo ponto.

- [ ] **Step 3: Atendimentos — mapper e CRUD**

Em `_record(r)`, adicionar `processId: r.process_id || null,` logo após `isUnavailability: !!r.is_unavailability,`.

Trocar a assinatura de `addRecord` e `updateRecord` para aceitar o parâmetro extra:

```javascript
    async addRecord(clientId, date, startTime, endTime, minutes, description, isUnavailability = false, processId = null) {
        const { data, error } = await this.db.from('records').insert({
            user_id: this.userId, client_id: clientId, date,
            start_time: startTime || '', end_time: endTime || '',
            minutes: parseInt(minutes) || 0, description: description || '',
            is_unavailability: !!isUnavailability, process_id: processId || null
        }).select().single();
        if (error) throw error;
        return this._record(data);
    }

    async updateRecord(id, clientId, date, startTime, endTime, minutes, description, isUnavailability = false, processId = null) {
        const { data, error } = await this.db.from('records').update({
            client_id: clientId, date, start_time: startTime || '',
            end_time: endTime || '', minutes: parseInt(minutes) || 0,
            description: description || '',
            is_unavailability: !!isUnavailability, process_id: processId || null
        }).eq('id', id).select().single();
        if (error) throw error;
        return this._record(data);
    }
```

- [ ] **Step 4: Verificação manual**

```javascript
const client = (await store.getClients())[0];
const proc = (await store.getClientProcessesByClient(client.id))[0];
const t = await store.addTask({ clientId: client.id, title: 'Comuniquei ao cliente sobre X', status: (await store.ensureDefaultColumns(client.id))[0].id, processId: proc.id });
t.processId === proc.id; // true
```

- [ ] **Step 5: Commit**

```powershell
$git = (Get-ChildItem "C:\Users\jorge\AppData\Local\GitHubDesktop" -Directory -Filter "app-*" | Sort-Object Name -Descending | Select-Object -First 1).FullName + "\resources\app\git\cmd\git.exe"
& $git add js/store.js
& $git commit -m "feat(processos): suporte a process_id em tarefas, agenda e atendimentos"
```

---

### Task 6: Store — vínculo `process_id` em Chamados + agregador de detalhe do processo

**Files:**
- Modify: `js/store.js`

**Interfaces:**
- Consumes: `_task`, `_event`, `_record` (com `processId` da Task 5); tabela `tickets` já existente.
- Produces: campo `ticket.processId` no mapper de tickets; `store.updateTicketProcess(id, processId)`; `store.getProcessDetailData(processId)` → `{ process, tasks, events, records, tickets, columnsById }`; `store.getUnlinkedItemsForClient(clientId)` → `{ tasks, events, records, tickets }` (só itens desse cliente com `process_id IS NULL`); `store.linkExistingItemsToProcess(processId, { taskIds, eventIds, recordIds, ticketIds })`.

- [ ] **Step 1: Ler o mapper de tickets atual**

O mapper de tickets (em torno da linha 1685 de `js/store.js`, função que retorna `linkedClientId: r.linked_client_id || null` etc.) ganha `processId: r.process_id || null,` na mesma linha.

- [ ] **Step 2: Adicionar `updateTicketProcess`**

Logo após `deleteTicketsNotIn`, no bloco de Chamados:

```javascript
    async updateTicketProcess(id, processId) {
        const { error } = await this.db.from('tickets')
            .update({ process_id: processId || null })
            .eq('id', id).eq('user_id', this.userId);
        if (error) throw error;
    }
```

- [ ] **Step 3: Adicionar o agregador de detalhe do processo**

No fim do bloco "PROCESSOS DO CLIENTE" (Task 4):

```javascript
    async getProcessDetailData(processId) {
        const process = await this.getClientProcess(processId);
        if (!process) return null;
        const [tasksRes, eventsRes, recordsRes, ticketsRes, columns] = await Promise.all([
            this.db.from('tasks').select('*').eq('user_id', this.userId).eq('process_id', processId),
            this.db.from('agenda_events').select('*').eq('user_id', this.userId).eq('process_id', processId),
            this.db.from('records').select('*').eq('user_id', this.userId).eq('process_id', processId),
            this.db.from('tickets').select('*').eq('user_id', this.userId).eq('process_id', processId),
            this.getAllColumns()
        ]);
        if (tasksRes.error) throw tasksRes.error;
        if (eventsRes.error) throw eventsRes.error;
        if (recordsRes.error) throw recordsRes.error;
        if (ticketsRes.error) throw ticketsRes.error;

        const columnsById = {};
        columns.forEach(c => { columnsById[c.id] = c; });

        return {
            process,
            tasks: (tasksRes.data || []).map(r => this._task(r)),
            events: (eventsRes.data || []).map(r => this._event(r)),
            records: (recordsRes.data || []).map(r => this._record(r)),
            tickets: (ticketsRes.data || []).map(r => this._ticket(r)),
            columnsById
        };
    }

    async getUnlinkedItemsForClient(clientId) {
        const [tasksRes, eventsRes, recordsRes, ticketsRes] = await Promise.all([
            this.db.from('tasks').select('*').eq('user_id', this.userId).eq('client_id', clientId)
                .eq('approval_status', 'approved').is('process_id', null),
            this.db.from('agenda_events').select('*').eq('user_id', this.userId).eq('client_id', clientId).is('process_id', null),
            this.db.from('records').select('*').eq('user_id', this.userId).eq('client_id', clientId).is('process_id', null),
            this.db.from('tickets').select('*').eq('user_id', this.userId).eq('linked_client_id', clientId).is('process_id', null),
        ]);
        if (tasksRes.error) throw tasksRes.error;
        if (eventsRes.error) throw eventsRes.error;
        if (recordsRes.error) throw recordsRes.error;
        if (ticketsRes.error) throw ticketsRes.error;
        return {
            tasks: (tasksRes.data || []).map(r => this._task(r)),
            events: (eventsRes.data || []).map(r => this._event(r)),
            records: (recordsRes.data || []).map(r => this._record(r)),
            tickets: (ticketsRes.data || []).map(r => this._ticket(r)),
        };
    }

    async linkExistingItemsToProcess(processId, { taskIds = [], eventIds = [], recordIds = [], ticketIds = [] }) {
        const ops = [];
        if (taskIds.length) ops.push(this.db.from('tasks').update({ process_id: processId }).in('id', taskIds).eq('user_id', this.userId));
        if (eventIds.length) ops.push(this.db.from('agenda_events').update({ process_id: processId }).in('id', eventIds).eq('user_id', this.userId));
        if (recordIds.length) ops.push(this.db.from('records').update({ process_id: processId }).in('id', recordIds).eq('user_id', this.userId));
        if (ticketIds.length) ops.push(this.db.from('tickets').update({ process_id: processId }).in('id', ticketIds).eq('user_id', this.userId));
        const results = await Promise.all(ops);
        const failed = results.find(r => r.error);
        if (failed) throw failed.error;
    }
```

O mapper de tickets é `_ticket(r)` (confirmado em `js/store.js:1679`, linha `rawData: r.raw_data || {}, linkedClientId: r.linked_client_id || null,`) — adicionar `processId: r.process_id || null,` nessa mesma linha.

- [ ] **Step 4: Verificação manual**

```javascript
const client = (await store.getClients())[0];
const proc = (await store.getClientProcessesByClient(client.id))[0];
const detail = await store.getProcessDetailData(proc.id);
detail.process.id === proc.id; // true
Array.isArray(detail.tasks); // true
const unlinked = await store.getUnlinkedItemsForClient(client.id);
Array.isArray(unlinked.tasks); // true
```

- [ ] **Step 5: Commit**

```powershell
$git = (Get-ChildItem "C:\Users\jorge\AppData\Local\GitHubDesktop" -Directory -Filter "app-*" | Sort-Object Name -Descending | Select-Object -First 1).FullName + "\resources\app\git\cmd\git.exe"
& $git add js/store.js
& $git commit -m "feat(processos): process_id em chamados + agregador de detalhe/timeline"
```

---

### Task 7: HTML — sidebar, view de lista e modais de catálogo/instância

**Files:**
- Modify: `index.html`

**Interfaces:**
- Produces: `<li data-view="processos">` no sidebar; `<section id="view-processos">` (lista); `<div id="modal-process-type">` (CRUD de tipo); `<div id="modal-client-process">` (nova/editar instância).

- [ ] **Step 1: Item de sidebar**

Em `index.html`, logo após o `<li class="nav-item" data-view="trainings" ...>...</li>` (linhas 134-136), adicionar:

```html
            <li class="nav-item" data-view="processos" title="Processos" tabindex="0" role="button">
                <i data-lucide="git-branch"></i><span class="nav-label">Processos</span>
            </li>
```

- [ ] **Step 2: View de lista**

Logo após o fechamento de `</section>` da view Treinamentos (procurar `<!-- VIEW: TREINAMENTOS -->` e ir até o próximo `<!-- VIEW:` seguinte), adicionar:

```html
        <!-- VIEW: PROCESSOS -->
        <section class="view-section" id="view-processos">
            <div class="header-actions">
                <div>
                    <h1>Processos</h1>
                    <p class="text-muted">Timeline agregada de implantações por cliente — tarefas, agenda, atendimentos e chamados de um mesmo processo, num só lugar.</p>
                </div>
                <div style="display:flex;gap:8px;">
                    <button class="btn btn-secondary" onclick="app.openManageProcessTypes()">
                        <i data-lucide="settings-2"></i> Tipos de Processo
                    </button>
                    <button class="btn btn-primary" onclick="app.openNewClientProcess()">
                        <i data-lucide="plus"></i> Novo Processo
                    </button>
                </div>
            </div>

            <div class="status-filter-tabs" id="process-status-filter-tabs" role="tablist" aria-label="Filtrar por status">
                <button type="button" class="status-filter-tab active" role="tab" aria-selected="true" data-status="active" onclick="app.setProcessStatusFilter('active')">Ativos</button>
                <button type="button" class="status-filter-tab" role="tab" aria-selected="false" data-status="completed" onclick="app.setProcessStatusFilter('completed')">Concluídos</button>
                <button type="button" class="status-filter-tab" role="tab" aria-selected="false" data-status="all" onclick="app.setProcessStatusFilter('all')">Todos</button>
            </div>

            <div id="processos-container"></div>
        </section>
```

- [ ] **Step 3: Modal de catálogo de tipos**

Junto dos demais `.modal-overlay` (perto de `modal-implementation`), adicionar:

```html
    <div class="modal-overlay" id="modal-process-types">
        <div class="modal glass" style="max-width: 560px;">
            <div class="modal-header">
                <h3>Tipos de Processo</h3>
                <button class="close-modal" onclick="app.closeModal('modal-process-types')"><i data-lucide="x"></i></button>
            </div>
            <form id="form-process-type" style="display:flex; gap:10px; align-items:flex-end; margin-bottom:16px;">
                <input type="hidden" id="process-type-id">
                <div class="form-group" style="flex:2; margin-bottom:0;">
                    <label class="form-label">Nome *</label>
                    <input type="text" id="process-type-name" class="form-control" placeholder="Ex: Tabela de Preços" required>
                </div>
                <div class="form-group" style="flex:0; margin-bottom:0;">
                    <label class="form-label">Cor</label>
                    <input type="color" id="process-type-color" value="#8b5cf6" style="width:44px;height:42px;padding:2px;border-radius:8px;">
                </div>
                <button type="submit" class="btn btn-primary" style="height:42px;">Salvar</button>
            </form>
            <div id="process-types-list" style="display:flex; flex-direction:column; gap:8px; max-height:320px; overflow-y:auto;"></div>
        </div>
    </div>

    <div class="modal-overlay" id="modal-client-process">
        <div class="modal glass" style="max-width: 520px;">
            <div class="modal-header">
                <h3 id="modal-client-process-title">Novo Processo</h3>
                <button class="close-modal" onclick="app.closeModal('modal-client-process')"><i data-lucide="x"></i></button>
            </div>
            <form id="form-client-process">
                <input type="hidden" id="cp-id">
                <div class="form-group">
                    <label class="form-label">Cliente *</label>
                    <select id="cp-client" class="form-control" required></select>
                </div>
                <div class="form-group">
                    <label class="form-label">Tipo de Processo *</label>
                    <select id="cp-type" class="form-control" required></select>
                </div>
                <div class="form-group" id="cp-status-group" style="display:none;">
                    <label class="form-label">Status</label>
                    <select id="cp-status" class="form-control">
                        <option value="active">Em andamento</option>
                        <option value="paused">Pausado</option>
                        <option value="completed">Concluído</option>
                        <option value="cancelled">Cancelado</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Observações</label>
                    <textarea id="cp-notes" class="form-control" rows="3" placeholder="Contexto geral do processo..."></textarea>
                </div>
                <div style="display:flex; gap:12px; justify-content:flex-end;">
                    <button type="button" class="btn btn-secondary" onclick="app.closeModal('modal-client-process')">Cancelar</button>
                    <button type="submit" class="btn btn-primary">Salvar</button>
                </div>
            </form>
        </div>
    </div>
```

- [ ] **Step 4: Commit**

```powershell
$git = (Get-ChildItem "C:\Users\jorge\AppData\Local\GitHubDesktop" -Directory -Filter "app-*" | Sort-Object Name -Descending | Select-Object -First 1).FullName + "\resources\app\git\cmd\git.exe"
& $git add index.html
& $git commit -m "feat(processos): HTML da view de lista, sidebar e modais de catálogo/instância"
```

---

### Task 8: app.js — lista de processos, catálogo de tipos e CRUD de instância

**Files:**
- Modify: `js/app.js`

**Interfaces:**
- Consumes: `store.getClientProcesses`, `store.getProcessTypes`, `store.addProcessType`, `store.updateProcessType`, `store.deleteProcessType`, `store.addClientProcess`, `store.updateClientProcess`, `store.getClients` (já existente).
- Produces: `app.renderProcessos()`, `app.setProcessStatusFilter(status)`, `app.openManageProcessTypes()`, `app.openNewClientProcess()`, `app.openProcessDetail(id)` (stub que só faz `switchView` — implementado de verdade na Task 9), `app.processStatusFilter` (instância).

- [ ] **Step 1: Registrar os novos forms no `init()`**

Logo após a linha `document.getElementById('form-training')?.addEventListener('submit', (e) => this.handleTrainingSubmit(e));`, adicionar:

```javascript
        document.getElementById('form-process-type')
            ?.addEventListener('submit', (e) => this.handleProcessTypeSubmit(e));
        document.getElementById('form-client-process')
            ?.addEventListener('submit', (e) => this.handleClientProcessSubmit(e));
```

- [ ] **Step 2: `renderProcessos()` (lista)**

Adicionar após `clearImplFilters()` (fim do bloco de Implementações, antes de `// TREINAMENTOS`):

```javascript
    // ===================================
    // PROCESSOS DO CLIENTE
    // ===================================

    async renderProcessos() {
        if (this.currentView !== 'processos') return;
        const container = document.getElementById('processos-container');
        if (!container) return;
        container.innerHTML = spinnerHtml;

        try {
            const [processes, clients] = await Promise.all([
                store.getClientProcesses(),
                store.getClients()
            ]);
            this._processesCache = processes;
            const clientsMap = {};
            clients.forEach(c => { clientsMap[c.id] = c; });

            const filter = this.processStatusFilter || 'active';
            const filtered = filter === 'all' ? processes : processes.filter(p => p.status === filter);

            if (filtered.length === 0) {
                container.innerHTML = `<div class="glass" style="padding:40px; text-align:center; color:var(--text-muted);">
                    <i data-lucide="git-branch" style="width:48px;height:48px;opacity:.3;margin-bottom:12px;"></i>
                    <p>Nenhum processo encontrado.</p></div>`;
                lucide.createIcons();
                return;
            }

            const statusLabels = { active: 'Em andamento', paused: 'Pausado', completed: 'Concluído', cancelled: 'Cancelado' };
            container.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;">` +
                filtered.map(p => {
                    const client = clientsMap[p.clientId];
                    return `<div class="glass clickable-card" style="padding:16px;border-left:4px solid ${p.processTypeColor};"
                        onclick="app.openProcessDetail('${p.id}')" tabindex="0" role="button"
                        aria-label="Abrir processo: ${escapeHtml(p.processTypeName)} — ${escapeHtml(client?.name || '')}"
                        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();app.openProcessDetail('${p.id}')}">
                        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px;">
                            <span style="font-weight:600;">${escapeHtml(p.processTypeName)}</span>
                            <span style="font-size:.7rem;padding:2px 8px;border-radius:20px;background:var(--bg-glass);color:var(--text-muted);">${statusLabels[p.status] || p.status}</span>
                        </div>
                        <div style="font-size:.85rem;color:var(--text-secondary);margin-bottom:8px;">${escapeHtml(client?.name || '(cliente removido)')}</div>
                        <div style="font-size:.75rem;color:var(--text-muted);">Iniciado em ${p.startedAt ? new Date(p.startedAt + 'T12:00').toLocaleDateString('pt-BR') : '—'}</div>
                    </div>`;
                }).join('') + `</div>`;
            lucide.createIcons();
        } catch (err) {
            container.innerHTML = `<p class="text-muted">Erro ao carregar processos: ${escapeHtml(err.message)}</p>`;
        }
    }

    setProcessStatusFilter(status) {
        this.processStatusFilter = status;
        document.querySelectorAll('#process-status-filter-tabs .status-filter-tab').forEach(tab => {
            const active = tab.getAttribute('data-status') === status;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        this.renderProcessos();
    }

    // ── Catálogo de Tipos de Processo ───────────────────────────────

    async openManageProcessTypes() {
        document.getElementById('process-type-id').value = '';
        document.getElementById('process-type-name').value = '';
        document.getElementById('process-type-color').value = '#8b5cf6';
        await this._renderProcessTypesList();
        this.openModal('modal-process-types');
    }

    async _renderProcessTypesList() {
        const list = document.getElementById('process-types-list');
        list.innerHTML = spinnerHtml;
        const types = await store.getProcessTypes();
        this._processTypesCache = types;
        if (types.length === 0) {
            list.innerHTML = '<span style="font-size:.85rem;color:var(--text-muted);">Nenhum tipo cadastrado ainda.</span>';
            return;
        }
        list.innerHTML = types.map(t => `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--bg-glass);border-radius:8px;">
                <span style="width:12px;height:12px;border-radius:50%;background:${t.color};flex-shrink:0;"></span>
                <span style="flex:1;font-size:.9rem;">${escapeHtml(t.name)}</span>
                <button type="button" class="btn-icon-sm" title="Editar" onclick="app._editProcessType('${t.id}')"><i data-lucide="pencil" style="width:14px;height:14px;"></i></button>
                <button type="button" class="btn-icon-sm" title="Excluir" onclick="app._deleteProcessType('${t.id}', this)"><i data-lucide="trash-2" style="width:14px;height:14px;"></i></button>
            </div>`).join('');
        lucide.createIcons();
    }

    _editProcessType(id) {
        const t = (this._processTypesCache || []).find(x => x.id === id);
        if (!t) return;
        document.getElementById('process-type-id').value = t.id;
        document.getElementById('process-type-name').value = t.name;
        document.getElementById('process-type-color').value = t.color;
    }

    _deleteProcessType(id, btn) {
        this._twostepDelete(btn, async () => {
            try {
                await store.deleteProcessType(id);
                await this._renderProcessTypesList();
                Toast.show('Tipo de processo excluído.', 'success');
            } catch (err) {
                Toast.show('Erro ao excluir: ' + err.message, 'error');
            }
        });
    }

    async handleProcessTypeSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('process-type-id').value;
        const payload = {
            name: document.getElementById('process-type-name').value.trim(),
            description: '',
            color: document.getElementById('process-type-color').value,
        };
        try {
            if (id) await store.updateProcessType(id, payload);
            else await store.addProcessType(payload);
            document.getElementById('process-type-id').value = '';
            document.getElementById('form-process-type').reset();
            document.getElementById('process-type-color').value = '#8b5cf6';
            await this._renderProcessTypesList();
            Toast.show(id ? 'Tipo atualizado.' : 'Tipo criado.', 'success');
        } catch (err) {
            Toast.show('Erro ao salvar: ' + err.message, 'error');
        }
    }

    // ── Instância de Processo ───────────────────────────────────────

    async _populateProcessTypeSelect(selectedId = '') {
        const select = document.getElementById('cp-type');
        const types = this._processTypesCache || await store.getProcessTypes();
        this._processTypesCache = types;
        select.innerHTML = '<option value="">Selecione...</option>' +
            types.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
        select.value = selectedId;
    }

    async openNewClientProcess(clientId = '') {
        document.getElementById('modal-client-process-title').textContent = 'Novo Processo';
        document.getElementById('cp-id').value = '';
        document.getElementById('cp-notes').value = '';
        document.getElementById('cp-status-group').style.display = 'none';
        const clientSelect = document.getElementById('cp-client');
        if (clientSelect.options.length <= 0) {
            const clients = await store.getClients();
            clientSelect.innerHTML = clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
        }
        clientSelect.value = clientId;
        clientSelect.disabled = false;
        await this._populateProcessTypeSelect('');
        this.openModal('modal-client-process');
    }

    async handleClientProcessSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('cp-id').value;
        const notes = document.getElementById('cp-notes').value;
        const btn = e.target.querySelector('[type="submit"]');
        this._btnPending(btn);
        try {
            if (id) {
                const status = document.getElementById('cp-status').value;
                const completedAt = status === 'completed' ? new Date().toISOString().slice(0, 10) : null;
                await store.updateClientProcess(id, { status, notes, completedAt });
            } else {
                const clientId = document.getElementById('cp-client').value;
                const processTypeId = document.getElementById('cp-type').value;
                if (!clientId || !processTypeId) { Toast.show('Selecione cliente e tipo de processo.', 'error'); this._btnError(btn); return; }
                await store.addClientProcess({ clientId, processTypeId, notes });
            }
            await this._btnSuccess(btn);
            this.closeModal('modal-client-process');
            await this.renderProcessos();
            Toast.show(id ? 'Processo atualizado.' : 'Processo criado.', 'success');
        } catch (err) {
            this._btnError(btn);
            Toast.show('Erro ao salvar: ' + err.message, 'error');
        }
    }
```

- [ ] **Step 3: Registrar `renderProcessos()` no `renderAll()`**

Em `renderAll()`, no array passado a `Promise.all([...])`, adicionar `this.renderProcessos(),` logo após `this.renderTrainings(),`.

- [ ] **Step 4: Adicionar `'processos'` ao `VIEW_ORDER`**

Em `switchView(viewName)`, na linha `const VIEW_ORDER = [...]`, inserir `'processos'` logo após `'trainings'`.

- [ ] **Step 5: Verificação manual**

Rodar o app local, ir em Processos → "Tipos de Processo" → criar "Tabela de Preços" → fechar → "Novo Processo" → escolher cliente e tipo → salvar. Esperado: card aparece na lista, aba "Ativos" selecionada por padrão.

- [ ] **Step 6: Commit**

```powershell
$git = (Get-ChildItem "C:\Users\jorge\AppData\Local\GitHubDesktop" -Directory -Filter "app-*" | Sort-Object Name -Descending | Select-Object -First 1).FullName + "\resources\app\git\cmd\git.exe"
& $git add js/app.js
& $git commit -m "feat(processos): lista de processos, catálogo de tipos e CRUD de instância"
```

---

### Task 9: Detalhe do processo — HTML + timeline agregada

**Files:**
- Modify: `index.html`
- Modify: `js/app.js`

**Interfaces:**
- Consumes: `store.getProcessDetailData` (Task 6), `TSPProcessTimeline.buildTimeline`/`computePendencies` (Task 2).
- Produces: `<section id="view-process-detail">`; `app.openProcessDetail(id)` (substitui o stub da Task 8), `app.renderProcessDetail()`.

- [ ] **Step 1: HTML da sub-view**

Em `index.html`, logo após o `</section>` da view Processos (Task 7), adicionar:

```html
        <!-- VIEW: DETALHE DO PROCESSO -->
        <section class="view-section" id="view-process-detail">
            <div class="header-actions">
                <div>
                    <h1 id="pd-title">Processo</h1>
                    <p class="text-muted" id="pd-subtitle"></p>
                </div>
                <div style="display:flex;gap:8px;">
                    <button class="btn btn-secondary" onclick="app.openProcessLinkExisting()">
                        <i data-lucide="link-2"></i> Vincular existente
                    </button>
                    <button class="btn btn-secondary" onclick="app.switchView('processos')">
                        <i data-lucide="arrow-left"></i> Voltar
                    </button>
                </div>
            </div>

            <div class="glass" style="padding:16px;margin-bottom:20px;display:flex;gap:24px;align-items:center;flex-wrap:wrap;">
                <div class="form-group" style="margin-bottom:0;min-width:200px;">
                    <label class="form-label">Status</label>
                    <select id="pd-status" class="form-control" onchange="app.handleProcessDetailStatusChange()"></select>
                </div>
                <div style="font-size:.85rem;color:var(--text-muted);">Iniciado em <span id="pd-started-at"></span></div>
                <div id="pd-completed-at-wrap" style="font-size:.85rem;color:var(--text-muted);display:none;">Concluído em <span id="pd-completed-at"></span></div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 2fr;gap:20px;align-items:start;">
                <div class="glass" style="padding:16px;">
                    <h3 style="font-size:.95rem;margin-bottom:12px;display:flex;align-items:center;gap:6px;">
                        <i data-lucide="list-checks" style="width:16px;height:16px;"></i> Pendências
                    </h3>
                    <div id="pd-pendencies"></div>
                </div>
                <div class="glass" style="padding:16px;">
                    <h3 style="font-size:.95rem;margin-bottom:12px;display:flex;align-items:center;gap:6px;">
                        <i data-lucide="history" style="width:16px;height:16px;"></i> Timeline
                    </h3>
                    <div id="pd-timeline"></div>
                </div>
            </div>
        </section>
```

- [ ] **Step 2: `openProcessDetail`/`renderProcessDetail` em `js/app.js`**

Substituir o stub de `openProcessDetail` criado na Task 8 (ou adicionar, se ainda não existir) por:

```javascript
    openProcessDetail(id) {
        this.selectedProcessId = id;
        this.switchView('process-detail');
        this._setActiveNavItem(null);
    }

    async renderProcessDetail() {
        if (this.currentView !== 'process-detail' || !this.selectedProcessId) return;
        const container = document.getElementById('pd-timeline');
        if (!container) return;

        try {
            const detail = await store.getProcessDetailData(this.selectedProcessId);
            if (!detail) { Toast.show('Processo não encontrado.', 'error'); this.switchView('processos'); return; }
            this._processDetailCache = detail;
            const { process, tasks, events, records, tickets, columnsById } = detail;
            const client = await store.getClient(process.clientId);

            document.getElementById('pd-title').textContent = process.processTypeName;
            document.getElementById('pd-subtitle').textContent = client ? client.name : '(cliente removido)';
            document.getElementById('pd-started-at').textContent = process.startedAt
                ? new Date(process.startedAt + 'T12:00').toLocaleDateString('pt-BR') : '—';
            const statusSelect = document.getElementById('pd-status');
            statusSelect.innerHTML = `
                <option value="active">Em andamento</option>
                <option value="paused">Pausado</option>
                <option value="completed">Concluído</option>
                <option value="cancelled">Cancelado</option>`;
            statusSelect.value = process.status;
            const completedWrap = document.getElementById('pd-completed-at-wrap');
            if (process.completedAt) {
                completedWrap.style.display = '';
                document.getElementById('pd-completed-at').textContent = new Date(process.completedAt + 'T12:00').toLocaleDateString('pt-BR');
            } else {
                completedWrap.style.display = 'none';
            }

            const pendencies = TSPProcessTimeline.computePendencies(tasks, columnsById);
            const pendContainer = document.getElementById('pd-pendencies');
            pendContainer.innerHTML = pendencies.length === 0
                ? '<span style="font-size:.85rem;color:var(--text-muted);">Nenhuma pendência.</span>'
                : pendencies.map(t => `<div style="padding:8px;border-radius:6px;background:var(--bg-glass);margin-bottom:6px;font-size:.85rem;cursor:pointer;"
                    onclick="app.handleEditTask('${t.id}')">${escapeHtml(t.title)}</div>`).join('');

            const timeline = TSPProcessTimeline.buildTimeline({ tasks, events, records, tickets });
            const iconByKind = { task: 'kanban', task_comment: 'message-square', agenda: 'calendar', record: 'clock', ticket: 'headphones' };
            container.innerHTML = timeline.length === 0
                ? '<span style="font-size:.85rem;color:var(--text-muted);">Nenhum item vinculado ainda.</span>'
                : timeline.map(item => `
                    <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--border-color);">
                        <i data-lucide="${iconByKind[item.kind] || 'circle'}" style="width:16px;height:16px;flex-shrink:0;margin-top:2px;color:var(--primary);"></i>
                        <div style="flex:1;">
                            <div style="font-size:.85rem;font-weight:500;">${escapeHtml(item.title)}</div>
                            <div style="font-size:.75rem;color:var(--text-muted);">${escapeHtml(item.subtitle)} · ${new Date(item.at).toLocaleString('pt-BR')}</div>
                        </div>
                    </div>`).join('');
            lucide.createIcons();
        } catch (err) {
            container.innerHTML = `<p class="text-muted">Erro ao carregar processo: ${escapeHtml(err.message)}</p>`;
        }
    }

    async handleProcessDetailStatusChange() {
        if (!this.selectedProcessId) return;
        const status = document.getElementById('pd-status').value;
        const completedAt = status === 'completed' ? new Date().toISOString().slice(0, 10) : null;
        try {
            await store.updateClientProcess(this.selectedProcessId, { status, completedAt });
            await this.renderProcessDetail();
            Toast.show('Status atualizado.', 'success');
        } catch (err) {
            Toast.show('Erro ao atualizar status: ' + err.message, 'error');
        }
    }
```

- [ ] **Step 3: Registrar no `renderAll()` e no `VIEW_ORDER`**

Em `renderAll()`, adicionar `this.renderProcessDetail(),` logo após `this.renderProcessos(),`. `process-detail` é uma sub-view sem item de menu (mesmo padrão de `client-dashboard`) — **não** entra em `VIEW_ORDER`.

- [ ] **Step 4: Verificação manual**

Abrir Processos → clicar num card → conferir: título/cliente corretos, status editável, pendências vazias (nenhuma tarefa vinculada ainda), timeline vazia. Trocar status para "Concluído" e confirmar que "Concluído em" aparece.

- [ ] **Step 5: Commit**

```powershell
$git = (Get-ChildItem "C:\Users\jorge\AppData\Local\GitHubDesktop" -Directory -Filter "app-*" | Sort-Object Name -Descending | Select-Object -First 1).FullName + "\resources\app\git\cmd\git.exe"
& $git add index.html js/app.js
& $git commit -m "feat(processos): sub-view de detalhe com timeline agregada e pendências"
```

---

### Task 10: "Vincular existente"

**Files:**
- Modify: `index.html`
- Modify: `js/app.js`

**Interfaces:**
- Consumes: `store.getUnlinkedItemsForClient` (Task 6), `store.linkExistingItemsToProcess` (Task 6).
- Produces: `<div id="modal-process-link-existing">`; `app.openProcessLinkExisting()`, `app.handleProcessLinkExistingSubmit(e)`.

- [ ] **Step 1: Modal HTML**

Junto dos demais modais:

```html
    <div class="modal-overlay" id="modal-process-link-existing">
        <div class="modal glass" style="max-width: 560px; max-height: 85vh; overflow-y: auto;">
            <div class="modal-header">
                <h3>Vincular itens existentes</h3>
                <button class="close-modal" onclick="app.closeModal('modal-process-link-existing')"><i data-lucide="x"></i></button>
            </div>
            <form id="form-process-link-existing">
                <div id="ple-container" style="display:flex;flex-direction:column;gap:16px;"></div>
                <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:16px;">
                    <button type="button" class="btn btn-secondary" onclick="app.closeModal('modal-process-link-existing')">Cancelar</button>
                    <button type="submit" class="btn btn-primary">Vincular selecionados</button>
                </div>
            </form>
        </div>
    </div>
```

- [ ] **Step 2: JS**

Adicionar em `js/app.js`, logo após `handleProcessDetailStatusChange`:

```javascript
    async openProcessLinkExisting() {
        if (!this.selectedProcessId || !this._processDetailCache) return;
        const clientId = this._processDetailCache.process.clientId;
        const container = document.getElementById('ple-container');
        container.innerHTML = spinnerHtml;
        this.openModal('modal-process-link-existing');
        try {
            const unlinked = await store.getUnlinkedItemsForClient(clientId);
            this._unlinkedItemsCache = unlinked;
            const groups = [
                { key: 'tasks', label: 'Tarefas', items: unlinked.tasks, getLabel: t => t.title },
                { key: 'events', label: 'Compromissos', items: unlinked.events, getLabel: e => `${e.title} — ${new Date(e.date + 'T12:00').toLocaleDateString('pt-BR')}` },
                { key: 'records', label: 'Atendimentos', items: unlinked.records, getLabel: r => `${new Date(r.date + 'T12:00').toLocaleDateString('pt-BR')} — ${r.description || '(sem descrição)'}` },
                { key: 'tickets', label: 'Chamados', items: unlinked.tickets, getLabel: k => `#${k.ticketNumber || k.ticketId} — ${k.title}` },
            ];
            container.innerHTML = groups.map(g => `
                <div>
                    <h5 style="font-size:.8rem;color:var(--text-muted);margin-bottom:6px;">${g.label} (${g.items.length})</h5>
                    ${g.items.length === 0
                        ? '<span style="font-size:.8rem;color:var(--text-muted);">Nada disponível.</span>'
                        : g.items.map(item => `
                            <label style="display:flex;align-items:center;gap:8px;font-size:.85rem;padding:4px 0;cursor:pointer;">
                                <input type="checkbox" data-group="${g.key}" value="${item.id}">
                                ${escapeHtml(g.getLabel(item))}
                            </label>`).join('')}
                </div>`).join('');
        } catch (err) {
            container.innerHTML = `<p class="text-muted">Erro ao carregar itens: ${escapeHtml(err.message)}</p>`;
        }
    }

    async handleProcessLinkExistingSubmit(e) {
        e.preventDefault();
        if (!this.selectedProcessId) return;
        const collect = (group) => Array.from(
            document.querySelectorAll(`#ple-container input[data-group="${group}"]:checked`)
        ).map(cb => cb.value);
        const payload = {
            taskIds: collect('tasks'), eventIds: collect('events'),
            recordIds: collect('records'), ticketIds: collect('tickets'),
        };
        const total = payload.taskIds.length + payload.eventIds.length + payload.recordIds.length + payload.ticketIds.length;
        if (total === 0) { Toast.show('Selecione ao menos um item.', 'error'); return; }
        const btn = e.target.querySelector('[type="submit"]');
        this._btnPending(btn);
        try {
            await store.linkExistingItemsToProcess(this.selectedProcessId, payload);
            await this._btnSuccess(btn);
            this.closeModal('modal-process-link-existing');
            await this.renderProcessDetail();
            Toast.show('Itens vinculados.', 'success');
        } catch (err) {
            this._btnError(btn);
            Toast.show('Erro ao vincular: ' + err.message, 'error');
        }
    }
```

- [ ] **Step 3: Registrar o form no `init()`**

Junto dos outros `?.addEventListener('submit', ...)`:

```javascript
        document.getElementById('form-process-link-existing')
            ?.addEventListener('submit', (e) => this.handleProcessLinkExistingSubmit(e));
```

- [ ] **Step 4: Verificação manual**

Criar uma tarefa comum (sem processo) num cliente que já tem um processo ativo → abrir o processo → "Vincular existente" → marcar a tarefa → salvar → conferir que ela aparece na timeline/pendências do processo.

- [ ] **Step 5: Commit**

```powershell
$git = (Get-ChildItem "C:\Users\jorge\AppData\Local\GitHubDesktop" -Directory -Filter "app-*" | Sort-Object Name -Descending | Select-Object -First 1).FullName + "\resources\app\git\cmd\git.exe"
& $git add index.html js/app.js
& $git commit -m "feat(processos): vincular tarefas/eventos/atendimentos/chamados existentes"
```

---

### Task 11: Cache de processos ativos por cliente (para os selects dos modais existentes)

**Files:**
- Modify: `js/app.js`

**Interfaces:**
- Consumes: `store.getAllActiveClientProcessesWithType` (Task 4).
- Produces: `app._activeProcessesByClient` (Map `clientId → [{id, label}]`, instância, reconstruído a cada `renderAll()`); `app._populateProcessSelect(selectId, clientId, selectedId = '')` (síncrono, lê do cache).

- [ ] **Step 1: Construir o cache em `renderAll()`**

Em `renderAll()`, logo após a linha `const batchStats = await store.getBatchStats();`, adicionar:

```javascript
            const activeProcesses = await store.getAllActiveClientProcessesWithType();
            this._activeProcessesByClient = {};
            activeProcesses.forEach(p => {
                if (!this._activeProcessesByClient[p.clientId]) this._activeProcessesByClient[p.clientId] = [];
                this._activeProcessesByClient[p.clientId].push({ id: p.id, label: p.processTypeName });
            });
```

- [ ] **Step 2: Helper de popular select**

Adicionar em `js/app.js`, próximo a `_populateImplClientCheckboxes` (ou em qualquer ponto do corpo da classe):

```javascript
    // Síncrono: lê de this._activeProcessesByClient (populado em renderAll()).
    // Some silenciosamente se não houver cliente ou nenhum processo ativo
    // desse cliente — mesmo padrão condicional de campos opcionais do app
    // (ex.: agenda-generate-meet-row).
    _populateProcessSelect(selectId, clientId, selectedId = '') {
        const select = document.getElementById(selectId);
        if (!select) return;
        const wrap = select.closest('.form-group') || select;
        const options = (clientId && this._activeProcessesByClient?.[clientId]) || [];
        if (options.length === 0) {
            select.innerHTML = '<option value="">Nenhum processo ativo</option>';
            wrap.style.display = 'none';
            return;
        }
        wrap.style.display = '';
        select.innerHTML = '<option value="">Nenhum</option>' +
            options.map(o => `<option value="${o.id}">${escapeHtml(o.label)}</option>`).join('');
        select.value = selectedId || '';
    }
```

- [ ] **Step 3: Verificação manual**

No console: `Object.keys(app._activeProcessesByClient)` deve listar os `clientId` com processo ativo após o próximo `renderAll()` (ex.: navegar entre views).

- [ ] **Step 4: Commit**

```powershell
$git = (Get-ChildItem "C:\Users\jorge\AppData\Local\GitHubDesktop" -Directory -Filter "app-*" | Sort-Object Name -Descending | Select-Object -First 1).FullName + "\resources\app\git\cmd\git.exe"
& $git add js/app.js
& $git commit -m "feat(processos): cache de processos ativos por cliente para os selects"
```

---

### Task 12: Campo "Processo" no modal de Tarefa

**Files:**
- Modify: `index.html`
- Modify: `js/app.js`

**Interfaces:**
- Consumes: `_populateProcessSelect` (Task 11), `taskData.processId` (Task 5).

- [ ] **Step 1: HTML**

Em `index.html`, dentro de `.modal-sidebar-section` que contém `<h5 class="modal-sidebar-label">Cliente</h5>` (grupo "Organização" do modal de Tarefa), adicionar logo depois:

```html
                            <div class="modal-sidebar-section" id="task-process-section">
                                <h5 class="modal-sidebar-label">Processo</h5>
                                <select id="task-process" class="form-control"></select>
                            </div>
```

- [ ] **Step 2: Popular ao trocar de cliente**

No listener já existente `document.getElementById('task-client')?.addEventListener('change', async (e) => {...})` (`js/app.js`), adicionar ao final do corpo do handler, antes do fechamento `});`:

```javascript
            this._populateProcessSelect('task-process', clientId, '');
```

- [ ] **Step 3: Popular em `_openNewTaskModal`**

Logo após `document.getElementById('task-client').value = filteredClient;`, adicionar:

```javascript
        this._populateProcessSelect('task-process', filteredClient, '');
```

- [ ] **Step 4: Popular em `handleEditTask`**

Logo após `document.getElementById('task-client').value = t.clientId || '';`, adicionar:

```javascript
        this._populateProcessSelect('task-process', t.clientId, t.processId || '');
```

- [ ] **Step 5: Ler no submit**

Em `handleTaskSubmit`, no objeto `taskData`, adicionar `processId: document.getElementById('task-process').value || null,` logo após `hiddenFromClient: document.getElementById('task-hidden-from-client').checked`.

- [ ] **Step 6: Verificação manual**

Criar um processo ativo num cliente → abrir "Nova Tarefa" com esse cliente → confirmar que o select "Processo" aparece com o processo listado → selecionar → salvar → reabrir a tarefa → confirmar que o processo continua selecionado. Trocar o cliente da tarefa para um sem processo ativo → confirmar que a seção "Processo" some.

- [ ] **Step 7: Commit**

```powershell
$git = (Get-ChildItem "C:\Users\jorge\AppData\Local\GitHubDesktop" -Directory -Filter "app-*" | Sort-Object Name -Descending | Select-Object -First 1).FullName + "\resources\app\git\cmd\git.exe"
& $git add index.html js/app.js
& $git commit -m "feat(processos): campo Processo no modal de Tarefa"
```

---

### Task 13: Campo "Processo" nos modais de Atendimento e Compromisso

**Files:**
- Modify: `index.html`
- Modify: `js/app.js`

**Interfaces:**
- Consumes: `_populateProcessSelect` (Task 11), `processId` em `addRecord`/`updateRecord` (Task 5) e em `eventData` (Task 5).

- [ ] **Step 1: HTML — Atendimento**

Em `index.html`, dentro de `modal-record`, logo após o `form-group` de `record-client` (linhas 1315-1320), adicionar:

```html
                <div class="form-group" id="record-process-section">
                    <label for="record-process">Processo (Opcional)</label>
                    <select id="record-process" class="form-control"></select>
                </div>
```

- [ ] **Step 2: HTML — Compromisso**

Em `index.html`, dentro de `modal-agenda-event`, logo após o `form-group` de `agenda-client` (linhas 1840-1845), adicionar:

```html
                <div class="form-group" id="agenda-process-section">
                    <label for="agenda-process">Processo (Opcional)</label>
                    <select id="agenda-process" class="form-control"></select>
                </div>
```

- [ ] **Step 3: Listeners de troca de cliente**

Em `js/app.js`, logo após o listener existente de `task-client` (que já popula colunas), adicionar dois novos listeners análogos:

```javascript
        document.getElementById('record-client')?.addEventListener('change', (e) => {
            this._populateProcessSelect('record-process', e.target.value, '');
        });
        document.getElementById('agenda-client')?.addEventListener('change', (e) => {
            this._populateProcessSelect('agenda-process', e.target.value, '');
        });
```

- [ ] **Step 4: Popular ao abrir o modal (novo e edição)**

Em `openModal(modalId)`, dentro do bloco `if (modalId === 'modal-record') { ... }`, adicionar, logo após a linha que seta `record-date`:

```javascript
            this._populateProcessSelect('record-process', document.getElementById('record-client').value, this._pendingRecordProcessId || '');
            this._pendingRecordProcessId = null;
```

Dentro do bloco `if (modalId === 'modal-agenda-event') { ... }`, adicionar, logo após `this.updateAgendaTaskSelect();`:

```javascript
            this._populateProcessSelect('agenda-process', document.getElementById('agenda-client').value, this._pendingAgendaProcessId || '');
            this._pendingAgendaProcessId = null;
```

- [ ] **Step 5: Capturar o valor ao editar**

Em `handleEditRecord(id)`, logo após `document.getElementById('record-id').value = r.id;`, adicionar `this._pendingRecordProcessId = r.processId || '';`.

Em `editAgendaEvent(id)`, logo após a linha que popula `document.getElementById('agenda-client').value = ev.clientId || '';`, adicionar `this._pendingAgendaProcessId = ev.processId || '';`.

**Nota:** confirmar, ao editar `js/app.js`, se `openModal('modal-record')`/`openModal('modal-agenda-event')` é chamado **depois** de `handleEditRecord`/`editAgendaEvent` setarem esses campos (já confirmado para `handleEditRecord` — chama `this.openModal('modal-record')` só no final da função) — se a ordem for diferente do assumido, mover a leitura de `_pendingRecordProcessId`/`_pendingAgendaProcessId` para o ponto correto.

- [ ] **Step 6: Ler no submit**

Em `handleRecordSubmit`, alterar as duas chamadas ao store:

```javascript
            const processId = document.getElementById('record-process').value || null;
            if (recordId) {
                await store.updateRecord(recordId, clientId, date, startTime, endTime, minutes, desc, isUnavailability, processId);
            } else {
                await store.addRecord(clientId, date, startTime, endTime, minutes, desc, isUnavailability, processId);
            }
```

Em `handleAgendaSubmit`, no objeto `eventData`, adicionar `processId: document.getElementById('agenda-process').value || null,` logo após `clientId: document.getElementById('agenda-client').value || null,`.

- [ ] **Step 7: Verificação manual**

Repetir o mesmo roteiro da Task 12 para os modais de Atendimento e Compromisso.

- [ ] **Step 8: Commit**

```powershell
$git = (Get-ChildItem "C:\Users\jorge\AppData\Local\GitHubDesktop" -Directory -Filter "app-*" | Sort-Object Name -Descending | Select-Object -First 1).FullName + "\resources\app\git\cmd\git.exe"
& $git add index.html js/app.js
& $git commit -m "feat(processos): campo Processo nos modais de Atendimento e Compromisso"
```

---

### Task 14: Campo "Processo" no modal de Chamado

**Files:**
- Modify: `index.html`
- Modify: `js/app.js`

**Interfaces:**
- Consumes: `_populateProcessSelect` (Task 11), `store.updateTicketProcess` (Task 6), `ticket.linkedClientId`/`ticket.processId` (Task 6).

- [ ] **Step 1: HTML**

No `chamado-sidebar-info` do `modal-chamado` (ou logo abaixo dele, dentro do mesmo painel lateral), adicionar um bloco fixo no HTML (não gerado via `innerHTML`, já que precisa manter o `<select>` vivo entre re-renders da sidebar):

```html
        <!-- localizar o elemento com id="chamado-sidebar-info" e adicionar logo depois -->
        <div class="chamado-sidebar-row" id="chamado-process-row">
            <span class="chamado-sidebar-label">Processo</span>
            <select id="chamado-process" class="form-control" style="max-width:180px;" onchange="app.handleChamadoProcessChange()"></select>
        </div>
```

- [ ] **Step 2: JS — popular e salvar**

Em `openChamadoModal(ticket)`, logo após o bloco que monta `chamado-sidebar-info` (`lucide.createIcons();` que já existe ali), adicionar:

```javascript
        this._populateProcessSelect('chamado-process', ticket.linkedClientId, ticket.processId || '');
```

Adicionar novo método, próximo a `openChamadoModal`:

```javascript
    async handleChamadoProcessChange() {
        if (!this._currentTicket) return;
        const processId = document.getElementById('chamado-process').value || null;
        try {
            await store.updateTicketProcess(this._currentTicket.id, processId);
            this._currentTicket.processId = processId;
            if (this._cachedChamadosTickets) {
                const t = this._cachedChamadosTickets.find(x => x.id === this._currentTicket.id);
                if (t) t.processId = processId;
            }
            Toast.show('Processo do chamado atualizado.', 'success');
        } catch (err) {
            Toast.show('Erro ao vincular processo: ' + err.message, 'error');
        }
    }
```

**Nota:** confirmar o mapper de ticket usado por `_cachedChamadosTickets` já expõe `processId` (herdado da Task 6, Step 1) antes de assumir esse campo aqui.

- [ ] **Step 3: Sem processo ativo do cliente do chamado**

Como `_populateProcessSelect` já oculta o `.form-group` pai quando não há processos, e aqui o elemento é uma `.chamado-sidebar-row` (não `.form-group`), ajustar: o `select#chamado-process` sem opções deve simplesmente mostrar `<option value="">Nenhum processo ativo</option>` desabilitado, sem esconder a linha — como `_populateProcessSelect` esconde `wrap` (que seria `.chamado-sidebar-row`), isso já funciona corretamente (linha inteira some quando não há processo ativo para aquele cliente).

- [ ] **Step 4: Verificação manual**

Abrir um chamado já vinculado a um cliente que tem processo ativo → selecionar o processo no dropdown da sidebar → fechar e reabrir o chamado → confirmar que o processo continua selecionado → abrir o processo em "Processos" → confirmar que o chamado aparece na timeline.

- [ ] **Step 5: Commit**

```powershell
$git = (Get-ChildItem "C:\Users\jorge\AppData\Local\GitHubDesktop" -Directory -Filter "app-*" | Sort-Object Name -Descending | Select-Object -First 1).FullName + "\resources\app\git\cmd\git.exe"
& $git add index.html js/app.js
& $git commit -m "feat(processos): campo Processo no modal de Chamado"
```

---

### Task 15: Verificação ponta-a-ponta e documentação

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nada novo — é a tarefa de fechamento.

- [ ] **Step 1: Roteiro de verificação manual completo**

Rodar o app local (`python -m http.server 8080`) logado como `testes@teste.com` e executar, em sequência:

1. Processos → Tipos de Processo → criar "Tabela de Preços".
2. Processos → Novo Processo → escolher um cliente existente + o tipo criado → salvar.
3. Abrir o card do processo → conferir status "Em andamento", timeline vazia, pendências vazias.
4. Ir em Tarefas → criar uma tarefa nesse cliente → no select "Processo" (sidebar do modal), escolher o processo → salvar.
5. Voltar ao processo → conferir que a tarefa aparece em Pendências e na Timeline (evento "Tarefa criada").
6. Marcar a tarefa como concluída no Kanban (mover para coluna com `isDone`) → voltar ao processo → conferir que ela some de Pendências mas continua na Timeline.
7. Lançar um Atendimento nesse cliente vinculado ao processo → conferir na Timeline.
8. Criar um Compromisso na Agenda vinculado ao processo → conferir na Timeline.
9. Se houver um chamado OTOBO já vinculado ao cliente, abrir e vincular ao processo pelo select da sidebar → conferir na Timeline.
10. Criar uma tarefa **sem** vínculo de processo nesse mesmo cliente → no processo, clicar "Vincular existente" → marcar essa tarefa → salvar → conferir que ela passa a aparecer.
11. Marcar o processo como "Concluído" → conferir que ele sai da aba "Ativos" da lista e aparece em "Concluídos".

Se qualquer passo falhar, corrigir antes de prosseguir — esta tarefa só fecha com o roteiro completo passando.

- [ ] **Step 2: Atualizar `CLAUDE.md`**

Adicionar à tabela de fases implementadas (após a linha da Fase 52 "Notas Rápidas"), uma nova linha:

```
| 53 | Processos do Cliente: catálogo reutilizável de tipos de processo (`process_types`) + instância por cliente (`client_processes`) com timeline agregada cronológica (tarefas/comentários, agenda, atendimentos, chamados vinculados via `process_id` nullable) e pendências derivadas das tarefas não concluídas; vínculo via select opcional nos modais de Tarefa/Atendimento/Compromisso/Chamado ou retroativo via "Vincular existente"; sem tabela de comunicações — uma comunicação avulsa é uma Tarefa vinculada ao processo |
```

Adicionar uma nova subseção "### Processos do Cliente — armadilhas conhecidas" (mesmo padrão das demais seções de armadilhas) documentando:
- `process_id` é `ON DELETE SET NULL` em todas as 4 tabelas — apagar um processo nunca apaga o dado de negócio vinculado.
- A timeline é 100% calculada em memória por `js/process-timeline.js` (`buildTimeline`/`computePendencies`) — nenhuma lógica de agregação no banco; qualquer novo tipo de item vinculável a um processo precisa de uma entrada nova nesse módulo.
- `app._activeProcessesByClient` é reconstruído a cada `renderAll()` (mesmo padrão de outros caches do app) — os selects "Processo" dos modais existentes nunca fazem round-trip próprio ao banco.
- Sem policy cross-role em `process_types`/`client_processes` nesta fase (nem Gerente em Modo Supervisão, nem Portal do Cliente) — mesma cautela documentada para `quick_notes`.

- [ ] **Step 3: Commit e push**

```powershell
$git = (Get-ChildItem "C:\Users\jorge\AppData\Local\GitHubDesktop" -Directory -Filter "app-*" | Sort-Object Name -Descending | Select-Object -First 1).FullName + "\resources\app\git\cmd\git.exe"
Set-Location d:\GerenciadorTSP
& $git add CLAUDE.md
& $git commit -m "docs: Processos do Cliente (Fase 53) no CLAUDE.md"
& $git push
```

Lembrar o usuário de fazer o deploy manual no Easypanel após o push (webhook automático está quebrado, conforme `CLAUDE.md`).
