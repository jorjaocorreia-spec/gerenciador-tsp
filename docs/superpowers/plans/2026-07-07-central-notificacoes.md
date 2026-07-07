# Central de Notificações Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um sino de notificações no sidebar do GerenciadorTSP que avisa consultores sobre melhorias/features novas, publicadas manualmente via script após cada entrega.

**Architecture:** Duas tabelas novas no Supabase (`app_notifications` global + `notification_reads` por usuário), 3 métodos novos em `TSPStore`, um botão de sino + popover em `AppController` (mesmo padrão do popup de RSVP da Agenda), e um script PowerShell standalone para publicar notificações via REST API do Supabase usando a `service_role` key.

**Tech Stack:** JavaScript ES6+ vanilla, Supabase (Postgres + RLS + REST), PowerShell, Lucide Icons.

## Global Constraints

- Visível **somente** para `app.userRole !== 'client'` (apenas consultores; Portal do Cliente nunca vê o sino).
- Conteúdo das notificações é **global** — mesma lista para todos os consultores, não há segmentação por usuário.
- Publicação é **sempre manual** via script — nada de parsing automático de commits/markdown nem geração de conteúdo por IA em tempo real.
- A `service_role` key do Supabase **nunca** é colada literalmente em nenhum arquivo do repositório — sempre lida de `$env:SUPABASE_SERVICE_ROLE_KEY` no momento da execução do script.
- Controle de leitura é só um timestamp agregado (`last_seen_at`) por usuário — sem marcação item-a-item.
- Se a query de notificações falhar (rede, tabela ausente, RLS), o sino fica oculto silenciosamente — sem toast de erro.
- Spec completa em `docs/superpowers/specs/2026-07-07-central-notificacoes-design.md`.

---

### Task 1: Migration SQL — tabelas e RLS

**Files:**
- Create: `supabase/migrations/20260707_notificacoes.sql`

**Interfaces:**
- Produces: tabelas `app_notifications(id, phase_label, title, description, created_at)` e `notification_reads(user_id, last_seen_at)`, consumidas pelos métodos de `store.js` na Task 3.

- [ ] **Step 1: Escrever o arquivo de migration**

```sql
-- Fase 47: Central de Notificações
CREATE TABLE IF NOT EXISTS app_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_label TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE app_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "consultants_read_notifications" ON app_notifications
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'consultant')
  );

CREATE TABLE IF NOT EXISTS notification_reads (
  user_id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE notification_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_notification_reads" ON notification_reads
  FOR ALL USING (auth.uid() = user_id);
```

- [ ] **Step 2: Aplicar a migration no Supabase**

Abrir https://supabase.com/dashboard/project/klimkamnydfnzqetqlqm/sql/new, colar o conteúdo do arquivo acima e executar.

- [ ] **Step 3: Verificar que as tabelas foram criadas**

No mesmo SQL Editor, rodar:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('app_notifications', 'notification_reads');
```

Expected: 2 linhas (`app_notifications`, `notification_reads`).

- [ ] **Step 4: Verificar que as policies de RLS existem**

```sql
SELECT tablename, policyname FROM pg_policies
WHERE tablename IN ('app_notifications', 'notification_reads');
```

Expected: 2 linhas (`consultants_read_notifications` em `app_notifications`, `users_own_notification_reads` em `notification_reads`).

- [ ] **Step 5: Commit**

```powershell
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.6.2\resources\app\git\cmd\git.exe"
& $git add supabase/migrations/20260707_notificacoes.sql
& $git commit -m "feat: migration da central de notificacoes"
```

(Confirmar antes se a versão do GitHub Desktop instalada ainda é `app-3.6.2` — rodar `Get-ChildItem "C:\Users\jorge\AppData\Local\GitHubDesktop" -Directory -Filter "app-*" | Sort-Object Name -Descending | Select-Object -First 1` se o comando falhar.)

---

### Task 2: Script de publicação

**Files:**
- Create: `Documentation/publish-notification.ps1`

**Interfaces:**
- Consumes: tabela `app_notifications` (Task 1) via REST API do Supabase.
- Produces: nenhuma interface de código — é uma ferramenta de linha de comando usada manualmente (Task 6 depende dela para o backfill).

- [ ] **Step 1: Escrever o script**

```powershell
param(
    [Parameter(Mandatory=$true)][string]$Phase,
    [Parameter(Mandatory=$true)][string]$Title,
    [Parameter(Mandatory=$true)][string]$Description
)

