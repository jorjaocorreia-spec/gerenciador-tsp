import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Tipos ──────────────────────────────────────────────────────────────────

type Intent = "query_hours" | "query_agenda" | "query_tasks" | "help";

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

interface Task {
  id: string;
  title: string;
  priority: string | null;
  due_date: string | null;
  status: string;
  client_id: string;
  completed: boolean | null;
}

interface KanbanColumn {
  id: string;
  name: string;
  client_id: string | null;
  is_done: boolean;
}

interface BotState {
  pending?: string;
  expires?: string;
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
    intent: "query_tasks",
    patterns: [
      /\btarefas?\b/i, /\bkanban\b/i, /\bpendente\b/i,
      /\bem aberto\b/i, /\bo que (tem|está|falta) pra fazer\b/i,
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

function fmtDate(dateStr: string): string {
  const [, month, day] = dateStr.split("-");
  return `${day}/${month}`;
}

// ── Estado conversacional (bot_state em user_profiles) ───────────────────

async function getBotState(userId: string): Promise<BotState> {
  const db = getAdminClient();
  const { data } = await db
    .from("user_profiles")
    .select("bot_state")
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.bot_state as BotState) ?? {};
}

async function setBotState(userId: string, state: BotState): Promise<void> {
  const db = getAdminClient();
  await db
    .from("user_profiles")
    .update({ bot_state: state })
    .eq("user_id", userId);
}

async function clearBotState(userId: string): Promise<void> {
  await setBotState(userId, {});
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

  const usedMap: Record<string, number> = {};
  for (const r of records ?? []) {
    usedMap[r.client_id] = (usedMap[r.client_id] ?? 0) + r.minutes;
  }

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

async function handleQueryTasks(userId: string, clientQuery: string): Promise<string> {
  const db = getAdminClient();

  const [{ data: columns }, { data: clients }] = await Promise.all([
    db.from("kanban_columns").select("id, name, client_id, is_done").eq("user_id", userId),
    db.from("clients").select("id, name").eq("user_id", userId).eq("status", "active"),
  ]);

  if (!clients || clients.length === 0) {
    return "Nenhum cliente ativo encontrado. Acesse o app para cadastrar clientes.";
  }

  // Fuzzy match de cliente se query fornecida
  let targetClients = clients as { id: string; name: string }[];
  if (clientQuery.trim().length >= 2) {
    const q = clientQuery.trim().toLowerCase();
    const matched = targetClients.filter((c) => c.name.toLowerCase().includes(q));
    if (matched.length > 0) {
      targetClients = matched;
    } else {
      return `❌ Nenhum cliente encontrado com "*${clientQuery}*".\n\nEnvie *tarefas* para ver todos os clientes.`;
    }
  }

  const allColumns = (columns ?? []) as KanbanColumn[];
  const doneColIds = new Set(allColumns.filter((c) => c.is_done).map((c) => c.id));
  const colNameMap = new Map(allColumns.map((c) => [c.id, c.name]));

  const clientIds = targetClients.map((c) => c.id);
  const { data: tasks } = await db
    .from("tasks")
    .select("id, title, priority, due_date, status, client_id, completed")
    .eq("user_id", userId)
    .in("client_id", clientIds)
    .or("completed.is.null,completed.eq.false")
    .order("client_id", { ascending: true })
    .limit(100);

  const openTasks = ((tasks ?? []) as Task[]).filter((t) => !doneColIds.has(t.status));

  if (openTasks.length === 0) {
    const names = targetClients.map((c) => c.name).join(", ");
    return `✅ Nenhuma tarefa em aberto para *${names}*.`;
  }

  const priorityEmoji: Record<string, string> = { high: "🔴", medium: "🟡", low: "🟢" };
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };

  // Agrupa por cliente
  const byClient = new Map<string, Task[]>();
  for (const c of targetClients) byClient.set(c.id, []);
  for (const t of openTasks) {
    byClient.get(t.client_id)?.push(t);
  }

  const sections: string[] = [];

  for (const client of targetClients) {
    const clientTasks = byClient.get(client.id) ?? [];
    if (clientTasks.length === 0) continue;

    clientTasks.sort((a, b) => (priorityOrder[a.priority ?? ""] ?? 3) - (priorityOrder[b.priority ?? ""] ?? 3));

    const shown = clientTasks.slice(0, 20);
    const extra = clientTasks.length - shown.length;

    const taskLines = shown.map((t) => {
      const emoji = priorityEmoji[t.priority ?? ""] ?? "⚪";
      const title = t.title.length > 50 ? t.title.slice(0, 47) + "..." : t.title;
      const colName = colNameMap.get(t.status);
      const colStr = colName ? ` | ${colName}` : "";
      const dueStr = t.due_date ? ` | Vence ${fmtDate(t.due_date)}` : "";
      return `${emoji} ${title}${colStr}${dueStr}`;
    });

    const count = clientTasks.length;
    const header = `📋 *${client.name}* (${count} tarefa${count !== 1 ? "s" : ""})`;
    const moreStr = extra > 0 ? `\n_(+ ${extra} mais)_` : "";
    sections.push(`${header}\n${taskLines.join("\n")}${moreStr}`);
  }

  if (sections.length === 0) {
    return "✅ Nenhuma tarefa em aberto encontrada.";
  }

  return sections.join("\n\n");
}

function handleHelp(): string {
  return `🤖 *TSP Manager Bot*\n\nComandos disponíveis:\n\n📊 *horas* — consumo de horas por cliente no mês atual\n   Ex: "horas", "horas cliente X"\n\n📅 *agenda* — eventos dos próximos 7 dias\n   Ex: "agenda", "reuniões de hoje"\n\n📋 *tarefas* — tarefas em aberto por cliente\n   Ex: "tarefas", "tarefas cascavel"\n\n❓ *ajuda* — exibe esta mensagem\n\n_Envie uma mensagem de texto para começar!_`;
}

// ── Lookup de usuário por número ──────────────────────────────────────────

async function findUserByPhone(phone: string): Promise<string | null> {
  const db = getAdminClient();

  const phoneAlt = phone.startsWith("55") && phone.length >= 12 ? phone.slice(2) : null;
  const phoneAlt9 = phoneAlt && phoneAlt.length === 10 ? phoneAlt.slice(0, 2) + "9" + phoneAlt.slice(2) : null;
  const phoneAlt9With55 = phoneAlt9 ? "55" + phoneAlt9 : null;
  const variants = [phone, phoneAlt, phoneAlt9, phoneAlt9With55].filter(Boolean) as string[];
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

  // Lê estado conversacional pendente
  const botState = await getBotState(userId);
  const nowIso = new Date().toISOString();

  let intent: Intent;
  let clientQuery = "";

  if (botState.pending === "query_tasks" && botState.expires && botState.expires > nowIso) {
    // Usuário está respondendo à pergunta "Para qual cliente?"
    // Se mandar outro comando conhecido, cancela o estado e trata normalmente
    const isOtherCommand = /\b(ajuda|horas?|agenda|cancelar|menu)\b/i.test(text);
    if (!isOtherCommand) {
      intent = "query_tasks";
      clientQuery = text;
      await clearBotState(userId);
    } else {
      await clearBotState(userId);
      intent = detectIntent(text);
    }
  } else {
    intent = detectIntent(text);
    if (intent === "query_tasks") {
      // Extrai nome do cliente inline, se fornecido (ex: "tarefas cascavel")
      const match = text.match(/^tarefas?\s+(.*)/i);
      clientQuery = match?.[1]?.trim() ?? "";
      if (!clientQuery) {
        // Pede o nome do cliente e salva estado pendente por 5 minutos
        await setBotState(userId, {
          pending: "query_tasks",
          expires: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        });
        await sendMessage(phone, "Para qual cliente? Responda com o nome (ou parte dele).\n\n_Ou envie *ajuda* para cancelar._");
        return new Response(JSON.stringify({ ok: true, intent: "query_tasks_ask" }));
      }
    }
  }

  console.log("[WA] userId:", userId, "| intent:", intent, "| clientQuery:", clientQuery);

  let reply: string;
  if (intent === "query_hours") {
    reply = await handleQueryHours(userId, text);
  } else if (intent === "query_agenda") {
    reply = await handleQueryAgenda(userId);
  } else if (intent === "query_tasks") {
    reply = await handleQueryTasks(userId, clientQuery);
  } else {
    reply = handleHelp();
  }

  await sendMessage(phone, reply);
  return new Response(JSON.stringify({ ok: true, intent }));
});
