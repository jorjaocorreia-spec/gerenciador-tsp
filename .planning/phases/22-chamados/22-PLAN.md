# Phase 22 — Chamados (OTOBO Integration) — Plano de Execução
_Gerado em: 2026-05-27_

---

## Goal

Adicionar a view "Chamados" ao GerenciadorTSP: painel de acompanhamento de tickets OTOBO, somente leitura, dados cacheados no Supabase, sync manual, agrupamento por cliente TSP.

---

## Pre-requisites (executar no Supabase antes do código)

### SQL Migration 1 — Tabela `otobo_config`
```sql
CREATE TABLE IF NOT EXISTS otobo_config (
  user_id     UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  url         TEXT NOT NULL DEFAULT '',
  username    TEXT NOT NULL DEFAULT '',
  password    TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE otobo_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "otobo_config_user" ON otobo_config
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

### SQL Migration 2 — Tabela `tickets`
```sql
CREATE TABLE IF NOT EXISTS tickets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  ticket_id         TEXT NOT NULL,
  ticket_number     TEXT NOT NULL DEFAULT '',
  title             TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT '',
  priority          TEXT NOT NULL DEFAULT '',
  queue             TEXT NOT NULL DEFAULT '',
  customer_name     TEXT NOT NULL DEFAULT '',
  owner             TEXT NOT NULL DEFAULT '',
  created_at_otobo  TIMESTAMPTZ,
  updated_at_otobo  TIMESTAMPTZ,
  raw_data          JSONB DEFAULT '{}',
  linked_client_id  UUID REFERENCES clients(id) ON DELETE SET NULL,
  synced_at         TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tickets_user" ON tickets
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE UNIQUE INDEX idx_tickets_user_ticket ON tickets(user_id, ticket_id);
CREATE INDEX idx_tickets_user_status ON tickets(user_id, status);
CREATE INDEX idx_tickets_linked_client ON tickets(linked_client_id);
```

---

## Tasks

### Task 1 — Store: métodos OTOBO config e tickets
**Arquivo:** `js/store.js`

Adicionar mapper e CRUD para `otobo_config`:
```javascript
_otoboConfig(r) {
    return { userId: r.user_id, url: r.url || '', username: r.username || '',
        password: r.password || '', updatedAt: r.updated_at };
}

async getOtoboConfig() {
    const { data, error } = await this.db.from('otobo_config')
        .select('*').eq('user_id', this.userId).maybeSingle();
    if (error) throw error;
    return data ? this._otoboConfig(data) : null;
}

