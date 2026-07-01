# Controle de Acesso por Níveis de Usuário (Portal do Cliente) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar o cadastro livre do GerenciadorTSP e introduzir dois papéis (`consultant` / `client`), com o papel `client` restrito a uma view Kanban somente-leitura de um único `client_id`, gerenciado por um novo painel admin "Usuários".

**Architecture:** Nova tabela `user_roles` + duas policies RLS cross-user (`tasks`, `kanban_columns`) fazem o cliente enxergar tarefas de outro `user_id` (o consultor) sem bypass de segurança no app. Uma Edge Function `manage-users` (com `SUPABASE_SERVICE_ROLE_KEY`) centraliza convite/listagem/revogação — nunca exposto ao browser. `app.js` ganha uma branch de roteamento logo após o login: papel `consultant` segue o fluxo atual; papel `client` entra num "modo portal" que pula o `renderAll()` padrão (bloqueado por RLS para várias tabelas) e renderiza um Kanban read-only dedicado.

**Tech Stack:** Vanilla JS ES6+ (sem build step), Supabase (Postgres + RLS + Auth Admin API), Supabase Edge Functions (Deno), nginx/Docker em produção.

## Global Constraints

- Sem TypeScript, sem framework, sem bundler — todo JS novo segue o padrão vanilla já usado em `app.js`/`store.js`/`auth.js`.
- Toda chamada ao `store` é `async/await` — nunca sem `await`.
- Nenhum `window.confirm()` para ações destrutivas — usar o padrão `_twostepDelete(btn, onConfirm)` já existente.
- Migrations SQL vão em `supabase/migrations/<data>_<nome>.sql`, seguindo o formato de `supabase/migrations/20260602_user_profiles.sql`.
- Deploy de Edge Function: `npx supabase@latest functions deploy <nome> --project-ref klimkamnydfnzqetqlqm` (requer `$env:SUPABASE_ACCESS_TOKEN`).
- Deploy em produção é manual no Easypanel após cada `git push` (webhook quebrado) — avisar o usuário ao final.
- CLAUDE.md deve ser atualizado com as armadilhas descobertas ao final da implementação (convenção fixa deste projeto).
- Spec de referência: `docs/superpowers/specs/2026-07-01-controle-acesso-portal-cliente-design.md`.

---

### Task 1: Migration SQL — tabela `user_roles` + RLS cross-user

**Files:**
- Create: `supabase/migrations/20260701_user_roles.sql`

**Interfaces:**
- Produces: tabela `user_roles(user_id UUID PK, role TEXT, client_id UUID NULL, invited_by UUID NULL, created_at TIMESTAMPTZ)`; policies `read_own_role` (SELECT em `user_roles`), `clients_read_own_tasks` (SELECT em `tasks`), `clients_read_own_columns` (SELECT em `kanban_columns`). Consumida pela Edge Function `manage-users` (Task 2) e pelos métodos `store.getUserRole()`/`getClientPortalTasks()`/`getClientPortalColumns()` (Task 3).

- [ ] **Step 1: Escrever o SQL da migration**

```sql
-- Fase 45: Controle de acesso por níveis de usuário (Portal do Cliente)
-- Papel 'consultant' = acesso total (atual). Papel 'client' = somente-leitura
-- da view Tarefas, restrito a um client_id.

CREATE TABLE IF NOT EXISTS user_roles (
    user_id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('consultant', 'client')),
    client_id UUID REFERENCES clients ON DELETE CASCADE,
    invited_by UUID REFERENCES auth.users,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Usuário só lê a própria role. INSERT/UPDATE/DELETE não têm policy
-- (negados por padrão) — gerenciamento só via Edge Function com service role.
CREATE POLICY "read_own_role" ON user_roles
    FOR SELECT USING (auth.uid() = user_id);

-- Papel 'client' lê tarefas de QUALQUER user_id, desde que o client_id bata
-- com o vínculo registrado em user_roles. Convive com a policy existente
-- (auth.uid() = user_id) que dá ao consultor dono acesso total às próprias tasks.
CREATE POLICY "clients_read_own_tasks" ON tasks
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = 'client'
              AND ur.client_id = tasks.client_id
        )
    );

-- Mesma lógica para as colunas do Kanban (o board precisa delas para renderizar).
CREATE POLICY "clients_read_own_columns" ON kanban_columns
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = 'client'
              AND ur.client_id = kanban_columns.client_id
        )
    );
```

- [ ] **Step 2: Rodar a migration no Supabase SQL Editor**

Copiar o conteúdo de `supabase/migrations/20260701_user_roles.sql` e executar em https://app.supabase.com/project/klimkamnydfnzqetqlqm/sql/new.

Expected: `Success. No rows returned` (criação de tabela + policies).

- [ ] **Step 3: Verificar que a tabela e as policies existem**

Rodar no SQL Editor:
```sql
SELECT table_name FROM information_schema.tables WHERE table_name = 'user_roles';
SELECT policyname, tablename FROM pg_policies WHERE tablename IN ('user_roles', 'tasks', 'kanban_columns') ORDER BY tablename, policyname;
```
Expected: a primeira query retorna 1 linha (`user_roles`); a segunda inclui `read_own_role` (user_roles), `clients_read_own_tasks` (tasks) e `clients_read_own_columns` (kanban_columns), além das policies já existentes de `tasks`/`kanban_columns`.

- [ ] **Step 4: Bootstrap do(s) consultor(es) atual(is)**

Substituir a lista de e-mails pelos consultores reais já cadastrados (mínimo: Jorge) e rodar no SQL Editor:
```sql
INSERT INTO user_roles (user_id, role)
SELECT id, 'consultant' FROM auth.users
WHERE email IN ('jorjaocorreia@gmail.com')
ON CONFLICT (user_id) DO NOTHING;
```
Expected: `INSERT 0 1` (ou mais, conforme quantos e-mails forem listados).

- [ ] **Step 5: Verificar o bootstrap**

```sql
SELECT ur.user_id, u.email, ur.role, ur.client_id
FROM user_roles ur JOIN auth.users u ON u.id = ur.user_id;
```
Expected: linha com `email = 'jorjaocorreia@gmail.com'`, `role = 'consultant'`, `client_id = null`.

- [ ] **Step 6: Commit**

