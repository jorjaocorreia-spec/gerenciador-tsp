import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function fetchJson(url: string, options: RequestInit): Promise<unknown> {
  const res = await fetch(url, options);
  const text = await res.text();
  if (!text) throw new Error(`OTOBO retornou resposta vazia (HTTP ${res.status})`);
  try {
    return JSON.parse(text);
  } catch {
    const preview = text.substring(0, 200).replace(/\n/g, " ");
    throw new Error(`OTOBO retornou resposta não-JSON (HTTP ${res.status}): ${preview}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const { action, otoboUrl, username, password, ticketIds, ticketId, syncFilters } = await req.json();
    const base = (otoboUrl || "").replace(/\/$/, "");
    const creds = { UserLogin: username, Password: password };
    const jsonHeaders = { "Content-Type": "application/json" };
    const authQuery = `UserLogin=${encodeURIComponent(username)}&Password=${encodeURIComponent(password)}`;

    let data: unknown;

    if (action === "search") {
      const sf = (syncFilters || {}) as Record<string, unknown>;
      const searchBody: Record<string, unknown> = {
        ...creds,
        SortBy: "Changed",
        OrderBy: "Down",
        Limit: (typeof sf.limit === "number" && sf.limit > 0) ? sf.limit : 500,
      };
      // Só adiciona filtros se o array não estiver vazio (array vazio = retorna 0 resultados no OTOBO)
      if (Array.isArray(sf.queues) && sf.queues.length > 0) searchBody.Queues = sf.queues;
      if (Array.isArray(sf.states) && sf.states.length > 0) searchBody.States = sf.states;
      if (Array.isArray(sf.types) && sf.types.length > 0) searchBody.Types = sf.types;
      if (typeof sf.ownerLogin === "string" && sf.ownerLogin.trim()) searchBody.OwnerLogin = sf.ownerLogin.trim();

      data = await fetchJson(
        `${base}/otobo/nph-genericinterface.pl/Webservice/ProgramaGestorTSP_jorge/Ticket`,
        {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify(searchBody),
        }
      );

    } else if (action === "get") {
      // Busca individual para pular tickets com AccessDenied
      const ids = ticketIds as string[];
      const tickets: unknown[] = [];
      let denied = 0;

      for (const id of ids) {
        try {
          const res = await fetchJson(
            `${base}/otobo/nph-genericinterface.pl/Webservice/ProgramaGestorTSP_jorge/Ticket/${id}?${authQuery}`,
            { headers: jsonHeaders }
          ) as Record<string, unknown>;

          if (res?.Error) {
            denied++;
            continue;
          }
          // Resposta pode ser { Ticket: [...] } ou { Ticket: {} }
          const t = res?.Ticket;
          if (Array.isArray(t)) tickets.push(...t);
          else if (t) tickets.push(t);
        } catch {
          denied++;
        }
      }

      data = { Ticket: tickets, _denied: denied };

    } else if (action === "articles") {
      data = await fetchJson(
        `${base}/otobo/nph-genericinterface.pl/Webservice/ProgramaGestorTSP_jorge/Ticket/${ticketId}?${authQuery}&AllArticles=1`,
        { headers: jsonHeaders }
      );

    } else {
      return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: corsHeaders });
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
