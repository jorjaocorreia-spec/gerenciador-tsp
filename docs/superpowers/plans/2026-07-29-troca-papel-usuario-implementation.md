# Troca de Papel de Usuário + Trava do Gerente Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir trocar o papel de um usuário existente (Consultor/Cliente/Gerente) direto na tela "Usuários", sem revogar/reconvidar, e restringir a concessão/remoção do papel Gerente a um único usuário-administrador do sistema.

**Architecture:** Nova action `changeRole` na Edge Function `manage-users` (Deno) faz um `UPDATE` em `user_roles` em vez do fluxo atual de `revoke`+`invite`; uma trava por e-mail hardcoded (`SUPER_ADMIN_EMAIL`) bloqueia qualquer troca que envolva o papel `manager` (concedê-lo OU removê-lo) vinda de outra pessoa. No frontend, a célula "Papel" da tabela de Usuários vira um `<select>` inline; ao escolher "Cliente", um segundo `<select>` de cliente aparece na mesma linha antes de a troca ser enviada.

**Tech Stack:** JavaScript vanilla ES6+ (`js/app.js`, sem build step), Deno/TypeScript (Edge Function `supabase/functions/manage-users/index.ts`), Supabase (Postgres, sem migration nova — reaproveita a tabela `user_roles` já existente).

## Global Constraints

- Ninguém além do usuário com e-mail `jorjaocorreia@gmail.com` pode conceder OU remover o papel `manager` de qualquer usuário — vale nas duas direções.
- Um usuário nunca pode trocar o próprio papel pela tela de Usuários (bloqueio no backend E `<select>` desabilitado no frontend para a própria linha).
- Trocar para o papel `client` sempre exige um `clientId`; trocar para qualquer outro papel sempre zera `client_id` para `null`.
- A troca de papel não deve tocar em `admin.auth.*` (login/senha do usuário permanecem intactos) — é só um `UPDATE` em `user_roles`.
- Sem migration SQL nova — `user_roles` já tem as colunas necessárias (`role`, `client_id`) desde a Fase 45/49.

---

### Task 1: Edge Function `manage-users` — nova action `changeRole`

**Files:**
- Modify: `supabase/functions/manage-users/index.ts`

**Interfaces:**
- Consumes: tabela `user_roles` (já existente, sem migration nova); `callerRole.role` (já resolvido no topo do handler, antes de qualquer `action`).
- Produces: `action: 'changeRole'`, body `{ userId, role, clientId? }` → `{ ok: true }` em sucesso, ou `{ error: string }` com status 400/403. Consumida pela Task 2.

- [ ] **Step 1: Adicionar a constante do administrador do sistema**

Em `supabase/functions/manage-users/index.ts`, logo após o bloco `const corsHeaders = {...};` (linha 8), adicionar:

```ts
// Único usuário autorizado a conceder OU remover o papel 'manager' de qualquer
// outro usuário (nas duas direções) — ver design em
// docs/superpowers/specs/2026-07-29-troca-papel-usuario-design.md.
const SUPER_ADMIN_EMAIL = "jorjaocorreia@gmail.com";
```

- [ ] **Step 2: Adicionar o bloco `changeRole`**

Logo antes de `return jsonResponse({ error: "Invalid action" }, 400);` (a última linha antes do `catch` que fecha o `serve(async (req) => {...})`), adicionar:

```ts
    if (action === "changeRole") {
      if (!userId || typeof userId !== "string") return jsonResponse({ error: "userId é obrigatório." }, 400);
      if (role !== "consultant" && role !== "client" && role !== "manager") return jsonResponse({ error: "Papel inválido." }, 400);
      if (role === "client" && !clientId) return jsonResponse({ error: "Cliente é obrigatório para o papel 'client'." }, 400);
      if (userId === caller.id) return jsonResponse({ error: "Você não pode alterar o próprio papel." }, 400);

      const { data: targetRole, error: targetRoleError } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .single();
      if (targetRoleError) return jsonResponse({ error: targetRoleError.message }, 400);

      // Trava do Gerente: vale para conceder OU remover, nas duas direções.
      const touchesManager = role === "manager" || targetRole.role === "manager";
      if (touchesManager && caller.email !== SUPER_ADMIN_EMAIL) {
        return jsonResponse({ error: "Apenas o administrador do sistema pode conceder ou remover o papel de Gerente." }, 403);
      }

      const { error: updateError } = await admin
        .from("user_roles")
        .update({ role, client_id: role === "client" ? clientId : null })
        .eq("user_id", userId);
      if (updateError) return jsonResponse({ error: updateError.message }, 400);

      return jsonResponse({ ok: true });
    }
```