```powershell
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.6.1\resources\app\git\cmd\git.exe"
& $git -C d:\GerenciadorTSP add supabase/migrations/20260701_user_roles.sql
& $git -C d:\GerenciadorTSP commit -m "feat(db): tabela user_roles + RLS cross-user para portal do cliente"
```
(Se o caminho do `app-3.6.1` mudar, listar `C:\Users\jorge\AppData\Local\GitHubDesktop` e pegar a pasta `app-*` mais recente antes de rodar.)

---

### Task 2: Edge Function `manage-users`

**Files:**
- Create: `supabase/functions/manage-users/index.ts`

**Interfaces:**
- Consumes: tabela `user_roles` (Task 1), `Deno.env` vars `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (já configuradas no projeto Supabase para outras functions).
- Produces: endpoint HTTP `POST /functions/v1/manage-users` com body `{ action: 'list' | 'invite' | 'revoke', ...params }`, header `Authorization: Bearer <jwt>`. Resposta JSON. Consumido por `AppController._manageUsersFetch()` (Task 3).
  - `action:'list'` → `{ users: [{ userId, email, role, clientId, clientName, invitedBy, createdAt }] }`
  - `action:'invite'` → body `{ email, role, clientId }` → `{ userId, email }`
  - `action:'revoke'` → body `{ userId }` → `{ ok: true }`

- [ ] **Step 1: Escrever a Edge Function**

```ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function getAdminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Unauthorized" }, 401);

    // Cliente autenticado como o usuário chamador — usado só para descobrir QUEM está chamando.
    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user: caller }, error: authError } = await callerClient.auth.getUser();
    if (authError || !caller) return jsonResponse({ error: "Unauthorized" }, 401);

    const admin = getAdminClient();

    // Só consultores podem chamar qualquer action desta function.
    const { data: callerRole } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .single();
    if (!callerRole || callerRole.role !== "consultant") {
      return jsonResponse({ error: "Apenas consultores podem gerenciar usuários." }, 403);
    }

    const { action, email, role, clientId, userId } = await req.json();

    if (action === "list") {
      const { data: rows, error } = await admin
        .from("user_roles")
        .select("user_id, role, client_id, invited_by, created_at, clients(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;

      const { data: authList, error: authListError } = await admin.auth.admin.listUsers({ perPage: 1000 });
      if (authListError) throw authListError;
      const emailById = new Map(authList.users.map(u => [u.id, u.email]));

      const users = (rows || []).map(r => ({
        userId: r.user_id,
        email: emailById.get(r.user_id) || "(desconhecido)",
        role: r.role,
        clientId: r.client_id,
        clientName: (r as unknown as { clients: { name: string } | null }).clients?.name || null,
        invitedBy: r.invited_by,
        createdAt: r.created_at,
      }));
      return jsonResponse({ users });
    }

    if (action === "invite") {
      if (!email || typeof email !== "string") return jsonResponse({ error: "E-mail é obrigatório." }, 400);
      if (role !== "consultant" && role !== "client") return jsonResponse({ error: "Papel inválido." }, 400);
      if (role === "client" && !clientId) return jsonResponse({ error: "Cliente é obrigatório para o papel 'client'." }, 400);

      const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email);
      if (inviteError) return jsonResponse({ error: inviteError.message }, 400);

      const newUserId = invited.user.id;
      const { error: roleError } = await admin.from("user_roles").insert({
        user_id: newUserId,
        role,
        client_id: role === "client" ? clientId : null,
        invited_by: caller.id,
      });
      if (roleError) {
        // Rollback: se falhar ao gravar a role, remove o usuário recém-convidado
        // para não deixar um login órfão sem papel.
        await admin.auth.admin.deleteUser(newUserId);
        return jsonResponse({ error: roleError.message }, 400);
      }

      return jsonResponse({ userId: newUserId, email });
    }

    if (action === "revoke") {
      if (!userId || typeof userId !== "string") return jsonResponse({ error: "userId é obrigatório." }, 400);
      await admin.from("user_roles").delete().eq("user_id", userId);
      const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
      if (deleteError) return jsonResponse({ error: deleteError.message }, 400);
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: "Invalid action" }, 400);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
```

- [ ] **Step 2: Deploy**

```powershell
$env:SUPABASE_ACCESS_TOKEN = "<seu-token-supabase>"
npx supabase@latest functions deploy manage-users --project-ref klimkamnydfnzqetqlqm
```
Expected: saída terminando em `Deployed Function manage-users`.

- [ ] **Step 3: Verificar autenticação — chamada sem token deve falhar**

```powershell
curl.exe -s -X POST "https://klimkamnydfnzqetqlqm.supabase.co/functions/v1/manage-users" -H "Content-Type: application/json" -d '{\"action\":\"list\"}'
```
Expected: `{"error":"Unauthorized"}` (function retorna 401 antes de tocar no banco — o gateway do Supabase pode retornar seu próprio 401 antes disso, ambos são aceitáveis).

- [ ] **Step 4: Verificar `action=list` autenticado como consultor**

No navegador, com Jorge logado no app (após Task 1 já ter feito o bootstrap dele como `consultant`), abrir o DevTools Console e rodar:
```js
const { data: { session } } = await window.supabaseClient.auth.getSession();
const res = await fetch('https://klimkamnydfnzqetqlqm.supabase.co/functions/v1/manage-users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
    body: JSON.stringify({ action: 'list' })
});
console.log(await res.json());
```
Expected: `{ users: [{ userId: '...', email: 'jorjaocorreia@gmail.com', role: 'consultant', clientId: null, ... }] }`.

- [ ] **Step 5: Commit**

```powershell
& $git -C d:\GerenciadorTSP add supabase/functions/manage-users/index.ts
& $git -C d:\GerenciadorTSP commit -m "feat(edge-function): manage-users (list/invite/revoke) para portal do cliente"
```

---

### Task 3: `store.js` — leitura de papel e dados do portal do cliente

**Files:**
- Modify: `d:\GerenciadorTSP\js\store.js` (adicionar métodos após o bloco `// ── KANBAN COLUMNS ──` existente, por volta da linha 903, logo após `ensureDefaultColumns`)

