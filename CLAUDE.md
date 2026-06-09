# GerenciadorTSP — Documentação para Claude Code

## O que é este projeto

Sistema web de gerenciamento de horas e consultoria para empresas. Permite controlar contratos de clientes, horas consumidas, tarefas (Kanban), agenda de atendimentos e sincronização com Google Calendar. Suporta múltiplos usuários — cada um com sua própria carteira de clientes e lançamentos isolados.

Aplicação client-side (vanilla JS) com autenticação e persistência via **Supabase**, servida por nginx no Docker.

**URL de produção**: https://jorge-gerenciador-tsp.27pl2o.easypanel.host

---

## Stack e dependências

- **Linguagens**: HTML5, CSS3, JavaScript ES6+ (vanilla, sem frameworks, sem build step)
- **Autenticação e banco**: Supabase (Auth + PostgreSQL + RLS)
- **Servidor local (dev)**: Python 3 HTTP server na porta 8080
- **Servidor produção**: nginx:alpine via Docker
- **Bibliotecas (CDN)**:
  - `@supabase/supabase-js@2` — autenticação e acesso ao banco
  - Lucide Icons — ícones da UI
  - PDF.js — leitura/parsing de PDFs
  - jsPDF + jsPDF-AutoTable — geração de PDFs
  - Google Calendar API v3 + Google Identity Services (GIS) — integração de agenda
- **Design**: tema escuro, glassmorphism, variáveis CSS, fonte Inter

---

## Como rodar localmente

```batch
# Windows — duplo clique ou via terminal:
.\Iniciar.bat

# Manual (PowerShell):
python -m http.server 8080
# Abrir: http://localhost:8080/index.html
```

Em dev, `js/config.js` precisa existir localmente com as credenciais reais (não é gerado automaticamente fora do Docker). Crie manualmente:

```javascript
window.TSP_CONFIG = {
  CLIENT_ID: 'seu-google-client-id',
  API_KEY: 'sua-google-api-key',
  SUPABASE_URL: 'https://klimkamnydfnzqetqlqm.supabase.co',
  SUPABASE_ANON_KEY: 'eyJ...'
};
```

---

## Estrutura de arquivos

```
GerenciadorTSP/
├── index.html              # Estrutura HTML completa (tela de login + app + modais)
├── Dockerfile              # nginx:alpine + envsubst para injetar credenciais
├── nginx.conf              # Config nginx customizada: security headers, rate limit, CSP
├── docker-entrypoint.sh    # Gera config.js a partir de config.template.js + env vars
├── .dockerignore           # Exclui skills/, docs, .bat do container
├── Iniciar.bat             # Script dev: inicia servidor Python
├── js/
│   ├── config.template.js  # Template de configuração com placeholders (versionado)
│   ├── config.js           # Gerado em runtime pelo container (gitignored)
│   ├── auth.js             # Auth — Supabase client, login/logout, UI de autenticação
│   ├── app.js              # AppController — lógica de UI, handlers, renderização, PDF, migração
│   ├── store.js            # TSPStore — CRUD Supabase async + stats + backup
│   ├── ai.js               # TSPAIClient — cliente de IA configurável por usuário (OpenAI/Anthropic)
│   └── calendar.js         # GoogleCalendarAPI — OAuth e sincronização de eventos
├── supabase/
│   └── functions/
│       ├── otobo-proxy/index.ts   # Edge Function: proxy OTOBO (evita CORS)
│       └── ai-proxy/index.ts      # Edge Function: proxy IA (OpenAI + Anthropic, protege API key)
├── styles/
│   └── main.css            # Sistema de design + Toast notifications + Loading spinners
├── skills/                 # Instrução de skills de desenvolvimento (gitignored, não vai ao container)
└── Documentation/
    ├── INSTRUCOES_GOOGLE_CALENDAR.md
    ├── fase6-rls-verificacao.sql      # SQL para verificar/criar políticas RLS no Supabase
    ├── fase6-checklist-testes.md      # Checklist completo de testes multi-usuário
    └── GEMINI-Construtor-de-Sites.md  # Referência de design (não faz parte do app)
```

---

## Arquitetura

### Fluxo de inicialização

```
DOMContentLoaded
  → Auth.init()          — inicializa Supabase client
  → Auth.getSession()    — verifica se há sessão ativa
  → new AppController()  — configura event listeners
  → se autenticado:  Auth.hideAuthScreen() + app.initAfterAuth()
  → se não:          Auth.showAuthScreen()
```

### Classes / objetos principais

**`Auth`** (`js/auth.js`)
- Inicializa o Supabase client (`window.supabaseClient`)
- Gerencia sessão: `getSession()`, `signIn()`, `signUp()`, `signOut()`
- Controla exibição da tela de login/cadastro
- `handleSubmit()` — trata o formulário de login e cadastro

**`AppController`** (`js/app.js`)
- Controla navegação entre views (Dashboard, Clientes, Atendimentos, Tarefas, Agenda)
- Gerencia modais, formulários e eventos de UI
- Renderiza todas as views dinamicamente no DOM
- `initAfterAuth()` — ponto de entrada pós-login; chama `applySidebarState()`, `applyMoneyVisibility()` e `renderAll()`
- `toggleSidebar()` / `applySidebarState()` — controla sidebar recolhível; estado via `sessionStorage.sidebarCollapsed`
- `toggleMoneyVisibility()` / `applyMoneyVisibility()` — oculta valores monetários; estado via `sessionStorage.moneyHidden`

**`TSPStore`** (`js/store.js`)
- Todas as operações são `async`, usam `this.db` (supabaseClient) e `this.userId` (Auth.getUserId())
- Mappers `_client()`, `_record()`, `_task()`, `_event()` convertem snake_case → camelCase
- CRUD para: Clientes, Registros (horas), Tarefas, Eventos de agenda + stats + backup
- `_computeClientStats(client, records, tasks, columns)` — cálculo puro de stats em memória, sem DB; usado por `getBatchStats()` e `getClientStats()`
- `getBatchStats()` — busca clients + records (só `client_id, minutes`) + tasks (sem blobs JSONB) + columns em **4 queries paralelas** e computa stats para todos os clientes; chamado por `renderAll()` para eliminar o padrão N×4 queries

**`GoogleCalendarAPI`** (`js/calendar.js`)
- Lê credenciais de `window.TSP_CONFIG.CLIENT_ID` e `window.TSP_CONFIG.API_KEY`
- Sincronização bidirecional com Google Calendar

**`TSPAIClient`** (`js/ai.js`)
- Singleton em `window.aiClient = new TSPAIClient()`; carregado entre `store.js` e `app.js`
- Configuração por usuário: provider (`openai` ou `anthropic`), api_key, model salvo em `user_ai_config` no Supabase (RLS)
- Todas as chamadas passam pela Supabase Edge Function `ai-proxy` — a API key nunca é exposta ao browser
- `loadConfig()` — carrega config do banco; chamado com `.then()` em `initAfterAuth()` (não bloqueante)
- `reset()` — limpa estado no logout
- `complete(systemPrompt, userPrompt)` — base de todas as features; usa JWT da sessão do usuário
- `isConfigured` getter — booleano; todas as features checam isso antes de exibir botões
- Features: `improveAtendimentoDescription()`, `suggestTaskNextSteps()`, `improveImplementationDescription()`, `generateAgendaReportNarrative()`, `parseAgendaNaturalLanguage()`, `generateDashboardInsights()`

---

## Banco de dados (Supabase)

**Projeto**: `klimkamnydfnzqetqlqm.supabase.co`

### Tabelas

Todas têm `user_id uuid references auth.users` + RLS ativa (`auth.uid() = user_id`).

| Tabela | Campos principais |
|--------|------------------|
| `clients` | id, user_id, name, hours_total, cs_name, project_num, client_pays, notes, status |
| `records` | id, user_id, client_id, date, start_time, end_time, minutes, description |
| `tasks` | id, user_id, client_id, title, description, status, priority, due_date, estimated_minutes, spent_minutes |
| `agenda_events` | id, user_id, client_id, related_task_id, title, type, date, **date_end**, start_time, end_time, location, calendar_event_id, **meet_link**, **attendees** |
| `apontamentos` | id, user_id, date, start_time, end_time, project_num, description |
| `implementations` | id, user_id, name, type, description, code_script, status, version, implementation_date, notes |
| `implementation_clients` | id, user_id, implementation_id, client_id, notes — junção M:N |
| `kanban_columns` | id, user_id, client_id (nullable), name, color, position, is_done, created_at |
| `otobo_config` | user_id (PK), url, username, password, updated_at |
| `tickets` | id, user_id, ticket_id, ticket_number, title, status, priority, queue, customer_name, owner, created_at_otobo, updated_at_otobo, raw_data JSONB, linked_client_id, synced_at |
| `user_ai_config` | user_id (PK), provider (openai\|anthropic), api_key TEXT, model TEXT, updated_at |

### Fases de migração

