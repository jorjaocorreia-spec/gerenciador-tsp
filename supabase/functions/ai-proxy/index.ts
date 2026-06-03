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

    const { action, systemPrompt, userPrompt } = await req.json();

    if (action !== "complete") {
      return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: corsHeaders });
    }

    // Busca config de IA do usuário
    const { data: config, error: configError } = await supabase
      .from("user_ai_config")
      .select("provider, api_key, model")
      .eq("user_id", user.id)
      .single();

    if (configError || !config?.api_key) {
      return new Response(JSON.stringify({ error: "IA não configurada. Acesse Configurações de IA na sidebar." }), {
        status: 400, headers: corsHeaders
      });
    }

    const { provider, api_key, model } = config;
    let content: string;

    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${api_key}`,
        },
        body: JSON.stringify({
          model: model || "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.7,
          max_tokens: 1024,
        }),
      });
      const json = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        const err = (json.error as Record<string, unknown>)?.message || "Erro na API OpenAI";
        throw new Error(String(err));
      }
      const choices = json.choices as Array<{ message: { content: string } }>;
      content = choices[0]?.message?.content ?? "";

    } else if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": api_key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: model || "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });
      const json = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        const err = (json.error as Record<string, unknown>)?.message || "Erro na API Anthropic";
        throw new Error(String(err));
      }
      const contentArr = json.content as Array<{ type: string; text: string }>;
      content = contentArr[0]?.text ?? "";

    } else {
      throw new Error("Provider inválido. Use 'openai' ou 'anthropic'.");
    }

    return new Response(JSON.stringify({ content }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