**Interfaces:**
- Consumes: tabela `user_roles`, policies `clients_read_own_tasks`/`clients_read_own_columns` (Task 1).
- Produces:
  - `store.getUserRole()` → `Promise<{ role: 'consultant'|'client', clientId: string|null } | null>`
  - `store.getClientPortalTasks(clientId)` → `Promise<Task[]>` (mesmo shape de `_task()`)
  - `store.getClientPortalColumns(clientId)` → `Promise<Column[]>` (mesmo shape de `_column()`)
  Consumidos por `app.js` nas Tasks 5 e 6.

- [ ] **Step 1: Adicionar os métodos em `store.js`**

Inserir logo após o método `ensureDefaultColumns` (linha 903 do arquivo atual, antes de `async addColumn`):

```js
    // ── PAPÉIS DE USUÁRIO (Portal do Cliente) ──────────────────────

    async getUserRole() {
        const { data, error } = await this.db.from('user_roles')
            .select('role, client_id').eq('user_id', this.userId).single();
        if (error) return null;
        return { role: data.role, clientId: data.client_id };
    }

    // Tarefas do portal do cliente: SEM filtro por user_id — a RLS
    // (policy clients_read_own_tasks) já restringe ao client_id vinculado
    // ao usuário logado, mesmo que o dono real da linha seja outro user_id
    // (o consultor). Nunca adicionar .eq('user_id', this.userId) aqui.
    async getClientPortalTasks(clientId) {
        const { data, error } = await this.db.from('tasks').select('*')
            .eq('client_id', clientId).order('status').order('position');
        if (error) throw error;
        return data.map(r => this._task(r));
    }

    // Mesma lógica: sem filtro por user_id, depende de clients_read_own_columns.
    async getClientPortalColumns(clientId) {
        const { data, error } = await this.db.from('kanban_columns').select('*')
            .eq('client_id', clientId).order('position');
        if (error) throw error;
        return (data || []).map(r => this._column(r));
    }
```

- [ ] **Step 2: Verificar via console do navegador (logado como Jorge/consultant)**

```js
console.log(await store.getUserRole());
```
Expected: `{ role: 'consultant', clientId: null }`.

- [ ] **Step 3: Commit**

```powershell
& $git -C d:\GerenciadorTSP add js/store.js
& $git -C d:\GerenciadorTSP commit -m "feat(store): getUserRole/getClientPortalTasks/getClientPortalColumns"
```

---

### Task 4: `js/app.js` — proxy fetch para `manage-users` (usado pela view Usuários)

**Files:**
- Modify: `d:\GerenciadorTSP\js\app.js` (adicionar método próximo a `_otoboProxyFetch`, por volta da linha 9680)

**Interfaces:**
- Consumes: Edge Function `manage-users` (Task 2).
- Produces: `AppController._manageUsersFetch(action, params)` → `Promise<any>` (mesmo padrão de `_otoboProxyFetch`). Consumido pela view Usuários (Task 8).

- [ ] **Step 1: Adicionar o método logo após `_otoboProxyFetch` (após a linha 9705 atual)**

```js
    async _manageUsersFetch(action, params = {}) {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session) throw new Error('Sessão expirada. Faça login novamente.');
        const res = await fetch(
            `${window.TSP_CONFIG.SUPABASE_URL}/functions/v1/manage-users`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`,
                    'apikey': window.TSP_CONFIG.SUPABASE_ANON_KEY,
                },
                body: JSON.stringify({ action, ...params })
            }
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.error) throw new Error(json.error || `manage-users retornou ${res.status}`);
        return json;
    }
```

- [ ] **Step 2: Verificar no console do navegador (logado como consultant)**

```js
console.log(await app._manageUsersFetch('list'));
```
Expected: `{ users: [ { userId: '...', email: 'jorjaocorreia@gmail.com', role: 'consultant', ... } ] }` — mesmo resultado do teste manual da Task 2.

- [ ] **Step 3: Commit**

```powershell
& $git -C d:\GerenciadorTSP add js/app.js
& $git -C d:\GerenciadorTSP commit -m "feat(app): _manageUsersFetch para consumir a edge function manage-users"
```

---

### Task 5: `auth.js` + `index.html` — fechar cadastro livre

**Files:**
- Modify: `d:\GerenciadorTSP\index.html` (bloco `#auth-screen`, linhas 35-64)
- Modify: `d:\GerenciadorTSP\js\auth.js`

**Interfaces:**
- Nenhuma nova interface — remoção de UI morta. Depende de um passo manual fora do código (desabilitar signup no Supabase Dashboard), documentado no Step 3.

- [ ] **Step 1: Remover a aba "Criar Conta" e simplificar o formulário em `index.html`**

Substituir o bloco (linhas 43-46):
```html
            <div style="display:flex; gap:8px; margin-bottom:24px;">
                <button id="auth-tab-login" class="btn btn-primary" style="flex:1;" onclick="Auth.switchTab('login')">Entrar</button>
                <button id="auth-tab-register" class="btn btn-secondary" style="flex:1;" onclick="Auth.switchTab('register')">Criar Conta</button>
            </div>
```
por:
```html
            <p class="text-muted" style="text-align:center; margin-bottom:20px; font-size:0.8rem;">Acesso apenas por convite. Contate seu consultor.</p>
```

- [ ] **Step 2: Remover a lógica de registro em `js/auth.js`**

Em `signUp`, `mode`, `switchTab` e `handleSubmit` (arquivo inteiro tem 131 linhas): remover a propriedade `mode` (linha 4), o método `signUp` (linhas 28-32), o método `switchTab` (linhas 64-80), e simplificar `handleSubmit`. Substituir o objeto inteiro por:

```js
const Auth = {
    client: null,
    currentUser: null,

    init() {
        const { createClient } = supabase;
        this.client = createClient(
            window.TSP_CONFIG.SUPABASE_URL,
            window.TSP_CONFIG.SUPABASE_ANON_KEY
        );
        window.supabaseClient = this.client;
    },

    async getSession() {
        const { data: { session } } = await this.client.auth.getSession();
        this.currentUser = session?.user ?? null;
        return this.currentUser;
    },

    async signIn(email, password) {
        const { data, error } = await this.client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        this.currentUser = data.user;
        return data.user;
    },

    async signOut() {
        await this.client.auth.signOut();
        this.currentUser = null;
        this.showAuthScreen();
    },

    getUserId() {
        return this.currentUser?.id ?? null;
    },

    getUserEmail() {
        return this.currentUser?.email ?? '';
    },

    // ── UI ──────────────────────────────────────────

    showAuthScreen() {
        document.getElementById('auth-screen').style.display = 'flex';
        document.querySelector('.sidebar').style.display = 'none';
        document.getElementById('main-content').style.display = 'none';
    },

    hideAuthScreen() {
        document.getElementById('auth-screen').style.display = 'none';
        document.querySelector('.sidebar').style.display = '';
        document.getElementById('main-content').style.display = '';
        const emailEl = document.getElementById('user-email-display');
        if (emailEl) emailEl.textContent = this.getUserEmail();
    },

    showMessage(text, isError = true) {
        const el = document.getElementById('auth-message');
        el.textContent = text;
        el.style.display = 'block';
        el.style.background = isError ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)';
        el.style.color = isError ? '#ef4444' : '#10b981';
        el.style.border = isError ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(16,185,129,0.3)';
    },

    clearMessage() {
        const el = document.getElementById('auth-message');
        el.style.display = 'none';
        el.textContent = '';
    },

    async handleSubmit(e) {
        e.preventDefault();
        const email = document.getElementById('auth-email').value.trim();
        const password = document.getElementById('auth-password').value;
        const btn = document.getElementById('auth-submit');

        btn.disabled = true;
        btn.textContent = 'Aguarde...';
        this.clearMessage();

        try {
            await this.signIn(email, password);
            this.hideAuthScreen();
            if (window.app) window.app.initAfterAuth();
        } catch (err) {
            const msgs = {
                'Invalid login credentials': 'E-mail ou senha incorretos.',
                'Email not confirmed': 'Confirme seu e-mail antes de entrar.',
            };
            this.showMessage(msgs[err.message] || err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Entrar';
        }
    }
};

window.Auth = Auth;
```

- [ ] **Step 3: Desabilitar signup no Supabase Dashboard (passo manual)**

Acessar https://app.supabase.com/project/klimkamnydfnzqetqlqm/auth/providers → Email → desmarcar "Allow new users to sign up" → Save. Sem esse passo, `auth.signUp` continua funcional via chamada direta à API do Supabase mesmo sem UI no app (defesa em profundidade).

- [ ] **Step 4: Testar login continua funcionando (regressão manual)**

Abrir `http://localhost:8080/index.html` (com `js/config.js` local configurado), logar com `jorjaocorreia@gmail.com` / `Jhc1881//`. Expected: login normal, sem a aba "Criar Conta" visível, sem erros no console.

- [ ] **Step 5: Commit**

```powershell
& $git -C d:\GerenciadorTSP add index.html js/auth.js
& $git -C d:\GerenciadorTSP commit -m "feat(auth): remove cadastro livre — acesso somente por convite"
```

---

### Task 6: `app.js` — resolução de papel em `initAfterAuth()`

**Files:**
- Modify: `d:\GerenciadorTSP\js\app.js` (constructor da `AppController`, linhas ~57-156, e `initAfterAuth()`, linhas 1881-1902)

**Interfaces:**
- Consumes: `store.getUserRole()` (Task 3).
- Produces: `this.userRole` (`'consultant'|'client'`), `this.userClientId` (`string|null`) — propriedades de instância consumidas pelas Tasks 7 e 8. Chama `this.enterClientPortalMode()` (implementado na Task 7) quando `role === 'client'`.

- [ ] **Step 1: Adicionar propriedades de estado no constructor**

Em `js/app.js`, logo após a linha `this.selectedMonth = null;` (linha 60):
```js
        this.selectedMonth = null;
        this.userRole = null;       // 'consultant' | 'client' — setado em initAfterAuth()
        this.userClientId = null;   // client_id vinculado, só para role 'client'
```

- [ ] **Step 2: Reescrever `initAfterAuth()` com a branch de papel**

Substituir o método atual (linhas 1881-1902):
```js
    async initAfterAuth() {
        const roleRow = await store.getUserRole();
        if (!roleRow) {
            Toast.show('Seu acesso ainda não foi configurado. Contate o consultor responsável.', 'error', 8000);
            await Auth.signOut();
            return;
        }
        this.userRole = roleRow.role;
        this.userClientId = roleRow.clientId;

        if (this.userRole === 'client') {
            return this.enterClientPortalMode();
        }

        this.checkLocalStorageMigration();
        this.applySidebarState();
        this.applyMoneyVisibility();
        // S7: cascata de nav items no login
        const sidebar = document.getElementById('sidebar');
        if (sidebar) {
            sidebar.classList.add('sidebar--nav-cascade');
            setTimeout(() => sidebar.classList.remove('sidebar--nav-cascade'), 900);
        }
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
        await this.renderAll();
    }
```

Nota: `this.enterClientPortalMode()` ainda não existe — será criado na Task 7. Este passo deixa o fluxo `consultant` funcional; a chamada para `client` só fica completa depois da Task 7.

- [ ] **Step 3: Testar regressão do fluxo consultor**

Login como `jorjaocorreia@gmail.com` em `http://localhost:8080/index.html`. Expected: dashboard carrega normalmente, sem toast de erro, `app.userRole === 'consultant'` no console.

- [ ] **Step 4: Commit**

```powershell
& $git -C d:\GerenciadorTSP add js/app.js
& $git -C d:\GerenciadorTSP commit -m "feat(app): resolve papel do usuario em initAfterAuth antes de renderizar"
```

---

### Task 7: Portal do cliente — sidebar reduzida + Kanban read-only

**Files:**
- Modify: `d:\GerenciadorTSP\js\app.js`
  - `_renderKanbanBoard` (linha 3571) — parâmetro `readOnly`
  - `createKanbanCard` (linha 3669) — parâmetro `readOnly`
  - `handleEditTask` (linha 900) — parâmetro `readOnly`
  - Adicionar `enterClientPortalMode()`, `renderClientPortalTasks()`, `_applyTaskModalReadOnlyState(readOnly)`
- Modify: `d:\GerenciadorTSP\styles\main.css` (nova classe `.modal-task-readonly`)

**Interfaces:**
- Consumes: `store.getClientPortalTasks(clientId)`, `store.getClientPortalColumns(clientId)` (Task 3); `this.userClientId` (Task 6).
- Produces: `this.enterClientPortalMode()` (chamado por `initAfterAuth`, Task 6); `_renderKanbanBoard(columns, tasks, clientsMap, readOnly=false)`; `createKanbanCard(task, clientsMap, readOnly=false)`; `handleEditTask(id, readOnly=false)`.

