# Nível de Acesso "Gerente" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um terceiro papel de usuário, `manager`, que enxerga (somente leitura) os dados de todos os consultores, sem deixar de operar sua própria carteira como um consultor normal.

**Architecture:** `store.userId` hoje é um getter (`get userId() { return Auth.getUserId(); }`) — vira `get userId() { return this.viewingAsUserId || Auth.getUserId(); }`, um override settável. Ao entrar em "Modo Supervisão", `store.viewingAsUserId` recebe o ID de outro consultor e **todas as telas/métodos existentes continuam funcionando sem alteração**, pois já filtram por `this.userId` internamente. Um `Proxy` envolvendo a instância do `store` bloqueia (com erro amigável) qualquer método que não comece com `get`/`_` enquanto o modo estiver ativo — defesa em profundidade complementar às novas policies RLS (que já impedem escrita cross-user no banco). Entrar/sair do modo é feito via `sessionStorage` + `location.reload()`, evitando ter que invalidar manualmente as ~10 caches em memória do `AppController`.

**Tech Stack:** JavaScript vanilla ES6+ (sem build step), Supabase (Postgres + RLS + Edge Functions Deno), Supabase Management API para aplicar SQL sem navegador.

## Global Constraints

- Nenhuma edição real de dados de outro consultor pode ocorrer — nem via UI, nem via chamada direta ao `store` no console do navegador, nem via API REST do Supabase (RLS é a barreira final).
- `otobo_config` e `user_ai_config` NUNCA recebem policy de leitura para `manager` — não expor credenciais de outro consultor.
- O papel `manager` continua sendo, por padrão, um consultor pleno (CRUD total nos próprios dados) — o modo supervisão é 100% opt-in.
- Seguir convenção do projeto: todo método de leitura em `store.js` começa com `get` (ou `_` para mappers/funções puras); todo método de escrita usa outro verbo (`add`/`update`/`delete`/`set`/`save`/`upsert`/`reorder`/`toggle`/`mark`/`ensure`/`revoke`/`invite`). O guard da Task 4 depende dessa convenção já existente — não introduzir um novo método de leitura sem prefixo `get`/`_`.
- Deploy da Edge Function requer `SUPABASE_ACCESS_TOKEN` (token pessoal do usuário, nunca expira — ver referência de memória `reference_supabase_token`).
- Deploy automático (webhook Easypanel) está quebrado — lembrar o usuário de fazer deploy manual após o push final.
- Sempre `git push origin main` depois de cada commit (convenção do projeto).

---

### Task 1: Migration SQL — papel `manager` + RLS cross-user somente leitura

**Files:**
- Create: `supabase/migrations/20260729_manager_role.sql`

**Interfaces:**
- Produces: `user_roles.role` aceita `'manager'` além de `'consultant'`/`'client'`. Novas policies `managers_read_all_<tabela>` (SELECT) em `clients`, `records`, `tasks`, `kanban_columns`, `agenda_events`, `apontamentos`, `implementations`, `implementation_clients`, `tickets`. Consumidas pelas Tasks 4–9 (nenhuma delas funciona sem esta migration aplicada).

- [ ] **Step 1: Escrever a migration**

```sql
-- Fase 49: Nível de acesso "Gerente" — supervisor somente-leitura cross-consultor
-- Gerente é, por padrão, um consultor pleno; a leitura cross-user é aditiva e
-- ativada via user_roles.role = 'manager'. Nenhuma policy de escrita é criada
-- para managers — INSERT/UPDATE/DELETE continuam exigindo auth.uid() = user_id.

ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_check
    CHECK (role IN ('consultant', 'client', 'manager'));

CREATE POLICY "managers_read_all_clients" ON clients FOR SELECT
    USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'manager'));

CREATE POLICY "managers_read_all_records" ON records FOR SELECT
    USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'manager'));

CREATE POLICY "managers_read_all_tasks" ON tasks FOR SELECT
    USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'manager'));

CREATE POLICY "managers_read_all_kanban_columns" ON kanban_columns FOR SELECT
    USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'manager'));

CREATE POLICY "managers_read_all_agenda_events" ON agenda_events FOR SELECT
    USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'manager'));

CREATE POLICY "managers_read_all_apontamentos" ON apontamentos FOR SELECT
    USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'manager'));

CREATE POLICY "managers_read_all_implementations" ON implementations FOR SELECT
    USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'manager'));

CREATE POLICY "managers_read_all_implementation_clients" ON implementation_clients FOR SELECT
    USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'manager'));

CREATE POLICY "managers_read_all_tickets" ON tickets FOR SELECT
    USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'manager'));
```

- [ ] **Step 2: Aplicar via Supabase Management API**

```powershell
# Token pessoal de Jorge — ver memória reference_supabase_token (nunca expira); não colar o valor literal aqui.
$env:SUPABASE_ACCESS_TOKEN = "<token pessoal — ver memória reference_supabase_token>"
$sql = Get-Content -Raw "d:\GerenciadorTSP\supabase\migrations\20260729_manager_role.sql"
Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/klimkamnydfnzqetqlqm/database/query" `
  -Method POST `
  -Headers @{ "Authorization" = "Bearer $env:SUPABASE_ACCESS_TOKEN"; "Content-Type" = "application/json" } `
  -Body (@{ query = $sql } | ConvertTo-Json)