if (-not $env:SUPABASE_SERVICE_ROLE_KEY) {
    Write-Error "Defina `$env:SUPABASE_SERVICE_ROLE_KEY antes de rodar este script (Supabase Dashboard -> Settings -> API -> service_role key)."
    exit 1
}

$body = @{ phase_label = $Phase; title = $Title; description = $Description } | ConvertTo-Json

Invoke-RestMethod `
  -Uri "https://klimkamnydfnzqetqlqm.supabase.co/rest/v1/app_notifications" `
  -Method POST `
  -Headers @{
      "apikey"        = $env:SUPABASE_SERVICE_ROLE_KEY
      "Authorization" = "Bearer $env:SUPABASE_SERVICE_ROLE_KEY"
      "Content-Type"  = "application/json"
      "Prefer"        = "return=representation"
  } `
  -Body $body
```

- [ ] **Step 2: Rodar um teste manual**

```powershell
$env:SUPABASE_SERVICE_ROLE_KEY = "<colar temporariamente no terminal, nunca em arquivo>"
.\Documentation\publish-notification.ps1 -Phase "teste" -Title "Notificacao de teste" -Description "Descricao de teste."
```

Expected: o comando imprime o JSON do registro inserido, incluindo um `id` UUID.

- [ ] **Step 3: Verificar e limpar o registro de teste**

No SQL Editor do Supabase:

```sql
SELECT id, title FROM app_notifications WHERE phase_label = 'teste';
```

Expected: 1 linha com `title = 'Notificacao de teste'`.

```sql
DELETE FROM app_notifications WHERE phase_label = 'teste';
```

- [ ] **Step 4: Commit**

```powershell
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.6.2\resources\app\git\cmd\git.exe"
& $git add Documentation/publish-notification.ps1
& $git commit -m "feat: script de publicacao de notificacoes"
```

---

### Task 3: Métodos em `store.js`

**Files:**
- Modify: `js/store.js:1569` (imediatamente antes do `}` de fechamento da classe `TSPStore`, logo após `deleteAIConfig()`)

**Interfaces:**
- Consumes: `this.db` (supabaseClient), `this.userId` — já existentes em `TSPStore`.
- Produces:
  - `_notification(r)` → `{ id, phaseLabel, title, description, createdAt }`
  - `async getNotifications(limit = 20)` → `Promise<Array<{id, phaseLabel, title, description, createdAt}>>`
  - `async getLastSeenAt()` → `Promise<string|null>` (ISO timestamp ou `null` se o usuário nunca abriu o sino)
  - `async markNotificationsSeen()` → `Promise<void>`
  - Consumidos por `AppController` na Task 5.

- [ ] **Step 1: Adicionar o mapper e os 3 métodos**

Em `js/store.js`, localizar o método `deleteAIConfig()` (por volta da linha 1565) e inserir logo depois, ainda dentro da classe (antes do `}` de fechamento):

```javascript
    _notification(r) {
        return {
            id: r.id,
            phaseLabel: r.phase_label || '',
            title: r.title,
            description: r.description,
            createdAt: r.created_at
        };
    }

    async getNotifications(limit = 20) {
        const { data, error } = await this.db.from('app_notifications')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);
        if (error) throw error;
        return (data || []).map(r => this._notification(r));
    }

    async getLastSeenAt() {
        const { data } = await this.db.from('notification_reads')
            .select('last_seen_at')
            .eq('user_id', this.userId)
            .single();
        return data ? data.last_seen_at : null;
    }

    async markNotificationsSeen() {
        const { error } = await this.db.from('notification_reads').upsert({
            user_id: this.userId,
            last_seen_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
        if (error) throw error;
    }
```

- [ ] **Step 2: Verificar sintaxe**

```powershell
node --check js/store.js
```

Expected: nenhuma saída (exit code 0). Isso só valida sintaxe — o comportamento real depende do browser/supabase-js e será verificado na Task 8.

- [ ] **Step 3: Commit**

```powershell
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.6.2\resources\app\git\cmd\git.exe"
& $git add js/store.js
& $git commit -m "feat: metodos de notificacoes em TSPStore"
```

---

### Task 4: Ícone de sino + CSS

**Files:**
- Modify: `index.html:100-102` (dentro de `.sidebar-header`, entre `.brand` e o botão de toggle)
- Modify: `styles/main.css` (adicionar ao final do arquivo)

**Interfaces:**
- Produces: elementos DOM `#notif-bell` (botão), `#notif-badge` (span de contador) — consumidos por `AppController` na Task 5.

- [ ] **Step 1: Adicionar o botão de sino no HTML**

Em `index.html`, dentro de `<div class="sidebar-header">`, inserir o botão do sino **antes** do botão `#btn-sidebar-toggle` (linha ~100):

```html
            <button class="btn-sidebar-toggle" id="notif-bell" style="display:none; position:relative;" onclick="app.toggleNotifPanel()" title="Novidades">
                <i data-lucide="bell" style="width:18px;height:18px;"></i>
                <span class="notif-badge" id="notif-badge" style="display:none;"></span>
            </button>
```

O resultado deve ficar assim:

```html
        <div class="sidebar-header">
            <div class="brand">
                <span class="brand-icon"><i data-lucide="activity"></i></span>
                <span class="nav-label">TSP Manager</span>
            </div>
            <button class="btn-sidebar-toggle" id="notif-bell" style="display:none; position:relative;" onclick="app.toggleNotifPanel()" title="Novidades">
                <i data-lucide="bell" style="width:18px;height:18px;"></i>
                <span class="notif-badge" id="notif-badge" style="display:none;"></span>
            </button>
            <button class="btn-sidebar-toggle" id="btn-sidebar-toggle" onclick="app.toggleSidebar()" title="Recolher menu">
                <i data-lucide="chevron-left" id="icon-sidebar-toggle" style="width:18px;height:18px;"></i>
            </button>
        </div>
```

- [ ] **Step 2: Adicionar o CSS**

No final de `styles/main.css`, adicionar:

```css
/* ===== Central de Notificações ===== */
.notif-badge {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: #ff4d4f;
    color: #fff;
    font-size: 0.65rem;
    font-weight: 700;
    line-height: 16px;
    text-align: center;
}

.notif-panel {
    position: fixed;
    z-index: 9999;
    background: var(--bg-glass, rgba(30, 30, 50, 0.95));
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 10px;
    padding: 10px;
    width: 320px;
    max-height: 420px;
    overflow-y: auto;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
}

.notif-panel-header {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--text-main);
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
}

.notif-item {
    padding: 8px 4px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    position: relative;
}

.notif-item:last-child {
    border-bottom: none;
}

.notif-item--new {
    padding-left: 14px;
}

.notif-item--new::before {
    content: '';
    position: absolute;
    left: 0;
    top: 14px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--primary-color, #8b5cf6);
}

.notif-item-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
}

.notif-item-title {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-main);
}

.notif-item-date {
    font-size: 0.68rem;
    color: var(--text-muted);
    flex-shrink: 0;
    white-space: nowrap;
}

.notif-item-desc {
    font-size: 0.78rem;
    color: var(--text-muted);
    margin-top: 4px;
    line-height: 1.4;
}

.notif-empty {
    font-size: 0.8rem;
    color: var(--text-muted);
    text-align: center;
    padding: 16px 0;
}
```

- [ ] **Step 3: Verificar visualmente que o botão existe no DOM**

```powershell
python -m http.server 8080
```

Abrir `http://localhost:8080/index.html`, abrir o DevTools (F12) e no console rodar:

```javascript
document.getElementById('notif-bell')
```

Expected: retorna o elemento `<button>` (não `null`). Ele fica invisível (`display:none`) até o login, o que é esperado nesta etapa. Parar o servidor com Ctrl+C depois.

- [ ] **Step 4: Commit**

```powershell
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.6.2\resources\app\git\cmd\git.exe"
& $git add index.html styles/main.css
& $git commit -m "feat: icone de sino de notificacoes no sidebar"
```

---

### Task 5: Lógica em `AppController` (`js/app.js`)

**Files:**
- Modify: `js/app.js` (constructor, `initAfterAuth()`, novos métodos, handler de logout)

**Interfaces:**
- Consumes: `store.getNotifications()`, `store.getLastSeenAt()`, `store.markNotificationsSeen()` (Task 3); elementos `#notif-bell`/`#notif-badge` (Task 4); `this._relativeDate(isoStr)` (já existe em `app.js:10450`).
- Produces: `app._initNotifications()`, `app.toggleNotifPanel()`, `app.openNotifPanel()`, `app.closeNotifPanel()` — usados apenas internamente/via `onclick` do HTML.

- [ ] **Step 1: Adicionar campos de estado no constructor**

Localizar `this.userRole = null;` por volta da linha 62 em `js/app.js` e adicionar logo abaixo:

```javascript
        this._notifications = [];          // lista cacheada de app_notifications
        this._notificationsLastSeenAt = null; // ISO string ou null
        this._closeNotifOnOutsideClick = null;
```

- [ ] **Step 2: Disparar o carregamento após login**

Em `initAfterAuth()`, localizar a linha `await this.renderAll();` (por volta da linha 2023) e adicionar logo antes:

```javascript
        this._initNotifications().catch(() => {});
```

Resultado esperado ao redor:

```javascript
        store.getHideDeclinedSetting().then(val => {
            this._hideDeclinedEvents = val;
            this._updateHideDeclinedBtn();
        }).catch(() => {});
        this._initNotifications().catch(() => {});
        await this.renderAll();
```

- [ ] **Step 3: Implementar os métodos de notificação**

Adicionar estes métodos na classe `AppController` (por exemplo, logo após o método `_relativeDate(isoStr)` em `js/app.js:10461`):

```javascript
    async _initNotifications() {
        const bell = document.getElementById('notif-bell');
        if (!bell) return;
        const [notifications, lastSeenAt] = await Promise.all([
            store.getNotifications(),
            store.getLastSeenAt()
        ]);
        this._notifications = notifications;
        this._notificationsLastSeenAt = lastSeenAt;
        bell.style.display = 'flex';
        this._updateNotifBadge();
    }

    _updateNotifBadge() {
        const badge = document.getElementById('notif-badge');
        if (!badge) return;
        const lastSeenAt = this._notificationsLastSeenAt;
        const unread = this._notifications.filter(n => !lastSeenAt || n.createdAt > lastSeenAt).length;
        if (unread > 0) {
            badge.textContent = unread > 9 ? '9+' : String(unread);
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }

    toggleNotifPanel() {
        if (document.getElementById('notif-panel-active')) {
            this.closeNotifPanel();
        } else {
            this.openNotifPanel();
        }
    }

    openNotifPanel() {
        this.closeNotifPanel();
        const bell = document.getElementById('notif-bell');
        if (!bell) return;

        const previousLastSeenAt = this._notificationsLastSeenAt;

        const itemsHtml = this._notifications.length
            ? this._notifications.map(n => {
                const isNew = !previousLastSeenAt || n.createdAt > previousLastSeenAt;
                return `
                    <div class="notif-item ${isNew ? 'notif-item--new' : ''}">
                        <div class="notif-item-header">
                            <span class="notif-item-title">${n.title}</span>
                            <span class="notif-item-date">${this._relativeDate(n.createdAt)}</span>
                        </div>
                        <p class="notif-item-desc">${n.description}</p>
                    </div>`;
            }).join('')
            : '<p class="notif-empty">Nenhuma novidade por enquanto.</p>';

        const panel = document.createElement('div');
        panel.className = 'notif-panel';
        panel.id = 'notif-panel-active';
        panel.innerHTML = `
            <div class="notif-panel-header">Novidades</div>
            <div class="notif-panel-list">${itemsHtml}</div>
        `;
        document.body.appendChild(panel);

        const rect = bell.getBoundingClientRect();
        panel.style.top = (rect.bottom + 8) + 'px';
        panel.style.left = rect.left + 'px';

        setTimeout(() => {
            this._closeNotifOnOutsideClick = (ev) => {
                if (!panel.contains(ev.target) && !bell.contains(ev.target)) {
                    this.closeNotifPanel();
                }
            };
            document.addEventListener('click', this._closeNotifOnOutsideClick);
        }, 0);

        this._notificationsLastSeenAt = new Date().toISOString();
        this._updateNotifBadge();
        store.markNotificationsSeen().catch(() => {});
    }

    closeNotifPanel() {
        const existing = document.getElementById('notif-panel-active');
        if (existing) existing.remove();
        if (this._closeNotifOnOutsideClick) {
            document.removeEventListener('click', this._closeNotifOnOutsideClick);
            this._closeNotifOnOutsideClick = null;
        }
    }
```

- [ ] **Step 4: Resetar o estado no logout**

Em `js/app.js`, dentro do handler `document.getElementById('btn-logout').addEventListener('click', ...)` (por volta da linha 10922), adicionar junto aos outros resets de cache (perto de `window.app._rsvpPopupEventId = null;`):

```javascript
            window.app._notifications = [];
            window.app._notificationsLastSeenAt = null;
            window.app.closeNotifPanel();
            const notifBell = document.getElementById('notif-bell');
            if (notifBell) notifBell.style.display = 'none';
```

- [ ] **Step 5: Verificar sintaxe**

```powershell
node --check js/app.js
```

Expected: nenhuma saída (exit code 0).

- [ ] **Step 6: Commit**

```powershell
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.6.2\resources\app\git\cmd\git.exe"
& $git add js/app.js
& $git commit -m "feat: logica do sino de notificacoes em AppController"
```

---

### Task 6: Backfill do histórico (fases 40-47)

**Files:** nenhum arquivo de código — apenas execução do script da Task 2 contra o Supabase de produção.

**Interfaces:**
- Consumes: `Documentation/publish-notification.ps1` (Task 2), já aplicado contra a tabela real (Task 1 já foi migrada em produção).

- [ ] **Step 1: Publicar as notificações das fases 40 a 47**

```powershell
$env:SUPABASE_SERVICE_ROLE_KEY = "<colar temporariamente no terminal>"

.\Documentation\publish-notification.ps1 -Phase "40" -Title "Gerador de apontamentos com IA" `
  -Description "Agora e possivel gerar automaticamente o apontamento do dia a partir das tarefas concluidas, comentadas ou editadas — a IA escreve a descricao pra voce."

.\Documentation\publish-notification.ps1 -Phase "41" -Title "Cobertura de agenda por cliente" `
  -Description "Novo painel mostra o panorama de atendimentos agendados comparado ao contrato mensal de cada cliente."

.\Documentation\publish-notification.ps1 -Phase "42" -Title "Confirmacao de presenca na Agenda" `
  -Description "Eventos de convite agora tem RSVP (Sim/Talvez/Nao) direto na Agenda, com opcao de ocultar os declinados."

.\Documentation\publish-notification.ps1 -Phase "43" -Title "Painel de Produtividade" `
  -Description "Acompanhe a meta semanal de horas versus o realizado, com feriados nacionais e manuais considerados automaticamente, saldo acumulado e exportacao em PDF."

.\Documentation\publish-notification.ps1 -Phase "44" -Title "Cobranca por hora" `
  -Description "Clientes agora podem ser configurados com cobranca Por Hora (horas x valor/hora), alem do modelo de Valor Fixo ja existente."

.\Documentation\publish-notification.ps1 -Phase "45" -Title "Portal do Cliente" `
  -Description "Clientes agora podem ter acesso proprio ao sistema, com visao read-only do quadro Kanban das suas tarefas."

.\Documentation\publish-notification.ps1 -Phase "46" -Title "Painel de Indicadores" `
  -Description "Novo painel de evolucao do cliente: KPIs, grafico mensal de tarefas, distribuicao por status/prioridade, timeline do projeto e resumo com chat de IA."

.\Documentation\publish-notification.ps1 -Phase "47" -Title "Central de Notificacoes" `
  -Description "Agora voce recebe um aviso, direto no sistema, sempre que lancarmos uma melhoria ou funcionalidade nova. Clique no sino ao lado do menu para ver as novidades."
```

- [ ] **Step 2: Verificar que as 8 notificações foram inseridas**

No SQL Editor do Supabase:

```sql
SELECT phase_label, title FROM app_notifications ORDER BY created_at;
```

Expected: 8 linhas, fases `40` a `47` em ordem.

---

### Task 7: Atualizar `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:** nenhuma — apenas documentação.

- [ ] **Step 1: Adicionar a fase à tabela "Fases implementadas"**

Localizar a última linha da tabela (fase 46, Painel de Indicadores) e adicionar logo depois:

```markdown
| 47 | Central de Notificações: aviso in-app de melhorias/novas features, publicado manualmente via script (`app_notifications` + `notification_reads`), sino no sidebar visível só para consultores |
```

- [ ] **Step 2: Adicionar seção de armadilhas conhecidas**

Adicionar, junto às demais seções de armadilhas por feature (por exemplo, logo antes de "### Cálculos automáticos"), uma nova seção:

```markdown
### Central de Notificações — armadilhas conhecidas

- **Publicação é sempre manual, nunca automática** — não há parsing de commits ou da tabela de fases; toda vez que uma feature for concluída e documentada aqui no CLAUDE.md, rodar `Documentation/publish-notification.ps1` com título/descrição em linguagem amigável ao usuário final (não a redação técnica desta tabela).
- **`app_notifications` só aceita INSERT via `service_role` key** — não há policy de INSERT para usuários autenticados; qualquer tentativa de inserir pelo client (browser) falha por RLS. Isso é deliberado, para nenhum consultor conseguir forjar uma notificação pelo console do navegador.
- **Sino só aparece para `app.userRole !== 'client'`** — Portal do Cliente nunca vê notificações do sistema.
- **Controle de leitura é um único timestamp por usuário (`notification_reads.last_seen_at`)** — não há marcação item-a-item; abrir o painel marca tudo como visto de uma vez.
- **Falha tolerante**: se `store.getNotifications()`/`getLastSeenAt()` falhar (rede, RLS, tabela ausente), `#notif-bell` permanece com `display:none` — sem toast de erro.
```

- [ ] **Step 3: Commit**

```powershell
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.6.2\resources\app\git\cmd\git.exe"
& $git add CLAUDE.md
& $git commit -m "docs: documenta central de notificacoes"
```

---

### Task 8: Deploy e verificação end-to-end

**Files:** nenhum arquivo novo — deploy manual + script de verificação descartável.

**Interfaces:**
- Consumes: todo o trabalho das Tasks 1-7, já em produção após o deploy.

- [ ] **Step 1: Push para o GitHub**

```powershell
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.6.2\resources\app\git\cmd\git.exe"
& $git push origin main
```

- [ ] **Step 2: Deploy manual no Easypanel**

Avisar o usuário para fazer o deploy manual no Easypanel (webhook automático está quebrado, conforme já documentado no CLAUDE.md) antes de prosseguir para o teste end-to-end.

- [ ] **Step 3: Escrever o script de verificação Playwright**

Criar `C:\Users\jorge\AppData\Local\Temp\playwright-test-notif.js` (fora do repositório):

```javascript
const { chromium } = require('playwright');

const TARGET_URL = 'https://jorge-gerenciador-tsp.27pl2o.easypanel.host';

(async () => {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    await page.goto(TARGET_URL);
    await page.fill('#auth-email', 'testes@teste.com');
    await page.fill('#auth-password', '123testes');
    await page.click('#auth-submit');
    await page.waitForSelector('#notif-bell', { state: 'visible', timeout: 15000 });

    const badgeVisible = await page.isVisible('#notif-badge');
    console.log('Badge visível após login:', badgeVisible);

    await page.click('#notif-bell');
    await page.waitForSelector('#notif-panel-active', { timeout: 5000 });
    const itemCount = await page.locator('.notif-item').count();
    console.log('Itens no painel de notificações:', itemCount);

    const badgeVisibleAfterOpen = await page.isVisible('#notif-badge');
    console.log('Badge visível após abrir o painel (esperado: false):', badgeVisibleAfterOpen);

    await browser.close();
})();
```

- [ ] **Step 4: Rodar o script**

```powershell
cd d:\GerenciadorTSP\skills\playwright-skill
node run.js "C:\Users\jorge\AppData\Local\Temp\playwright-test-notif.js"
```

Expected: `Badge visível após login: true`, `Itens no painel de notificações: 8` (ou mais, se novas notificações forem publicadas depois), `Badge visível após abrir o painel (esperado: false): false`.

- [ ] **Step 5: Reportar o resultado ao usuário**

Se todos os 3 valores baterem com o esperado, a feature está funcionando end-to-end em produção. Se algo divergir, investigar antes de reportar como concluído (nunca reportar sucesso sem essa verificação, conforme prática já estabelecida no projeto).
