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
│   └── calendar.js         # GoogleCalendarAPI — OAuth e sincronização de eventos
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

**`GoogleCalendarAPI`** (`js/calendar.js`)
- Lê credenciais de `window.TSP_CONFIG.CLIENT_ID` e `window.TSP_CONFIG.API_KEY`
- Sincronização bidirecional com Google Calendar

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
- **Fase 25** ✅ — Agendamento Automático: regras de recorrência por cliente (tabela `scheduling_rules`) com frequência semanal/quinzenal/mensal, dias da semana, horário, período fixo (data início + data fim) e geração idempotente via `last_generated_until`; aba "Agendamento" no modal do cliente (tabs `.modal-tab`/`.modal-tabs`) lista as regras ativas do cliente; modal `modal-scheduling-rule` para criar/editar regras com checkboxes de dias da semana (`.rule-day-btn`); botão ⚡ por regra abre modal `modal-schedule-preview` com lista de ocorrências calculadas e marcação de conflitos (⚠) com eventos existentes no mesmo horário; confirmação cria `agenda_events` + push Google Calendar + atualiza `last_generated_until`; migration SQL: `CREATE TABLE scheduling_rules (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL, client_id UUID REFERENCES clients ON DELETE CASCADE NOT NULL, title TEXT NOT NULL DEFAULT 'Atendimento', event_type TEXT DEFAULT 'meeting', days_of_week JSONB DEFAULT '[]', start_time TEXT NOT NULL DEFAULT '', end_time TEXT NOT NULL DEFAULT '', frequency TEXT NOT NULL DEFAULT 'weekly', period_start DATE NOT NULL, period_end DATE NOT NULL, location TEXT DEFAULT '', attendees TEXT DEFAULT '', generate_meet BOOLEAN DEFAULT FALSE, is_active BOOLEAN DEFAULT TRUE, last_generated_until DATE, created_at TIMESTAMPTZ DEFAULT now()); ALTER TABLE scheduling_rules ENABLE ROW LEVEL SECURITY; CREATE POLICY "users_own_scheduling_rules" ON scheduling_rules FOR ALL USING (auth.uid() = user_id);`
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
- Pre-fetch de `clientsMap` antes de `forEach` para evitar chamadas async dentro de loops síncronos