- **Fase 1** ✅ — Supabase criado, tabelas e RLS configuradas
- **Fase 2** ✅ — Autenticação: tela de login/logout integrada ao app
- **Fase 3** ✅ — Reescrita do `store.js` para Supabase + adaptação completa do `app.js` para async/await
- **Fase 4** ✅ — Loading states (spinners) e error handling (Toast notifications) na UI
- **Fase 5** ✅ — Ferramenta de migração localStorage → Supabase (detecção automática + modal + limpeza)
- **Fase 6** ✅ — Deploy final: correções RLS defense-in-depth, reset de estado no logout, checklist de testes multi-usuário
- **Fase 7** ✅ — Suite de testes Playwright 48/48 passando; correção do Toast (`lucide.createIcons()`) e headers de segurança nginx
- **Fase 8** ✅ — Importação de Ata PDF (SAP): parser page-by-page, extração de nome do cliente, criação automática de cliente, validação de horas centesimais
- **Fase 9** ✅ — View Apontamentos: log diário independente de clientes (horário, nº projeto, descrição) para conferência antes de lançar no ERP; tabela `apontamentos` com RLS
- **Fase 10** ✅ — Agenda: clicar no dia abre novo agendamento direto; campo Data Final (`date_end`) para eventos multi-dia; queries com overlap detection; sync Google Calendar usa dateEnd
- **Fase 11** ✅ — Agenda: botão "Excluir" no modal de edição de agendamento (visível apenas ao editar); `deleteAgendaEventFromModal()` lida com remoção no Supabase + Google Calendar + fechamento do modal
- **Fase 12** ✅ — Agenda: checkbox "Dia inteiro" no modal; quando marcado, oculta campos de horário e salva `startTime: ''`; eventos dia-inteiro exibidos como banners coloridos acima da grade horária nas views diária e semanal; view schedule exibe "Dia inteiro"; tooltip mensal atualizado; Google Calendar recebe formato `date` (sem hora) para eventos dia-inteiro
- **Fase 13** ✅ — Tarefas: anexos reais com paste de prints (Ctrl+V) e seleção de arquivos; imagens salvas como base64 JPEG em coluna `attachments JSONB` na tabela `tasks`; thumbnails no modal com remoção individual; miniatura no card Kanban; compressão automática via Canvas (max 1400px, JPEG 75%)
- **Fase 15** ✅ — Implementações: biblioteca de recursos técnicos (triggers, procedures, features, customizações, integrações) vinculados a zero, um ou vários clientes; tabelas `implementations` + `implementation_clients` (M:N) com RLS; view com grade de cards agrupada por tipo, filtros por tipo/status/cliente; modal com campos nome, tipo, status, versão, data, descrição, código (monospace), multi-select de clientes, notas; botão excluir visível apenas ao editar
- **Fase 16** ✅ — Implementações: anexos de imagem (paste Ctrl+V + seleção de arquivo); imagens salvas como base64 JPEG em coluna `attachments JSONB` na tabela `implementations`; thumbnails no modal com remoção individual e lightbox; contador de anexos exibido no card; novo tipo "Relatório Customizado" (`report`) com ícone `file-bar-chart-2`; migration SQL necessária: `ALTER TABLE implementations ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'`
- **Fase 14** ✅ — Agenda: Google Meet + convites por e-mail; checkbox "Gerar link do Google Meet" no modal (visível apenas quando sync Google ativo); campo Participantes (e-mails separados por vírgula); `createGoogleEvent()` usa `conferenceDataVersion=1` + `sendUpdates='all'` — Google gera a sala e envia convites automaticamente; `meetLink` salvo localmente; sync bidirecional captura `hangoutLink` e `attendees` do Google; ícone de vídeo clicável nos event blocks e na view schedule; botão Copiar no bloco read-only do link Meet
- **Fase 17** ✅ — Kanban reescrito (Trello-like): colunas `.kb-column[data-status]` com quick-add inline por coluna; modal two-panel (conteúdo à esquerda, sidebar de ações à direita); labels coloridas (picker + chips no card); checklist com toggle/delete por item; cover color no card; ordenação persistente via campo `position INTEGER` no Supabase + `reorderTasks()` após DnD; design tokens `--kb-*` no CSS; migration SQL: `ADD COLUMN position INTEGER`, `labels JSONB`, `checklist JSONB`, `cover_color TEXT` + índice `idx_tasks_user_status_position`
- **Fase 18** ✅ — Kanban DnD com placeholder em tempo real (estilo Trello): card arrastado fica semi-transparente (`opacity:0.4`, `pointer-events:none`); placeholder `.kb-drag-placeholder` (borda dashed, mesma altura do card) se move no DOM em tempo real conforme o mouse passa pelos cards; `reorderTasks()` reescrito de `upsert` para `Promise.all` de `UPDATE` individuais (upsert conflitava com RLS do Supabase); placeholder intercepta seus próprios `dragover`/`drop` com `stopPropagation` para evitar flickering causado por borbulhamento até a dropzone
- **Fase 19** ✅ — Comentários e atividade nas tarefas: seção abaixo de Anexos no modal; comentários manuais (textarea + botão Comentar, Ctrl+Enter); log automático de mudanças de status (via botões "Mover para" no modal e DnD) e lançamentos de tempo; entradas armazenadas em coluna `comments JSONB DEFAULT '[]'` na tabela `tasks`; migration SQL: `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS comments JSONB DEFAULT '[]'`; exibição mais recente primeiro; atividades compactas com ícone Lucide; comentários manuais com botão de excluir visível no hover
- **Fase 20** ✅ — Importação PDF: UI de divergência de horas; `parsePdfPages` retorna `{ records, warnings }`; records de página divergente recebem `_warningMsg`; modal de confirmação exibe painel amarelo de aviso acima da tabela (com lista das páginas divergentes) e ícone `⚠` inline na coluna "Tempo" de cada linha afetada (com tooltip mostrando detalhe); `pendingPdfWarnings` limpo no logout e após confirmação
- **Fase 21** ✅ — Sync Google Calendar robusto: `syncEventsFromGoogle` busca de **todos os calendários** do usuário (não só `primary`) via `calendarList.list` + deduplica por `id`; loop de import (parte 1) tem try-catch por evento — falha em um não impede os demais; loop de push (parte 2) corrigido para só enviar eventos SEM `calendarEventId` (evita recriar no Google eventos antigos fora da janela ±30 dias); toast de aviso mostra contagem de falhas parciais; **passo 3** (fix posterior): eventos locais com `calendarEventId` dentro da janela ±30 dias que não aparecem mais no Google são deletados localmente — reflete deleções feitas diretamente no Google Calendar
- **Fase 22** ✅ — Colunas Kanban personalizadas por cliente:
- **Fase 24** ✅ — Painel de Saldo de Horas: botão "Saldo" no header da view Clientes abre modal `modal-saldo` com posição acumulada de horas por projeto; novos campos em `clients`: `initial_balance_minutes INTEGER` (saldo de entrada em minutos) e `balance_start_date DATE` (início do período de cálculo automático); cálculo: `saldo = initialBalanceMinutes + totalAplicado − totalContratado` onde positivo = consultor entregou mais que o contratado; mês atual entra completo no contratado independente do dia; modal exibe tabela com Cota/mês, Mês atual (com delta colorido) e Saldo acumulado; clientes sem `balanceStartDate` exibem "sem controle" na coluna de saldo; migration SQL: `ALTER TABLE clients ADD COLUMN IF NOT EXISTS initial_balance_minutes INTEGER DEFAULT 0, ADD COLUMN IF NOT EXISTS balance_start_date DATE;`
- **Fase 25** ✅ — Agendamento Automático: regras de recorrência por cliente (tabela `scheduling_rules`) com frequência semanal/quinzenal/mensal, dias da semana, horário, período fixo (data início + data fim) e geração idempotente via `last_generated_until`; aba "Agendamento" no modal do cliente (tabs `.modal-tab`/`.modal-tabs`) lista as regras ativas do cliente; modal `modal-scheduling-rule` para criar/editar regras com checkboxes de dias da semana (`.rule-day-btn`); botão ⚡ por regra abre modal `modal-schedule-preview` com lista de ocorrências calculadas e marcação de conflitos (⚠) com eventos existentes no mesmo horário; confirmação cria `agenda_events` + push Google Calendar + atualiza `last_generated_until`; migration SQL (criação): `CREATE TABLE scheduling_rules (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL, client_id UUID REFERENCES clients ON DELETE CASCADE NOT NULL, title TEXT NOT NULL DEFAULT 'Atendimento', event_type TEXT DEFAULT 'meeting', description TEXT DEFAULT '', days_of_week JSONB DEFAULT '[]', start_time TEXT NOT NULL DEFAULT '', end_time TEXT NOT NULL DEFAULT '', frequency TEXT NOT NULL DEFAULT 'weekly', period_start DATE NOT NULL, period_end DATE NOT NULL, location TEXT DEFAULT '', attendees TEXT DEFAULT '', generate_meet BOOLEAN DEFAULT FALSE, is_active BOOLEAN DEFAULT TRUE, last_generated_until DATE, created_at TIMESTAMPTZ DEFAULT now()); ALTER TABLE scheduling_rules ENABLE ROW LEVEL SECURITY; CREATE POLICY "users_own_scheduling_rules" ON scheduling_rules FOR ALL USING (auth.uid() = user_id);`; migration SQL (tabela já existe): `ALTER TABLE scheduling_rules ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';`
- **Fase 25 (update)** ✅ — Paridade com agendamento manual: tipos de evento alinhados (meeting/consulting/task/reminder); campo Descrição adicionado (`rule-description`); checkbox "Dia inteiro" (`rule-all-day`) via `toggleAllDayRule()` — oculta campos de hora e salva `startTime: ''`; Meet row sempre visível (não depende mais do checkbox `agenda-sync-google`); `confirmScheduleGeneration()` passa `generateMeet: ev.generateMeet` ao `createGoogleEvent()` e `description` ao `addAgendaEvent()`; card na tab de agendamento exibe tipo, descrição e "Dia inteiro" quando aplicável
- **Fase 26** ✅ — Agendamento Automático com Meta de Horas: modal `modal-schedule-preview` enriquecido com painel "Resumo de Horas" (horas agendadas vs meta mensal do cliente com delta colorido: verde ±10%, vermelho deficit, amarelo excesso); breakdown por mês em tabela quando a regra cobre múltiplos meses; botão "Sugerir X sessões extras" aparece automaticamente quando há deficit — calcula sessões faltantes via `Math.ceil(deficit / sessionMinutes)` e propõe próximas datas seguindo `daysOfWeek` da regra; campo "+ Adicionar data específica" com mini-calendário inline customizado (substituiu `<input type="date">` nativo) que exibe pontos coloridos nos dias ocupados — azul = já na lista, laranja = conflito com agenda existente; botão ✕ em cada linha para remover eventos antes de confirmar; resumo e contador do botão "Confirmar (N)" atualizam em tempo real via `_renderPreviewContent()`; eventos extras marcados com `isExtra: true` (apenas em memória — chegam ao banco como eventos normais); sem novas colunas no banco — usa `clients.hours_total` existente; novos métodos: `_renderPreviewContent()`, `_previewRemoveEvent(idx)`, `_previewSuggestExtras()`, `_previewAddManual()`, `_renderMiniCal()`, `_miniCalNav(delta)`, `_miniCalSelectDate(dateStr)`; novos estados de instância: `_pendingPreviewRule`, `_pendingPreviewClient`, `_pendingPreviewConflictSet`, `_miniCalYear`, `_miniCalMonth`, `_miniCalSelected`
- **Fase 26 (update)** ✅ — Edição inline de data no preview: botão lápis em cada linha de evento do `modal-schedule-preview` converte o span de data em `<input type="date">` editável; ao confirmar a nova data, `_previewEditEventDate(idx, newDate)` atualiza `_pendingPreviewEvents[idx].date`, reavalia `hasConflict` via `_pendingPreviewConflictSet`, reordena o array e chama `_renderPreviewContent()`; perder o foco sem alterar cancela a edição via re-render; novos métodos: `_previewStartEditDate(idx)`, `_previewEditEventDate(idx, newDate)`; nova classe CSS `preview-edit-date-btn`; cada row recebe `data-preview-idx="${idx}"` e o span de data ganha classe `preview-date-text`
- **Fase 27** ✅ — Relatório de Agenda por Cliente: geração de relatório de eventos da agenda filtrado por cliente + período; dois formatos de saída: PDF (jsPDF-AutoTable) e texto copiável (WhatsApp/e-mail); acessível de dois pontos — botão "Relatório" no header da view Agenda (abre `modal-agenda-report` com select de cliente + período) e aba "Relatório" no modal do cliente (painel inline `tab-client-report`); ambas as fontes compartilham os métodos `fetchAgendaReportEvents(source)`, `generateAgendaReportPdf(source)` e `generateAgendaReportText(source)` via `_reportGetContext(source)` que abstrai de onde vêm os dados; novo método `store.getAgendaEventsByClientAndRange(clientId, startDate, endDate)` — query com overlap detection por `client_id`; estado compartilhado em `_reportEvents` e `_reportClient`; `switchClientModalTab()` estendido para suportar aba `'report'` além de `'dados'` e `'scheduling'`; sem novas tabelas no banco
- **Fase 30** ✅ — Kanban: marcar tarefa como concluída diretamente no card; botão circular no footer à esquerda do lápis (aparece no hover; verde e sempre visível quando concluída); badge "Concluída" verde nos badges do card; ao marcar: registra entrada `completed` na atividade da tarefa com data/hora; ao desmarcar: remove todas as entradas `completed`/`uncompleted` do log (sem nova entrada); migration SQL: `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed BOOLEAN DEFAULT FALSE; ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;`; novos campos `completed`/`completedAt` em `_task()`, `updateTask()` e `handleTaskSubmit()`; novo método `store.toggleTaskComplete(taskId, completed)` e `store.removeCompletionActivity(taskId)`; `_modalCompleted` e `_modalCompletedAt` como estado do modal de tarefa
- **Fase 29** ✅ — Chamados OTOBO: view "Chamados" com cache no Supabase (`otobo_config` + `tickets`), sync manual via REST API OTOBO (TicketSearch + TicketGet em lotes de 10), agrupamento por cliente TSP com match fuzzy por nome, badges de status/prioridade, modal two-panel com artigos carregados on-demand, link "Abrir no OTOBO"; migration SQL: criação das tabelas `otobo_config` e `tickets` com RLS; CORS é o principal risco — se o OTOBO bloquear, toast exibe mensagem orientando o admin
- **Fase 32** ✅ — Bot WhatsApp via Evolution API: instância `tsp` criada no Evolution API (`jorge-evolution-api.27pl2o.easypanel.host`); Supabase Edge Function `whatsapp-bot` recebe webhooks, identifica usuário pelo número registrado em `user_profiles`, detecta intent por regex (query_hours, query_agenda, query_tasks, help) e responde via Evolution API; `query_hours` retorna consumo de horas por cliente no mês atual com barra visual de progresso (🟢🟡🔴); `query_agenda` retorna eventos dos próximos 7 dias com tipo e horário; `query_tasks` retorna tarefas em aberto por cliente (com estado conversacional via `bot_state` em `user_profiles`); botão "WhatsApp" no sidebar bottom abre modal `modal-whatsapp-config` onde o usuário cadastra seu número pessoal; botão "Enviar teste" chama Edge Function com JWT do usuário para enviar mensagem de boas-vindas; migration SQL: `CREATE TABLE user_profiles (user_id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE, whatsapp_number TEXT, updated_at TIMESTAMPTZ DEFAULT now())` com RLS; migration SQL adicional (query_tasks): `ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS bot_state JSONB DEFAULT '{}';`; novos métodos: `store.getWhatsappProfile()`, `store.saveWhatsappProfile(number)`, `app.openWhatsappConfig()`, `app.saveWhatsappConfig()`, `app.sendTestWhatsapp()`; secrets da Edge Function: `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE=tsp`, `WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`; deploy: `npx supabase@latest functions deploy whatsapp-bot --project-ref klimkamnydfnzqetqlqm --no-verify-jwt` com `SUPABASE_ACCESS_TOKEN` setado; **PENDENTE: escanear QR code** em `https://jorge-evolution-api.27pl2o.easypanel.host` → instâncias → `tsp` para conectar o número ao bot
- **Fase 33** ✅ — Integração de IA — infraestrutura base: tabela `user_ai_config` com RLS (upsert por `user_id`); Supabase Edge Function `ai-proxy` (Deno) autentica via JWT, lê config do usuário, roteia para OpenAI (`/v1/chat/completions`) ou Anthropic (`/v1/messages`) e retorna `{ content }`; classe `TSPAIClient` em `js/ai.js` com `complete()`, `loadConfig()`, `reset()`, `testConnection()`; modal `modal-ai-config` na sidebar bottom (botão ✨) com select de provider, select de model dinâmico, input de API key com toggle de visibilidade, botão "Testar conexão" e botão "Remover"; badge de status na sidebar atualizado em `initAfterAuth()`; deploy: `npx supabase@latest functions deploy ai-proxy --project-ref klimkamnydfnzqetqlqm`; migration SQL: `CREATE TABLE user_ai_config (user_id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE, provider TEXT NOT NULL DEFAULT 'anthropic', api_key TEXT NOT NULL, model TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001', updated_at TIMESTAMPTZ DEFAULT now()); ALTER TABLE user_ai_config ENABLE ROW LEVEL SECURITY; CREATE POLICY "users_own_ai_config" ON user_ai_config FOR ALL USING (auth.uid() = user_id);`
- **Fase 34** ✅ — IA: melhoria de texto em 3 views: botão `✨ Melhorar com IA` nos campos de Descrição de Atendimento (`#record-desc`), Apontamento (`#apt-description`) e Implementação (`#impl-description`); botão oculto por padrão, exibido via `oninput` quando há 10+ chars e `aiClient.isConfigured`; ao clicar: lê contexto (cliente/projeto/duração/tipo/código), chama `aiClient.improveAtendimentoDescription()` ou `aiClient.improveImplementationDescription()`, substitui o textarea com flash roxo (`rgba(139,92,246,0.08)`); métodos: `onRecordDescInput()`, `improveRecordDescription()`, `onAptDescInput()`, `improveAptDescription()`, `onImplDescInput()`, `improveImplDescription()`; `setTimeout(() => this.onXxxDescInput(), 50)` nos métodos `open` para exibir botão ao editar registro existente
- **Fase 35** ✅ — IA: features contextuais em 4 views:
  - **Kanban (Fase C)**: botão `✨ Sugerir com IA` no header do Checklist (visível só ao editar tarefa existente com IA configurada); chama `aiClient.suggestTaskNextSteps(title, description, checklist, activityLog)`; exibe painel inline com 3-6 sugestões selecionáveis — botão `+` por item ou "Adicionar todos"; sugestão adicionada fica riscada; painel limpo ao fechar modal; estado `_aiTaskSuggestions` em AppController
  - **Relatório de Agenda (Fase E)**: botão `✨ Narrativa com IA` aparece junto com PDF/Copiar texto após Buscar, nos dois pontos de acesso (modal standalone + aba Relatório do cliente); chama `aiClient.generateAgendaReportNarrative(clientName, events, startDate, endDate)`; exibe painel roxo com textarea editável + botão Copiar; painel oculta ao trocar cliente ou nova busca; `_copyReportNarrative(source)` usa `navigator.clipboard`; `_reportGetContext(source)` estendido com `aiBtn`, `aiPanel`, `aiTextarea`
  - **Assistente de Linguagem Natural — Agenda (Fase F)**: botão `✨ Assistente` no header da view Agenda; abre painel colapsável com textarea e botão "Interpretar" (Ctrl+Enter); `aiClient.parseAgendaNaturalLanguage(text, todayDate)` retorna JSON `{title, type, date, dateEnd, startTime, endTime, allDay, location, description}`; `interpretAgendaEvent()` chama `openNewAgendaEvent(date)` e preenche todos os campos retornados; painel fecha após sucesso e limpa o input
  - **Dashboard Insights (Fase G)**: botão `✨ Insights` no header do Dashboard; painel `#dashboard-ai-insights` aparece acima dos cards; `aiClient.generateDashboardInsights(stats, monthLabel)` recebe dados de consumo/projeção/tarefas por cliente e retorna análise em 3 seções (Visão Geral, Atenção Necessária, Oportunidades); respeita filtros de status e mês; botão ✕ fecha o painel
