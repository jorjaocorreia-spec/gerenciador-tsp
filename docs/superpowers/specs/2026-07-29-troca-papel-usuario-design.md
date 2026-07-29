# Troca de Papel de Usuário + Trava do Gerente — Design

**Data**: 2026-07-29
**Status**: Aprovado, aguardando plano de implementação

## Contexto

A view "Usuários" (`js/app.js` `renderUsers()`, Edge Function `manage-users`) hoje só permite convidar, revogar e reenviar acesso. Trocar o papel de um usuário existente (ex.: Cliente → Consultor) exige revogar e reconvidar do zero — perdendo o histórico de `invited_by`/`created_at` e forçando um novo convite por e-mail. Além disso, qualquer consultor pode convidar/promover alguém a Gerente (papel introduzido na feature anterior, Fase 49) sem nenhuma restrição adicional — não há hoje nenhum controle sobre quem pode conceder esse nível de supervisão.

Esta melhoria resolve os dois pontos:
1. Permite trocar o papel de um usuário existente in-place, sem revogar/reconvidar.
2. Restringe a concessão **e** remoção do papel Gerente a um único usuário-dono do sistema.

## 1. Backend — nova action `changeRole`

Na Edge Function `supabase/functions/manage-users/index.ts`, nova action `changeRole`, body `{ userId, role, clientId? }`:

- Exige `callerRole.role === 'consultant'` — mesma regra já aplicada a `invite`/`revoke`/`resend` (linha `if (action !== "list" && callerRole.role !== "consultant")`).
- **Bloqueio de auto-alteração**: se `userId === caller.id`, retorna erro 400 ("Você não pode alterar o próprio papel.") — evita que um consultor tire o próprio acesso sem querer.
- **Trava do Gerente (nas duas direções)**: antes de aplicar a troca, busca o papel ATUAL do usuário-alvo (`SELECT role FROM user_roles WHERE user_id = userId`). Se o papel **novo** (`role`) for `'manager'` **OU** o papel **atual** do alvo já for `'manager'`, a chamada só é aceita se `caller.email === SUPER_ADMIN_EMAIL` (constante no topo do arquivo, valor `"jorjaocorreia@gmail.com"`); caso contrário, retorna 403 ("Apenas o administrador do sistema pode conceder ou remover o papel de Gerente.").
- Validação de `role`: aceita `'consultant' | 'client' | 'manager'` (mesma lista de `invite`).
- Se `role === 'client'`, exige `clientId` (mesma regra de `invite`).
- Se o papel novo **não** for `'client'`, `client_id` é sempre gravado como `null` (mesmo que o usuário já não fosse `'client'` antes — idempotente).
- Persistência: `UPDATE user_roles SET role = ..., client_id = ... WHERE user_id = userId`. Nenhuma chamada a `admin.auth.*` — a conta do usuário (login/senha) não é tocada, só o papel.
- Retorna `{ ok: true }` em caso de sucesso.

## 2. Frontend — `js/app.js` / `index.html`

### Tabela de Usuários (`renderUsers()`)
- A célula "Papel" deixa de ser texto estático e vira um `<select>` com as 3 opções (`Consultor`/`Cliente`/`Gerente`), valor atual pré-selecionado, `onchange="app.handleRoleSelectChange(this, '${u.userId}', '${u.role}', '${u.clientId || ''}')"`.
- Se `u.userId === Auth.getUserId()` (própria linha), o `<select>` recebe `disabled` — ninguém troca o próprio papel pela UI (reforça a trava do backend com feedback imediato, sem round-trip).
- Quando o valor selecionado for `'client'`, um segundo `<select>` de clientes (mesma lista de `#invite-client-id`, carregada uma vez por abertura da view) aparece na mesma linha; a troca só é enviada ao backend quando um cliente for escolhido nesse segundo select.
- Para as trocas que não envolvem `'client'` (Consultor ↔ Gerente), a troca é enviada assim que o primeiro `<select>` muda.

### Fluxo de submissão (`handleRoleSelectChange`)
- Chama `this._manageUsersFetch('changeRole', { userId, role, clientId })`.
- Sucesso: Toast de confirmação + `renderUsers()` recarrega a lista (garante que a UI reflita o estado real do banco, inclusive se a troca envolveu o campo de cliente).
- Erro (incluindo a trava do Gerente retornando 403): Toast com a mensagem de erro do backend + reverte o `<select>` para o valor original (`u.role`), sem re-chamar `renderUsers()` (evita round-trip desnecessário quando já se sabe que nada mudou no banco).

## 3. Efeitos colaterais aceitos
- A troca de papel só reflete na sessão ATIVA do usuário afetado no próximo login/refresh — `getUserRole()` já é lido do banco a cada `initAfterAuth()`, não há necessidade de invalidar sessão ou revogar JWT.
- Não há auditoria de "quem trocou o papel de quem" — consistente com o restante da view, que também não audita revogações/reenvios hoje.

## Fora de escopo (YAGNI)
- Trocar e-mail/senha do usuário.
- Permitir mais de um "super admin" (um segundo dono do sistema) — se necessário no futuro, é uma extensão separada (ex.: coluna `is_admin`), não faz parte desta entrega.
- Histórico/log de mudanças de papel.