- [ ] **Step 1: Adicionar `readOnly` em `_renderKanbanBoard`**

Substituir a assinatura e o template da coluna (linhas 3571-3616):
```js
    _renderKanbanBoard(columns, tasks, clientsMap, readOnly = false) {
        const board = document.getElementById('kanban-board');
        if (!board) return;
        board.innerHTML = '';

        if (columns.length === 0) {
            board.innerHTML = `<div class="kb-empty-state"><i data-lucide="columns" style="width:48px;height:48px;opacity:0.25"></i><p>Nenhuma coluna configurada.</p></div>`;
            return;
        }

        columns.forEach((col, colIdx) => {
            const colTasks = tasks.filter(t => t.status === col.id)
                .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
            const colId = col.id;
            const colEl = document.createElement('div');
            colEl.className = 'kb-column kb-column-cascade';
            colEl.style.animationDelay = `${colIdx * 0.07}s`;
            colEl.dataset.status = colId;

            const headerAddBtn = readOnly ? '' : `
                    <button class="kb-header-add" onclick="app.openQuickAdd('${colId}')" title="Adicionar card">
                        <i data-lucide="plus"></i>
                    </button>`;
            const dropzoneAttrs = readOnly ? '' : `ondragover="app.allowDrop(event)" ondrop="app.dropTask(event)"`;
            const quickAddHtml = readOnly ? '' : `
                <div class="kb-quick-add" id="kb-quick-add-${colId}" style="display:none">
                    <textarea class="kb-quick-add-input" id="kb-quick-input-${colId}" rows="3"
                              placeholder="Título do card..." spellcheck="true"
                              onkeydown="app.handleQuickAddKey(event,'${colId}')"></textarea>
                    <div class="kb-quick-add-actions">
                        <button class="btn btn-primary" onclick="app.submitQuickAdd('${colId}')">Adicionar</button>
                        <button class="btn btn-ghost" onclick="app.closeQuickAdd('${colId}')"><i data-lucide="x"></i></button>
                    </div>
                </div>`;
            const addCardBtn = readOnly ? '' : `
                <button class="kb-add-card-btn" id="kb-add-btn-${colId}" onclick="app.openQuickAdd('${colId}')">
                    <i data-lucide="plus"></i> Adicionar card
                </button>`;

            colEl.innerHTML = `
                <div class="kb-column-header">
                    <div class="kb-column-title">
                        <span class="kb-column-dot" style="background:${escapeHtml(col.color)}"></span>
                        <h3>${escapeHtml(col.name)}</h3>
                        ${col.isDone ? '<span class="kb-done-badge" title="Finalizada">✓</span>' : ''}
                        <span class="kb-count" id="kb-count-${colId}">${colTasks.length}</span>
                    </div>
                    ${headerAddBtn}
                </div>
                <div class="kb-dropzone" id="kb-col-${colId}" data-status="${colId}" ${dropzoneAttrs}></div>
                ${quickAddHtml}
                ${addCardBtn}
            `;

            const dropzone = colEl.querySelector('.kb-dropzone');
            colTasks.forEach(task => dropzone.appendChild(this.createKanbanCard(task, clientsMap, readOnly)));

            board.appendChild(colEl);
        });
    }
```

- [ ] **Step 2: Adicionar `readOnly` em `createKanbanCard`**

Localizar o início do método (linha 3669) e ajustar a criação do card (linhas 3669-3697):
```js
    createKanbanCard(task, clientsMap, readOnly = false) {
        const card = document.createElement('div');
        card.className = 'kb-card' + (task.id === this._lastAddedTaskId ? ' kb-card-new' : '');
        card.draggable = !readOnly;
        card.dataset.id = task.id;

        if (!readOnly) {
            card.addEventListener('dragstart', this.dragStart.bind(this));
            card.addEventListener('dragend', this.dragEnd.bind(this));
            card.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!this._dragPlaceholder || card === this._draggedCard) return;
                const rect = card.getBoundingClientRect();
                const mid = rect.top + rect.height / 2;
                if (e.clientY < mid) {
                    card.parentNode.insertBefore(this._dragPlaceholder, card);
                } else {
                    card.insertAdjacentElement('afterend', this._dragPlaceholder);
                }
            });
            card.addEventListener('drop', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                await this._handleDrop(e, card.closest('.kb-dropzone'));
            });
        }
        card.addEventListener('click', (e) => {
            if (!e.target.closest('button')) this.handleEditTask(task.id, readOnly);
        });
```
O restante do método (montagem de `coverHtml`, `labelsHtml`, etc., a partir da linha 3698 em diante) permanece inalterado — não copiar/duplicar, apenas inserir o bloco acima no lugar das linhas 3669-3697 originais.

- [ ] **Step 3: Adicionar `readOnly` em `handleEditTask` e criar `_applyTaskModalReadOnlyState`**

Alterar a assinatura (linha 900) de `async handleEditTask(id) {` para `async handleEditTask(id, readOnly = false) {`.

Logo após a linha `this.openModal('modal-task');` (linha 942, última linha do método atual), adicionar a chamada:
```js
        this._applyTaskModalReadOnlyState(readOnly);
        this.openModal('modal-task');
    }

    _applyTaskModalReadOnlyState(readOnly) {
        const modalEl = document.querySelector('#modal-task .modal');
        if (modalEl) modalEl.classList.toggle('modal-task-readonly', !!readOnly);
        if (!readOnly) return;
        document.getElementById('btn-delete-task').style.display = 'none';
        document.getElementById('btn-add-time-task').style.display = 'none';
        document.getElementById('modal-task-comments-section').style.display = 'none';
        ['task-title', 'task-description', 'task-client', 'task-priority', 'task-due-date', 'task-estimated-minutes']
            .forEach(id => { const el = document.getElementById(id); if (el) el.disabled = true; });
        document.querySelectorAll('#modal-checklist-items input[type="checkbox"]').forEach(cb => cb.disabled = true);
    }
```
(nota: mover a chamada para depois do bloco `this.openModal('modal-task');` original faz a linha `this.openModal(...)` deixar de ser a última — reordenar para `this._applyTaskModalReadOnlyState(readOnly);` vir antes de `this.openModal('modal-task');`, como escrito acima, para que o estado read-only já esteja aplicado quando o modal ficar visível.)

