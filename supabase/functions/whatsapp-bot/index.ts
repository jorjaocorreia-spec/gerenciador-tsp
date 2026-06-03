import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Tipos ──────────────────────────────────────────────────────────────────

type Intent = "query_hours" | "query_agenda" | "help";

interface Client {
  id: string;
  name: string;
  hours_total: number;
  status: string;
}

interface AgendaEvent {
  id: string;
  title: string;
  date: string;
  date_end: string | null;
  start_time: string;
  end_time: string;
  type: string;
  client_id: string | null;
}

// ── Supabase admin (service role) ─────────────────────────────────────────

function getAdminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );
}

// ── Evolution API: enviar mensagem ────────────────────────────────────────

async function sendMessage(phone: string, text: string): Promise<void> {
  const url = Deno.env.get("EVOLUTION_API_URL") ?? "";
  const apiKey = Deno.env.get("EVOLUTION_API_KEY") ?? "";
  const instance = Deno.env.get("EVOLUTION_INSTANCE") ?? "tsp";

  const res = await fetch(`${url}/message/sendText/${instance}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: apiKey },
    body: JSON.stringify({ number: phone, text }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("[WA] sendMessage failed:", res.status, body);
  }
}

// ── Extração do payload Evolution API ────────────────────────────────────

function extractMessage(body: Record<string, unknown>): { phone: string; text: string } | null {
  const key = (body?.data as Record<string, unknown>)?.key as Record<string, unknown> | undefined;
  if (!key) return null;
  if (key.fromMe) return null;

  const addressingMode = (key.addressingMode as string) ?? "";
  const rawJid: string =
    addressingMode === "lid"
      ? ((key.remoteJidAlt ?? key.remoteJid) as string) ?? ""
      : (key.remoteJid as string) ?? "";

  if (!rawJid) return null;

  const phone = rawJid.replace(/@.*$/, "").replace(/[^0-9]/g, "");
  if (!phone) return null;

  const message = (body?.data as Record<string, unknown>)?.message as Record<string, unknown> | undefined;
  const text: string =
    (message?.conversation as string) ??
    ((message?.extendedTextMessage as Record<string, unknown>)?.text as string) ??
    "";

  if (!text.trim()) return null;
  return { phone, text: text.trim() };
}

// ── Detecção de intent ────────────────────────────────────────────────────

const INTENT_RULES: { intent: Intent; patterns: RegExp[] }[] = [
  {
    intent: "help",
    patterns: [
      /\bajuda\b/i, /\bcomandos?\b/i, /\bmenu\b/i,
      /^(oi|ol[aá]|hi|hey|bom dia|boa tarde|boa noite)[\s!?]*$/i,
    ],
  },
  {
    intent: "query_agenda",
    patterns: [
      /\bagenda\b/i, /\brevisi[oó]o?\b/i,
      /\bpróximo\b/i, /\bpróxima\b/i,
      /\breuni[aã]o\b/i, /\batendimento\b/i,
      /\bhoje\b/i, /\bsemana\b/i,
      /\bevento/i,
    ],
  },
  {
    intent: "query_hours",
    patterns: [
      /\bhoras\b/i, /\bconsumo\b/i,
      /\bsaldo\b/i, /\bprojeto\b/i,
      /\bcliente\b/i, /\bhoras?\s+rest/i,
      /\bquanto\s+(tem|sobrou|falta)/i,
    ],
  },
];

function detectIntent(text: string): Intent {
  for (const rule of INTENT_RULES) {
    if (rule.patterns.some((p) => p.test(text))) return rule.intent;
  }
  return "help";
}

// ── Formatação de tempo ───────────────────────────────────────────────────

function fmtMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, "0")}`;
}

// ── Handlers de consulta ──────────────────────────────────────────────────

async function handleQueryHours(userId: string, text: string): Promise<string> {
  const db = getAdminClient();
  const now = new Date();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [{ data: clients }, { data: records }] = await Promise.all([
    db.from("clients").select("id, name, hours_total, status").eq("user_id", userId).eq("status", "active"),
    db.from("records")
      .select("client_id, minutes")
      .eq("user_id", userId)
      .gte("date", `${monthStr}-01`)
      .lte("date", `${monthStr}-31`),
  ]);

  if (!clients || clients.length === 0) {
    return "Nenhum cliente ativo encontrado. Acesse o app para cadastrar clientes.";
  }

  // Agrupa minutos usados por cliente
  const usedMap: Record<string, number> = {};
  for (const r of records ?? []) {
    usedMap[r.client_id] = (usedMap[r.client_id] ?? 0) + r.minutes;
  }

  // Filtra por palavra-chave se mencionada
  const lowerText = text.toLowerCase();
  let filtered = clients as Client[];

  const hasKeyword = !/\b(horas?|consumo|saldo|quanto)\b/i.test(text) || /\bcliente\b/i.test(text);
  if (hasKeyword) {
    const keyword = lowerText
      .replace(/horas?|consumo|saldo|cliente|projeto|quanto|tem|sobrou|falta/gi, "")
      .replace(/[^a-záéíóúàèìòùãõâêîôûç0-9\s]/gi, "")
      .trim();
    if (keyword.length >= 3) {
      const kw = keyword;
      const match = filtered.filter((c) =>
        c.name.toLowerCase().includes(kw) || c.name.toLowerCase().replace(/\s+/g, " ").includes(kw)
      );
      if (match.length > 0) filtered = match;
    }
  }

  // Limita a 8 clientes para não ultrapassar limite de mensagem
  const shown = filtered.slice(0, 8);

  const monthLabel = now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const lines = shown.map((c) => {
    const used = usedMap[c.id] ?? 0;
    const total = Math.round(c.hours_total * 60);
    const remaining = total - used;
    const pct = total > 0 ? Math.round((used / total) * 100) : 0;
    const bar = total > 0 ? (pct >= 90 ? "🔴" : pct >= 70 ? "🟡" : "🟢") : "⚪";
    const remainingTxt = remaining >= 0 ? `${fmtMinutes(remaining)} restam` : `${fmtMinutes(Math.abs(remaining))} acima`;
    return `${bar} *${c.name}*\n   ${fmtMinutes(used)} / ${fmtMinutes(total)} (${pct}%) — ${remainingTxt}`;
  });

  const header = `📊 *Horas — ${monthLabel}*`;
  const footer = filtered.length > 8 ? `\n_... e mais ${filtered.length - 8} clientes_` : "";
  return `${header}\n\n${lines.join("\n\n")}${footer}`;
}

async function handleQueryAgenda(userId: string): Promise<string> {
  const db = getAdminClient();
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const in7 = new Date(today);
  in7.setDate(in7.getDate() + 7);
  const in7Str = in7.toISOString().split("T")[0];

  const { data: events } = await db
    .from("agenda_events")
    .select("id, title, date, date_end, start_time, end_time, type")
    .eq("user_id", userId)
    .lte("date", in7Str)
    .gte("date", todayStr)
    .order("date", { ascending: true })
    .order("start_time", { ascending: true })
    .limit(10);

  if (!events || events.length === 0) {
    return "📅 Nenhum evento nos próximos 7 dias.";
  }

  const typeEmoji: Record<string, string> = {
    meeting: "🤝",
    consulting: "💻",
    task: "✅",
    reminder: "🔔",
  };

  const todayFull = todayStr;
  const lines = (events as AgendaEvent[]).map((e) => {
    const isToday = e.date === todayFull;
    const dateLabel = isToday
      ? "Hoje"
      : new Date(e.date + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
    const timeLabel = e.start_time ? `${e.start_time}${e.end_time ? "–" + e.end_time : ""}` : "Dia inteiro";
    const emoji = typeEmoji[e.type] ?? "📌";
    return `${emoji} *${e.title}*\n   ${dateLabel} · ${timeLabel}`;
  });

  return `📅 *Agenda — próximos 7 dias*\n\n${lines.join("\n\n")}`;
}

function handleHelp(): string {
  return `🤖 *TSP Manager Bot*\n\nComandos disponíveis:\n\n📊 *horas* — consumo de horas por cliente no mês atual\n   Ex: "horas", "horas cliente X"\n\n📅 *agenda* — eventos dos próximos 7 dias\n   Ex: "agenda", "reuniões de hoje"\n\n❓ *ajuda* — exibe esta mensagem\n\n_Envie uma mensagem de texto para começar!_`;
}

// ── Lookup de usuário por número ──────────────────────────────────────────

async function findUserByPhone(phone: string): Promise<string | null> {
  const db = getAdminClient();

  // Gera variantes do número (com/sem 55, com/sem 9° dígito)
  const phoneAlt = phone.startsWith("55") && phone.length >= 12 ? phone.slice(2) : null;
  const phoneAlt9 = phoneAlt && phoneAlt.length === 10 ? phoneAlt.slice(0, 2) + "9" + phoneAlt.slice(2) : null;
  const variants = [phone, phoneAlt, phoneAlt9].filter(Boolean) as string[];
  const orFilter = variants.map((v) => `whatsapp_number.eq.${v}`).join(",");

  const { data, error } = await db
    .from("user_profiles")
    .select("user_id")
    .or(orFilter)
    .limit(1);

  if (error) {
    console.error("[WA] user lookup error:", error.message);
    return null;
  }
  return data?.[0]?.user_id ?? null;
}

// ── Ação interna: enviar mensagem de boas-vindas ──────────────────────────

async function handleWelcomeAction(req: Request): Promise<Response> {
  const db = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } }
  );

  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const { data: profile } = await db.from("user_profiles").select("whatsapp_number").eq("user_id", user.id).maybeSingle();
  const number = profile?.whatsapp_number;
  if (!number) {
    return new Response(JSON.stringify({ error: "Número não cadastrado" }), { status: 400 });
  }

  await sendMessage(number, handleHelp());
  return new Response(JSON.stringify({ ok: true }));
}