### Armadilhas conhecidas
- **`switchView()` chama `renderAll()` sem `await`** — views sub-nível (client-dashboard, month-records) ficam com spinner briefly após navegação; testes ou código que dependem do conteúdo renderizado devem aguardar o elemento concreto aparecer no DOM
- **`const Toast` e `const spinnerHtml` em `app.js` são script-scoped** — não estão em `window`; inacessíveis de `page.evaluate()` no Playwright e de outros scripts. Não mover para `window` sem avaliar impacto
- **`lucide.createIcons({ nodes: [...] })` NÃO é suportado no Lucide 0.469.0 UMD** — usar sempre `lucide.createIcons()` sem opções para re-processar ícones no DOM
- **`store.userId` dentro de `page.evaluate()` async retorna `null`** — ao testar via Playwright, usar `window.supabaseClient` com `uid = Auth.getUserId()` capturado localmente em vez de chamar `store.addXxx()` ou `store.getXxx()` dentro de evaluate
- **`renderClients()` faz `await store.getClientStats(c.id)` por cliente** — chamadas sequenciais; com muitos clientes a renderização pode levar 2-3s; esperar o elemento aparecer no DOM antes de interagir
- **Google Calendar API mantém conexões em background** — `page.waitForLoadState('networkidle')` nunca dispara; sempre adicionar `.catch(() => {})`
- **PDF.js só extrai texto de PDFs text-based** — PDFs baseados em imagem (sem operadores BT/ET nos streams de conteúdo) retornam 0 itens de texto; o parser retorna vazio sem erro. Para diagnosticar: verificar se o texto é selecionável no Chrome; inspecionar o binário com `grep 'BT '` após descompressão FlateDecode. PDFs de imagem precisam de OCR (não implementado) — a solução correta é gerar o PDF com texto real na fonte (ex.: configuração de exportação do SAP).
- **CSP nginx: `worker-src blob:` é obrigatório para PDF.js** — sem a diretiva `worker-src blob:`, o nginx bloqueia o Web Worker que PDF.js cria internamente como blob URL. O resultado é texto vazio em PDFs text-based. O `nginx.conf` já inclui `worker-src blob: https://cdnjs.cloudflare.com` desde o commit `6285b38`.
- **PDF.js achata colunas visuais em texto plano** — layout de colunas do SAP faz PDF.js extrair `"22851 Projeto.:"` (número antes do rótulo) em vez de `"Projeto.: 22851"`. O parser suporta ambos os formatos.
- **Horas na Ata SAP são centesimais, não sexagesimais** — `00:75` = 0,75 h = 45 min reais (não 1h15). A coluna "Horas Aplicadas" usa formato centesimal. **Hora Inicial e Hora Final também podem estar em centesimal** quando o SAP usa timestamps intermediários (ex: `16:75` = 16h45m). O parser detecta minutos > 59 e converte via `round(CC * 60 / 100)`. Para converter centesimal → minutos: `(HH * 100 + CC) / 100 * 60`.
- **Cada página da Ata PDF = um bloco independente** — nunca concatenar textos de páginas diferentes antes de parsear. O parser (`parsePdfPages`) processa cada página em isolamento via `_parseSinglePage`.
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
- **Agenda: sync forçado para eventos com `calendarEventId`** — `handleAgendaSubmit` usa `needsGoogleSync = (syncGoogle || !!existingCalId) && calendarAPI.isEnabled`. Se o evento já foi enviado ao Google (tem `calendarEventId`), o update é forçado mesmo que o checkbox "Sincronizar com Google Calendar" esteja desmarcado. Isso garante que editar um evento não deixe o Google Calendar com dados desatualizados.
- **Agenda: auto-sync bidirecional ao entrar na view** — `switchView('agenda')` dispara `_autoSyncGoogle()` em background quando `calendarAPI.isAuthenticated` e a view anterior não era 'agenda'. `_autoSyncGoogle()` tem cooldown de 2 minutos (`_lastGoogleSync`) para evitar chamadas excessivas durante navegações rápidas.
- **Agenda: sync periódico a cada 5 minutos** — `onCalendarAuthenticated()` inicia `_googleSyncInterval = setInterval(...)` de 5 minutos que chama `_autoSyncGoogle()` enquanto o usuário estiver na view agenda e autenticado. O intervalo é limpo no logout (handler `btn-logout`) e reiniciado a cada autenticação. Não usar `setInterval` adicional sem limpar o anterior.
- **Agenda: `_lastGoogleSync` e `_googleSyncInterval` são instâncias de AppController** — inicializados no constructor (`_lastGoogleSync = 0`, `_googleSyncInterval = null`). Ambos são limpos no handler de logout para evitar vazamento entre sessões.
- **Agenda: "Dia inteiro" — identificação e renderização** — eventos dia-inteiro são identificados por `startTime === ''` (string vazia no banco). `toggleAllDayAgenda(bool)` controla visibilidade de `#agenda-time-fields` e o atributo `required` dos inputs de hora. `editAgendaEvent()` detecta allDay e chama `toggleAllDayAgenda(true)`. Nas views diária/semanal, allDay events são filtrados ANTES de `createEventBlockHtml` (que crasharia com `startTime=''`) e renderizados em `createAllDayBannerHtml`. Google Calendar: `mapLocalToGoogleEvent` envia `{ date }` (sem hora) para allDay; na sync reversa, `gEv.end.date` é exclusivo — subtrai 1 dia para `dateEnd`.

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