Observação importante: o gate já existente na linha `if (action !== "list" && callerRole.role !== "consultant") { return jsonResponse({ error: "Apenas consultores podem convidar, revogar ou reenviar acesso." }, 403); }` já cobre `changeRole` (que não é `"list"`), então nenhum `manager` consegue nem chamar essa action — não precisa adicionar nenhuma checagem extra para isso.

- [ ] **Step 3: Deploy — requer ação humana (token pessoal)**

Este passo **não deve ser executado por um agente** — exige um token de acesso Supabase que só o operador humano deve digitar em seu próprio terminal (política de segurança do projeto: segredos nunca entram em comandos ou arquivos de um agente). Ao final desta task, deixe registrado no relatório que o deploy abaixo ainda precisa ser rodado pelo humano:

```powershell
$env:SUPABASE_ACCESS_TOKEN = "<token pessoal>"
npx supabase@latest functions deploy manage-users --project-ref klimkamnydfnzqetqlqm
```

- [ ] **Step 4: Commit**

```powershell
$git = (Get-ChildItem "C:\Users\jorge\AppData\Local\GitHubDesktop" -Directory -Filter "app-*" | Sort-Object Name -Descending | Select-Object -First 1).FullName + "\resources\app\git\cmd\git.exe"
& $git add supabase/functions/manage-users/index.ts
& $git commit -m "feat(usuarios): action changeRole com trava de Gerente restrita ao admin do sistema"
```

---

### Task 2: Frontend — select inline de papel + select condicional de cliente

**Files:**
- Modify: `js/app.js:10643-10677` (`renderUsers()`)
- Modify: `js/app.js` (novas funções `handleRoleSelectChange`/`_submitRoleChange`, inseridas logo após `resendUserInvite`)

**Interfaces:**
- Consumes: `this._manageUsersFetch('changeRole', { userId, role, clientId })` (Task 1); `store.getClients()` (já existe, usada em `openInviteUserModal()`); `Auth.getUserId()` (já existe, `js/auth.js`).
- Produces: nenhuma interface nova consumida por outra task.

- [ ] **Step 1: Buscar clientes e trocar a célula "Papel" por selects**