- [ ] **Step 4: CSS para o modal read-only**

Adicionar ao final de `d:\GerenciadorTSP\styles\main.css`:
```css
/* Fase 45: Portal do Cliente — modal de tarefa somente-leitura */
.modal-task-readonly .modal-sidebar-actions,
.modal-task-readonly .modal-checklist-add,
.modal-task-readonly .attach-zone-hint,
.modal-task-readonly .attach-remove,
.modal-task-readonly .modal-sidebar-col-buttons,
.modal-task-readonly .kb-label-picker,
.modal-task-readonly .kb-cover-picker,
.modal-task-readonly #btn-ai-suggest-steps,
.modal-task-readonly .checklist-item-delete,
.modal-task-readonly .modal-task-title-edit-icon {
    display: none !important;
}
.modal-task-readonly textarea,
.modal-task-readonly input:not([type="checkbox"]),
.modal-task-readonly select {
    pointer-events: none;
}
```

- [ ] **Step 5: Criar `enterClientPortalMode()` e `renderClientPortalTasks()`**

Adicionar logo antes do método `renderAll()` (por volta da linha 1904-1906, na seção `// RENDERS`):
```js
    async enterClientPortalMode() {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.style.display = item.getAttribute('data-view') === 'tasks' ? '' : 'none';
        });
        ['btn-import-pdf', 'btn-migrate-local', 'btn-ai-config', 'btn-whatsapp-config'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        // View Tarefas: filtros e dashboard de métricas não fazem sentido no portal
        // (cliente já está fixo no próprio client_id, sem opção de trocar)
        const filtersBar = document.querySelector('#view-tasks .kanban-filters');
        if (filtersBar) filtersBar.style.display = 'none';
        const dashboardBox = document.getElementById('tasks-dashboard-container');
        if (dashboardBox) dashboardBox.style.display = 'none';

        this.currentView = 'tasks';
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.getAttribute('data-view') === 'tasks');
        });
        document.querySelectorAll('.view-section').forEach(section => {
            section.classList.toggle('active', section.id === 'view-tasks');
        });

        await this.renderClientPortalTasks();
        lucide.createIcons();
    }

    async renderClientPortalTasks() {
        const board = document.getElementById('kanban-board');
        if (!board) return;
        const btnManage = document.getElementById('btn-manage-columns');
        if (btnManage) btnManage.style.display = 'none';
        const btnNewTask = document.getElementById('btn-new-task');
        if (btnNewTask) btnNewTask.style.display = 'none';

        const [columns, tasks] = await Promise.all([
            store.getClientPortalColumns(this.userClientId),
            store.getClientPortalTasks(this.userClientId),
        ]);
        this._currentColumns = columns;
        this._tasksCache = tasks;
        this._renderKanbanBoard(columns, tasks, {}, true);
        lucide.createIcons();
    }
```

Nota: `document.getElementById('tasks-filters-bar')` e `document.getElementById('btn-new-task')` — confirmar os IDs reais na view Tarefas do `index.html` antes de aplicar (se o container de filtros tiver outro id, ajustar a constante; buscar com `grep -n "filter-task-client" index.html` para localizar o wrapper pai).

- [ ] **Step 6: Verificação manual (requer um usuário `client` já convidado — depende da Task 8 estar pronta)**

Este passo só pode ser validado de ponta a ponta após a Task 8 (fluxo de convite). Por ora, verificar apenas que a Task 6 + Task 7 não quebraram o fluxo consultor: login como Jorge, ir em Tarefas, confirmar que o Kanban normal (com quick-add e drag-and-drop) continua funcionando.

- [ ] **Step 7: Commit**

```powershell
& $git -C d:\GerenciadorTSP add js/app.js styles/main.css
& $git -C d:\GerenciadorTSP commit -m "feat(app): modo portal do cliente — kanban read-only + sidebar reduzida"
```

---

### Task 8: View "Usuários" (admin — convite/listagem/revogação)

**Files:**
- Modify: `d:\GerenciadorTSP\index.html`
  - `<nav class="sidebar">`: novo `nav-item`
  - novo `<section class="view-section" id="view-users">`
  - novo `<div class="modal-overlay" id="modal-invite-user">`
- Modify: `d:\GerenciadorTSP\js\app.js`
  - `switchView()`: incluir `'users'` em `VIEW_ORDER`
  - `renderAll()`: incluir `this.renderUsers()` no `Promise.all`
  - Novos métodos: `renderUsers()`, `openInviteUserModal()`, `handleInviteUserSubmit(event)`, `revokeUserAccess(userId, btn)`, `toggleInviteRoleFields()`

**Interfaces:**
- Consumes: `this._manageUsersFetch(action, params)` (Task 4); `store.getClients()` (já existe, para popular o select de cliente do convite); `this._twostepDelete(btn, onConfirm)` (já existe).
- Produces: view `#view-users` navegável só para `role === 'consultant'` (nunca visível no modo portal do cliente, pois a Task 7 já esconde todo `nav-item` que não seja `tasks`).

- [ ] **Step 1: Novo item de menu em `index.html`**

Adicionar após o `nav-item` de Financeiro (logo após a linha do `</li>` de `data-view="financeiro"`, antes de `</ul>`):
```html
            <li class="nav-item" data-view="users" title="Usuários">
                <i data-lucide="user-cog"></i><span class="nav-label">Usuários</span>
            </li>
```

- [ ] **Step 2: Nova view em `index.html`**

Adicionar logo após o fechamento de `<section class="view-section" id="view-financeiro">` (respeitando a mesma indentação dos outros `view-section`):
```html
        <!-- VIEW: USUÁRIOS -->
        <section class="view-section" id="view-users">
            <div class="header-actions">
                <div>
                    <h1>Usuários</h1>
                    <p class="text-muted">Consultores e clientes com acesso ao sistema</p>
                </div>
                <button class="btn btn-primary" onclick="app.openInviteUserModal()">
                    <i data-lucide="user-plus" style="width:16px;height:16px;"></i>
                    <span class="nav-label">Convidar</span>
                </button>
            </div>
            <div id="users-content"></div>
        </section>
```

- [ ] **Step 3: Modal de convite em `index.html`**