```

- [ ] **Step 3: Verificar que a constraint e as policies foram criadas**

```powershell
$verify = @"
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'user_roles_role_check';
SELECT policyname, tablename FROM pg_policies WHERE policyname LIKE 'managers_read_all_%' ORDER BY tablename;
"@
Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/klimkamnydfnzqetqlqm/database/query" `
  -Method POST `
  -Headers @{ "Authorization" = "Bearer $env:SUPABASE_ACCESS_TOKEN"; "Content-Type" = "application/json" } `
  -Body (@{ query = $verify } | ConvertTo-Json)
```

Expected: a primeira query retorna a constraint com `role = ANY (ARRAY['consultant'::text, 'client'::text, 'manager'::text])`; a segunda retorna exatamente 9 linhas (uma por tabela listada no Step 1).

- [ ] **Step 4: Commit**

```powershell
$git = (Get-ChildItem "C:\Users\jorge\AppData\Local\GitHubDesktop" -Directory -Filter "app-*" | Sort-Object Name -Descending | Select-Object -First 1).FullName + "\resources\app\git\cmd\git.exe"
& $git add supabase/migrations/20260729_manager_role.sql
& $git commit -m "feat(db): papel manager + RLS somente-leitura cross-consultor"
```

---

### Task 2: Edge Function `manage-users` — aceitar papel `manager`

**Files:**
- Modify: `supabase/functions/manage-users/index.ts:51`, `:57-81`, `:85`

**Interfaces:**
- Consumes: `user_roles.role IN ('consultant','client','manager')` (Task 1).
- Produces: `action:'list'` chamável por `role IN ('consultant','manager')` (necessário para o seletor de consultor da Task 6); `action:'invite'` aceita `role:'manager'` sem exigir `clientId`; `action:'invite'/'revoke'/'resend'` continuam exigindo `role === 'consultant'` no chamador.

- [ ] **Step 1: Ampliar o gate de entrada para permitir `manager` chamar a function**

Em `supabase/functions/manage-users/index.ts:51`, trocar:

```ts
    if (!callerRole || callerRole.role !== "consultant") {
      return jsonResponse({ error: "Apenas consultores podem gerenciar usuários." }, 403);
    }
```

por:

```ts
    if (!callerRole || (callerRole.role !== "consultant" && callerRole.role !== "manager")) {
      return jsonResponse({ error: "Apenas consultores ou gerentes podem acessar esta função." }, 403);
    }
```

- [ ] **Step 2: Restringir `invite`/`revoke`/`resend` a `consultant`**

Logo após `const { action, email, role, clientId, userId } = await req.json();` (linha 55), adicionar:

```ts
    if (action !== "list" && callerRole.role !== "consultant") {
      return jsonResponse({ error: "Apenas consultores podem convidar, revogar ou reenviar acesso." }, 403);
    }
```

- [ ] **Step 3: Aceitar `role === 'manager'` no `invite`**

Em `supabase/functions/manage-users/index.ts:85`, trocar:

```ts
      if (role !== "consultant" && role !== "client") return jsonResponse({ error: "Papel inválido." }, 400);
```

por:

```ts
      if (role !== "consultant" && role !== "client" && role !== "manager") return jsonResponse({ error: "Papel inválido." }, 400);
```

(`role === "manager"` cai no mesmo ramo de `client_id: null` já existente na linha seguinte — nenhuma outra mudança necessária nesse bloco.)

- [ ] **Step 4: Deploy da function**

```powershell
$env:SUPABASE_ACCESS_TOKEN = "<token pessoal — ver memória reference_supabase_token>"
npx supabase@latest functions deploy manage-users --project-ref klimkamnydfnzqetqlqm
```

Expected: saída `Deployed Function manage-users`.

- [ ] **Step 5: Commit**

```powershell
& $git add supabase/functions/manage-users/index.ts
& $git commit -m "feat(auth): manage-users aceita papel manager (list liberado, invite/revoke restrito a consultant)"
```

---

### Task 3: UI de convite — opção "Gerente" + rótulo na listagem

**Files:**
- Modify: `index.html:1424-1427` (select `#invite-role`)
- Modify: `js/app.js:10622` (`roleLabel` em `renderUsers()`)

**Interfaces:**
- Consumes: Edge Function `manage-users` aceitando `role:'manager'` (Task 2).
- Produces: nenhuma interface nova consumida por outra task — mudança isolada de UI.

- [ ] **Step 1: Adicionar a opção no select de convite**

Em `index.html:1424-1427`, trocar:

```html
                    <select id="invite-role" class="form-control" onchange="app.toggleInviteRoleFields()">
                        <option value="client" selected>Cliente (somente leitura de Tarefas)</option>
                        <option value="consultant">Consultor (acesso total)</option>
                    </select>
```

por:

```html
                    <select id="invite-role" class="form-control" onchange="app.toggleInviteRoleFields()">
                        <option value="client" selected>Cliente (somente leitura de Tarefas)</option>
                        <option value="consultant">Consultor (acesso total)</option>
                        <option value="manager">Gerente (supervisor de todos os consultores)</option>
                    </select>
```

`toggleInviteRoleFields()` não precisa mudar: `isClient = role === 'client'` já esconde o campo de cliente vinculado para qualquer outro valor, incluindo `manager`.

- [ ] **Step 2: Adicionar o rótulo "Gerente" na tabela de usuários**

Em `js/app.js:10622`, trocar:

```js
        const roleLabel = { consultant: 'Consultor', client: 'Cliente' };
```

por:

```js
        const roleLabel = { consultant: 'Consultor', client: 'Cliente', manager: 'Gerente' };
```

- [ ] **Step 3: Verificação manual**

Rodar `python -m http.server 8080` a partir de `d:\GerenciadorTSP`, logar como `testes@teste.com`, abrir "Usuários" → "Convidar" → confirmar que a opção "Gerente (supervisor de todos os consultores)" aparece no select e que o campo "Cliente vinculado" fica oculto quando ela é selecionada.

- [ ] **Step 4: Commit**

```powershell
& $git add index.html js/app.js
& $git commit -m "feat(usuarios): opcao de convite para papel Gerente"
```

---

### Task 4: `store.js` — override de `userId` + guard de escrita

**Files:**
- Modify: `js/store.js:3` (getter `userId`)
- Modify: `js/store.js:1644` (instanciação `window.store`)

**Interfaces:**
- Produces: `store.viewingAsUserId` (string UUID ou `null`) — quando setado, todo método de `store.js` passa a operar sobre esse `user_id` em vez do usuário logado. `store.isManagerView` (boolean) — quando `true`, qualquer método de escrita (nome não iniciado por `get`/`_`) rejeita com `Error('Modo de visualização: ação bloqueada. Saia do modo supervisão para editar.')` antes de tocar o banco. Consumido pelas Tasks 5–9.

- [ ] **Step 1: Trocar o getter `userId`**

Em `js/store.js:3`, trocar:

```js
    get userId() { return Auth.getUserId(); }
```

por:

```js
    get userId() { return this.viewingAsUserId || Auth.getUserId(); }
```

- [ ] **Step 2: Envolver a instância com o guard de escrita**

Em `js/store.js:1644`, trocar:

```js
window.store = new TSPStore();
```

por:

```js
// Modo Supervisão (papel Gerente, Fase 49): quando `isManagerView` está ativo,
// bloqueia qualquer método que não seja leitura (nome não iniciado por get/_)
// antes de chegar ao banco. Defesa em profundidade — a RLS (Task 1) já nega
// escrita cross-user; este guard só dá feedback imediato e amigável na UI.
function _wrapStoreWithManagerGuard(storeInstance) {
    const BLOCKED_MESSAGE = 'Modo de visualização: ação bloqueada. Saia do modo supervisão para editar.';
    return new Proxy(storeInstance, {
        get(target, prop) {
            const value = Reflect.get(target, prop, target);
            if (typeof value !== 'function') return value;
            if (typeof prop === 'string' && (prop.startsWith('get') || prop.startsWith('_'))) {
                return value.bind(target);
            }
            return function guardedStoreMethod(...args) {
                if (target.isManagerView) {
                    return Promise.reject(new Error(BLOCKED_MESSAGE));
                }
                return value.apply(target, args);
            };
        }
    });
}

window.store = _wrapStoreWithManagerGuard(new TSPStore());
window.store.isManagerView = false;
window.store.viewingAsUserId = null;
```

- [ ] **Step 3: Verificação manual no console do navegador**

Com o app aberto e logado, no DevTools console:

```js
store.isManagerView = true;
await store.addTask({ clientId: null, title: 'teste guard' }).catch(e => console.log('BLOQUEADO:', e.message));
store.isManagerView = false;
await store.getTasks(); // deve funcionar normalmente
```

Expected: a primeira chamada imprime `BLOQUEADO: Modo de visualização: ação bloqueada...`; a segunda retorna a lista de tarefas normalmente (prova que leitura nunca é afetada pelo guard).

- [ ] **Step 4: Commit**

```powershell
& $git add js/store.js
& $git commit -m "feat(store): viewingAsUserId override + guard de escrita para Modo Supervisao"
```

---

### Task 5: `AppController` — estado do Modo Supervisão + restauração no login

**Files:**
- Modify: `js/app.js:80` (constructor)
- Modify: `js/app.js:2211-2248` (`initAfterAuth`)

**Interfaces:**
- Consumes: `store.viewingAsUserId`/`store.isManagerView` (Task 4).
- Produces: `this.isManagerView` (boolean, instância de `AppController`); leitura de `sessionStorage.tsp_manager_viewing_as` / `tsp_manager_viewing_as_email` no boot. Consumido pelas Tasks 6, 7 e 9.

- [ ] **Step 1: Adicionar o flag no constructor**

Em `js/app.js:80`, logo abaixo de `this.userRole = null;`, adicionar:

```js
        this.isManagerView = false;  // true quando um 'manager' está supervisionando outro consultor
```

- [ ] **Step 2: Restaurar o Modo Supervisão no boot, quando aplicável**

Em `js/app.js`, dentro de `initAfterAuth()` (linhas 2211-2248), entre a linha 2220 (`this.userClientId = roleRow.clientId;`) e a linha 2222 (`if (this.userRole === 'client') {`), adicionar:

```js
        if (this.userRole === 'manager') {
            const viewingAs = sessionStorage.getItem('tsp_manager_viewing_as');
            if (viewingAs) {
                store.viewingAsUserId = viewingAs;
                store.isManagerView = true;
                this.isManagerView = true;
            }
        }
```

- [ ] **Step 3: Não carregar configs pessoais (Google/IA/notificações) enquanto estiver supervisionando outro consultor**

Em `js/app.js:2236-2246`, envolver o bloco existente com a checagem `!this.isManagerView` — trocar:

```js
        const settings = await store.getUserSettings();
        if (settings && settings.googleClientId && settings.googleApiKey) {
            await calendarAPI.configure(settings.googleClientId, settings.googleApiKey);
        }
        // Carrega config de IA em background (não bloqueia o render)
        aiClient.loadConfig().then(() => this._updateAIStatusBadge());
        store.getHideDeclinedSetting().then(val => {
            this._hideDeclinedEvents = val;
            this._updateHideDeclinedBtn();
        }).catch(() => {});
        this._initNotifications().catch(() => {});
```

por:

```js
        if (!this.isManagerView) {
            const settings = await store.getUserSettings();
            if (settings && settings.googleClientId && settings.googleApiKey) {
                await calendarAPI.configure(settings.googleClientId, settings.googleApiKey);
            }
            // Carrega config de IA em background (não bloqueia o render)
            aiClient.loadConfig().then(() => this._updateAIStatusBadge());
            store.getHideDeclinedSetting().then(val => {
                this._hideDeclinedEvents = val;
                this._updateHideDeclinedBtn();
            }).catch(() => {});
            this._initNotifications().catch(() => {});
        }
```

(Motivo: essas chamadas usam `this.userId`, que já é o do consultor supervisionado nesse ponto — configurar o Google Calendar/IA do app com credenciais de outra pessoa, ou marcar notificações do sistema como lidas em nome dela, não faz sentido em modo leitura.)

- [ ] **Step 4: Verificação manual**

No console do navegador, logado como qualquer usuário: `sessionStorage.setItem('tsp_manager_viewing_as', 'qualquer-uuid'); location.reload();` — como `this.userRole` não será `'manager'` para esse usuário de teste, o bloco do Step 2 não deve executar (`this.isManagerView` permanece `false`). Confirma que a restauração só ocorre para o papel correto. `sessionStorage.removeItem('tsp_manager_viewing_as')` para limpar depois do teste.

- [ ] **Step 5: Commit**

```powershell
& $git add js/app.js
& $git commit -m "feat(app): estado isManagerView + restauracao do Modo Supervisao no boot"
```

---

### Task 6: Botão + modal seletor de consultor + entrada no Modo Supervisão

**Files:**
- Modify: `index.html:153-179` (sidebar-bottom — novo botão)
- Modify: `index.html` (novo modal, inserir após o modal `modal-invite-user`, ou seja após a linha que hoje é `1438` antes da edição da Task 3 somar 1 linha ao arquivo)
- Modify: `js/app.js` (novas funções: `openManagerSupervisorPicker`, `enterManagerView`)
- Modify: `js/app.js:2226-2229` (`initAfterAuth`, exibir o botão quando `userRole === 'manager'`)

**Interfaces:**
- Consumes: `this._manageUsersFetch('list')` (já existe, `js/app.js:11368`); `this.isManagerView`/`store.viewingAsUserId` (Task 4/5).
- Produces: `sessionStorage.tsp_manager_viewing_as` / `tsp_manager_viewing_as_email` — consumidos pela Task 5 (restauração) e Task 7 (banner).

- [ ] **Step 1: Botão na sidebar, oculto por padrão**

Em `index.html:153-154`, logo depois de `<p class="text-muted sidebar-section-label">SISTEMA</p>`, adicionar:

```html
            <button class="btn btn-secondary" id="btn-manager-supervisor" style="width:100%; margin-bottom:8px; display:none;" onclick="app.openManagerSupervisorPicker()" title="Ver outro consultor">
                <i data-lucide="eye"></i><span class="nav-label"> Ver outro consultor</span>
            </button>
```

- [ ] **Step 2: Modal seletor de consultor**

Em `index.html`, logo após o fechamento do modal `modal-invite-user` (a `</div>` final que fecha `id="modal-invite-user"`), adicionar:

```html
    <!-- MODAL: SUPERVISÃO GERENCIAL — ESCOLHER CONSULTOR -->
    <div class="modal-overlay" id="modal-manager-supervisor">
        <div class="modal glass" style="max-width:480px;">
            <div class="modal-header">
                <h2>Ver outro consultor</h2>
                <button class="close-modal" onclick="app.closeModal('modal-manager-supervisor')"><i data-lucide="x"></i></button>
            </div>
            <p class="text-muted" style="padding: 0 24px 12px; font-size: 0.85rem;">
                Modo somente leitura — você verá as telas exatamente como aquele consultor, sem poder editar nada.
            </p>
            <div id="manager-supervisor-list" style="padding: 0 24px 20px; max-height: 50vh; overflow-y: auto;"></div>
        </div>
    </div>
```

- [ ] **Step 3: Funções de abrir o seletor e entrar no modo**

Em `js/app.js`, logo após a função `resendUserInvite` (após o fechamento em `js/app.js:10713`), adicionar:

```js
    async openManagerSupervisorPicker() {
        const container = document.getElementById('manager-supervisor-list');
        container.innerHTML = '<p class="text-muted">Carregando...</p>';
        this.openModal('modal-manager-supervisor');
        try {
            const result = await this._manageUsersFetch('list');
            const myId = Auth.getUserId();
            const candidates = result.users.filter(u =>
                (u.role === 'consultant' || u.role === 'manager') && u.userId !== myId
            );
            if (candidates.length === 0) {
                container.innerHTML = '<p class="text-muted">Nenhum outro consultor cadastrado.</p>';
                return;
            }
            container.innerHTML = candidates.map(u => `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--surface-border);">
                    <span>${escapeHtml(u.email)}</span>
                    <button class="btn btn-primary btn-sm" onclick="app.enterManagerView('${u.userId}', '${escapeHtml(u.email)}')">
                        <i data-lucide="eye" style="width:13px;height:13px"></i> Visualizar
                    </button>
                </div>`).join('');
            lucide.createIcons();
        } catch (err) {
            container.innerHTML = `<p class="text-muted">Erro ao carregar consultores: ${escapeHtml(err.message)}</p>`;
        }
    }

    enterManagerView(consultantUserId, consultantEmail) {
        sessionStorage.setItem('tsp_manager_viewing_as', consultantUserId);
        sessionStorage.setItem('tsp_manager_viewing_as_email', consultantEmail);
        location.reload();
    }
```

- [ ] **Step 4: Exibir o botão só para `role === 'manager'`**

Em `js/app.js:2226-2229` (dentro de `initAfterAuth()`, logo antes de `this.checkLocalStorageMigration();`), adicionar:

```js
        const btnSupervisor = document.getElementById('btn-manager-supervisor');
        if (btnSupervisor) btnSupervisor.style.display = this.userRole === 'manager' ? '' : 'none';
```

- [ ] **Step 5: Verificação manual**

Convidar um segundo usuário de teste com papel "Gerente" (via modal Usuários da Task 3), logar com ele, confirmar que o botão "Ver outro consultor" aparece na sidebar (e não aparece ao logar como `testes@teste.com`, que é `consultant`). Clicar no botão, confirmar que a lista mostra `testes@teste.com` (e nenhum usuário `role='client'`). Clicar "Visualizar" — a página recarrega.

- [ ] **Step 6: Commit**

```powershell
& $git add index.html js/app.js
& $git commit -m "feat(gerente): seletor de consultor e entrada no Modo Supervisao"
```

---

### Task 7: Barra de supervisão (banner) + saída do modo

**Files:**
- Modify: `index.html` (novo banner, inserir imediatamente antes de `<main class="main-content" id="main-content">`)
- Modify: `styles/main.css` (novo bloco de CSS para o banner)
- Modify: `js/app.js:2211-2248` (`initAfterAuth`, exibir o banner quando `isManagerView`)
- Modify: `js/app.js` (nova função `exitManagerView`)

**Interfaces:**
- Consumes: `sessionStorage.tsp_manager_viewing_as_email` (Task 6); `this.isManagerView` (Task 5).
- Produces: `exitManagerView()` — consumida só pelo próprio botão "Sair" do banner.

- [ ] **Step 1: Markup do banner, oculto por padrão**

Em `index.html`, imediatamente antes de `<main class="main-content" id="main-content">`, adicionar:

```html
    <!-- BANNER: MODO SUPERVISÃO (Gerente visualizando outro consultor) -->
    <div id="manager-view-banner" style="display:none;">
        <i data-lucide="eye" style="width:15px;height:15px;"></i>
        <span>Visualizando: <strong id="manager-view-banner-email"></strong> — somente leitura</span>
        <button class="btn btn-secondary btn-sm" onclick="app.openManagerSupervisorPicker()">Trocar</button>
        <button class="btn btn-danger btn-sm" onclick="app.exitManagerView()">Sair</button>
    </div>
```

- [ ] **Step 2: CSS do banner**

Ao final de `styles/main.css`, adicionar:

```css
#manager-view-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 500;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 20px;
    background: var(--warning-color);
    color: #1a1a1a;
    font-size: 0.85rem;
    font-weight: 600;
}

#manager-view-banner strong {
    font-weight: 700;
}
```

- [ ] **Step 3: Exibir o banner ao restaurar o Modo Supervisão**

Em `js/app.js`, dentro de `initAfterAuth()`, no bloco adicionado na Task 5 Step 2, trocar:

```js
        if (this.userRole === 'manager') {
            const viewingAs = sessionStorage.getItem('tsp_manager_viewing_as');
            if (viewingAs) {
                store.viewingAsUserId = viewingAs;
                store.isManagerView = true;
                this.isManagerView = true;
            }
        }
```

por:

```js
        if (this.userRole === 'manager') {
            const viewingAs = sessionStorage.getItem('tsp_manager_viewing_as');
            if (viewingAs) {
                store.viewingAsUserId = viewingAs;
                store.isManagerView = true;
                this.isManagerView = true;
                const banner = document.getElementById('manager-view-banner');
                const bannerEmail = document.getElementById('manager-view-banner-email');
                if (banner && bannerEmail) {
                    bannerEmail.textContent = sessionStorage.getItem('tsp_manager_viewing_as_email') || viewingAs;
                    banner.style.display = 'flex';
                    lucide.createIcons();
                }
            }
        }
```

- [ ] **Step 4: Função de saída**

Em `js/app.js`, logo após `enterManagerView` (Task 6, Step 3), adicionar:

```js
    exitManagerView() {
        sessionStorage.removeItem('tsp_manager_viewing_as');
        sessionStorage.removeItem('tsp_manager_viewing_as_email');
        location.reload();
    }
```

- [ ] **Step 5: Verificação manual**

Continuando do teste da Task 6: após o reload, confirmar que a barra amarela aparece no topo com o e-mail do consultor visualizado e que Dashboard/Clientes/Tarefas mostram os dados daquele consultor (não os do Gerente). Clicar "Sair" — confirmar que a página recarrega e volta a mostrar os dados do próprio Gerente, sem a barra.

- [ ] **Step 6: Commit**

```powershell
& $git add index.html styles/main.css js/app.js
& $git commit -m "feat(gerente): barra de Modo Supervisao e saida"
```

---

### Task 8: Mensagem amigável para ação bloqueada

**Files:**
- Modify: `js/app.js:503-519` (`_friendlyErrorMessage`)

**Interfaces:**
- Consumes: erro lançado pelo guard da Task 4 (`Error('Modo de visualização: ação bloqueada...')`).
- Produces: nenhuma interface nova — só melhora a mensagem exibida por todo handler que já usa `_friendlyErrorMessage` (não precisa tocar em nenhum dos ~12 `handleXxxSubmit`).

- [ ] **Step 1: Adicionar o caso logo após `const msg = ...`**

Em `js/app.js:503-519`, a função é:

```js
    _friendlyErrorMessage(err) {
        console.error(err);
        const msg = (err?.message || '').toLowerCase();
        if (!navigator.onLine || msg.includes('failed to fetch') || msg.includes('networkerror')) {
            return 'Sem conexão com a internet. Verifique sua rede e tente novamente.';
        }
        if (msg.includes('jwt') || msg.includes('401') || msg.includes('unauthorized')) {
            return 'Sua sessão expirou. Atualize a página e faça login novamente.';
        }
        if (msg.includes('duplicate key') || msg.includes('unique constraint')) {
            return 'Já existe um registro com esses dados.';
        }
        if (msg.includes('violates') || msg.includes('constraint') || msg.includes('null value')) {
            return 'Alguns dados não puderam ser salvos — confira os campos obrigatórios.';
        }
        return 'Não foi possível salvar. Tente novamente em instantes.';
    }
```

Trocar por (o único bloco novo é o `if (msg.includes('modo de visualização'))`, inserido logo depois de `const msg = ...` e antes do primeiro `if` já existente):

```js
    _friendlyErrorMessage(err) {
        console.error(err);
        const msg = (err?.message || '').toLowerCase();
        if (msg.includes('modo de visualização')) {
            return 'Ação bloqueada: você está em Modo Supervisão (somente leitura). Saia do modo para editar.';
        }
        if (!navigator.onLine || msg.includes('failed to fetch') || msg.includes('networkerror')) {
            return 'Sem conexão com a internet. Verifique sua rede e tente novamente.';
        }
        if (msg.includes('jwt') || msg.includes('401') || msg.includes('unauthorized')) {
            return 'Sua sessão expirou. Atualize a página e faça login novamente.';
        }
        if (msg.includes('duplicate key') || msg.includes('unique constraint')) {
            return 'Já existe um registro com esses dados.';
        }
        if (msg.includes('violates') || msg.includes('constraint') || msg.includes('null value')) {
            return 'Alguns dados não puderam ser salvos — confira os campos obrigatórios.';
        }
        return 'Não foi possível salvar. Tente novamente em instantes.';
    }
```

- [ ] **Step 2: Verificação manual**

Repetir o teste do console feito na Task 4 Step 3, mas desta vez através da UI: com `store.isManagerView = true` setado manualmente no console, tentar salvar qualquer formulário (ex.: editar um cliente) — o Toast de erro deve mostrar "Ação bloqueada: você está em Modo Supervisão (somente leitura). Saia do modo para editar." em vez da mensagem genérica "Não foi possível salvar...". Depois, `store.isManagerView = false` para não deixar o estado "vazado" na sessão de teste.

