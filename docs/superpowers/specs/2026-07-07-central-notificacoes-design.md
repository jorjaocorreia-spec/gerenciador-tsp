# Central de Notificações — Design

**Data:** 2026-07-07
**Status:** Aprovado, aguardando plano de implementação

## Objetivo

Sempre que uma melhoria ou nova feature for implementada no GerenciadorTSP, exibir e explicar isso aos usuários consultores dentro do próprio app, via um ícone de sino com contador de não-lidas no sidebar.

## Escopo

- Visível **somente** para usuários com `role = 'consultant'`. Usuários do Portal do Cliente (`role = 'client'`) nunca veem o sino nem as notificações.
- Conteúdo é **global** (mesmo para todos os consultores) — não há notificações direcionadas a um usuário específico.
- Publicação de notificações é **manual**, disparada por um script rodado ao final de cada feature concluída (não há parsing automático de commits nem geração via IA em tempo real).

## Modelo de dados (Supabase)

### `app_notifications`

```sql
CREATE TABLE app_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_label TEXT,        -- ex: "Fase 47" — apenas informativo/rastreabilidade
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE app_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "consultants_read_notifications" ON app_notifications
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'consultant')
  );
```

Sem policy de INSERT/UPDATE/DELETE para usuários autenticados — apenas a `service_role` key (usada localmente pelo script de publicação, nunca exposta ao browser) pode escrever nessa tabela. Isso impede que qualquer consultor injete notificações via console do navegador.

### `notification_reads`

```sql
CREATE TABLE notification_reads (
  user_id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE notification_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_notification_reads" ON notification_reads
  FOR ALL USING (auth.uid() = user_id);
```

Uma linha por usuário. O contador de não-lidas é calculado no client: `notifications.filter(n => n.createdAt > lastSeenAt).length`. Não há marcação item-a-item (lida/não lida individual) — decisão deliberada para manter simples, dado o volume baixo de publicações esperado.

## Fluxo de publicação

Script `Documentation/publish-notification.ps1`:

```powershell
param(
    [Parameter(Mandatory=$true)][string]$Phase,
    [Parameter(Mandatory=$true)][string]$Title,
    [Parameter(Mandatory=$true)][string]$Description
)

$body = @{ phase_label = $Phase; title = $Title; description = $Description } | ConvertTo-Json

Invoke-RestMethod `
  -Uri "https://klimkamnydfnzqetqlqm.supabase.co/rest/v1/app_notifications" `
  -Method POST `
  -Headers @{
      "apikey" = $env:SUPABASE_SERVICE_ROLE_KEY
      "Authorization" = "Bearer $env:SUPABASE_SERVICE_ROLE_KEY"
      "Content-Type" = "application/json"
      "Prefer" = "return=minimal"
  } `
  -Body $body
```

**Uso:**
```powershell
$env:SUPABASE_SERVICE_ROLE_KEY = "..."
.\Documentation\publish-notification.ps1 -Phase "47" -Title "Nova função X" -Description "Agora você pode..."
```

**Quando rodar:** toda vez que uma fase for concluída e adicionada à tabela "Fases implementadas" do CLAUDE.md, junto ao mesmo checklist de fechamento (atualizar CLAUDE.md + push). O título/descrição publicados são reescritos em linguagem amigável ao usuário final — não a redação técnica interna da tabela de fases.

A `service_role` key nunca deve ser colada literalmente em nenhum arquivo do repositório — sempre lida de variável de ambiente no momento da execução, seguindo a mesma prática já usada para `SUPABASE_ACCESS_TOKEN` nos deploys de Edge Functions.

## UI/UX

- **Ícone de sino** (`bell`, Lucide) no `sidebar-header`, ao lado do botão de recolher sidebar (`#btn-sidebar-toggle`) — permanece visível mesmo com a sidebar colapsada, diferente dos itens de navegação que dependem de `.nav-label`.
- **Badge** vermelho com contador no canto do ícone; oculto (`display:none`) quando `unreadCount === 0`.
- **Visibilidade condicional**: renderizado apenas quando `app.userRole !== 'client'`, verificado no mesmo ponto onde o Portal do Cliente já é detectado (`initAfterAuth`).
- **Popover**: `position: fixed` (mesmo padrão do popup de RSVP da Agenda, para escapar de qualquer `overflow:hidden` de containers pais), ancorado ao ícone via `getBoundingClientRect()`. Lista as últimas 20 notificações, mais recente primeiro: título, descrição, data relativa (ex: "há 2 dias"). Sem paginação nem view dedicada nesta fase — se o volume crescer muito no futuro, isso pode ser revisitado.
- **Marcar como lido**: ao abrir o popover, chama `store.markNotificationsSeen()` (upsert de `last_seen_at = now()`) e zera o badge imediatamente. Itens mais novos que o `last_seen_at` anterior (capturado antes do upsert) recebem um destaque visual sutil (ponto azul) só durante essa abertura — não persiste como estado "novo" nas aberturas seguintes.
- **Tolerância a falha**: se a query falhar (rede, tabela ainda não migrada, RLS negando), o sino simplesmente não é renderizado — sem toast de erro, sem quebrar o restante do app. Mesmo padrão de tolerância usado no `aiClient.isConfigured`.

### Novos métodos em `store.js`

- `getNotifications(limit = 20)` — `SELECT * FROM app_notifications ORDER BY created_at DESC LIMIT N`, mapeado para camelCase.
- `getLastSeenAt()` — `SELECT last_seen_at FROM notification_reads WHERE user_id = this.userId` (maybeSingle; `null` se nunca visto).
- `markNotificationsSeen()` — upsert em `notification_reads` com `onConflict: 'user_id'`.

## Backfill do histórico

Ao implementar esta feature, publicar manualmente (via o mesmo script) as ~7 fases mais recentes (40 a 46), com título/descrição reescritos em linguagem amigável a partir da tabela de fases do CLAUDE.md — dá contexto imediato a quem abrir o sino pela primeira vez, sem inundar a lista com as 46 fases completas do projeto.

## Fora de escopo (deliberado)

- Parsing automático de commits ou da tabela do CLAUDE.md para detectar fases "não publicadas" — a publicação é sempre um passo manual e editorial.
- Marcação de leitura item-a-item — só o timestamp agregado `last_seen_at`.
- Visibilidade para o Portal do Cliente.
- Geração de conteúdo via IA em tempo real — o texto é escrito manualmente (por Jorge ou por Claude durante a sessão de implementação) antes de publicar.