- **Fase 31** ✅ — Chamados: filtros locais + sincronização seletiva; barra de filtros na view Chamados (número/título, status, prioridade, fila, proprietário, tipo, cliente vinculado); filtros locais aplicados sobre cache em memória (`_cachedChamadosTickets`); modal `modal-otobo-config` reestruturado em duas tabs ("Conexão" + "Filtros de Sync"); filtros de sync salvos em `sync_filters JSONB` na tabela `otobo_config` e repassados ao proxy OTOBO; novo campo `ticket_type` em `tickets`; badge de tipo no card; linha "Tipo" na sidebar do modal de detalhe; migration SQL: `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ticket_type TEXT DEFAULT ''; ALTER TABLE otobo_config ADD COLUMN IF NOT EXISTS sync_filters JSONB DEFAULT '{}';`; novos métodos: `_attachChamadoFilterListeners()`, `_rerenderChamadosWithFilters()`, `_applyTicketFilters()`, `_populateChamadoFilterDropdowns()`, `clearChamadoFilters()`, `switchOtoboTab()`
- **Fase 28** ✅ — Importação PDF: detecção de duplicatas; antes de exibir o modal de confirmação, `openPdfConfirmationModal()` faz uma única query via `store.getRecordsByDateRange(startDate, endDate, clientIds)` para buscar todos os registros existentes no intervalo de datas da ata; chave de comparação: `client_id|date|start_time|end_time`; registros já existentes recebem flag `_isDuplicate: true`; exibidos no modal com linha riscada (`.pdf-row-duplicate`), badge laranja "Já lançado" (`.pdf-dup-badge`) e checkbox desabilitado; painel amarelo `#pdf-dup-warnings` lista os registros ignorados acima da tabela; `confirmPdfImport()` pula registros `_isDuplicate` e inclui contagem no toast final ("X importados. Y já existiam e foram ignorados."); novo método `store.getRecordsByDateRange(startDate, endDate, clientIds[])`; sem migration necessária
- **Fase 36** ✅ — Agenda: múltiplas tarefas por agendamento + auto-preenchimento da descrição; substitui o select único de tarefa por botão "Vincular Tarefas" que abre painel inline com checkboxes filtrados pelo cliente selecionado; seleção temporária em `_agendaTaskPanelTempIds` (descartada no Cancelar) confirmada em `_agendaRelatedTaskIds`; tarefas confirmadas exibidas como chips removíveis abaixo do botão; ao confirmar ou remover chip, campo Descrição atualizado automaticamente com bloco `\n\nTarefas executadas:\n- Título...` usando marcador sentinela para preservar texto digitado pelo usuário; nova coluna `related_task_ids JSONB DEFAULT '[]'` em `agenda_events` com retrocompatibilidade via `related_task_id` (legado); migration SQL: `ALTER TABLE agenda_events ADD COLUMN IF NOT EXISTS related_task_ids JSONB DEFAULT '[]';`; novos métodos: `openAgendaTaskPanel()`, `cancelAgendaTaskPanel()`, `confirmAgendaTaskPanel()`, `toggleAgendaTaskTemp(taskId)`, `removeAgendaTask(taskId)`, `_renderAgendaTaskPanel()`, `_renderAgendaTaskChips()`, `_updateAgendaLinkBtn()`, `_updateDescriptionWithTasks()`; estado em `_agendaRelatedTaskIds[]`, `_agendaTaskPanelTempIds[]`, `_agendaAllTasks[]`
- **Fase 38** ✅ — Chamados: filtros de exibição persistidos por usuário no banco; coluna `local_filters JSONB DEFAULT '{}'` adicionada em `otobo_config`; `store.saveOtoboLocalFilters(filters)` faz UPDATE (não upsert) para não criar linhas sem config de conexão; `_restoreChamadoFilters(saved)` restaura checkboxes + campo de busca após `_populateChamadoFilterDropdowns()` na abertura da view; `_rerenderChamadosWithFilters()` agenda save debounced de 800ms após qualquer mudança; `clearChamadoFilters()` salva `{}` imediatamente; `_chamadoFilterSaveTimer` limpo no logout; migration SQL: `ALTER TABLE otobo_config ADD COLUMN IF NOT EXISTS local_filters JSONB DEFAULT '{}';`
- **Fase 39** ✅ — Chamados: sync incremental por timestamp; coluna `last_sync_at TIMESTAMPTZ` em `otobo_config`; primeira sync (ou Shift+clique) é completa (busca todos); syncs seguintes são incrementais — envia `TicketLastChangeTimeNewerDate` ao OTOBO via proxy, buscando apenas tickets alterados desde o último sync; limite incremental: 200 tickets (vs 500 completa); sync incremental nunca apaga cache (`deleteTicketsNotIn` só roda em sync completa sem `ownerFilter`); `store.saveOtoboLastSync(isoTimestamp)` persiste o timestamp no banco; `_otoboConfig.lastSyncAt` atualizado em memória após cada sync bem-sucedida; UI exibe `"(incremental)"` no status e no toast; botão "Sincronizar" passa `event.shiftKey` como `force`; `_fetchTicketsFromOtobo(config, onProgress, lastSyncAt)` repassa `lastSyncAt` ao proxy; proxy formata o timestamp para `"YYYY-MM-DD HH:MM:SS"` (UTC) exigido pelo OTOBO; migration SQL: `ALTER TABLE otobo_config ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;`
- **Fase 40** ✅ — Gerador de Apontamentos a partir de Tarefas: botão `⚡ Gerar do Dia` (`#btn-generate-apontamentos`) no header da view Apontamentos, visível apenas quando IA configurada; busca todas as tasks do usuário via `store.getTasksForApontamento(date)` — filtra em memória por `completedAt.startsWith(date)` OU qualquer entrada em `task.comments[].createdAt.startsWith(date)`; agrupa por `clientId`; abre modal `modal-apontamento-generator` com skeleton; dispara `Promise.all` de `aiClient.generateApontamentoFromTasks(clientName, projectNum, tasks, date)` por cliente (em paralelo); resultado exibido em cards editáveis com checkbox de inclusão, textarea de descrição (editável), e inputs de horário início/fim; `confirmApontamentoGeneration()` valida horários, cria apontamentos via `store.addApontamento` em paralelo e fecha o modal; se AI falha em um cliente, card exibe textarea vazia com hint de preenchimento manual; sem nova tabela no banco; novos métodos em `app.js`: `generateApontamentosFromTasks()`, `_renderAptGenContent()`, `_aptGenToggle()`, `_aptGenDescChange()`, `_aptGenTimeChange()`, `_aptGenUpdateConfirmBtn()`, `confirmApontamentoGeneration()`; novo método em `store.js`: `getTasksForApontamento(date)`; novo método em `ai.js`: `generateApontamentoFromTasks(clientName, projectNum, tasks, date)`; estado `_aptGenEntries` em AppController (null no constructor e no logout); `_updateAIStatusBadge()` atualizado para exibir/ocultar `#btn-generate-apontamentos`
- **Fase 37** ✅ — Dashboard: modal "Horas do Mês" — botão "Horas do Mês" no header do Dashboard abre `modal-horas-mes` com ranking de clientes por horas aplicadas no mês selecionado; total geral em destaque no topo; barras horizontais proporcionais ao maior consumidor (100% = cliente com mais horas); cor da barra: roxo (normal), amarelo (≥80% do contrato), vermelho (>100% do contrato); coluna "Contrato / %" exibe cota mensal + percentual consumido; toggle "Mostrar sem horas" filtra clientes sem lançamentos no período; dados via `store.getBatchStats(this._dashboardMonth)` (4 queries paralelas, sem custo extra); sincroniza com o mês selecionado no Dashboard (navegação por mês funciona); estado cacheado em `_horasMesStats` — toggle não faz nova query; `_horasMesStats = null` no constructor e no logout; sem migration, sem novas tabelas; novos métodos: `openHorasMes()`, `_renderHorasMesContent()`, `_horasMesToggle()`
- **Fase 23** ✅ — Gestão de Treinamentos: biblioteca de materiais didáticos por cliente; tabelas `trainings` + `training_clients` (M:N obrigatório — todo treinamento exige pelo menos um cliente); `attachments JSONB` com discriminador `type`: `'link'` (URL externa com detecção automática de tipo: youtube/drive/pdf/generic) e `'image'` (base64 JPEG comprimido via Canvas); view com cards agrupados por categoria (Geral/SAP/Sistema/Processo/Ferramenta) e filtros por categoria/status/cliente; modal com campo links externos (rótulo + URL + botão adicionar) e prints de tela (Ctrl+V + file picker); botão Excluir visível apenas no modo edição; migration SQL necessária antes do deploy nova tabela `kanban_columns` (id, user_id, client_id, name, color, position, is_done, created_at) com RLS; cada cliente tem seu próprio conjunto de colunas; migration automática na primeira abertura (status antigos 'new'/'doing'/'done' → UUIDs das novas colunas padrão); botão "Gerenciar Colunas" no header da view Tarefas (visível apenas com cliente filtrado); modal com lista reordenável (▲▼), color picker, checkbox "Finalizada", delete com bloqueio se houver tasks; Kanban requer seleção de cliente para exibir board (placeholder quando sem filtro); quick-add usa clientId do filtro; campo Cliente obrigatório no modal de tarefa; `store.getClientStats` detecta colunas "done" dinamicamente

---

## Variáveis de ambiente

Configuradas no Easypanel → serviço `gerenciador-tsp` → Ambiente:

| Variável | Descrição |
|----------|-----------|
| `GOOGLE_CLIENT_ID` | OAuth Client ID do Google Cloud |
| `GOOGLE_API_KEY` | API Key do Google Cloud |
| `SUPABASE_URL` | `https://klimkamnydfnzqetqlqm.supabase.co` |
| `SUPABASE_ANON_KEY` | Chave pública anon do Supabase |

O `docker-entrypoint.sh` injeta essas vars em `js/config.js` via `envsubst` na inicialização do container. O arquivo `js/config.js` está no `.gitignore`.

---

## Deploy

- **VPS**: Hostinger → Easypanel → projeto `jorge`, serviço `gerenciador-tsp`
- **Build**: Dockerfile (nginx:alpine)
- **Repo**: https://github.com/jorjaocorreia-spec/gerenciador-tsp (público)
- **Branch**: `main` → ~~deploy automático via webhook~~ **deploy manual** (webhook quebrado)
- NUNCA tocar em outros serviços da VPS (7dias, evolution-api, termix)

---

## Regras de desenvolvimento

### O que nunca alterar sem cuidado
- Schema das tabelas Supabase — mudanças requerem migration SQL e atualização do store.js
- `docker-entrypoint.sh` — qualquer var nova precisa ser adicionada aqui E no Easypanel
- IDs de elementos HTML — usados como seletores em `app.js`; renomear quebra a UI
- Estrutura do sidebar — `.sidebar-header`, `.sidebar-bottom`, `.sidebar-user`, `.sidebar-section-label` e `.nav-label` são usados pelo CSS do estado colapsado; reorganizar sem atualizar o CSS quebra o comportamento de colapso

### Padrões de código
- JavaScript vanilla ES6+; sem TypeScript, sem React, sem bundler
- CSS usa variáveis (`--primary`, `--bg-glass`, etc.) definidas em `:root`
- Todas as chamadas ao `store` são `async/await` — nunca chamar métodos do store sem `await`
- Pre-fetch de dados antes de loops de render — nunca fazer `await` dentro de `forEach`; usar `getBatchStats()` para stats de múltiplos clientes e passar arrays pré-buscados como parâmetro para as funções de render