// ── Handler principal ─────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
      },
    });
  }

  // Ação interna autenticada (ex: enviar mensagem de boas-vindas)
  const auth = req.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { body = {}; }
    if ((body as Record<string, unknown>).action === "welcome") {
      return handleWelcomeAction(req);
    }
    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400 });
  }

  // Webhook do Evolution API
  const secret = req.headers.get("x-webhook-secret") ?? new URL(req.url).searchParams.get("secret");
  if (secret !== Deno.env.get("WEBHOOK_SECRET")) {
    console.warn("[WA] unauthorized webhook attempt");
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const event = (body.event as string) ?? "";
  if (event !== "messages.upsert" && event !== "MESSAGES_UPSERT") {
    return new Response(JSON.stringify({ ok: true, skipped: true, event }));
  }

  const msg = extractMessage(body);
  if (!msg) return new Response(JSON.stringify({ ok: true, skipped: true, reason: "no message" }));

  const { phone, text } = msg;
  console.log("[WA] phone:", phone, "| text:", text);

  const userId = await findUserByPhone(phone);
  if (!userId) {
    console.warn("[WA] unknown phone:", phone);
    await sendMessage(
      phone,
      "⚠️ Número não cadastrado no *TSP Manager*.\n\nAcesse o app → menu lateral → ⚙️ *WhatsApp* → cadastre seu número."
    );
    return new Response(JSON.stringify({ ok: true, skipped: true, reason: "phone not found" }));
  }

  const intent = detectIntent(text);
  console.log("[WA] userId:", userId, "| intent:", intent);

  let reply: string;
  if (intent === "query_hours") {
    reply = await handleQueryHours(userId, text);
  } else if (intent === "query_agenda") {
    reply = await handleQueryAgenda(userId);
  } else {
    reply = handleHelp();
  }

  await sendMessage(phone, reply);
  return new Response(JSON.stringify({ ok: true, intent }));
});