Adicionar próximo aos demais `modal-overlay` (ex.: logo antes do fechamento de `#modal-task`, ou em qualquer ponto do bloco de modais no final do `<body>`):
```html
    <div class="modal-overlay" id="modal-invite-user">
        <div class="modal glass" style="max-width:420px;">
            <div class="modal-header">
                <h2>Convidar Usuário</h2>
                <button class="close-modal" onclick="app.closeModal('modal-invite-user')"><i data-lucide="x"></i></button>
            </div>
            <form id="form-invite-user" onsubmit="app.handleInviteUserSubmit(event)">
                <div class="form-group">
                    <label class="form-label">E-mail</label>
                    <input type="email" id="invite-email" class="form-control" placeholder="pessoa@empresa.com" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Papel</label>
                    <select id="invite-role" class="form-control" onchange="app.toggleInviteRoleFields()">
                        <option value="client" selected>Cliente (somente leitura de Tarefas)</option>
                        <option value="consultant">Consultor (acesso total)</option>
                    </select>
                </div>
                <div class="form-group" id="invite-client-group">
                    <label class="form-label">Cliente vinculado</label>
                    <select id="invite-client-id" class="form-control" required></select>
                </div>
                <button type="submit" class="btn btn-primary" style="width:100%; margin-top:8px;">
                    <i data-lucide="send" style="width:14px;height:14px"></i> Enviar convite
                </button>
            </form>
        </div>
    </div>
```

- [ ] **Step 4: Incluir `'users'` em `VIEW_ORDER` (`js/app.js`, linha 363)**

Alterar:
```js
        const VIEW_ORDER = ['dashboard','clients','records','tasks','agenda','apontamentos','implementations','trainings','chamados','produtividade','financeiro'];
```
para:
```js
        const VIEW_ORDER = ['dashboard','clients','records','tasks','agenda','apontamentos','implementations','trainings','chamados','produtividade','financeiro','users'];
```

- [ ] **Step 5: Incluir `renderUsers()` no `renderAll()` (`js/app.js`, dentro do `Promise.all`, por volta da linha 1922-1935)**

Adicionar `this.renderUsers(),` como novo item do array passado a `Promise.all` (mesmo padrão de `this.renderChamados()`, `this.renderFinanceiro()`).

- [ ] **Step 6: Implementar `renderUsers()`, `openInviteUserModal()`, `toggleInviteRoleFields()`, `handleInviteUserSubmit()`, `revokeUserAccess()`**

Adicionar em `js/app.js`, próximo aos demais métodos de render de view (ex.: logo antes de `renderChamados()`):
```js
    async renderUsers() {
        if (this.currentView !== 'users') return;
        const container = document.getElementById('users-content');
        if (!container) return;
        let result;
        try {
            result = await this._manageUsersFetch('list');
        } catch (err) {
            container.innerHTML = `<p class="text-muted">Erro ao carregar usuários: ${escapeHtml(err.message)}</p>`;
            return;
        }
        const roleLabel = { consultant: 'Consultor', client: 'Cliente' };
        const rowsHtml = result.users.map(u => `
            <tr>
                <td>${escapeHtml(u.email)}</td>
                <td>${roleLabel[u.role] || u.role}</td>
                <td>${u.clientName ? escapeHtml(u.clientName) : '—'}</td>
                <td>${new Date(u.createdAt).toLocaleDateString('pt-BR')}</td>
                <td>
                    <button class="btn btn-danger btn-sm" onclick="app.revokeUserAccess('${u.userId}', this)">
                        <i data-lucide="user-x" style="width:13px;height:13px"></i> Remover acesso
                    </button>
                </td>
            </tr>`).join('');
        container.innerHTML = `
            <table class="data-table">
                <thead><tr><th>E-mail</th><th>Papel</th><th>Cliente</th><th>Convidado em</th><th></th></tr></thead>
                <tbody>${rowsHtml || '<tr><td colspan="5" class="text-muted">Nenhum usuário cadastrado.</td></tr>'}</tbody>
            </table>`;
        lucide.createIcons();
    }

    async openInviteUserModal() {
        const clients = await store.getClients();
        const select = document.getElementById('invite-client-id');
        select.innerHTML = clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
        document.getElementById('form-invite-user').reset();
        this.toggleInviteRoleFields();
        this.openModal('modal-invite-user');
    }

    toggleInviteRoleFields() {
        const role = document.getElementById('invite-role').value;
        const group = document.getElementById('invite-client-group');
        const clientSelect = document.getElementById('invite-client-id');
        const isClient = role === 'client';
        group.style.display = isClient ? '' : 'none';
        clientSelect.required = isClient;
    }

    async handleInviteUserSubmit(e) {
        e.preventDefault();
        const email = document.getElementById('invite-email').value.trim();
        const role = document.getElementById('invite-role').value;
        const clientId = role === 'client' ? document.getElementById('invite-client-id').value : null;
        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
            await this._manageUsersFetch('invite', { email, role, clientId });
            Toast.show('Convite enviado com sucesso.', 'success');
            this.closeModal('modal-invite-user');
            await this.renderUsers();
        } catch (err) {
            Toast.show(`Erro ao convidar: ${err.message}`, 'error', 6000);
        } finally {
            btn.disabled = false;
        }
    }

    revokeUserAccess(userId, btn) {
        this._twostepDelete(btn, async () => {
            try {
                await this._manageUsersFetch('revoke', { userId });
                Toast.show('Acesso removido.', 'success');
                await this.renderUsers();
            } catch (err) {
                Toast.show(`Erro ao remover acesso: ${err.message}`, 'error', 6000);
            }
        });
    }
```

- [ ] **Step 7: Verificação manual — fluxo completo de convite**

1. Login como Jorge (`jorjaocorreia@gmail.com`).
2. Ir em "Usuários" no sidebar → deve listar Jorge como `Consultor`.
3. Clicar "Convidar" → e-mail de teste (ex.: `cliente.teste+tsp@gmail.com` ou um e-mail real que Jorge controle), papel "Cliente", selecionar um cliente existente → Enviar convite.
4. Expected: toast de sucesso, nova linha aparece na tabela com papel "Cliente" e o nome do cliente vinculado.
5. Checar a caixa de entrada do e-mail convidado → deve chegar o e-mail padrão do Supabase com link para definir senha.
6. Clicar no link, definir senha, confirmar que a app abre direto no Kanban do cliente vinculado, com sidebar reduzida (só "Tarefas" + "Sair").
7. Tentar arrastar um card ou abrir o modal de uma tarefa → confirmar que o modal abre em modo leitura (campos desabilitados, sem botão Salvar/Excluir, sem seção de comentários).
8. Voltar como Jorge → "Usuários" → "Remover acesso" (dois cliques, padrão twostep) na linha do usuário-cliente de teste.
9. Expected: linha some da tabela; tentar logar novamente com aquele e-mail/senha falha com "Invalid login credentials".