### Armadilhas conhecidas
- **`switchView()` chama `renderAll()` sem `await`** — views sub-nível (client-dashboard, month-records) ficam com spinner briefly após navegação; testes ou código que dependem do conteúdo renderizado devem aguardar o elemento concreto aparecer no DOM
- **`renderAll()` tem mutex guard (`_renderAllRunning` / `_renderAllPending`)** — chamadas concorrentes são descartadas (a segunda aguarda e roda uma vez após a primeira terminar). Isso evita que `switchView()` e `initAfterAuth()` executem `renderAll()` em paralelo. O guard foi necessário porque `Auth.hideAuthScreen()` exibe a sidebar ANTES de `initAfterAuth()` terminar o `await calendarAPI.configure()`, permitindo que o usuário clique em um nav-item e dispare `switchView()` → `renderAll()` concorrente. **Nunca remover esses flags** sem entender essa janela de concorrência.
- **`renderClients()` coleta todos os stats antes de tocar no DOM** — recebe `batchStats` pré-buscado de `renderAll()` e só depois chama `tbody.innerHTML = ''` + `forEach` síncrono. Isso garante que nenhum `await` ocorra dentro do loop de render, eliminando a causa raiz da duplicação visual de clientes: dois `renderClients()` concorrentes interleaving `tbody.appendChild()`. **Nunca introduzir `await` dentro do `forEach` de renderização de clientes.**
- **`const Toast` e `const spinnerHtml` em `app.js` são script-scoped** — não estão em `window`; inacessíveis de `page.evaluate()` no Playwright e de outros scripts. Não mover para `window` sem avaliar impacto
- **`lucide.createIcons({ nodes: [...] })` NÃO é suportado no Lucide 0.469.0 UMD** — usar sempre `lucide.createIcons()` sem opções para re-processar ícones no DOM
- **`store.userId` dentro de `page.evaluate()` async retorna `null`** — ao testar via Playwright, usar `window.supabaseClient` com `uid = Auth.getUserId()` capturado localmente em vez de chamar `store.addXxx()` ou `store.getXxx()` dentro de evaluate
- **`renderAll()` usa `getBatchStats()` como única fonte de dados para Dashboard e Clientes** — chama `store.getBatchStats()` (4 queries) antes do `Promise.all`, extrai `clients` do resultado e passa `(clients, batchStats)` para `renderDashboard`, `renderClients` e `(clients)` para `renderRecords`. Nunca chamar `store.getClientStats(id)` em loop dentro dessas funções — seria regressão de N×4 queries. `renderDashboard` e `renderClients` aceitam os parâmetros opcionalmente (fallback para busca individual quando chamados direto fora do `renderAll`).
- **Google Calendar API mantém conexões em background** — `page.waitForLoadState('networkidle')` nunca dispara; sempre adicionar `.catch(() => {})`
- **`syncEventsFromGoogle` retorna `[]` (não `null`) quando todos os calendários falham** — cada calendário tem seu próprio `try-catch` que silencia erros individuais; se todos falharem (token expirado, rede, etc.), a função retorna array vazio. O guard `if (!googleEvents) return` em `executeBiDirectionalSync` NÃO pega array vazio — `[]` é truthy. Sem a proteção de `fetchSuccessCount`, o passo 3 apagaria todos os eventos locais com `calendarEventId` dentro da janela ±30 dias. A proteção atual: se `fetchSuccessCount === 0` após o loop, retorna `null`. Nunca remover essa verificação.
- **Importação PDF: duplicatas detectadas por `client_id|date|start_time|end_time`** — `openPdfConfirmationModal()` chama `store.getRecordsByDateRange()` uma única vez (não N queries); registros com `matchedClientId === null` (auto-criação pendente) nunca são marcados como duplicata pois a chave seria `null|date|...`; `#pdf-dup-warnings` é criado dinamicamente no DOM se não existir (inserido após `#pdf-warnings`) — não está no HTML do `index.html`; `confirmPdfImport()` contabiliza os pulados em `skippedCount` separado de `importedCount` (um registro `_isDuplicate` não ocupa o loop de INSERT mesmo que o checkbox estivesse marcado, pois o guard de `_isDuplicate` vem antes do check do checkbox).
- **PDF.js só extrai texto de PDFs text-based** — PDFs baseados em imagem (sem operadores BT/ET nos streams de conteúdo) retornam 0 itens de texto; o parser retorna vazio sem erro. Para diagnosticar: verificar se o texto é selecionável no Chrome; inspecionar o binário com `grep 'BT '` após descompressão FlateDecode. PDFs de imagem precisam de OCR (não implementado) — a solução correta é gerar o PDF com texto real na fonte (ex.: configuração de exportação do SAP).
- **CSP nginx: `worker-src blob:` é obrigatório para PDF.js** — sem a diretiva `worker-src blob:`, o nginx bloqueia o Web Worker que PDF.js cria internamente como blob URL. O resultado é texto vazio em PDFs text-based. O `nginx.conf` já inclui `worker-src blob: https://cdnjs.cloudflare.com` desde o commit `6285b38`.
- **PDF.js achata colunas visuais em texto plano** — layout de colunas do SAP faz PDF.js extrair `"22851 Projeto.:"` (número antes do rótulo) em vez de `"Projeto.: 22851"`. O parser suporta ambos os formatos.
- **Horas na Ata SAP são centesimais, não sexagesimais** — `00:75` = 0,75 h = 45 min reais (não 1h15). A coluna "Horas Aplicadas" usa formato centesimal. **Hora Inicial e Hora Final também podem estar em centesimal** quando o SAP usa timestamps intermediários (ex: `16:75` = 16h45m). O parser detecta minutos > 59 e converte via `round(CC * 60 / 100)`. Para converter centesimal → minutos: `(HH * 100 + CC) / 100 * 60`.
- **Atas com descrição multi-página: `parsePdfPages` mescla páginas de continuação antes de parsear** — quando uma descrição de atendimento extrapola para a página seguinte (sem cabeçalho "Descrição do Atendimento"), `parsePdfPages` detecta a continuação via `/Descri..o\s+do\s+Atendimento/i` e mescla o texto da página de continuação (com o header TECINCO/Ref./Programa stripped) ao bloco anterior. Só depois chama `_parseSinglePage` em cada bloco mesclado. Para PDFs normais (uma página por atendimento), cada página tem "Descrição do Atendimento" → `isNewPage = true` → sem mescla → comportamento idêntico ao anterior. **Nunca usar o número do projeto (`Projeto.:`) como detector de nova página** — PDF.js pode extrair no formato invertido (`35091 Projeto.:`) que não bate com o padrão `Projeto\s*[.:]+\s*\d{4,6}`, causando falsos negativos.
- **Chamados: proxy Supabase Edge Function evita CORS** — todas as chamadas ao OTOBO passam por `supabase/functions/otobo-proxy/index.ts` (não direto do browser). O proxy autentica o usuário via JWT antes de repassar ao OTOBO. Deploy via `npx supabase@latest functions deploy otobo-proxy --project-ref klimkamnydfnzqetqlqm` com `SUPABASE_ACCESS_TOKEN` setado.
- **Chamados: nome do web service OTOBO é `ProgramaGestorTSP_jorge`** — o proxy usa este nome fixo na URL: `{url}/otobo/nph-genericinterface.pl/Webservice/ProgramaGestorTSP_jorge/Ticket`. Se o admin criar o web service com nome diferente, atualizar o proxy.
- **Chamados: rota de busca é POST `/Ticket`, não `/Ticket/Search`** — o OTOBO mapeia `/Ticket/:TicketID` para TicketGet; chamar `/Ticket/Search` resulta em TicketGet com `TicketID = "Search"` (erro `AccessDenied`). A busca correta é POST para `/Ticket` com os critérios no body. O proxy usa `SortBy: "Changed", OrderBy: "Down", Limit: 500` para trazer os 500 mais recentes.
- **Chamados: TicketGet individual por ticket tolera `AccessDenied`** — o proxy busca cada ticket separadamente em loop; tickets que retornam `{ Error: { ErrorCode: "TicketGet.AccessDenied" } }` são silenciosamente pulados (`denied++`). Isso evita que um ticket inacessível bloqueie toda a sync. A resposta final é `{ Ticket: [...], _denied: N }`.
- **Chamados: `deleteTicketsNotIn` NÃO deve usar aspas nos IDs** — o filtro PostgREST correto é `.not('ticket_id', 'in', '(10338,10401,...)')` sem aspas nos valores. Com aspas `('10338','10401',...)` o PostgREST interpreta os valores como strings literais com aspas, o NOT IN não bate com nenhum registro e **apaga todos os tickets**. Bug corrigido no commit `b3bdd65`.
- **Chamados: `_otoboConfig` é cache em memória** — carregado na primeira abertura da view e limpo no logout. Se o usuário salvar nova config no modal, `_otoboConfig` é atualizado imediatamente via `this._otoboConfig = { url, username, password, syncFilters }` sem precisar recarregar do Supabase.
- **Chamados: sync incremental usa `last_sync_at` da `otobo_config`** — `syncChamados(force)` lê `this._otoboConfig.lastSyncAt`; se existir e `force=false`, passa ao proxy como `lastSyncAt` que vira `TicketLastChangeTimeNewerDate` na busca OTOBO. Sync incremental nunca chama `deleteTicketsNotIn` — só foram buscados tickets alterados, não o conjunto completo. `saveOtoboLastSync()` faz UPDATE (não upsert) — só funciona se a linha de `otobo_config` já existe (usuário já configurou o OTOBO). `event.shiftKey` passado como `force=true` no onclick do botão para forçar sync completa quando necessário. migration obrigatória antes do deploy: `ALTER TABLE otobo_config ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;`
- **Chamados: `_cachedChamadosTickets` e `_cachedChamadosClients` evitam query a cada filtro local** — populados em `renderChamados()` após carregar do banco; `_rerenderChamadosWithFilters()` usa exclusivamente esses arrays. Invalidados em `syncChamados()` (`_cachedChamadosTickets = null`) para forçar reload após sync. Limpos no logout junto com `_chamadoFiltersAttached = false`.
- **Chamados: `_chamadoFiltersAttached` garante que os event listeners são adicionados uma única vez** — `_attachChamadoFilterListeners()` retorna imediatamente se `_chamadoFiltersAttached === true`. Resetado no logout. Se não for resetado, sair e entrar com outro usuário manteria listeners apontando para dados do usuário anterior.
- **Chamados: filtros de sync com array vazio NÃO devem ser enviados ao OTOBO** — o proxy verifica `Array.isArray(sf.queues) && sf.queues.length > 0` antes de incluir no body da busca. Array vazio (`[]`) enviado como `Queues: []` em alguns deployments OTOBO retorna 0 resultados em vez de ignorar o filtro. Campos em branco no textarea = array vazio no JS = filtro omitido no proxy.
- **Chamados: `local_filters` requer migration antes do deploy** — `ALTER TABLE otobo_config ADD COLUMN IF NOT EXISTS local_filters JSONB DEFAULT '{}';`. Sem a coluna, `saveOtoboLocalFilters` lança erro 400. Como usa UPDATE (não upsert), nenhuma linha é criada automaticamente — o save é silenciosamente ignorado se o usuário nunca configurou OTOBO.
- **Chamados: `ticket_type` requer migration antes do próximo deploy** — `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ticket_type TEXT DEFAULT '';`; sem a coluna, `upsertTickets` com `ticket_type` no objeto lança erro 400 do PostgREST. Da mesma forma: `ALTER TABLE otobo_config ADD COLUMN IF NOT EXISTS sync_filters JSONB DEFAULT '{}';`.
- **Chamados: match de cliente tem dois níveis** — `_mapTicketsToRows` tenta primeiro match exato por `clients.otobo_customer_id === t.CustomerID` (normalizado lowercase/trim); somente se não encontrar cai no fallback fuzzy `includes` bilateral por nome. Campo `otobo_customer_id TEXT` na tabela `clients`; migration: `ALTER TABLE clients ADD COLUMN IF NOT EXISTS otobo_customer_id TEXT;`. Campo "ID Cliente OTOBO" no modal de cliente (id: `client-otobo-id`). Tickets sem match vão para seção "Sem cliente vinculado".
- **Chamados: artigos carregados on-demand, não cacheados** — `openChamadoModal` faz fetch do `TicketGet?AllArticles=1` a cada abertura do modal. Dados do artigo não são salvos em `raw_data` do cache (apenas o snapshot do ticket). Se o OTOBO estiver inacessível no momento de abrir o modal, exibe mensagem de erro; os metadados do ticket (sidebar) ainda são exibidos do cache local.
- **Chamados: `store.upsertTickets` usa `onConflict: 'user_id,ticket_id'`** — o índice `idx_tickets_user_ticket` é UNIQUE em `(user_id, ticket_id)` e deve existir para o upsert funcionar. Se o índice estiver ausente, o upsert insere duplicatas. Verificar no Supabase se o índice foi criado pela migration.
- **Chamados: filtro de proprietário (`ownerLogin`) funciona localmente, não no OTOBO** — o webservice `ProgramaGestorTSP_jorge` ignora os parâmetros `OwnerLogin` e `Owners` no TicketSearch (retorna todos os tickets da instalação, ~10k). O proxy envia esses parâmetros assim mesmo para compatibilidade futura. A filtragem real ocorre em `_fetchTicketsFromOtobo()` após receber os resultados, comparando `t.Owner`/`t.Responsible` com `syncFilters.ownerLogin` (case-insensitive, normaliza pontos para espaços). Para corrigir na origem: o admin OTOBO precisa adicionar `OwnerLogin`/`Owners` ao mapeamento da operação TicketSearch no webservice.
- **Chamados: `deleteTicketsNotIn` é pulado quando `ownerLogin` está configurado** — o sync traz janela de 500 tickets mais recentes; tickets antigos do usuário que não caíram nessa janela não devem ser deletados do cache. Com ownerLogin ativo: só `upsertTickets` (cache acumula). Sem ownerLogin: comportamento normal de limpeza. Implementado em `syncChamados()` verificando `this._otoboConfig?.syncFilters?.ownerLogin`.
- **Chamados: OTOBO tem ~10k tickets — buscar tudo é inviável** — sem o filtro de owner funcionando no servidor, buscar todos os IDs e fazer TicketGet em lotes de 10 levaria 15+ minutos. A solução atual usa Limit=500 (sync rápido ~30s) com cache acumulativo: tickets antigos do usuário aparecem conforme recebem atividade e caem na janela de 500 mais modificados. Tickets "bloqueados" sem atividade por meses só aparecem quando houver resposta/mudança no OTOBO.
- **WhatsApp bot: Edge Function precisa de `SUPABASE_SERVICE_ROLE_KEY` como secret** — a Edge Function usa `getAdminClient()` com service role para contornar RLS ao buscar dados de qualquer usuário pelo número de telefone. Sem esse secret setado no Supabase Dashboard, todas as queries retornam 401. Configurar em: Supabase Dashboard → Edge Functions → whatsapp-bot → Secrets. Os secrets necessários são: `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`, `WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`. (`SUPABASE_URL` e `SUPABASE_ANON_KEY` são injetados automaticamente pelo runtime do Deno).
- **WhatsApp bot: instância `tsp` no Evolution API precisa de QR code** — após criar a instância, o número ainda não está conectado. Escanear QR em `https://jorge-evolution-api.27pl2o.easypanel.host` → instâncias → `tsp`. O status inicial é `connecting`; após scan vira `open`.
- **WhatsApp bot: usuário deve cadastrar seu número pessoal no app** — o bot identifica o usuário pelo número de quem enviou a mensagem, comparando com `user_profiles.whatsapp_number`. Sem cadastro, o bot responde com mensagem de "número não cadastrado". Cada usuário cadastra o próprio número em sidebar → WhatsApp.
- **WhatsApp bot: `action=welcome` usa JWT do usuário autenticado** — o endpoint interno (para teste) autentica via `Authorization: Bearer <jwt>`, não via `WEBHOOK_SECRET`. O frontend passa o token da sessão atual do Supabase. Se a sessão expirou, `sendTestWhatsapp()` exibe toast de erro "Sessão expirada".
- **WhatsApp bot: deploy da Edge Function requer `SUPABASE_ACCESS_TOKEN`** — rodar: `$env:SUPABASE_ACCESS_TOKEN = "seu-token"; npx supabase@latest functions deploy whatsapp-bot --project-ref klimkamnydfnzqetqlqm`. Token gerado em supabase.com/dashboard/account/tokens.
- **WhatsApp bot: Edge Function deve ser deployada com `--no-verify-jwt`** — o Evolution API não envia header `apikey` no webhook; sem `--no-verify-jwt`, o Supabase gateway bloqueia a requisição com `UNAUTHORIZED_NO_AUTH_HEADER` antes de chegar ao código da função. A função tem sua própria autenticação via `WEBHOOK_SECRET` na query string. Comando correto: `npx supabase@latest functions deploy whatsapp-bot --project-ref klimkamnydfnzqetqlqm --no-verify-jwt`
- **WhatsApp bot: Evolution API envia número sem o 9º dígito em contas antigas** — o número `5545999910111` (13 dígitos) chega como `554599910111` (12 dígitos) no webhook. `findUserByPhone` gera 4 variantes: original, sem `55`, sem `55` + 9º dígito, e com `55` + 9º dígito (`phoneAlt9With55`). Sem a 4ª variante, usuários que cadastram o número completo com 9 nunca são encontrados.
- **WhatsApp bot: `WEBHOOK_SECRET` com caracteres especiais deve ser URL-encoded na webhook URL** — o secret gerado em base64 contém `+`, `/` e `=`; ao configurar o webhook no Evolution API, usar `[uri]::EscapeDataString($secret)` para codificar. O Deno decodifica automaticamente via `searchParams.get("secret")`. Alternativa mais simples: gerar um secret alfanumérico sem caracteres especiais.
- **WhatsApp bot: webhook configurado na instância `tsp`** — URL: `https://klimkamnydfnzqetqlqm.supabase.co/functions/v1/whatsapp-bot?secret=<WEBHOOK_SECRET>`. Se o secret mudar, reconfigurar o webhook via: `curl -X POST https://jorge-evolution-api.27pl2o.easypanel.host/webhook/set/tsp -H "apikey: 429683C4C977415CAAFCCE10F7D57E11" -d '{"webhook":{"enabled":true,"url":"<URL>","webhook_by_events":false,"webhook_base64":false,"events":["MESSAGES_UPSERT"]}}'`
- **WhatsApp bot: `handleHelp()` deve ser atualizado a cada novo comando** — a função `handleHelp()` na Edge Function retorna a lista de comandos enviada ao usuário via `ajuda` e no boas-vindas. Todo novo intent adicionado ao bot DEVE ter sua entrada correspondente em `handleHelp()`. Comandos atuais: `horas`, `agenda`, `tarefas`, `ajuda`.
- **WhatsApp bot: `query_tasks` usa estado conversacional via `bot_state JSONB`** — quando enviado sem cliente (`"tarefas"` sozinho), o bot salva `{ pending: 'query_tasks', expires: <ISO+5min> }` em `user_profiles.bot_state` e aguarda a próxima mensagem como nome do cliente. Se o usuário enviar um comando conhecido (ajuda/horas/agenda/cancelar) enquanto o estado está pendente, o estado é limpo e o comando é tratado normalmente. Estado expira em 5 minutos. Migration: `ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS bot_state JSONB DEFAULT '{}';`
- **WhatsApp bot: `query_tasks` filtra colunas Kanban `is_done=true`** — tarefas cujo `status` (UUID) aponta para uma `kanban_columns` com `is_done=true` são excluídas do resultado, assim como tarefas com `completed=true`. Sem a tabela `kanban_columns` populada para o usuário, nenhuma tarefa é filtrada como "concluída" por coluna (todas as colunas sem `is_done` explícito são tratadas como abertas). A query busca tasks em lote (até 100) e filtra em memória pelo Set de IDs de colunas done.
- **Deploy automático (webhook Easypanel) está quebrado** — após cada `git push`, avisar o usuário para fazer deploy manual no Easypanel antes de testar em produção.
- **Sidebar: todo texto usa `<span class="nav-label">`** — nav-items, botões da `sidebar-bottom` e email do usuário têm o texto em `<span class="nav-label">`. Esse span é o que CSS esconde no estado `.sidebar.collapsed`. Novos itens de menu ou botões adicionados ao sidebar sem esse span não respondem ao colapso. Cada nav-item também precisa do atributo `title="Nome"` para exibir tooltip quando colapsado.
- **Sidebar: dois estados via `sessionStorage`** — `sidebarCollapsed` ('1' = colapsado) e `moneyHidden` ('1' = oculto). Ambos são aplicados em `initAfterAuth()`. O padrão é: se a chave não existir no sessionStorage, o default é expandido/visível. A sidebar vai de 260px (expandida) para 70px (colapsada) com `transition: width 0.25s ease` no CSS.
- **Tarefas: `attachments` é JSONB de objetos `{name, data}`** — `data` é uma data URL base64 JPEG comprimida via Canvas. `_task()` retorna `attachments: Array.isArray(r.attachments) ? r.attachments : []`. `this.taskAttachments` em AppController é o estado local do modal; sempre resetado em `closeModal('modal-task')` e pre-populado em `handleEditTask`. Paste de imagens escuta `document.addEventListener('paste')` — só age quando `#modal-task` tem classe `active`. Imagens grandes são comprimidas pela função global `compressImageFile()` (max 1400px, JPEG 75%).
- **Agenda: eventos multi-dia usam `date_end`** — `_event()` retorna `dateEnd: r.date_end || r.date`. Queries usam overlap detection via `.or('date_end.gte.X,and(date_end.is.null,...)')`. Nos renders mensal e semanal, filtrar com `e.date <= iso && (e.dateEnd || e.date) >= iso`; nunca filtrar só por `e.date === iso`.
- **Agenda: `openNewAgendaEvent(dateStr)` é o ponto de entrada para novo agendamento** — chama `closeModal` + `openModal` em sequência (síncrono), sobrescreve as datas e oculta o botão excluir. Cells/colunas do grid e o botão "+ Novo Agendamento" chamam este método. Eventos dentro do grid têm `event.stopPropagation()` para não acionar o click da célula pai.
- **Agenda: botão excluir no modal** — `#btn-delete-agenda-event` fica oculto (`display:none`) por padrão; `editAgendaEvent()` o exibe (`display:flex`); `openNewAgendaEvent()` o oculta novamente. `deleteAgendaEventFromModal()` lê o ID de `#agenda-id`, remove do Supabase (e do Google Calendar se `calendarEventId` existir), fecha o modal e re-renderiza a agenda.
- **Agenda: Google Meet — `conferenceDataVersion=1` é obrigatório** — sem esse parâmetro na chamada `gapi.client.calendar.events.insert/update`, o Google ignora o campo `conferenceData` e não gera a sala Meet. O parâmetro é passado junto com `resource`, não dentro dele.
- **Agenda: `createGoogleEvent()` retorna `{ id, meetLink }`** — retorno mudou da Fase 14 em diante (antes retornava só `id`). Todo código que consome o retorno deve desestruturar: `const result = await calendarAPI.createGoogleEvent(ev); if (result) { ev.calendarEventId = result.id; ev.meetLink = result.meetLink; }`. O mesmo vale para `updateGoogleEvent()` que retorna `{ ok, meetLink }`.
- **Agenda: `agenda-generate-meet-row` visível somente quando sync Google ativo** — a linha do checkbox "Gerar Meet" começa oculta; o listener em `agenda-sync-google` a exibe quando marcado. `editAgendaEvent()` a oculta se o evento já tem `meetLink` (evita gerar segundo link). `openNewAgendaEvent()` controla a visibilidade com base no estado atual do checkbox de sync.
- **Agenda: Meet não é regenerado no update** — `mapLocalToGoogleEvent()` só inclui `conferenceData` quando `generateMeet === true && !meetLink`. Se o evento já tem um Meet link, o update preserva o link original e não cria uma nova sala.
- **`calendarAPI.isSignedIn` não existe** — a propriedade correta é `calendarAPI.isAuthenticated` (boolean). Nunca usar `calendarAPI.isSignedIn()` — sempre retorna `undefined` (falsy) e silencia todo o push ao Google sem erro visível. Para verificar + autenticar: `if (!calendarAPI.isAuthenticated) { await calendarAPI.authenticateGoogle(); }`.
- **Agenda: sync bidirecional — dois guards contra perda de `clientId`** — `executeBiDirectionalSync` usa dois Sets para blindar o sync: (1) `processedLocalIds` — eventos locais resolvidos no Passo 1 (match exato ou fuzzy) são adicionados ao Set; o Passo 2 pula esses IDs antes de empurrar ao Google, impedindo criar duplicatas no Google de eventos já tratados; (2) `resolvedGoogleKeys` — chave `titulo|data|hora` de cada evento Google resolvido; eventos do Google com mesma chave (duplicatas históricas criadas pelo bug antigo) são descartados via `continue` antes do fuzzy match, impedindo que virem eventos locais órfãos sem `clientId`. Passo 1 tenta match por `calendarEventId`; fallback fuzzy por `title+date+startTime` em eventos locais sem `calendarEventId`. **Para recuperar eventos afetados**, rodar no Supabase SQL Editor: `UPDATE agenda_events ae SET client_id = sr.client_id FROM scheduling_rules sr JOIN auth.users u ON sr.user_id = u.id WHERE ae.user_id = sr.user_id AND u.email = 'EMAIL_USUARIO' AND ae.client_id IS NULL AND sr.title = ae.title AND sr.start_time = ae.start_time AND sr.end_time = ae.end_time;`
- **Agenda: sync forçado para eventos com `calendarEventId`** — `handleAgendaSubmit` usa `needsGoogleSync = (syncGoogle || !!existingCalId) && calendarAPI.isEnabled`. Se o evento já foi enviado ao Google (tem `calendarEventId`), o update é forçado mesmo que o checkbox "Sincronizar com Google Calendar" esteja desmarcado. Isso garante que editar um evento não deixe o Google Calendar com dados desatualizados.
- **Agenda: auto-sync bidirecional ao entrar na view** — `switchView('agenda')` dispara `_autoSyncGoogle()` em background quando `calendarAPI.isAuthenticated` e a view anterior não era 'agenda'. `_autoSyncGoogle()` tem cooldown de 2 minutos (`_lastGoogleSync`) para evitar chamadas excessivas durante navegações rápidas.
- **Agenda: sync periódico a cada 5 minutos** — `onCalendarAuthenticated()` inicia `_googleSyncInterval = setInterval(...)` de 5 minutos que chama `_autoSyncGoogle()` enquanto o usuário estiver na view agenda e autenticado. O intervalo é limpo no logout (handler `btn-logout`) e reiniciado a cada autenticação. Não usar `setInterval` adicional sem limpar o anterior.
- **Agenda: `_lastGoogleSync` e `_googleSyncInterval` são instâncias de AppController** — inicializados no constructor (`_lastGoogleSync = 0`, `_googleSyncInterval = null`). Ambos são limpos no handler de logout para evitar vazamento entre sessões.
- **Agenda: "Dia inteiro" — identificação e renderização** — eventos dia-inteiro são identificados por `startTime === ''` (string vazia no banco). `toggleAllDayAgenda(bool)` controla visibilidade de `#agenda-time-fields` e o atributo `required` dos inputs de hora. `editAgendaEvent()` detecta allDay e chama `toggleAllDayAgenda(true)`. Nas views diária/semanal, allDay events são filtrados ANTES de `createEventBlockHtml` (que crasharia com `startTime=''`) e renderizados em `createAllDayBannerHtml`. Google Calendar: `mapLocalToGoogleEvent` envia `{ date }` (sem hora) para allDay; na sync reversa, `gEv.end.date` é exclusivo — subtrai 1 dia para `dateEnd`.
- **Agenda: `related_task_ids` é JSONB com fallback para `related_task_id` legado** — `_event()` lê `related_task_ids` (array); se vazio, faz fallback para `[related_task_id]` (UUID único legado). `addAgendaEvent`/`updateAgendaEvent` salvam ambos: `related_task_ids` (array) e `related_task_id` (primeiro elemento ou null). Nunca remover o campo legado sem migration de dados.
- **Agenda: `_updateDescriptionWithTasks()` usa marcador sentinela fixo** — o marcador é `'\n\nTarefas executadas:\n'`; tudo antes = conteúdo do usuário, tudo a partir = zona gerenciada. Se o usuário digitar exatamente esse texto manualmente, será tratado como sentinela. Chamado apenas em `confirmAgendaTaskPanel()` e `removeAgendaTask()` — não chamar em `openNewAgendaEvent()` (descrição vazia) nem em `editAgendaEvent()` (bloco já persiste do banco e só é recalculado se o usuário mudar as tarefas).
- **Agenda: painel de tarefas filtra pelo cliente selecionado no modal** — `_renderAgendaTaskPanel()` lê `document.getElementById('agenda-client').value` no momento da abertura; se o cliente mudar depois do painel aberto, o painel não re-renderiza automaticamente. Fechar e reabrir o painel exibe as tarefas do novo cliente.