- **Saldo de horas: migration obrigatória antes do deploy** — sem `initial_balance_minutes` e `balance_start_date` na tabela `clients`, o `addClient`/`updateClient` lançará erro 400. Rodar: `ALTER TABLE clients ADD COLUMN IF NOT EXISTS initial_balance_minutes INTEGER DEFAULT 0, ADD COLUMN IF NOT EXISTS balance_start_date DATE;`
- **Saldo de horas: saldo inicial obriga data de início** — `handleClientSubmit()` bloqueia o save se `client-initial-balance` estiver preenchido mas `client-balance-start` estiver vazio. Validação no JS, não no banco.
- **Saldo de horas: `_calcClientBalance` retorna `hasTracking: false` sem `balanceStartDate`** — clientes sem data de início mostram apenas o delta do mês atual; coluna "Saldo acumulado" exibe "sem controle". O cálculo de meses usa `Math.max(1, ...)` para garantir pelo menos 1 mês contratado.
- **Saldo de horas: `openSaldoPanel()` carrega `store.getRecords()` inteiro** — busca todos os registros do usuário de uma vez para evitar N queries. Com muitos registros isso pode ser lento; filtragem por `clientId` é feita em memória via `Array.filter`. Botão `#btn-open-saldo` está no header da view Clientes.

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

- **Kanban Fase 22: `kanban_columns` deve ser criada antes do primeiro uso** — sem a tabela, `ensureDefaultColumns()` lança erro; `renderTasks()` captura o erro, exibe toast e mostra board vazio. Migration SQL: vide seção abaixo. A migration de dados existentes ('new'/'doing'/'done' → UUIDs) é automática via `_migrateOldStatuses()` na primeira abertura da view Tarefas, controlada por `sessionStorage.kbMigrated`.
- **Kanban Fase 22: coluna `is_done` pode estar ausente em tabelas criadas antes do commit final** — o erro `PGRST204: Could not find the 'is_done' column` ocorre quando a tabela `kanban_columns` foi criada sem esse campo (ex.: via migration parcial anterior). Corrigir com: `ALTER TABLE kanban_columns ADD COLUMN IF NOT EXISTS is_done BOOLEAN DEFAULT FALSE;`
- **Kanban Fase 22: `task.status` agora é UUID de `kanban_columns.id`** — todo código que compara `t.status === 'done'` está quebrado pós-migração. Usar `isDone` via `_currentColumns` ou `store.getAllColumns()`. O fingerprint do backup/migração localStorage (`['new','doing','done'].includes(first.status)`) ainda funciona para backups antigos mas não detectará backups gerados pós-fase-22.
- **Kanban Fase 22: board requer cliente selecionado** — sem filtro de cliente, `renderTasks()` exibe placeholder e retorna. Cards e quick-add só aparecem com cliente filtrado. Botão "Gerenciar Colunas" também fica oculto sem filtro.
- **Kanban Fase 22: `_currentColumns` é instância de AppController** — populado por `renderTasks()` e, se necessário, por `handleEditTask()`. `_syncModalColumnButtons()` usa `_currentColumns` para gerar os botões "Mover para" dinamicamente. Se `_currentColumns` estiver vazio, usa fallback legado (3 botões hardcoded).
- **Kanban Fase 22: `reorderColumns` usa mesmo padrão de `reorderTasks`** — `Promise.all` de `UPDATE` individuais, nunca `upsert` (conflita com RLS).
- **Kanban Fase 22: `mc-color-palette` fecha via re-render** — `_mcPickColor(idx, color)` chama `_renderManageColumnsList()` que recria o DOM; todas as palettes ficam `display:none` novamente. `_mcToggleColorPicker` fecha todos antes de abrir o selecionado.

### Cálculos automáticos
- Comissão do consultor = 43% do valor pago pelo cliente (`clientPays * 0.43`)
- Duração do atendimento calculada a partir de `startTime` e `endTime`
- Barras de progresso baseadas em `minutes / (hoursTotal * 60)`

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
2. `parsePdfPages(pageTexts[])` processa cada página independentemente via `_parseSinglePage()`
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
| `parsePdfPages(pageTexts)` | Itera páginas, agrega records e warnings |
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