- [ ] **Step 3: Commit**

```powershell
& $git add js/app.js
& $git commit -m "feat(gerente): mensagem amigavel para acao bloqueada em Modo Supervisao"
```

---

### Task 9: Kanban (Tarefas) — somente leitura em Modo Supervisão

**Files:**
- Modify: `js/app.js:3980-4010` (`renderTasks`)
- Modify: `js/app.js:4086` (`_renderTasksFromCache`, a segunda função de render do Kanban)

**Interfaces:**
- Consumes: `this.isManagerView` (Task 5); `_renderKanbanBoard(columns, tasks, clientsMap, readOnly, allowReorder)` (assinatura já existente, `js/app.js:4142` — não precisa mudar).
- Produces: nenhuma interface nova.

- [ ] **Step 1: Evitar `ensureDefaultColumns` (que insere linhas) em Modo Supervisão**

Em `js/app.js:3982-3989`, dentro de `renderTasks()`, trocar:

```js
        // Carrega (ou cria) colunas do cliente selecionado — sempre, pois cliente pode ter mudado
        try {
            this._currentColumns = await store.ensureDefaultColumns(filterClient);
        } catch (err) {
            console.error('Erro ao carregar colunas:', err);
            this._currentColumns = [];
            Toast.show('Erro ao carregar colunas. Execute o SQL de migração no Supabase.', 'error', 5000);
        }
```

por:

```js
        // Em Modo Supervisão nunca criar colunas padrão (ensureDefaultColumns insere
        // linhas) — o consultor supervisionado já deve ter colunas; usar getColumns
        // (somente leitura) evita disparar o guard de escrita por engano.
        try {
            this._currentColumns = this.isManagerView
                ? await store.getColumns(filterClient)
                : await store.ensureDefaultColumns(filterClient);
        } catch (err) {
            console.error('Erro ao carregar colunas:', err);
            this._currentColumns = [];
            Toast.show('Erro ao carregar colunas. Execute o SQL de migração no Supabase.', 'error', 5000);
        }
```

- [ ] **Step 2: Passar `readOnly`/`allowReorder` ao renderizar o board**

Em `js/app.js:4010`, trocar:

```js
        this._renderKanbanBoard(this._currentColumns, tasks, this._clientsMapCache);
```

por:

```js
        this._renderKanbanBoard(this._currentColumns, tasks, this._clientsMapCache, this.isManagerView, false);
```

Em `js/app.js:4086` (dentro de `_renderTasksFromCache`), aplicar a mesma troca:

```js
        this._renderKanbanBoard(this._currentColumns, tasks, this._clientsMapCache, this.isManagerView, false);
```

- [ ] **Step 3: Ocultar os botões "Nova Tarefa" e "Gerenciar Colunas" em Modo Supervisão**

Em `js/app.js:3941-3947` (início de `renderTasks()`, bloco `if (!filterClient)`), e em `js/app.js:3980` (`if (btnManage) btnManage.style.display = 'flex';`), a visibilidade de `btnManage` já é controlada pela presença de `filterClient`. Adicionar logo após a linha `if (btnManage) btnManage.style.display = 'flex';` (`js/app.js:3980`):

```js
        if (btnManage && this.isManagerView) btnManage.style.display = 'none';
        const btnNewTaskEl = document.getElementById('btn-new-task');
        if (btnNewTaskEl) btnNewTaskEl.style.display = this.isManagerView ? 'none' : '';
```

- [ ] **Step 4: Verificação manual**

Em Modo Supervisão (Task 6/7 já testadas), abrir a view Tarefas, selecionar um cliente do consultor supervisionado: confirmar que (a) o board mostra as tarefas normalmente, (b) não é possível arrastar cards entre colunas, (c) os botões "Nova Tarefa" e "Gerenciar Colunas" não aparecem, (d) clicar num card ainda abre o modal em modo leitura (mesmo comportamento já usado pelo Portal do Cliente, reaproveitado via `readOnly=true`).

- [ ] **Step 5: Commit**

```powershell
& $git add js/app.js
& $git commit -m "feat(gerente): Kanban somente leitura em Modo Supervisao"
```

---

### Task 10: Atualizar `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (tabela de fases implementadas + seção de armadilhas conhecidas)

**Interfaces:**
- Consumes: nada — task de documentação.
- Produces: nada — mas é obrigatória pela convenção do projeto (ver memória `feedback_update_claudemd`).

- [ ] **Step 1: Adicionar linha na tabela de fases**

Na tabela "Fases implementadas" do `CLAUDE.md`, adicionar após a linha da Fase 48:

```
| 49 | Nível de acesso Gerente: papel `manager` em `user_roles`, RLS somente-leitura cross-consultor em 9 tabelas (exceto `otobo_config`/`user_ai_config`), Modo Supervisão (seletor de consultor + banner + `store.viewingAsUserId` + guard de escrita via Proxy), Kanban somente leitura reaproveitando `readOnly`/`allowReorder` |
```

- [ ] **Step 2: Adicionar seção de armadilhas conhecidas**