- **Implementações: `renderImplementations()` tem guard `currentView`** — igual a `renderApontamentos()`, só executa se `this.currentView === 'implementations'`. Chamado no `renderAll()` dentro do `Promise.all`; quando a view não está ativa retorna imediatamente sem consultar o banco.
- **Implementações: `setImplementationClients()` faz DELETE + INSERT** — substituição completa dos vínculos a cada save; não há update parcial. Seguro porque `implementation_clients` não tem dados editáveis além do vínculo.
- **Implementações: select de clientes no filtro é populado na primeira renderização** — o código verifica `clientSelect.options.length <= 1` antes de adicionar; se navegar para a view sem clientes cadastrados, ao cadastrar um cliente e voltar a view, o select não recarrega automaticamente (workaround: limpar filtros dispara re-render).
- **Implementações: `btn-delete-implementation` começa com `display:none`** — exibido via `display:flex` apenas em `openEditImplementation()`; `openNewImplementation()` o força de volta a `none`.
- **Implementações: `attachments` é JSONB de objetos `{name, data}`** — mesmo padrão das tarefas; `data` é data URL base64 JPEG comprimida via Canvas. `_implementation()` retorna `attachments: Array.isArray(r.attachments) ? r.attachments : []`. `this.implAttachments` em AppController é o estado local do modal; sempre resetado em `closeModal('modal-implementation')` e pre-populado em `openEditImplementation()`. Migration necessária no Supabase: `ALTER TABLE implementations ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'`. Paste escuta `document.addEventListener('paste')` — detecta qual modal está ativo (`modal-task` ou `modal-implementation`) para direcionar o anexo ao array correto.
- **Implementações: tipo `report` (Relatório Customizado)** — ícone `file-bar-chart-2`; adicionado em `typeLabels` e `typeIcons` no `renderImplementations()`, nos dois selects HTML (`impl-filter-type` e `impl-type`) e no select do modal.

- **Treinamentos: migration SQL obrigatória antes do deploy** — sem as tabelas `trainings` e `training_clients` no Supabase, a view retorna erro. Rodar no SQL Editor: `CREATE TABLE trainings (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL, title TEXT NOT NULL, description TEXT DEFAULT '', category TEXT DEFAULT 'geral', status TEXT DEFAULT 'active', attachments JSONB DEFAULT '[]', created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()); ALTER TABLE trainings ENABLE ROW LEVEL SECURITY; CREATE POLICY "users_own_trainings" ON trainings FOR ALL USING (auth.uid() = user_id); CREATE TABLE training_clients (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL, training_id UUID REFERENCES trainings ON DELETE CASCADE NOT NULL, client_id UUID REFERENCES clients ON DELETE CASCADE NOT NULL); ALTER TABLE training_clients ENABLE ROW LEVEL SECURITY; CREATE POLICY "users_own_training_clients" ON training_clients FOR ALL USING (auth.uid() = user_id);`
- **Treinamentos: `attachments` mistura dois tipos em um único JSONB** — `{ type: 'link', label, url, urlType }` para links externos e `{ type: 'image', name, data }` para imagens base64. Em `openEditTraining()`, o array é separado por tipo: `trainingLinks = allAttachments.filter(a => a.type === 'link')` e `trainingAttachments = allAttachments.filter(a => a.type === 'image')`. Em `handleTrainingSubmit()`, são recombinados antes de salvar.
- **Treinamentos: cliente obrigatório — validação no JS, não no banco** — `handleTrainingSubmit()` verifica `selectedClientIds.length === 0` antes de chamar o store e exibe Toast de erro. Não há constraint no banco para isso.
- **Treinamentos: `renderTrainings()` tem guard `currentView`** — retorna imediatamente se `this.currentView !== 'trainings'`; chamado no `renderAll()`.
- **Treinamentos: `btn-delete-training` começa com `display:none`** — exibido via `display:flex` apenas em `openEditTraining()`; `openNewTraining()` o força de volta a `none`.
- **Treinamentos: IDs dos elementos interativos** — `btn-new-training` (botão no header da view), `btn-save-training` (submit do form), `btn-clear-training-filters` (limpar filtros), `btn-add-training-link` (adicionar link externo). Cards renderizados dinamicamente têm `class="training-card"` e `data-id="{id}"` para seleção precisa via JS/testes.

- **Agendamento automático: `description` requer migration** — a coluna `description TEXT DEFAULT ''` deve existir em `scheduling_rules` antes de salvar regras com descrição. Migration: `ALTER TABLE scheduling_rules ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';`. Sem a migration, o insert/update lança erro 400 do PostgREST.
- **Agendamento automático: "Dia inteiro" usa `startTime === ''`** — mesma convenção de `agenda_events`; `toggleAllDayRule(bool)` oculta `#rule-time-fields` e remove `required` dos inputs de hora. `handleSchedulingRuleSubmit` salva `startTime: ''` e `endTime: ''` quando all-day. `confirmScheduleGeneration` repassa `startTime: ev.startTime` que será `''`, fazendo o evento ser criado como dia inteiro. Conflict check `ev.startTime === rule.startTime` funciona corretamente pois `'' === ''`.
- **Agendamento automático: Meet row sempre visível** — `rule-generate-meet` checkbox não depende mais de `agenda-sync-google`; é sempre exibido. Se Google não está autenticado no momento da geração, `confirmScheduleGeneration` tenta autenticar; se falhar, eventos são criados sem Meet (silenciosamente).
- **Agendamento automático: tipos de evento alinhados com manual** — `rule-event-type` aceita meeting/consulting/task/reminder (mesmo que o manual); valores antigos `followup`/`other` não são mais opções no HTML mas podem existir em dados legados — `_rule()` os repassa sem conversão.
- **Preview de geração: `_renderPreviewContent()` reconstrói o DOM a cada mudança** — chamado por `_previewRemoveEvent`, `_previewSuggestExtras` e `_previewAddManual`; não manter referências a elementos do `preview-content` entre chamadas pois são descartados. `lucide.createIcons()` é chamado ao final de cada render.
- **Preview de geração: `isExtra` existe só em memória** — flag usada para estilo visual (classe `preview-event-extra`) e ícone `plus-circle`; não persiste no banco. `confirmScheduleGeneration` trata todos os eventos de `_pendingPreviewEvents` igualmente, independente de `isExtra`.
- **Preview de geração: sugestão de extras começa após o último evento da lista** — `_previewSuggestExtras` percorre datas a partir do dia seguinte ao último evento em `_pendingPreviewEvents` (ordenado), seguindo `daysOfWeek` da regra. Se `_pendingPreviewEvents` estiver vazio, começa em `periodStart`. Limite de 400 iterações de segurança.
- **Preview de geração: `_pendingPreviewConflictSet` não é reatualizado ao adicionar extras**
- **Preview de geração: edição inline de data usa swap DOM direto, não re-render** — `_previewStartEditDate(idx)` localiza a row via `[data-preview-idx]`, substitui o `.preview-date-text` span por um `<input type="date">` e remove o botão lápis da própria row; só chama `_renderPreviewContent()` após `change` (confirmação) ou `blur` sem mudança (cancelamento). Não guardar referências a elementos de rows entre chamadas — `_renderPreviewContent()` destrói e recria todo o `preview-content`. — o conjunto de conflitos é calculado uma vez em `generateSchedulingRule` e reutilizado. Datas extras fora do período original podem ter conflitos não detectados; o sistema sinaliza apenas conflitos dentro do período original da regra.
- **Mini-calendário do preview: `_renderMiniCal()` é chamado após `lucide.createIcons()` em `_renderPreviewContent()`** — renderiza dentro de `#preview-mini-cal-container` e chama `lucide.createIcons()` novamente para processar os ícones do header. Estado em `_miniCalYear`/`_miniCalMonth`/`_miniCalSelected`; inicializado ao 1º mês do `rule.periodStart` em `generateSchedulingRule()`. Clicar numa data já selecionada a deseleciona (toggle). Após `_previewAddManual()` bem-sucedido, `_miniCalSelected` é resetado para `null` antes de chamar `_renderPreviewContent()`.
- **Mini-calendário: `--warning-color` movido para `:root`** — a variável estava declarada fora de qualquer seletor (CSS inválido) e foi corrigida para dentro do bloco `:root` em `styles/main.css`.
- **Mini-calendário: três tipos de ponto — cinza (compromisso), azul (novo), laranja (conflito)** — `existingByDate` é populado com **todos** os eventos do usuário (sem filtro de período) para que ao navegar entre meses qualquer compromisso existente apareça. `.pmc-dot-existing` (cinza) é renderizado sempre que `existingByDate.has(iso)`; ponto azul/laranja só aparece em datas com novo agendamento. Quando há dois pontos (ex.: compromisso + novo), CSS posiciona o primeiro em `50% - 4px` e o segundo em `50% + 4px`. Conflito (laranja) só é exibido quando `isPending && isConflict` — nunca em datas sem novo agendamento.

