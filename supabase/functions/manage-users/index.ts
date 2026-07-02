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
    const { data: callerRole, error: callerRoleError } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .single();
    if (callerRoleError) {
      console.error("Erro ao consultar user_roles do caller:", callerRoleError.message);
    }
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

      const confirmedById = new Map(authList.users.map(u => [u.id, !!u.confirmed_at]));

      const users = (rows || []).map(r => ({
        userId: r.user_id,
        email: emailById.get(r.user_id) || "(desconhecido)",
        role: r.role,
        clientId: r.client_id,
        clientName: (r as unknown as { clients: { name: string } | null }).clients?.name || null,
        invitedBy: r.invited_by,
        createdAt: r.created_at,
        confirmed: confirmedById.get(r.user_id) ?? true,
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

      // Guarda a role atual antes de apagar, para poder reverter caso o
      // deleteUser falhe (ex.: usuário ainda possui dados dependentes —
      // clients/tasks/records referenciando user_id sem ON DELETE CASCADE,
      // comum para consultores com dados reais). Sem esse rollback, uma
      // falha no deleteUser deixava o usuário sem role mas com a conta e
      // os dados intactos — um "meio-revogado" perigoso.
      const { data: existingRole, error: fetchRoleError } = await admin
        .from("user_roles")
        .select("role, client_id, invited_by")
        .eq("user_id", userId)
        .single();
      if (fetchRoleError) return jsonResponse({ error: fetchRoleError.message }, 400);

      const { error: roleDeleteError } = await admin.from("user_roles").delete().eq("user_id", userId);
      if (roleDeleteError) return jsonResponse({ error: roleDeleteError.message }, 400);

      const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
      if (deleteError) {
        const { error: rollbackError } = await admin.from("user_roles").insert({ user_id: userId, ...existingRole });
        if (rollbackError) {
          return jsonResponse({ error: `Falha ao remover o usuário E ao restaurar a role (usuário ficou sem acesso!). Restaure manualmente. Detalhe original: ${deleteError.message}` }, 500);
        }
        return jsonResponse({ error: `Não foi possível remover o usuário (provavelmente possui dados vinculados — clientes, tarefas, etc.). O acesso foi restaurado. Detalhe: ${deleteError.message}` }, 400);
      }
      return jsonResponse({ ok: true });
    }

    if (action === "resend") {
      if (!userId || typeof userId !== "string") return jsonResponse({ error: "userId é obrigatório." }, 400);

      const { data: userData, error: getUserError } = await admin.auth.admin.getUserById(userId);
      if (getUserError || !userData?.user) return jsonResponse({ error: getUserError?.message || "Usuário não encontrado." }, 400);
      const targetUser = userData.user;
      if (targetUser.confirmed_at) {
        return jsonResponse({ error: "Usuário já confirmou o convite — não é possível reenviar." }, 400);
      }
      const email = targetUser.email;
      if (!email) return jsonResponse({ error: "Usuário sem e-mail associado." }, 400);

      // Reenviar = recriar o convite preservando role/cliente: o GoTrue recusa
      // reinvocar inviteUserByEmail para um e-mail já cadastrado (mesmo não
      // confirmado), então o único jeito de gerar um link novo é apagar o
      // usuário não-confirmado e recriá-lo com os mesmos dados de role.
      const { data: existingRole, error: fetchRoleError } = await admin
        .from("user_roles")
        .select("role, client_id, invited_by")
        .eq("user_id", userId)
        .single();
      if (fetchRoleError) return jsonResponse({ error: fetchRoleError.message }, 400);

      const { error: roleDeleteError } = await admin.from("user_roles").delete().eq("user_id", userId);
      if (roleDeleteError) return jsonResponse({ error: roleDeleteError.message }, 400);

      const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
      if (deleteError) {
        const { error: rollbackError } = await admin.from("user_roles").insert({ user_id: userId, ...existingRole });
        if (rollbackError) {
          return jsonResponse({ error: `Falha ao remover o convite antigo E ao restaurar a role. Detalhe original: ${deleteError.message}` }, 500);
        }
        return jsonResponse({ error: `Não foi possível remover o convite antigo para reenviar. Detalhe: ${deleteError.message}` }, 400);
      }

      const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email);
      if (inviteError) {
        return jsonResponse({ error: `Convite antigo removido, mas falha ao reenviar: ${inviteError.message}. Convide o e-mail novamente.` }, 400);
      }

      const newUserId = invited.user.id;
      const { error: roleError } = await admin.from("user_roles").insert({
        user_id: newUserId,
        role: existingRole.role,
        client_id: existingRole.client_id,
        invited_by: existingRole.invited_by,
      });
      if (roleError) {
        await admin.auth.admin.deleteUser(newUserId);
        return jsonResponse({ error: roleError.message }, 400);
      }

      return jsonResponse({ userId: newUserId, email });
    }

    return jsonResponse({ error: "Invalid action" }, 400);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