Em `js/app.js:10643-10677`, a função `renderUsers()` atual é:

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
        const roleLabel = { consultant: 'Consultor', client: 'Cliente', manager: 'Gerente' };
        const rowsHtml = result.users.map(u => `
            <tr>
                <td>${escapeHtml(u.email)}</td>
                <td>${roleLabel[u.role] || u.role}</td>
                <td>${u.clientName ? escapeHtml(u.clientName) : '—'}</td>
                <td>${new Date(u.createdAt).toLocaleDateString('pt-BR')}</td>
                <td style="display:flex;gap:8px;flex-wrap:wrap;">
                    ${u.confirmed === false ? `
                    <button class="btn btn-secondary btn-sm" onclick="app.resendUserInvite('${u.userId}', this)">
                        <i data-lucide="send" style="width:13px;height:13px"></i> Reenviar link
                    </button>` : ''}
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
```

Trocar por:

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
        let clients = [];
        try {
            clients = await store.getClients();
        } catch (err) {
            Toast.show('Erro ao carregar clientes para o seletor de papel: ' + err.message, 'error');
        }
        const clientOptionsHtml = (targetClientId) => clients.map(c =>
            `<option value="${c.id}" ${c.id === targetClientId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
        ).join('');
        const myUserId = Auth.getUserId();
        const rowsHtml = result.users.map(u => {
            const isSelf = u.userId === myUserId;
            const isClientRole = u.role === 'client';
            return `
            <tr>
                <td>${escapeHtml(u.email)}</td>
                <td>
                    <select class="form-control" style="min-width:140px" ${isSelf ? 'disabled title="Você não pode alterar seu próprio papel"' : ''}
                        onchange="app.handleRoleSelectChange(this, '${u.userId}', '${u.role}', '${u.clientId || ''}')">
                        <option value="consultant" ${u.role === 'consultant' ? 'selected' : ''}>Consultor</option>
                        <option value="client" ${u.role === 'client' ? 'selected' : ''}>Cliente</option>
                        <option value="manager" ${u.role === 'manager' ? 'selected' : ''}>Gerente</option>
                    </select>
                    <select class="form-control user-role-client-select" style="min-width:140px;margin-top:4px;${isClientRole ? '' : 'display:none;'}" ${isClientRole ? '' : 'disabled'}>
                        <option value="">Selecione o cliente...</option>
                        ${clientOptionsHtml(u.clientId)}
                    </select>
                </td>
                <td>${u.clientName ? escapeHtml(u.clientName) : '—'}</td>
                <td>${new Date(u.createdAt).toLocaleDateString('pt-BR')}</td>
                <td style="display:flex;gap:8px;flex-wrap:wrap;">
                    ${u.confirmed === false ? `
                    <button class="btn btn-secondary btn-sm" onclick="app.resendUserInvite('${u.userId}', this)">
                        <i data-lucide="send" style="width:13px;height:13px"></i> Reenviar link
                    </button>` : ''}
                    <button class="btn btn-danger btn-sm" onclick="app.revokeUserAccess('${u.userId}', this)">
                        <i data-lucide="user-x" style="width:13px;height:13px"></i> Remover acesso
                    </button>
                </td>
            </tr>`;
        }).join('');
        container.innerHTML = `
            <table class="data-table">
                <thead><tr><th>E-mail</th><th>Papel</th><th>Cliente</th><th>Convidado em</th><th></th></tr></thead>
                <tbody>${rowsHtml || '<tr><td colspan="5" class="text-muted">Nenhum usuário cadastrado.</td></tr>'}</tbody>
            </table>`;
        lucide.createIcons();
    }
```

Notas sobre a troca:
- `roleLabel`/`<td>${roleLabel[u.role]...}</td>` (texto estático) foi removido — a própria célula do `<select>` já mostra o papel atual via `selected`.
- A coluna "Cliente" (`u.clientName`) continua mostrando o cliente vinculado atual (texto), independente do novo select de papel — ela só reflete o estado salvo, não o que está sendo editado no select.
- O segundo `<select class="user-role-client-select">` é sempre renderizado (evita ter que criar o elemento dinamicamente via JS), só fica oculto (`display:none`) e `disabled` quando o papel atual não é `'client'`.

- [ ] **Step 2: Adicionar `handleRoleSelectChange` e `_submitRoleChange`**

Em `js/app.js`, logo após o fechamento da função `resendUserInvite` (a função que termina com o `catch` que reexibe `origHtml` e mostra o Toast de erro do reenvio), adicionar:

```js
    handleRoleSelectChange(selectEl, userId, oldRole, oldClientId) {
        const newRole = selectEl.value;
        const clientSelect = selectEl.parentElement.querySelector('.user-role-client-select');
        if (newRole === 'client') {
            clientSelect.style.display = '';
            clientSelect.disabled = false;
            clientSelect.value = '';
            clientSelect.onchange = () => {
                if (!clientSelect.value) return;
                this._submitRoleChange(userId, newRole, clientSelect.value, selectEl, oldRole, oldClientId);
            };
            return;
        }
        clientSelect.style.display = 'none';
        clientSelect.disabled = true;
        clientSelect.onchange = null;
        this._submitRoleChange(userId, newRole, null, selectEl, oldRole, oldClientId);
    }

    async _submitRoleChange(userId, role, clientId, selectEl, oldRole, oldClientId) {
        try {
            await this._manageUsersFetch('changeRole', { userId, role, clientId });
            Toast.show('Papel atualizado.', 'success');
            await this.renderUsers();
        } catch (err) {
            Toast.show(`Erro ao trocar papel: ${err.message}`, 'error', 6000);
            selectEl.value = oldRole;
            const clientSelect = selectEl.parentElement.querySelector('.user-role-client-select');
            if (clientSelect) {
                clientSelect.style.display = oldRole === 'client' ? '' : 'none';
                clientSelect.disabled = oldRole !== 'client';
                clientSelect.value = oldClientId || '';
                clientSelect.onchange = null;
            }
        }
    }
```

Comportamento: escolher "Consultor" ou "Gerente" envia a troca imediatamente. Escolher "Cliente" só exibe o segundo select — a troca só é enviada quando um cliente é de fato escolhido nele (`clientSelect.onchange`). Em caso de erro (incluindo a trava do Gerente retornando 403 da Task 1), o select de papel volta para o valor original e o select de cliente volta ao estado anterior, sem chamar `renderUsers()` de novo.

- [ ] **Step 3: Checagem de sintaxe**

```powershell
node --check "d:\GerenciadorTSP\js\app.js"
```
Expected: nenhuma saída (exit code 0).

- [ ] **Step 4: Verificação manual**

Com `python -m http.server 8080` rodando a partir de `d:\GerenciadorTSP`, logar como `testes@teste.com` (consultor), abrir "Usuários":
1. Trocar o papel de um usuário Cliente existente para "Consultor" → confirmar Toast de sucesso e que a linha recarrega sem o cliente vinculado.
2. Trocar um usuário para "Cliente" → confirmar que o segundo select aparece, escolher um cliente → confirmar Toast de sucesso e que a coluna "Cliente" mostra o nome certo.
3. Tentar trocar qualquer usuário para "Gerente" logado como `testes@teste.com` (que não é o administrador do sistema) → confirmar que aparece um Toast de erro claro e que o select volta para o valor original.
4. Confirmar que a própria linha do usuário logado tem o select desabilitado.
5. Logado como `jorjaocorreia@gmail.com` (administrador do sistema), confirmar que a troca para/de "Gerente" funciona normalmente.

- [ ] **Step 5: Commit**

```powershell
& $git add js/app.js
& $git commit -m "feat(usuarios): select inline de papel com troca imediata e trava do Gerente"
```

---

### Task 3: Atualizar `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nada — task de documentação.

- [ ] **Step 1: Adicionar armadilha conhecida**

Na seção de armadilhas do Portal do Cliente/Gerente do `CLAUDE.md` (logo após o bloco "Gerente/Modo Supervisão" já existente, adicionado na Fase 49), adicionar:

```markdown
- **Usuários: troca de papel in-place via `action: 'changeRole'`** — `manage-users` faz `UPDATE user_roles SET role, client_id` em vez de revogar+reconvidar; preserva `invited_by`/`created_at` e não toca em `admin.auth.*` (login/senha do usuário intactos). **Conceder OU remover o papel `manager` (nas duas direções) só é permitido para `caller.email === SUPER_ADMIN_EMAIL`** (constante hardcoded no topo de `manage-users/index.ts`, hoje `jorjaocorreia@gmail.com`) — qualquer outro consultor recebe 403 ao tentar. Um usuário nunca pode trocar o próprio papel (bloqueio no backend via `userId === caller.id`, e o `<select>` da própria linha vem `disabled` no frontend). Trocar para `'client'` exige escolher um cliente num segundo `<select>` que só aparece nesse caso; a troca só é enviada ao backend depois que o cliente é escolhido — as demais trocas são enviadas assim que o select de papel muda.
```

- [ ] **Step 2: Commit**

```powershell
& $git add CLAUDE.md
& $git commit -m "docs: documenta troca de papel de usuario e trava do Gerente"
```

---

### Task 4: Verificação final e push

**Files:**
- Nenhum arquivo novo.

**Interfaces:**
- Consumes: todas as tasks anteriores.

- [ ] **Step 1: Push**

```powershell
& $git push origin main
```

- [ ] **Step 2: Deploy — ação humana**

Rodar (com o token pessoal, digitado pelo próprio operador, nunca por um agente):

```powershell
$env:SUPABASE_ACCESS_TOKEN = "<token pessoal>"
npx supabase@latest functions deploy manage-users --project-ref klimkamnydfnzqetqlqm
```

Depois, fazer o deploy manual no Easypanel (webhook automático está quebrado).

- [ ] **Step 3: Teste final em produção**

Repetir os 5 cenários da Task 2 Step 4, desta vez contra a versão publicada.