- [ ] **Step 8: Commit**

```powershell
& $git -C d:\GerenciadorTSP add index.html js/app.js
& $git -C d:\GerenciadorTSP commit -m "feat(app): view Usuarios — convite, listagem e revogacao de acesso"
```

---

### Task 9: Atualizar `CLAUDE.md`

**Files:**
- Modify: `d:\GerenciadorTSP\CLAUDE.md`

**Interfaces:** Nenhuma — documentação.

- [ ] **Step 1: Mover o item do Backlog para a tabela de Fases implementadas**

Na seção "Fases implementadas (1–44, todas ✅)", adicionar linha (ajustar o range do título para 1–45):
```
| 45 | Controle de acesso por níveis de usuário (Portal do Cliente): tabela `user_roles`, RLS cross-user em `tasks`/`kanban_columns`, Edge Function `manage-users` (convite/listagem/revogação), view "Usuários", modo portal do cliente (Kanban read-only) |
```

- [ ] **Step 2: Remover o item do "Backlog (planejado, não implementado)"**

Apagar o bullet "**Controle de acesso por níveis de usuário (Portal do Cliente)**..." da seção Backlog.

- [ ] **Step 3: Adicionar armadilhas conhecidas**

Na seção "Regras de desenvolvimento" → "Armadilhas conhecidas", adicionar:
```
- **Portal do Cliente: `initAfterAuth()` sempre resolve o papel antes de renderizar** — `store.getUserRole()` roda antes de qualquer `renderAll()`; sem linha em `user_roles`, o usuário é deslogado automaticamente com toast de erro. Nunca mover a chamada de `getUserRole()` para depois do primeiro render.
- **Portal do Cliente: `getClientPortalTasks`/`getClientPortalColumns` nunca filtram por `user_id`** — dependem inteiramente das policies RLS `clients_read_own_tasks`/`clients_read_own_columns` (que casam `user_roles.client_id` com `tasks.client_id`/`kanban_columns.client_id`). Adicionar `.eq('user_id', this.userId)` nesses métodos quebraria o acesso cross-user do papel `client` (o dono real da tarefa é o consultor, não o cliente logado).
- **Portal do Cliente: `manage-users` só aceita chamadas de `role === 'consultant'`** — a checagem é feita no backend (Edge Function), não só na UI; qualquer novo `action` adicionado à function deve manter essa checagem antes de tocar em `user_roles`/`auth.admin`.
- **Portal do Cliente: revogação sempre deleta o usuário do Supabase Auth, não só a role** — evita login "zumbi" sem `user_roles`. Se um dia for necessário suspender sem deletar, isso é uma mudança de comportamento deliberada, não um bug a corrigir.
- **Portal do Cliente: `_renderKanbanBoard`/`createKanbanCard`/`handleEditTask` aceitam `readOnly` como último parâmetro opcional** — `enterClientPortalMode()`/`renderClientPortalTasks()` são o único caminho que passa `readOnly=true`; qualquer novo ponto de entrada do Kanban precisa decidir explicitamente esse valor, o default é `false` (comportamento normal do consultor).
```

- [ ] **Step 4: Commit**

```powershell
& $git -C d:\GerenciadorTSP add CLAUDE.md
& $git -C d:\GerenciadorTSP commit -m "docs: atualiza CLAUDE.md com a fase 45 (portal do cliente)"
```

---

### Task 10: Regressão completa + push + aviso de deploy manual

**Files:** nenhum arquivo novo — validação e publicação.

**Interfaces:** N/A.

- [ ] **Step 1: Rodar a suíte Playwright existente (48 testes) contra produção**

```powershell
cd "d:\GerenciadorTSP\skills\playwright-skill"
node run.js "C:\Users\jorge\AppData\Local\Temp\playwright-test-tsp-v2.js"
```
Expected: 48/48 ✅ — nenhuma regressão introduzida pelas mudanças em `initAfterAuth()`, `_renderKanbanBoard`, `createKanbanCard`, `handleEditTask`, `switchView()`, `auth.js`.

Se algum teste falhar por causa da remoção da aba "Criar Conta" (Task 5) ou de `Auth.signUp`/`Auth.switchTab`, atualizar o script de teste correspondente antes de prosseguir — não reverter a remoção do cadastro livre (é o objetivo da feature).

- [ ] **Step 2: Push**

```powershell
& $git -C d:\GerenciadorTSP push origin main
```

- [ ] **Step 3: Avisar sobre deploy manual**

Informar ao usuário: "Deploy automático está quebrado (webhook do Easypanel) — é necessário fazer o deploy manual do serviço `gerenciador-tsp` no Easypanel antes de testar em produção." Isso já está registrado como convenção fixa do projeto (`feedback_test_after_fix` na memória).

- [ ] **Step 4: Teste manual pós-deploy em produção**

Repetir o Step 7 da Task 8 (fluxo completo de convite) contra `https://jorge-gerenciador-tsp.27pl2o.easypanel.host` após o deploy manual confirmado pelo usuário.

---

## Riscos e pontos de atenção para quem executar este plano

- **Task 7, Step 5** depende de confirmar o `id` real do container de filtros da view Tarefas (`tasks-filters-bar` é um palpite baseado no padrão de outras views — grep antes de usar) e do botão "+ Nova Tarefa" (`btn-new-task` — também confirmar via grep em `index.html`, já que só foi visto referenciado em `renderTasks()`, não na definição do HTML).
- **Task 2** usa o token do Supabase já documentado na memória do projeto (`reference_supabase_token.md`); se tiver expirado, gerar um novo em https://app.supabase.com/account/tokens.
- **Task 10, Step 1** pode expor testes existentes que dependiam de `Auth.switchTab`/aba de cadastro — ajustar o script de teste (fora deste repo, em `%TEMP%`) faz parte do escopo de "sem regressão", não é opcional.