async saveOtoboConfig(url, username, password) {
    const { error } = await this.db.from('otobo_config').upsert({
        user_id: this.userId, url, username, password, updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (error) throw error;
}
```

Adicionar mapper e CRUD para `tickets`:
```javascript
_ticket(r) {
    return { id: r.id, ticketId: r.ticket_id, ticketNumber: r.ticket_number,
        title: r.title, status: r.status, priority: r.priority,
        queue: r.queue, customerName: r.customer_name, owner: r.owner,
        createdAtOtobo: r.created_at_otobo, updatedAtOtobo: r.updated_at_otobo,
        rawData: r.raw_data || {}, linkedClientId: r.linked_client_id || null,
        syncedAt: r.synced_at };
}

async getTickets() {
    const { data, error } = await this.db.from('tickets').select('*')
        .eq('user_id', this.userId).order('updated_at_otobo', { ascending: false });
    if (error) throw error;
    return (data || []).map(r => this._ticket(r));
}

async upsertTickets(ticketRows) {
    // ticketRows: array de objetos snake_case prontos para o Supabase
    const { error } = await this.db.from('tickets').upsert(ticketRows,
        { onConflict: 'user_id,ticket_id' });
    if (error) throw error;
}

async deleteTicketsNotIn(ticketIds) {
    // Remove tickets do cache que não existem mais na listagem do OTOBO
    if (ticketIds.length === 0) {
        await this.db.from('tickets').delete().eq('user_id', this.userId);
        return;
    }
    const { error } = await this.db.from('tickets').delete()
        .eq('user_id', this.userId).not('ticket_id', 'in', `(${ticketIds.map(id => `'${id}'`).join(',')})`);
    if (error) throw error;
}
```

---

### Task 2 — HTML: nav item + modais
**Arquivo:** `index.html`

**2a. Nav item no sidebar** (após o item "Implementações"):
```html
<a href="#" class="nav-item" data-view="chamados" title="Chamados">
    <i data-lucide="ticket" style="width:20px;height:20px;flex-shrink:0;"></i>
    <span class="nav-label">Chamados</span>
</a>
```

**2b. Div da view Chamados** (após `<div id="view-implementations">`):
```html
<div id="view-chamados" class="view-section" style="display:none;">
    <div class="page-header">
        <div>
            <h2>Chamados</h2>
            <p class="page-subtitle">Tickets em aberto — OTOBO</p>
        </div>
        <div class="header-actions">
            <span id="chamados-sync-info" class="sync-info-label" style="display:none;"></span>
            <button class="btn btn-secondary" onclick="app.openOtoboConfigModal()">
                <i data-lucide="settings-2" style="width:16px;height:16px;"></i>
                <span class="nav-label">Configurar OTOBO</span>
            </button>
            <button class="btn btn-primary" id="btn-sync-chamados" onclick="app.syncChamados()" style="display:none;">
                <i data-lucide="refresh-cw" style="width:16px;height:16px;"></i>
                <span class="nav-label">Sincronizar</span>
            </button>
        </div>
    </div>
    <div id="chamados-content"></div>
</div>
```

**2c. Modal de configuração OTOBO** (antes do `</body>`):
```html
<div id="modal-otobo-config" class="modal-overlay" style="display:none;">
    <div class="modal-container" style="max-width:480px;">
        <div class="modal-header">
            <h3>Configurar OTOBO</h3>
            <button class="modal-close" onclick="app.closeModal('modal-otobo-config')">
                <i data-lucide="x" style="width:18px;height:18px;"></i>
            </button>
        </div>
        <div class="modal-body" style="padding:24px;">
            <div class="form-group">
                <label>URL do OTOBO</label>
                <input type="url" id="otobo-url" class="form-input" placeholder="https://helpdesk.empresa.com">
            </div>
            <div class="form-group">
                <label>Usuário</label>
                <input type="text" id="otobo-username" class="form-input" placeholder="seu.usuario">
            </div>
            <div class="form-group">
                <label>Senha</label>
                <input type="password" id="otobo-password" class="form-input" placeholder="••••••••">
            </div>
            <p class="form-hint" style="color:var(--text-muted);font-size:0.8rem;margin-top:8px;">
                As credenciais são armazenadas de forma segura e isoladas por usuário.
            </p>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="app.closeModal('modal-otobo-config')">Cancelar</button>
            <button class="btn btn-primary" onclick="app.saveOtoboConfig()">Salvar</button>
        </div>
    </div>
</div>
```

**2d. Modal de detalhe do chamado**:
```html
<div id="modal-chamado" class="modal-overlay" style="display:none;">
    <div class="modal-container modal-task-two-panel" style="max-width:860px;">
        <div class="modal-header">
            <h3 id="chamado-modal-title">Chamado</h3>
            <div style="display:flex;gap:8px;align-items:center;">
                <a id="chamado-otobo-link" href="#" target="_blank" class="btn btn-secondary btn-sm">
                    <i data-lucide="external-link" style="width:14px;height:14px;"></i> Abrir no OTOBO
                </a>
                <button class="modal-close" onclick="app.closeModal('modal-chamado')">
                    <i data-lucide="x" style="width:18px;height:18px;"></i>
                </button>
            </div>
        </div>
        <div class="modal-task-body">
            <div class="modal-task-content">
                <div id="chamado-articles-content"><div class="spinner-wrap"><div class="spinner"></div></div></div>
            </div>
            <div class="modal-task-sidebar">
                <div id="chamado-sidebar-info"></div>
            </div>
        </div>
    </div>
</div>
```

---

### Task 3 — AppController: métodos de view e OTOBO
**Arquivo:** `js/app.js`

**3a. Inicialização** — no `constructor()`, adicionar:
```javascript
this._otoboConfig = null; // cache da config OTOBO em memória
this._currentTicket = null; // ticket aberto no modal
```

**3b. Resetar no logout** — em `handleLogout()` / reset state, adicionar:
```javascript
this._otoboConfig = null;
this._currentTicket = null;
```

**3c. `initAfterAuth()`** — adicionar `renderChamados()` no `Promise.all` do `renderAll()`.

**3d. `renderChamados()`**:
```javascript
async renderChamados() {
    if (this.currentView !== 'chamados') return;
    const content = document.getElementById('chamados-content');
    if (!content) return;
    content.innerHTML = spinnerHtml;

    // Verificar se OTOBO está configurado
    if (!this._otoboConfig) {
        this._otoboConfig = await store.getOtoboConfig().catch(() => null);
    }
    if (!this._otoboConfig || !this._otoboConfig.url) {
        content.innerHTML = `
            <div class="empty-state">
                <i data-lucide="ticket" style="width:48px;height:48px;color:var(--text-muted);"></i>
                <h3>OTOBO não configurado</h3>
                <p>Configure as credenciais do OTOBO para visualizar seus chamados.</p>
                <button class="btn btn-primary" onclick="app.openOtoboConfigModal()">Configurar OTOBO</button>
            </div>`;
        lucide.createIcons();
        return;
    }

    // Mostrar botão sync e info
    document.getElementById('btn-sync-chamados').style.display = '';

    try {
        const [tickets, clients] = await Promise.all([store.getTickets(), store.getClients()]);
        this._renderChamadosCards(tickets, clients, content);
    } catch (err) {
        content.innerHTML = `<div class="empty-state"><p>Erro ao carregar chamados: ${escapeHtml(err.message)}</p></div>`;
    }
    lucide.createIcons();
}
```

**3e. `_renderChamadosCards(tickets, clients, container)`**:
- Agrupar tickets por `linkedClientId`
- Para cada cliente com tickets: renderizar seção com nome do cliente + grid de cards
- Seção "Sem cliente vinculado" ao final para tickets sem match
- Card HTML: número, título, badges de status/prioridade, queue, owner, datas relativas
- Click no card: `app.openChamadoModal(ticketId)`

**3f. `syncChamados()`**:
```javascript
async syncChamados() {
    const btn = document.getElementById('btn-sync-chamados');
    if (btn) btn.disabled = true;
    Toast.show('Sincronizando com OTOBO...', 'info', 2000);
    try {
        const config = this._otoboConfig;
        const tickets = await this._fetchTicketsFromOtobo(config);
        const clients = await store.getClients();
        const rows = this._mapTicketsToRows(tickets, clients);
        const ticketIds = rows.map(r => r.ticket_id);
        await store.upsertTickets(rows);
        await store.deleteTicketsNotIn(ticketIds);
        // Atualizar timestamp
        const now = new Date().toLocaleString('pt-BR');
        const info = document.getElementById('chamados-sync-info');
        if (info) { info.textContent = `Última sync: ${now}`; info.style.display = ''; }
        await this.renderChamados();
        Toast.show('Chamados sincronizados!', 'success');
    } catch (err) {
        Toast.show(`Erro na sincronização: ${err.message}`, 'error', 5000);
    } finally {
        if (btn) btn.disabled = false;
    }
}
```

**3g. `_fetchTicketsFromOtobo(config)`** — chamada à API OTOBO:
```javascript
async _fetchTicketsFromOtobo(config) {
    const base64 = btoa(`${config.username}:${config.password}`);
    const headers = { 'Authorization': `Basic ${base64}`, 'Content-Type': 'application/json' };

    // TicketSearch — todos os não fechados
    const searchUrl = `${config.url}/otrs/nph-genericinterface.pl/Webservice/GenericTicketConnectorREST/Ticket?` +
        new URLSearchParams({ UserLogin: config.username, Password: config.password,
            StateType: 'Open', Limit: 500 });

    const res = await fetch(`${config.url}/otobo/nph-genericinterface.pl/Webservice/GenericTicketConnectorREST/Ticket/Search`,
        { method: 'POST', headers,
          body: JSON.stringify({ UserLogin: config.username, Password: config.password,
            StateType: ['new', 'open', 'pending reminder', 'pending auto', 'in treatment'] }) });

    if (!res.ok) {
        if (res.status === 0) throw new Error('CORS bloqueado. Peça ao administrador do OTOBO para configurar Access-Control-Allow-Origin.');
        throw new Error(`OTOBO retornou ${res.status}: ${res.statusText}`);
    }
    const searchData = await res.json();
    const ticketIds = searchData.TicketID || [];

    // TicketGet em lotes de 10 para não sobrecarregar
    const results = [];
    for (let i = 0; i < ticketIds.length; i += 10) {
        const batch = ticketIds.slice(i, i + 10);
        const getRes = await fetch(
            `${config.url}/otobo/nph-genericinterface.pl/Webservice/GenericTicketConnectorREST/Ticket/${batch.join(',')}?UserLogin=${encodeURIComponent(config.username)}&Password=${encodeURIComponent(config.password)}`,
            { headers });
        if (getRes.ok) {
            const d = await getRes.json();
            results.push(...(d.Ticket || []));
        }
    }
    return results;
}
```

**3h. `_mapTicketsToRows(otoboTickets, clients)`** — mapear OTOBO → Supabase:
```javascript
_mapTicketsToRows(otoboTickets, clients) {
    return otoboTickets.map(t => {
        // Match por nome: normalizar lowercase + trim
        const normalize = s => (s || '').toLowerCase().trim();
        const customerNorm = normalize(t.CustomerUserID || t.CustomerID || '');
        const linked = clients.find(c => normalize(c.name) === customerNorm
            || normalize(c.name).includes(customerNorm)
            || customerNorm.includes(normalize(c.name)));
        return {
            user_id: store.userId,
            ticket_id: String(t.TicketID),
            ticket_number: t.TicketNumber || '',
            title: t.Title || '',
            status: t.State || '',
            priority: t.Priority || '',
            queue: t.Queue || '',
            customer_name: t.CustomerUserID || t.CustomerID || '',
            owner: t.Owner || '',
            created_at_otobo: t.Created || null,
            updated_at_otobo: t.Changed || null,
            raw_data: t,
            linked_client_id: linked ? linked.id : null,
            synced_at: new Date().toISOString()
        };
    });
}
```

**3i. `openOtoboConfigModal()`** — abrir modal de config pré-preenchido com dados existentes.

**3j. `saveOtoboConfig()`** — ler campos + validar + `store.saveOtoboConfig()` + fechar modal + `renderChamados()`.

**3k. `openChamadoModal(ticketId)`** — abrir modal de detalhe, carregar artigos via `TicketGet` com `AllArticles=1`, renderizar sidebar info + artigos.

---

### Task 4 — CSS: estilos dos cards e badges
**Arquivo:** `styles/main.css`

**Badges de status** (usar variáveis existentes):
```css
.ticket-status-badge { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:4px; font-size:0.72rem; font-weight:500; }
.ticket-status-new    { background:rgba(99,179,237,0.15); color:#63b3ed; }
.ticket-status-open   { background:rgba(72,187,120,0.15); color:#68d391; }
.ticket-status-pending{ background:rgba(246,173,85,0.15);  color:#f6ad55; }

.ticket-priority-badge { /* similar */ }
.ticket-priority-urgent { background:rgba(252,129,129,0.15); color:#fc8181; }
.ticket-priority-high   { background:rgba(246,173,85,0.15);  color:#f6ad55; }
.ticket-priority-normal { background:rgba(160,174,192,0.15); color:#a0aec0; }
.ticket-priority-low    { background:rgba(72,187,120,0.15);  color:#68d391; }

.ticket-card { /* reutilizar padrão .impl-card ou .kb-card */ }
.ticket-card-meta { display:flex; gap:12px; flex-wrap:wrap; font-size:0.75rem; color:var(--text-muted); margin-top:8px; }
```

---

### Task 5 — Integração geral
**Arquivo:** `js/app.js`

- `switchView()`: adicionar `case 'chamados': this.renderChamados(); break;`
- `renderAll()`: adicionar `this.renderChamados()` no `Promise.all`
- `closeModal('modal-chamado')`: resetar `this._currentTicket = null`
- Logout: limpar `this._otoboConfig = null`
- `lucide.createIcons()` após cada render que insere ícones

---

## Migration SQL Summary (rodar no Supabase antes do deploy)

```sql
-- 1. Tabela de configuração OTOBO por usuário
CREATE TABLE IF NOT EXISTS otobo_config (
  user_id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  url TEXT NOT NULL DEFAULT '', username TEXT NOT NULL DEFAULT '',
  password TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE otobo_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "otobo_config_user" ON otobo_config
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 2. Tabela de cache de tickets
CREATE TABLE IF NOT EXISTS tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  ticket_id TEXT NOT NULL, ticket_number TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT '', queue TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '', owner TEXT NOT NULL DEFAULT '',
  created_at_otobo TIMESTAMPTZ, updated_at_otobo TIMESTAMPTZ,
  raw_data JSONB DEFAULT '{}',
  linked_client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  synced_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tickets_user" ON tickets
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE UNIQUE INDEX idx_tickets_user_ticket ON tickets(user_id, ticket_id);
```

---

## Sequence de Implementação

1. Executar SQL migrations no Supabase *(pré-requisito)*
2. Task 1 — Store (métodos independentes de UI)
3. Task 2 — HTML (estrutura estática)
4. Task 4 — CSS (badges e cards)
5. Task 3 — AppController (lógica completa)
6. Task 5 — Integração (switchView, renderAll, logout)
7. Testar fluxo completo: configurar → sincronizar → ver cards → clicar detalhe

---

## Riscos e Mitigações

| Risco | Probabilidade | Mitigação |
|-------|--------------|-----------|
| CORS bloqueado no OTOBO | Alta | Mensagem de erro específica + orientação ao admin; testar primeiro via console do browser |
| Autenticação OTOBO Basic Auth vs Token | Média | OTOBO 10+ suporta Basic Auth via Generic Interface; verificar versão em uso |
| Nome do cliente OTOBO ≠ nome no TSP | Alta | Match fuzzy + seção "Sem cliente vinculado" como fallback |
| Volume alto de tickets (>500) | Baixa | Parâmetro `Limit` na busca + paginação futura |
| URL da API OTOBO varia por instalação | Média | Campo URL livre no config + documentar endpoint padrão no tooltip |

---

## Definition of Done

- [ ] SQL migrations executadas com sucesso no Supabase
- [ ] Nav item "Chamados" aparece e navega corretamente
- [ ] Empty state exibido quando OTOBO não configurado
- [ ] Modal de config abre, salva e fecha corretamente
- [ ] Botão Sincronizar busca tickets do OTOBO e salva no Supabase
- [ ] Tickets exibidos agrupados por cliente TSP
- [ ] Tickets sem vínculo aparecem em seção separada
- [ ] Badges de status e prioridade com cores corretas
- [ ] Modal de detalhe abre com artigos carregados
- [ ] Link "Abrir no OTOBO" funciona em nova aba
- [ ] Erros de OTOBO exibem toast descritivo
- [ ] Sidebar funciona colapsada (ícone + tooltip)
- [ ] Logout limpa estado da view