- **Saldo de horas: migration obrigatória antes do deploy** — sem `initial_balance_minutes` e `balance_start_date` na tabela `clients`, o `addClient`/`updateClient` lançará erro 400. Rodar: `ALTER TABLE clients ADD COLUMN IF NOT EXISTS initial_balance_minutes INTEGER DEFAULT 0, ADD COLUMN IF NOT EXISTS balance_start_date DATE;`
- **Saldo de horas: saldo inicial obriga data de início** — `handleClientSubmit()` bloqueia o save se `client-initial-balance` estiver preenchido mas `client-balance-start` estiver vazio. Validação no JS, não no banco.
- **Saldo de horas: `_calcClientBalance` retorna `hasTracking: false` sem `balanceStartDate`** — clientes sem data de início mostram apenas o delta do mês atual; coluna "Saldo acumulado" exibe "sem controle". O cálculo de meses usa `Math.max(1, ...)` para garantir pelo menos 1 mês contratado.
- **Saldo de horas: `openSaldoPanel()` carrega `store.getRecords()` inteiro** — busca todos os registros do usuário de uma vez para evitar N queries. Com muitos registros isso pode ser lento; filtragem por `clientId` é feita em memória via `Array.filter`. Botão `#btn-open-saldo` está no header da view Clientes.
- **`_computeClientStats` retorna `hoursUsed` em HORAS, não minutos** — `hoursUsed = totalMinutesUsed / 60`. Qualquer código que consome `batchStats` e exibe tempo deve usar uma função `fmtHours(hours)` que converte internamente via `Math.round(hours * 60)` → h + min. `client.hoursTotal` também está em horas. Nunca fazer `hoursUsed / (hoursTotal * 60)` para percentual — o correto é `hoursUsed / hoursTotal`.

- **Kanban: `position` deve ser migrado antes do deploy** — sem a migration SQL (`ADD COLUMN position INTEGER DEFAULT 0` + `ADD COLUMN labels JSONB DEFAULT '[]'` + `ADD COLUMN checklist JSONB DEFAULT '[]'` + `ADD COLUMN cover_color TEXT`), o `getTasks()` retorna erro 400 e a view Tarefas fica em branco. Rodar no Supabase SQL Editor antes de qualquer deploy da Fase 17.
- **Kanban: `reorderTasks()` usa `Promise.all` de `UPDATE` individuais** — não usar `upsert`: o `upsert` com RLS no Supabase verifica política de INSERT mesmo para linhas existentes, causando erro silencioso. Cada task recebe seu próprio `.update({ status, position }).eq('id', ...).eq('user_id', ...)`.
- **Kanban DnD: placeholder intercepta seus próprios eventos** — `kb-drag-placeholder` precisa de `dragover` com `stopPropagation` para evitar que o evento borbulhe até a dropzone. Sem isso, `allowDrop` (dropzone) move o placeholder para o final da coluna toda vez que o mouse passa sobre ele, causando flickering em loop.
- **Kanban DnD: `_draggedCard`, `_dragPlaceholder`, `_draggingFromStatus`** — instâncias de `AppController`, inicializadas no constructor. `dragStart` cria e insere o placeholder via `setTimeout(..., 0)` (para o browser renderizar o estado de drag antes). `dragEnd` limpa tudo. `_handleDrop` lê o DOM no momento do drop para determinar a ordem final.
- **Kanban: `#form-task` deve ser flex column** — o `form#form-task` é filho direto de `.modal-task-two-panel` (flex column). Se não tiver `display:flex; flex-direction:column; flex:1; min-height:0; overflow:hidden`, ele fica `display:block` e cresce além da altura do modal, cortando os botões da sidebar. Todo `flex:1` e `min-height:0` aplicado nos descendentes (`.modal-task-body`, `.modal-task-sidebar`, etc.) é ineficaz sem esse CSS no form.
- **Kanban: estado do modal em `this._modal*`** — `_modalStatus`, `_modalLabels`, `_modalChecklist`, `_modalCoverColor` são instância de `AppController`. Resetados em `closeModal('modal-task')` e populados em `handleEditTask()`. Nunca ler esses valores do DOM diretamente.
- **Kanban: quick-add usa `kb-quick-add-{status}` e `kb-add-btn-{status}`** — IDs dependentes do valor de `data-status` da coluna. Não alterar os IDs no HTML sem atualizar `openQuickAdd/closeQuickAdd/submitQuickAdd`.
- **Kanban: filtro por label usa `l.color` como chave** — labels são objetos `{color, name}`; o select `#filter-task-label` é populado com `value=color`. Filtro em `renderTasks()` compara `t.labels.some(l => l.color === filterLabel)`.

- **Comentários de tarefa: `_modalComments` inclui `[]` no constructor** — também resetado em `closeModal('modal-task')` e populado em `handleEditTask()`. A seção `#modal-task-comments-section` fica `display:none` por padrão; apenas `handleEditTask()` a exibe. Novas tarefas não mostram a seção de comentários.
- **Comentários de tarefa: `addTaskComment` e `logTaskActivity` fazem fetch + update** — cada chamada lê o array atual de `comments` do banco antes de appendar. Seguro para single-user; não há risco de race condition.
- **Comentários de tarefa: `_deleteTaskComment` salva via `store.updateTask`** — passa o `taskData` completo (título, status, labels, etc.) lido do DOM no momento da exclusão, mais o array `comments` filtrado. Nunca chamar apenas um update parcial de `comments` sem o spread restante dos campos, pois `updateTask` substitui todos os campos mapeados.
- **Auto-log via DnD: `oldStatus` lido de `this._draggingFromStatus`** — disponível no momento do drop. O log de atividade é fire-and-forget (`.catch(() => {})`) para não bloquear o re-render.
- **Auto-log via `moveTaskToColumn`: só loga se `this._modalTaskId` existe** — cliques no modal de nova tarefa (sem ID ainda salvo) não disparam log.

- **Kanban Fase 22: `kanban_columns` deve ser criada antes do primeiro uso** — sem a tabela, `ensureDefaultColumns()` lança erro; `renderTasks()` captura o erro, exibe toast e mostra board vazio. Migration SQL: vide seção abaixo. A migration de dados existentes ('new'/'doing'/'done' → UUIDs) é automática via `_migrateOldStatuses()` a cada abertura da view Tarefas (sai cedo se não houver tasks com status legado — custo zero no caso normal); o guard `sessionStorage.kbMigrated` foi removido porque criava um bug: tasks salvas com status legado após a primeira migração da sessão ficavam invisíveis no board.
- **Kanban: trocar cliente no modal recarrega colunas** — o listener `change` em `#task-client` chama `store.ensureDefaultColumns(clientId)`, atualiza `_currentColumns`, reseta `_modalStatus` para a primeira coluna e chama `_syncModalColumnButtons()`. Sem esse listener, ao criar uma tarefa sem filtro de cliente ativo e selecionar o cliente no modal, os botões "Mover Para" mostrariam as colunas legadas (new/doing/done) e a tarefa seria salva com status legado, ficando invisível no board do cliente escolhido.
- **Kanban Fase 22: coluna `is_done` pode estar ausente em tabelas criadas antes do commit final** — o erro `PGRST204: Could not find the 'is_done' column` ocorre quando a tabela `kanban_columns` foi criada sem esse campo (ex.: via migration parcial anterior). Corrigir com: `ALTER TABLE kanban_columns ADD COLUMN IF NOT EXISTS is_done BOOLEAN DEFAULT FALSE;`
- **Kanban Fase 22: `task.status` agora é UUID de `kanban_columns.id`** — todo código que compara `t.status === 'done'` está quebrado pós-migração. Usar `isDone` via `_currentColumns` ou `store.getAllColumns()`. O fingerprint do backup/migração localStorage (`['new','doing','done'].includes(first.status)`) ainda funciona para backups antigos mas não detectará backups gerados pós-fase-22.
- **Kanban Fase 22: board requer cliente selecionado** — sem filtro de cliente, `renderTasks()` exibe placeholder e retorna. Cards e quick-add só aparecem com cliente filtrado. Botão "Gerenciar Colunas" também fica oculto sem filtro.
- **Kanban Fase 22: `_currentColumns` é instância de AppController** — populado por `renderTasks()` e, se necessário, por `handleEditTask()`. `_syncModalColumnButtons()` usa `_currentColumns` para gerar os botões "Mover para" dinamicamente. Se `_currentColumns` estiver vazio, usa fallback legado (3 botões hardcoded).
- **Kanban Fase 22: `reorderColumns` usa mesmo padrão de `reorderTasks`** — `Promise.all` de `UPDATE` individuais, nunca `upsert` (conflita com RLS).
- **Kanban Fase 22: `mc-color-palette` fecha via re-render** — `_mcPickColor(idx, color)` chama `_renderManageColumnsList()` que recria o DOM; todas as palettes ficam `display:none` novamente. `_mcToggleColorPicker` fecha todos antes de abrir o selecionado.

### Integração de IA — armadilhas conhecidas

- **`aiClient.isConfigured` é `false` até `loadConfig()` resolver** — `loadConfig()` é chamado com `.then()` (não `await`) em `initAfterAuth()` para não bloquear o render. Em testes ou código que checa `aiClient.isConfigured` logo após o login, a config pode ainda não ter sido carregada. Sempre checar `isConfigured` no momento do clique, não no render inicial.
- **Botões de IA nunca aparecem sem IA configurada** — `onRecordDescInput()`, `onAptDescInput()`, `onImplDescInput()` retornam `display:none` se `!aiClient.isConfigured`; `handleEditTask()` checa `aiClient.isConfigured` antes de exibir `btn-ai-suggest-steps`; `fetchAgendaReportEvents` checa antes de exibir `ctx.aiBtn`; `toggleAgendaAssistant()` exibe Toast de erro se não configurado. Não exibir botões de IA via CSS — sempre via JS condicional.
- **`ai-proxy` Edge Function usa `SUPABASE_ANON_KEY` do cliente + JWT do usuário** — a autenticação é dupla: o header `apikey` autentica a chamada à Edge Function (anon key); o header `Authorization: Bearer <jwt>` é repassado ao Supabase client interno que lê `user_ai_config` com RLS. Sem o JWT, a query retorna vazio e a função responde "IA não configurada".
- **API key nunca trafega do servidor para o browser** — `store.getAIConfig()` lê `api_key` do banco, mas este método é chamado apenas para checar se a chave existe (e para preencher o modal de edição — onde é truncada). A Edge Function é a única que usa a chave real para chamadas externas. Nunca retornar `api_key` completa para o browser via query direta sem necessidade.
- **`parseAgendaNaturalLanguage` pode retornar JSON com markdown fencing** — alguns modelos retornam `` ```json {...} ``` `` mesmo com instrução de não fazê-lo. O método em `ai.js` tem limpeza: `.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '')` antes do `JSON.parse`. Se adicionar novos métodos que parseiam JSON de IA, sempre incluir essa limpeza.
- **`suggestTaskNextSteps` tem fallback para split por linha** — se o JSON.parse falhar (modelo retornou lista em vez de array), o método divide por `\n` e remove prefixos de lista. Nunca depender de JSON puro de modelos menos capazes sem fallback.
- **`generateDashboardInsights` re-busca `getBatchStats`** — não reutiliza dados já renderizados para garantir análise fresca. São sempre 4 queries paralelas (~200ms). Não chamar em loop ou automaticamente — apenas sob demanda do usuário.
- **Painel `#agenda-ai-assistant` é HTML estático** — diferente das views dinâmicas, o painel do assistente existe em `index.html` e é mostrado/ocultado via `toggleAgendaAssistant()`. `switchView('agenda')` não reseta o painel; se o usuário navegar para outra view e voltar, o painel continua no estado anterior.
- **Deploy da Edge Function `ai-proxy` requer `SUPABASE_ACCESS_TOKEN` válido** — o token expira. Se o deploy retornar 401, gerar novo token em app.supabase.com → Account → Access Tokens. Comando: `$env:SUPABASE_ACCESS_TOKEN='sbp_xxx'; npx supabase@latest functions deploy ai-proxy --project-ref klimkamnydfnzqetqlqm`

### Cálculos automáticos
- Comissão do consultor = 43% do valor pago pelo cliente (`clientPays * 0.43`)
- Duração do atendimento calculada a partir de `startTime` e `endTime`
- Barras de progresso baseadas em `minutes / (hoursTotal * 60)`
- **Todos os stats do dashboard/clientes usam apenas o mês atual** — `getBatchStats()` passa `recordsByClientMonth` (filtrado por `YYYY-MM`) ao `_computeClientStats()`; `getClientStats()` filtra `allRecords` pelo mês relevante antes de computar. `hoursUsed`, `percentage`, `hoursRemaining` e `isOverLimit` reiniciam todo mês. Nunca passar `recordsByClient` (acumulado) para `_computeClientStats` no contexto do dashboard.

---

## Funcionalidades por view

| View | Descrição |
|------|-----------|
| **Login** | Tela de autenticação (email/senha) via Supabase Auth |
| **Dashboard** | Visão geral dos clientes com barras de consumo de horas; hover no card exibe tooltip com número do projeto (`title` nativo) |
| **Clientes** | CRUD de clientes; campos: nome, horas, CS, nº projeto, valor, notas, status |
| **Atendimentos** | Log de horas por cliente; filtros por cliente e período; exportação PDF |
| **Tarefas** | Kanban (Novas / Em Execução / Finalizadas) com drag-and-drop e métricas |
| **Agenda** | Calendário diário/semanal/mensal; 4 tipos de evento; eventos multi-dia (Data Inicial + Data Final); clicar no dia abre novo agendamento; excluir pelo modal de edição; sincronização Google Calendar |
| **Apontamentos** | Log diário: horário início/fim, nº projeto (texto livre + autocomplete de clientes), descrição; navegação por dia; total do dia calculado |
| **Implementações** | Biblioteca de recursos técnicos vinculados a clientes (M:N); tipos: trigger, procedure, feature, customization, integration; filtros por tipo/status/cliente; cards agrupados por tipo; modal com código monospace |
| **Chamados** | Tickets OTOBO em aberto, cacheados no Supabase; sync manual via botão; agrupados por cliente TSP; modal de detalhe com artigos carregados on-demand; configuração via modal (URL + usuário + senha) |

### Sidebar
- **Recolhível**: botão chevron no cabeçalho (`#btn-sidebar-toggle`) alterna entre expandido (260px) e colapsado (70px)
- **Estado colapsado**: apenas ícones centralizados; texto oculto via `.sidebar.collapsed .nav-label { display: none }`
- **Persistência**: `sessionStorage.sidebarCollapsed`; default = expandido; aplicado em `applySidebarState()` dentro de `initAfterAuth()`
- **Ícone do toggle**: `chevron-left` quando expandido, `chevron-right` quando colapsado (atualizado via `lucide.createIcons()`)

