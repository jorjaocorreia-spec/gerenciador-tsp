import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Estados que nunca devem ser sincronizados (tickets fechados)
const EXCLUDED_STATES = ["fechado com sucesso", "fechado sem sucesso"];

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

    const { action, otoboUrl, username, password, ticketIds, ticketId, syncFilters, lastSyncAt } = await req.json();
    const base = (otoboUrl || "").replace(/\/$/, "");
    const creds = { UserLogin: username, Password: password };
    const jsonHeaders = { "Content-Type": "application/json" };
    const authQuery = `UserLogin=${encodeURIComponent(username)}&Password=${encodeURIComponent(password)}`;

    let data: unknown;

    if (action === "search") {
      const sf = (syncFilters || {}) as Record<string, unknown>;
      const hasOwnerFilter = typeof sf.ownerLogin === "string" && (sf.ownerLogin as string).trim().length > 0;
      // OwnerIDs é o único parâmetro de proprietário que a operação TicketSearch do OTOBO
      // realmente suporta (Owners/OwnerLogin como string não existem no backend e são
      // silenciosamente ignorados — confirmado com o admin do OTOBO). Cada usuário tem um
      // ID de agente diferente, informado manualmente na config (não há como descobrir via API).
      const hasOwnerId = typeof sf.ownerId === "number" && Number.isFinite(sf.ownerId) && sf.ownerId > 0;
      const isIncremental = typeof lastSyncAt === "string" && lastSyncAt.trim().length > 0;

      const searchBody: Record<string, unknown> = {
        ...creds,
        SortBy: "Changed",
        OrderBy: "Down",
        // Sync incremental: limite baixo pois só busca tickets recentemente alterados.
        // Com OwnerIDs, a busca já é exata (só os tickets do agente) — o limite é só um teto de segurança.
        Limit: isIncremental ? 200 : ((typeof sf.limit === "number" && sf.limit > 0) ? sf.limit : 500),
      };
      // Só adiciona filtros se o array não estiver vazio (array vazio = retorna 0 resultados no OTOBO)
      if (Array.isArray(sf.queues) && sf.queues.length > 0) searchBody.Queues = sf.queues;
      if (Array.isArray(sf.states) && sf.states.length > 0) searchBody.States = sf.states;
      if (Array.isArray(sf.types) && sf.types.length > 0) searchBody.Types = sf.types;
      if (hasOwnerId) {
        searchBody.OwnerIDs = [sf.ownerId];
      } else if (hasOwnerFilter) {
        const login = (sf.ownerLogin as string).trim();
        // Mantido por compatibilidade, mas o OTOBO ignora estes parâmetros na prática.
        searchBody.Owners = [login];
        searchBody.OwnerLogin = login;
      }
      // Sync incremental: só buscar tickets alterados desde a última sincronização.
      // Formato esperado pelo OTOBO: "YYYY-MM-DD HH:MM:SS"
      if (isIncremental) {
        const d = new Date(lastSyncAt as string);
        const pad = (n: number) => String(n).padStart(2, "0");
        const otoboDate = `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
        searchBody.TicketLastChangeTimeNewerDate = otoboDate;
      }

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
          const addTicket = (tk: unknown) => {
            const state = ((tk as Record<string, unknown>)?.State as string || "").toLowerCase();
            if (!EXCLUDED_STATES.includes(state)) tickets.push(tk);
          };
          if (Array.isArray(t)) t.forEach(addTicket);
          else if (t) addTicket(t);
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