Na seção de armadilhas do Portal do Cliente/RLS do `CLAUDE.md`, adicionar um novo bloco:

```markdown
- **Gerente/Modo Supervisão: `store.userId` é um getter que lê `this.viewingAsUserId || Auth.getUserId()`** — nunca fazer `store.userId = x` diretamente (não existe setter, a atribuição falha silenciosamente); usar sempre `store.viewingAsUserId = <uuid>` para trocar de contexto. `window.store` é um `Proxy` (não a instância pura de `TSPStore`) — qualquer método cujo nome não comece com `get`/`_` é bloqueado quando `store.isManagerView === true`, rejeitando a Promise com `Error('Modo de visualização: ação bloqueada...')`. Isso depende inteiramente da convenção de nomenclatura já existente no projeto (leitura = `get*`/`_*`, escrita = `add/update/delete/set/save/upsert/reorder/toggle/mark/ensure`) — um novo método de leitura sem o prefixo `get`/`_` seria bloqueado incorretamente em Modo Supervisão.
- **Gerente: entrar/sair do Modo Supervisão sempre recarrega a página** (`location.reload()`) — decisão deliberada para evitar ter que invalidar manualmente as ~10 caches em memória do `AppController` (`_tasksCache`, `_agendaEventsCache`, `_clientsMapCache`, `_indicadoresData`, `_prodSummary`, `_financeiroSummary`, etc.), que ficariam com dados do consultor errado se o contexto trocasse sem reload. Estado persiste via `sessionStorage.tsp_manager_viewing_as`/`tsp_manager_viewing_as_email`, lido em `initAfterAuth()`.
- **Gerente: `otobo_config` e `user_ai_config` nunca recebem policy de manager** — Chamados (config OTOBO) e botões de IA não funcionam em Modo Supervisão porque o JWT de autenticação continua sendo o do Gerente (nunca trocamos a sessão do Supabase Auth, só o filtro de `user_id` no JS); mesmo que funcionassem, usariam a config do Gerente, não a do consultor supervisionado — por isso `initAfterAuth()` pula o carregamento de config de Google Calendar/IA/notificações inteiramente quando `isManagerView === true`.
- **Gerente: `renderTasks()` usa `store.getColumns(clientId)` em vez de `store.ensureDefaultColumns(clientId)` quando `isManagerView`** — `ensureDefaultColumns` insere linhas se não houver colunas, o que o guard de escrita bloquearia; como o consultor supervisionado já deve ter colunas configuradas, a versão somente-leitura é suficiente e evita disparar o guard por engano.
```

- [ ] **Step 3: Commit**

```powershell
& $git add CLAUDE.md
& $git commit -m "docs: documenta nivel de acesso Gerente no CLAUDE.md"
```

---

### Task 11: Verificação end-to-end e push final

**Files:**
- Nenhum arquivo novo — task de verificação.

**Interfaces:**
- Consumes: todas as tasks anteriores.

- [ ] **Step 1: Criar um usuário de teste com papel Gerente**

Logado como `testes@teste.com` (consultor), abrir "Usuários" → "Convidar" → e-mail de teste próprio (ex.: um alias que o usuário controle) → papel "Gerente" → enviar convite. Confirmar o cadastro na aba do e-mail de convite do Supabase (ou, se preferir, usar a Management API para inserir diretamente em `user_roles` um usuário de teste já existente, evitando esperar e-mail).

- [ ] **Step 2: Validar RLS diretamente via Management API**

```powershell
$verify = @"
SELECT ur.role, count(*) FROM user_roles ur GROUP BY ur.role;
"@
Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/klimkamnydfnzqetqlqm/database/query" `
  -Method POST `
  -Headers @{ "Authorization" = "Bearer $env:SUPABASE_ACCESS_TOKEN"; "Content-Type" = "application/json" } `
  -Body (@{ query = $verify } | ConvertTo-Json)
```

Expected: uma linha com `role = 'manager'` e `count >= 1`.

- [ ] **Step 3: Fluxo completo na UI**

Logar com a conta Gerente → confirmar botão "Ver outro consultor" na sidebar → escolher `testes@teste.com` → confirmar banner amarelo + dados daquele consultor em Dashboard, Clientes, Financeiro (valores visíveis), Tarefas (Kanban somente leitura) → tentar editar um cliente (deve falhar com o Toast da Task 8) → "Sair" → confirmar volta aos próprios dados do Gerente, sem banner.

- [ ] **Step 4: Rodar a suíte Playwright existente para checar que nada quebrou**

```powershell
cd "d:\GerenciadorTSP\skills\playwright-skill"
node run.js "C:\Users\jorge\AppData\Local\Temp\playwright-test-tsp-v2.js"
```

Expected: 48/48 (a suíte existente não testa o papel `manager`, mas confirma que nenhuma regressão foi introduzida nos fluxos de `consultant`/`client`).

- [ ] **Step 5: Push final e lembrete de deploy manual**

```powershell
& $git push origin main
```

Lembrar o usuário: deploy automático via webhook está quebrado — fazer deploy manual no Easypanel antes de considerar a feature disponível em produção.