---

## Apontamentos

View de log diário para registrar atividades antes de lançar no ERP. **Independente de clientes** — o número de projeto é texto livre (sem FK para `clients`), mas o campo exibe sugestões autocomplete a partir de `clients.project_num`.

### Fluxo
1. Usuário navega ao dia desejado com os botões `<` / `>` ou clica "Hoje"
2. Clica "Novo Apontamento" → modal abre com data do dia atual
3. Preenche Hora Início + Hora Fim (duração calculada em tempo real) + Nº Projeto + Descrição
4. Salva → registro aparece na tabela; rodapé mostra total de horas do dia

### Tabela `apontamentos` (Supabase)
```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL
date DATE NOT NULL
start_time TEXT NOT NULL
end_time TEXT NOT NULL DEFAULT ''
project_num TEXT NOT NULL DEFAULT ''
description TEXT NOT NULL DEFAULT ''
created_at TIMESTAMPTZ DEFAULT now()
```
RLS policy: `auth.uid() = user_id` (SELECT/INSERT/UPDATE/DELETE).

### Métodos relevantes

| Método | Arquivo | Descrição |
|--------|---------|-----------|
| `renderApontamentos()` | `js/app.js` | Render da view; guarda-se em `if (this.currentView !== 'apontamentos') return` |
| `openNewApontamento()` | `js/app.js` | Abre modal zerado com data = `this.aptCurrentDate` |
| `openEditApontamento(id)` | `js/app.js` | Busca item do dia atual e pré-preenche modal |
| `handleApontamentoSubmit(e)` | `js/app.js` | Salva via `store.addApontamento` ou `store.updateApontamento` |
| `deleteApontamento(id)` | `js/app.js` | Exclui com confirmação |
| `aptNavigateDay(delta)` | `js/app.js` | Avança/retrocede `this.aptCurrentDate` em `delta` dias |
| `calcDuration(start, end)` | `js/app.js` | Retorna `{ minutes, label }` — helper reutilizável |
| `populateAptProjectList()` | `js/app.js` | Preenche `<datalist id="apt-project-list">` com `clients.projectNum` |
| `getApontamentos(date)` | `js/store.js` | Busca apontamentos de uma data (YYYY-MM-DD) do usuário |
| `addApontamento(...)` | `js/store.js` | INSERT em `apontamentos` |
| `updateApontamento(...)` | `js/store.js` | UPDATE por id + user_id |
| `deleteApontamento(id)` | `js/store.js` | DELETE por id + user_id |

### Estado
- `this.aptCurrentDate` — string `'YYYY-MM-DD'`, inicializada no constructor com a data de hoje
- Chamada em `renderAll()` dentro do `Promise.all` junto com as demais views

---

## Importação de Ata PDF (SAP)

Funcionalidade na view **Atendimentos**: botão "Importar Ata (PDF)" lê um PDF gerado pelo SAP e cria registros de atendimento automaticamente.

### Fluxo
1. Usuário seleciona o PDF → `setupPdfImport()` lê página por página com PDF.js
2. `parsePdfPages(pageTexts[])` detecta páginas de continuação (sem "Descrição do Atendimento") e mescla ao bloco anterior; depois chama `_parseSinglePage()` em cada bloco mesclado
3. Modal de confirmação (`openPdfConfirmationModal()`) mostra registros identificados; clientes sem cadastro são criados automaticamente com nota "Cadastro incompleto"
4. Usuário confirma → `confirmPdfImport()` salva via `store.addRecord()`

### Estrutura da Ata SAP (por página) — dois formatos suportados

**Formato A (antigo):** colunas incluem "Horas Aplicadas no Dia" como nome de coluna
```
Projeto.: 22851   17 - CASCAVEL MAQUINAS AGRICOLAS LTDA 001 CVEL
Data......: 09/04/2026
Horas contratadas.: 1000:00   Horas executadas.: 500:00
Descrição do Atendimento
[texto da descrição global]
Horas Aplicadas no Dia 09/04/2026
Hora Inicial  Hora Final  Horas Aplicadas no Dia  Analista
08:00         09:00       01:00                   JORGE HENRIQUE
09:30         10:15       00:75                   JORGE HENRIQUE
Total Horas Dia.: 01:75
```

**Formato B (novo):** 5 colunas, "Horas Aplicadas no Dia" é cabeçalho de seção
```
Projeto.: 22851   17 - CASCAVEL MAQUINAS AGRICOLAS LTDA 001 CVEL
Data......: 22/05/2026
Horas contratadas.: 20:00   Horas executadas: 340:70
Descrição do Atendimento
[texto da descrição global]
Tarefa Executada  Analista  Hora Inicial  Hora Final  Total Horas
Horas Aplicadas no Dia 22/05/2026
Analise/estudo...  JORGE HENRIQUE CORREIA  09:00  12:00  03:00
Total Horas Dia.: 03:00
```

- **Código do projeto**: `22851` (4–6 dígitos após `"Projeto.:"`)
- **ID secundário**: `17` — ignorado pelo parser
- **Nome do cliente**: tudo após `" - "` até `"Horas contratadas"`, `"Descrição"` ou `"Tarefa Executada"`
- **PDF.js** pode inverter a ordem: `"22851 Projeto.: 17 - NOME"` — ambos os formatos são suportados
- **Horas Aplicadas / Total Horas**: formato centesimal (`01:75` = 1,75 h = 105 min). Hora Inicial/Final são HH:MM normais.
- **Âncora da tabela**: parser usa `"Horas Aplicadas no Dia DD/MM/YYYY"` (seção) como âncora primária para delimitar as linhas de dados; fallback para `"Hora Inicial Hora Final"`. Isso suporta ambos os formatos e é robusto a extração coluna-a-coluna pelo PDF.js.
- **Validação**: `_parseSinglePage` compara soma das linhas com `Total Horas Dia` (divergências → `console.warn`)

### Métodos relevantes em `js/app.js`
| Método | Descrição |
|--------|-----------|
| `setupPdfImport()` | Configura listener do input de arquivo; coleta `pageTexts[]` |
| `parsePdfPages(pageTexts)` | Mescla páginas de continuação; itera blocos mesclados; agrega records e warnings |
| `_parseSinglePage(text, pageNum)` | Extrai projeto, data, descrição, linhas da tabela e valida total |
| `openPdfConfirmationModal()` | Mapeia projetos → clientes; cria cliente auto se não encontrado |
| `confirmPdfImport()` | Salva records confirmados pelo usuário com progress feedback |

---

## Testes automatizados (Playwright)

Suite de testes end-to-end em `C:\Users\jorge\AppData\Local\Temp\playwright-test-tsp-v2.js`.

**Rodar:**
```powershell
cd "d:\GerenciadorTSP\skills\playwright-skill"
node run.js "C:\Users\jorge\AppData\Local\Temp\playwright-test-tsp-v2.js"
```

**Resultado esperado:** 48/48 ✅ — dividido em 7 blocos:

| Bloco | Cobertura | Testes |
|-------|-----------|--------|
| 1 — Autenticação | Login correto/errado, logout, troca de usuário | 4 |
| 2 — RLS Isolamento | user_a e user_b não veem dados um do outro (clients, records, events, tasks) | 10 |
| 3 — CRUD | Criar/editar clientes, atendimentos, tarefas, Kanban, agenda | 20 |
| 4 — Dashboard | Cards, filtros, drilldown mensal | 4 |
| 5 — Backup | Exportar JSON, botão migração oculto | 2 |
| 6 — Segurança | Headers HTTP, config.js, skills/ e nginx.conf bloqueados | 6 |
| 7 — UX/Loading | Toast, spinner, validação de campos | 4 |

**Usuários de teste:**
- user_a: `jorjaocorreia@gmail.com` / `Jhc1881//`
- user_b: `testes@teste.com` / `123testes`

---

## Animações de UI

Animações CSS/JS implementadas em `styles/main.css` e `js/app.js` para dar vida à plataforma. Todas respeitam `animation-play-state: paused` no hover para não interferir com cliques.

### Sidebar — botões permanentes
- **Botão IA (`#btn-ai-config`)**: `@keyframes sparkle-burst` faz o SVG escalar até 1.35× com rotação de 18° a cada 3.5s; `@keyframes ai-glow-pulse` pulsa o box-shadow roxo a cada 2.5s.
- **Botão WhatsApp (`#btn-whatsapp-config`)**: `@keyframes whatsapp-shake` simula vibração lateral a cada 4.5s (delay 1.2s); `::after` pseudo-element verde com `@keyframes ping-dot` cria dot de status pulsante.
- **Ícones nav (`#btn-ai-config svg`, `.nav-item svg`)**: `transition: transform 0.2s ease` + `scale(1.18) translateX(2px)` no hover.

### Toasts
- `@keyframes toast-in`: entrada com slide da direita + slight scale bounce (0% → 60% → 80% → 100%).

### Toggle de valores monetários
- `.money-value`: `transition: filter 0.35s ease, opacity 0.35s ease`; no estado `body.money-hidden`, `filter: blur(8px); opacity: 0.4`.

### Dashboard — cards e contadores
- `.stat-card-animate` + `@keyframes card-cascade-in`: cards entram em cascata com `animationDelay = idx * 0.07s` e translateY de 18px → 0.
- Barras de progresso: começam em `width: 0%` no innerHTML; duplo `requestAnimationFrame` dispara o `transition: width 1s ease-out` existente para o valor real.
- `_animateCounter(el, target, hoursTotal, delay)`: contador de horas sobe de 0 ao valor real em 800ms com easing `1 - (1-t)^3`; delay sincronizado com a cascata de cards.

### Estado vazio — botão primário
- `.btn-pulse-empty` + `@keyframes btn-pulse-empty`: pulsa o botão principal quando a view não tem registros; usa multi-shadow para preservar o `box-shadow: 0 4px 15px rgba(139,92,246,0.3)` do `.btn-primary` e adiciona ring de ping como segundo valor. Adicionado por JS em `renderRecords()` e `renderTasks()` quando `records.length === 0` / `tasks.length === 0`.
- IDs necessários: `id="btn-new-record"` no botão "Lançar Horas" (index.html), `id="btn-new-task"` no botão "Nova Tarefa" (index.html).

### Kanban — drop bounce
- `.kb-card-dropped` + `@keyframes kb-card-drop`: card recém-solto faz bounce elástico (scaleY 0.88 → 1.04 → 0.98 → 1) via `cubic-bezier(0.34,1.56,0.64,1)`; classe adicionada em `_handleDrop()` e removida no `animationend` com `{ once: true }`.

### T2 — hover curtain (implementado 2026-06-04)
- **Tabelas** (`.data-table tbody tr`): `background-image: linear-gradient(90deg, rgba(139,92,246,0.055) 0%, transparent 70%)` no `tr`; `background-size` transiciona de `0% 100%` → `100% 100%` no hover. **Obrigatório**: `.data-table tbody td { background-color: transparent !important }` — sem isso, os `<td>` mascariam o gradiente do `<tr>` e o efeito ficaria dividido em células.
- **Apontamentos** (`.apt-row`): mesmo padrão de `background-image`/`background-size` diretamente no `div` — os filhos são `<span>` e não têm background próprio, então não precisa do `transparent !important`.
- **Não se aplica a cards** — gradiente horizontal faz sentido em row de tabela, não em card de grid.

### T3 — delete animation + two-step confirm (implementado 2026-06-04)
- `@keyframes row-delete-out`: `translateX(0) → -6px → +8px → +24px` com fade; 0.38s ease-out.
- Classes de acionamento: `.row-deleting td` (tabelas), `.kb-card.row-deleting`, `.event-block.row-deleting`, `.event-allday-banner.row-deleting`, `.apt-row.row-deleting`.
- **`_twostepDelete(btn, onConfirm)`** — helper compartilhado em `AppController`: 1º clique → botão vira vermelho + "⚠ Confirmar?" por 3 segundos via `setTimeout`; 2º clique → executa `onConfirm()`. Usado em `handleDeleteClient`, `handleDeleteTask`, `handleDeleteTaskFromModal`, `deleteAgendaEventFromModal`, `handleDeleteImplementation`, `handleDeleteTraining`, `handleDeleteSchedulingRule`. Ações de baixo risco (atendimentos, apontamentos, blocos de agenda inline) usam delete direto sem two-step.
- **Não usar `window.confirm()`** em nenhum delete — substituído inteiramente por `_twostepDelete` + animação.

### `.clickable-card` — hover unificado para cards (implementado 2026-06-04)
- Classe CSS base: `transform: translateY(-2px)`, `box-shadow: 0 6px 20px rgba(139,92,246,0.18)`, `border-color: rgba(139,92,246,0.45) !important`, `transition: 0.18s ease`.
- Aplicada em: cards de **Implementações** (`div.glass.clickable-card`), **Treinamentos** (`div.glass.training-card.clickable-card`), **Chamados** (`div.ticket-card.clickable-card`).
- Todo novo card clicável deve receber essa classe — nunca adicionar `transition:border-color` inline.

### Rodada 1 — Quick wins implementados (2026-06-04) ✅

**Login:** L1 (`login-card-in` no `.glass`), L2 (logo `activity` rotaciona), L3+F1 (barra roxa deslizante no `focus` via `background-image` trick em `.form-control`).
**Sidebar:** S4 (`nav-active-pulse` no `border-left` do item ativo), S5 (`brand-glow` no `text-shadow` do `.brand`).
**Modais:** V2 (spring bounce `scale(0.93) → scale(1)` no `.modal`), V5 (shake em `:invalid` + classe `input-shake` via JS capture-phase + `void el.offsetWidth` reflow).
**Dashboard:** D4 (`card-danger-pulse` em `.stat-card.over-limit` — usa longhand `animation-name` para rodar cascade + pulse em paralelo).
**Kanban:** K2 (`kb-column-cascade` com stagger 70ms), K3 (`kb-card-new` pop-in via `_lastAddedTaskId` tracking), K4 (`priority-high-pulse`), K5 (`.kb-complete-btn` scale+glow), K6 (`.kb-dropzone.drag-over` glow lateral).
**Agenda:** A1 (`event-block-in` com 9 regras nth-child), A3 (`agenda-fade-in` em `#agenda-container > *`), A4 (`#btn-agenda-sync.syncing svg` gira via classe JS + `try/finally`).
**Badges:** B1 (`badge-ativo::before` ponto verde), B2 (`badge-danger-pulse::before` ponto vermelho).
**Empty state:** E2 (`icon-float` em `.kb-empty-state svg, .empty-state svg`).

