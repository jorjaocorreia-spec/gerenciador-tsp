import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

    const { action, otoboUrl, username, password, ticketIds, ticketId } = await req.json();
    const base = (otoboUrl || "").replace(/\/$/, "");
    const creds = { UserLogin: username, Password: password };
    const headers = { "Content-Type": "application/json" };

    let data: unknown;

    if (action === "search") {
      const res = await fetch(
        `${base}/otobo/nph-genericinterface.pl/Webservice/GenericTicketConnectorREST/Ticket/Search`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            ...creds,
            StateType: ["new", "open", "pending reminder", "pending auto", "in treatment"],
          }),
        }
      );
      data = await res.json();

    } else if (action === "get") {
      const ids = (ticketIds as string[]).join(",");
      const res = await fetch(
        `${base}/otobo/nph-genericinterface.pl/Webservice/GenericTicketConnectorREST/Ticket/${ids}?UserLogin=${encodeURIComponent(username)}&Password=${encodeURIComponent(password)}`,
        { headers }
      );
      data = await res.json();

    } else if (action === "articles") {
      const res = await fetch(
        `${base}/otobo/nph-genericinterface.pl/Webservice/GenericTicketConnectorREST/Ticket/${ticketId}?UserLogin=${encodeURIComponent(username)}&Password=${encodeURIComponent(password)}&AllArticles=1`,
        { headers }
      );
      data = await res.json();

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