### Armadilhas de animação
- **Lucide substitui `<i>` por `<svg>` em runtime** — seletores de ícone devem usar `#btn-ai-config svg`, nunca `i[data-lucide="sparkles"]`.
- **`@keyframes` sobrescrevem `box-shadow` do elemento** — usar multi-shadow preservando o shadow original como primeiro valor em todos os keyframes; sem isso, o ring de ping "apaga" o shadow do botão.
- **Duplo `requestAnimationFrame` é obrigatório para animar propriedades CSS definidas no innerHTML** — um único rAF não garante que o browser renderizou o estado inicial antes de aplicar o valor final.
- **`opacity: 0` como propriedade direta + animação de entrada = armadilha de override** — se uma classe define `opacity: 0` explicitamente E usa `animation` para animar para 1, qualquer regra de maior especificidade que sobrescreva `animation` deixa o elemento invisível permanentemente (pois `opacity: 0` permanece sem a animação para restaurar). Padrão seguro: ou usar `animation-fill-mode: both` (sem `opacity: 0` direto) ou usar `animation-name` longhands para listar múltiplas animações em paralelo. Classes afetadas: `.stat-card-animate` e `.kb-column-cascade`. Correção aplicada em `.stat-card.over-limit`: usa `animation-name: card-cascade-in, card-danger-pulse` com longhand para rodar ambas simultaneamente.
- **Animação permanente em elemento re-renderizado causa piscadas** — CSS `animation: ... both` em classes permanentes (ex.: `.event-block`, `#container > *`) faz todos os elementos começarem em `opacity:0` a cada re-render do DOM. Este app recria o DOM em cada `renderAll()`, então animações devem ser disparadas por classes transientes (adicionadas/removidas por JS) ou por classes de container que só existem durante a navegação. **A3** (`#agenda-container > * { animation: agenda-fade-in both }`) foi removida por este motivo — causava flash em todo conteúdo da agenda a cada re-render (incluindo auto-sync de 5 min). **A1** (`.event-block`) foi corrigida de `both` para `forwards` para não iniciar invisível.
- **`backdrop-filter` no estado base de `.modal-overlay` força compositing layer** — se aplicar `backdrop-filter` na classe base (sem `.active`), o browser cria camada de compositing para TODOS os overlays mesmo quando `opacity:0` e invisíveis. Isso gera repaints constantes. Aplicar `backdrop-filter` APENAS no estado `.active`. **V4** foi removida por este motivo.
- **`.view-section` tem `animation: fadeIn` base que conflita com V1 slide** — a regra `.view-section { animation: fadeIn 0.4s ease-out }` existia antes das rodadas de animação. Quando V1 adiciona `.slide-in-right` (que tem mesma especificidade que `.view-section` de base → a classe slide vence), ao remover a classe slide no `animationend`, o browser recomputa estilos e re-dispara `fadeIn` — causando um segundo flash. Correção: `.view-section.active { animation: none }` — especificidade maior que a base, menor que as classes slide (`.view-section.slide-in-right` vence por vir depois no CSS).
- **Float labels (F2) são JS-driven, não CSS puro** — a abordagem CSS via `:not(:placeholder-shown)` não funciona quando o `<label>` vem antes do `<input>` (padrão do app). A implementação usa `_initFloatLabels(container)` que adiciona listeners de `focus/blur/input/change` e alterna a classe `fl-up` no label; `dataset.flInit = '1'` evita registrar listeners duplicados ao reabrir o modal. `_refreshFloatLabels(container)` sincroniza o estado visual imediatamente (necessário ao abrir modal com campos pré-preenchidos). Chamado em `openModal()` para todos os modais e em `DOMContentLoaded` para o form de login (`#auth-form`). Classe CSS ativa: `.float-group` no `form-group`; label sobe via `.float-group > label.fl-up`.
- **Float labels em `<select>`: `hasVal` é sempre `true`** — `ctrl.value !== ''` não funciona para selects com placeholder `<option value="" disabled selected>` porque o select retorna `''` enquanto exibe o texto do placeholder, mantendo o label sobreposto ao conteúdo. A lógica correta é `ctrl.tagName === 'SELECT' || ctrl.value !== ''` — selects sempre têm `hasVal = true` para que o label fique sempre na posição elevada (fl-up). Aplicado em `_initFloatLabels` e `_refreshFloatLabels`.

---

## Backlog (planejado, não implementado)

- **Optimistic updates na Agenda** — aplicar a mesma abordagem de cache em memória implementada no Kanban (Fase perf/kanban de 2026-06-09) para a view Agenda: `_agendaEventsCache`, `_renderAgendaFromCache()`, e optimistic updates em criar/editar/excluir eventos. Hoje cada operação chama `renderAll()` causando 1–3s de espera. Referência de implementação: ver `_tasksCache`, `_renderTasksFromCache()` e `_renderTasksDashboardSync()` em `js/app.js`.

- **Transformar tarefa em apontamento** — botão no modal de tarefa (ou no card Kanban) que pré-preenche o modal de Apontamento com os dados da tarefa (título como descrição, `estimatedMinutes` como duração sugerida, cliente vinculado → `projectNum` via lookup); permite lançar o tempo da tarefa no ERP sem redigitar.

- **Monitorar no OTOBO** — opção nos chamados para marcar um ticket como "monitorado"; tickets monitorados seriam destacados na view Chamados (ex.: badge ou seção separada) para facilitar o acompanhamento de tickets importantes sem precisar lembrar o número. Detalhes de implementação a definir (pode ser coluna `monitored BOOLEAN` em `tickets` ou lista local por usuário).

- **Lançar chamado OTOBO como Implementação** — botão "Criar Implementação" no modal de detalhe do chamado (`modal-chamado`) que pré-preenche o `modal-implementation` com os dados do ticket: `title` → nome da implementação, `raw_data` (descrição do artigo mais recente) → campo descrição, `linked_client_id` → cliente vinculado, status padrão `planned`, tipo padrão `feature`. O usuário complementa os demais campos (código, versão, notas) e salva normalmente. Não requer migration — usa tabela `implementations` + `implementation_clients` já existentes. Ponto de entrada: botão secundário no footer do `modal-chamado` (ao lado de "Abrir no OTOBO"), visível apenas quando o ticket tem `linked_client_id` definido.

### Fase 38 — Painel de Posição de Projeto por Cliente (planejado em 2026-06-05)

**Objetivo**: tela unificada que consolida, em uma única visão, a posição completa de um cliente — chamados OTOBO, tarefas Kanban, atendimentos, agenda e saldo de horas — equivalente a uma planilha de acompanhamento de projeto, mas viva e automática.

**Motivação**: hoje o usuário precisa navegar entre 4–5 views para ter a visão completa de um cliente. A planilha de referência (Tickets/Prioridade/Status/Responsável/Data Entrega) mostra o padrão mental esperado: uma linha por item de trabalho, com coluna de status, responsável e data.

#### Estrutura da view

**Ponto de acesso**: botão "Posição do Projeto" no modal do cliente (nova aba) OU novo item no sidebar (ícone `layout-dashboard`).

**Layout sugerido**: página dividida em painéis por categoria, todos filtrados pelo cliente selecionado:

| Painel | Fonte de dados | Colunas exibidas |
|--------|---------------|-----------------|
| **Saldo de Horas** | `clients` + `records` | Cota mensal, horas usadas, % consumido, saldo acumulado |
| **Chamados OTOBO** | `tickets` | Nº ticket, solicitação, responsável T5, status, data criação, data atualização |
| **Tarefas (Kanban)** | `tasks` | Título, coluna (status), prioridade, data limite, % checklist |
| **Próximos Agendamentos** | `agenda_events` | Data, tipo, título, horário, Google Meet |
| **Últimos Atendimentos** | `records` | Data, início, fim, duração, descrição |

**Seletor de cliente**: dropdown no header da view (ou usa o cliente aberto no modal); não exige navegação por cliente individual.

#### Campos inspirados na planilha de referência

- **Item**: numeração sequencial por categoria
- **Prioridade**: herdada do chamado/tarefa (alta/média/baixa) — `?` para sem prioridade, igual à planilha
- **Ticket/Referência**: número do chamado OTOBO ou ID interno
- **Resp. SIGMA / Resp. T5**: responsável interno (coluna `owner` do ticket) e responsável T5 (campo livre — pode vir de `tasks.description` ou campo novo `assignee`)
- **Solicitação/Título**: descrição curta do item
- **Status**: badge colorido (Pendente / Em desenvolvimento / Resolvido / Concluído)
- **Informações Complementares**: campo de observação livre — para chamados vem de `raw_data`; para tarefas vem de `description`
- **Data Entrega**: `due_date` da tarefa ou campo `date_delivery` a criar em `tickets`
- **Última Atualização**: `updated_at` do registro
- **Data Criação**: `created_at`

#### Interações

- Clicar em um chamado → abre `modal-chamado` (reutiliza o existente)
- Clicar em uma tarefa → abre `modal-task` (reutiliza o existente)
- Clicar em um agendamento → abre `modal-agenda` (reutiliza o existente)
- Botão "Exportar PDF" → jsPDF com todos os painéis em tabela (mesmo padrão do relatório de agenda)
- Botão "Exportar Excel-like" → copiar para área de transferência em formato TSV (colar no Excel/Sheets)

#### IA (se configurada)

- Botão `✨ Resumo do Projeto` → `aiClient.complete()` recebe todos os dados do cliente e retorna parágrafo de situação atual, pontos de atenção e próximos passos; exibido em painel roxo colapsável no topo.

#### Decisões de arquitetura

- **Sem nova tabela**: todos os dados já existem; a view é puramente de leitura e agregação
- **Sem nova rota de store**: usar métodos existentes (`getTicketsByClient`, `getTasks`, `getAgendaEventsByClientAndRange`, `getRecords`) com Promise.all para carregar em paralelo
- **`renderProjectDashboard(clientId)`** — método em `app.js`; guarded por `currentView === 'project-dashboard'`; chamado pelo seletor de cliente
- **Estado**: `this._projectDashboardClientId` — cliente selecionado; `this._projectDashboardData` — cache dos dados para o export sem re-fetch
- **Filtro de chamados**: apenas tickets do cliente (match por `linked_client_id` já existente na tabela `tickets`)
- **Filtro de tarefas**: `client_id` da tarefa
- **Filtro de agenda**: próximos 30 dias a partir de hoje
- **Filtro de atendimentos**: últimos 90 dias (configurável futuramente)

#### Migration SQL necessária

Nenhuma — a view usa apenas dados e colunas já existentes. Caso se queira o campo "Data de Entrega" nos chamados OTOBO: `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS date_delivery DATE;`

#### Itens a decidir antes da execução

1. Ponto de acesso principal: aba no modal de cliente vs. item do sidebar?
2. O painel deve ter filtro de período configurável ou usa janelas fixas (30d agenda, 90d atendimentos)?
3. "Exportar PDF" deve gerar um único PDF com todos os painéis ou um PDF por painel?
4. Campo "Responsável T5" nos chamados: usar `owner` do OTOBO ou criar campo novo no app?

### Backlog de Animações e Visuais (planejado em 2026-06-03)

Plano completo de ~35 animações novas dividido em 3 rodadas de implementação. Princípio geral: `animation-play-state: paused` no hover, multi-shadow para preservar shadows existentes, duplo rAF para animar props definidas via innerHTML.

**Rodada 1 — Quick wins (puro CSS, alto impacto): ✅ IMPLEMENTADA em 2026-06-04**
- **L1** ✅ — Login: card entra com slide-up + fade
- **L2** ✅ — Login: logo `activity` rotaciona uma volta ao carregar
- **L3** ✅ — Login: input focus com barra inferior animada deslizando da esquerda
- **S4** ✅ — Sidebar: item ativo pulsa levemente ao trocar de view (`border-left` roxa)
- **S5** ✅ — Sidebar: marca "TSP Manager" com glow roxo pulse suave contínuo
- **V2** ✅ — Modal abre com spring bounce (scale 0.93 → overshoot → 1)
- **V5** ✅ — Campo inválido: shake horizontal ao tentar salvar com erro de validação
- **D4** ✅ — Dashboard: card com consumo esgotado ganha borda vermelha pulsante
- **K2** ✅ — Kanban: colunas entram em cascata ao carregar o board (slide da esquerda, stagger 70ms)
- **K3** ✅ — Kanban: card criado via quick-add faz pop-in com spring
- **K4** ✅ — Kanban: badge de prioridade Alta pisca suavemente em vermelho
- **K5** ✅ — Kanban: botão de conclusão (✓) tem escala + brilho verde ao marcar
- **K6** ✅ — Kanban: coluna recebe card no drag com borda lateral glow colorida
- **A1** ✅ — Agenda: blocos de evento fade-in escalonado ao carregar view diária/semanal
- **A3** ✅ — Agenda: troca de view (dia/semana/mês) com crossfade suave
- **A4** ✅ — Agenda: ícone do botão sync Google gira enquanto sincroniza
- **F1** ✅ — Formulários (global): input focus com barra roxa animada na borda inferior
- **B1** ✅ — Badges: status "Ativo" em implementações/treinamentos com ponto verde pulsante
- **B2** ✅ — Badges: badge "Estourado" com ponto vermelho pulsante
- **E2** ✅ — Empty state: ícone central flutua em loop suave (keyframe translateY)

**Rodada 2 — JS simples + médio esforço: ✅ IMPLEMENTADA em 2026-06-04**
- **L4** ✅ — Login: botão "Entrar" com ripple ao clicar (`.btn-primary:active::after` + `@keyframes btn-ripple`)
- **V3** ✅ — Modal fecha com animação de saída (shrink + fade): classe `modal-overlay--exiting` por 200ms ease-in
- **V4** ~~✅~~ — Modal overlay backdrop-filter 0→4px — **REMOVIDO** 2026-06-04: `backdrop-filter` na classe base `.modal-overlay` forçava compositing em todos os overlays mesmo com `opacity:0`, causando repaints e piscadas ao carregar views
- **T1** ✅ — Tabelas (todas): linhas entram em cascata (`@keyframes row-in`, `.data-table tbody tr { animation: row-in 0.22s }`)
- **T2** ✅ — Tabelas + Apontamentos: hover curtain da esquerda; cards clicáveis com `.clickable-card` (lift + glow roxo)
- **T3** ✅ — Delete com shake/fade via `.row-deleting`; botões destrutivos com `_twostepDelete` two-step confirm
- **D5** ✅ — Dashboard: card hover com glow dinâmico vazando da cor da barra de progresso (`.stat-card:hover` usa `var(--card-glow-color)` e `var(--card-glow-shadow)`)
- **D6** ✅ — Dashboard: troca de mês com cards deslizando para fora/dentro conforme direção (prev=esquerda, next=direita)
- **A2** ✅ — Agenda: ripple circular roxo no clique do dia na view mensal
- **B3** ✅ — Badge "Estourado" faz shake periódico a cada 4s com escala

**Rodada 3 — Mais complexo (polish final): ✅ IMPLEMENTADA em 2026-06-04**

- **V1** ✅ — Views: slide vem da direita ao avançar, da esquerda ao voltar (baseado na posição no menu)
- **S6** ✅ — Sidebar: ícones giram 360° ao colapsar/expandir (`sidebar--icon-spin`)
- **S7** ✅ — Sidebar: nav items aparecem em cascata no primeiro login (`.sidebar--nav-cascade` + `@keyframes nav-item-in`, stagger 60ms por item, classe removida após 900ms)
- **T4** ✅ — Tabelas: célula de horas faz flip vertical ao renderizar (`class="hours-flip"` nas tds de minutos em `renderRecords` e `renderMonthRecords`; `@keyframes hours-flip` com `perspective(400px) rotateX`)
- **A5** ✅ — Agenda: grid desliza left/right ao navegar prev/next
- **F2** ✅ — Formulários: float label JS-driven via `_initFloatLabels(container)` — label sobe ao focar/preencher
- **E3** ✅ — Skeleton loading com shimmer — já implementado antes das rodadas 2/3 (`.sk`, `sk-shimmer`, `.sk-stat-card`, `.sk-row`)

---

## Comandos úteis

```powershell
# Iniciar servidor dev
python -m http.server 8080

# Verificar se porta 8080 está em uso
netstat -ano | findstr :8080

# Git push (usa git do GitHub Desktop)
$git = "C:\Users\jorge\AppData\Local\GitHubDesktop\app-3.5.8\resources\app\git\cmd\git.exe"
Set-Location d:\GerenciadorTSP
& $git add . && & $git commit -m "mensagem" && & $git push
```
