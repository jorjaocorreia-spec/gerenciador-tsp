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
| `agenda_events` | id, user_id, client_id, related_task_id, title, type, date, **date_end**, start_time, end_time, location, calendar_event_id |
| `apontamentos` | id, user_id, date, start_time, end_time, project_num, description |

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
- **PDF.js achata colunas visuais em texto plano** — layout de colunas do SAP faz PDF.js extrair `"22851 Projeto.:"` (número antes do rótulo) em vez de `"Projeto.: 22851"`. O parser suporta ambos os formatos.
- **Horas na Ata SAP são centesimais, não sexagesimais** — `00:75` = 0,75 h = 45 min reais (não 1h15). A coluna "Horas Aplicadas" usa formato centesimal. **Hora Inicial e Hora Final também podem estar em centesimal** quando o SAP usa timestamps intermediários (ex: `16:75` = 16h45m). O parser detecta minutos > 59 e converte via `round(CC * 60 / 100)`. Para converter centesimal → minutos: `(HH * 100 + CC) / 100 * 60`.
- **Cada página da Ata PDF = um bloco independente** — nunca concatenar textos de páginas diferentes antes de parsear. O parser (`parsePdfPages`) processa cada página em isolamento via `_parseSinglePage`.
- **Deploy automático (webhook Easypanel) está quebrado** — após cada `git push`, avisar o usuário para fazer deploy manual no Easypanel antes de testar em produção.
- **Sidebar: todo texto usa `<span class="nav-label">`** — nav-items, botões da `sidebar-bottom` e email do usuário têm o texto em `<span class="nav-label">`. Esse span é o que CSS esconde no estado `.sidebar.collapsed`. Novos itens de menu ou botões adicionados ao sidebar sem esse span não respondem ao colapso. Cada nav-item também precisa do atributo `title="Nome"` para exibir tooltip quando colapsado.
- **Sidebar: dois estados via `sessionStorage`** — `sidebarCollapsed` ('1' = colapsado) e `moneyHidden` ('1' = oculto). Ambos são aplicados em `initAfterAuth()`. O padrão é: se a chave não existir no sessionStorage, o default é expandido/visível. A sidebar vai de 260px (expandida) para 70px (colapsada) com `transition: width 0.25s ease` no CSS.
- **Agenda: eventos multi-dia usam `date_end`** — `_event()` retorna `dateEnd: r.date_end || r.date`. Queries usam overlap detection via `.or('date_end.gte.X,and(date_end.is.null,...)')`. Nos renders mensal e semanal, filtrar com `e.date <= iso && (e.dateEnd || e.date) >= iso`; nunca filtrar só por `e.date === iso`.
- **Agenda: `openNewAgendaEvent(dateStr)` é o ponto de entrada para novo agendamento** — chama `closeModal` + `openModal` em sequência (síncrono), sobrescreve as datas e oculta o botão excluir. Cells/colunas do grid e o botão "+ Novo Agendamento" chamam este método. Eventos dentro do grid têm `event.stopPropagation()` para não acionar o click da célula pai.
- **Agenda: botão excluir no modal** — `#btn-delete-agenda-event` fica oculto (`display:none`) por padrão; `editAgendaEvent()` o exibe (`display:flex`); `openNewAgendaEvent()` o oculta novamente. `deleteAgendaEventFromModal()` lê o ID de `#agenda-id`, remove do Supabase (e do Google Calendar se `calendarEventId` existir), fecha o modal e re-renderiza a agenda.
- **Agenda: "Dia inteiro" — identificação e renderização** — eventos dia-inteiro são identificados por `startTime === ''` (string vazia no banco). `toggleAllDayAgenda(bool)` controla visibilidade de `#agenda-time-fields` e o atributo `required` dos inputs de hora. `editAgendaEvent()` detecta allDay e chama `toggleAllDayAgenda(true)`. Nas views diária/semanal, allDay events são filtrados ANTES de `createEventBlockHtml` (que crasharia com `startTime=''`) e renderizados em `createAllDayBannerHtml`. Google Calendar: `mapLocalToGoogleEvent` envia `{ date }` (sem hora) para allDay; na sync reversa, `gEv.end.date` é exclusivo — subtrai 1 dia para `dateEnd`.

### Cálculos automáticos
- Comissão do consultor = 43% do valor pago pelo cliente (`clientPays * 0.43`)
- Duração do atendimento calculada a partir de `startTime` e `endTime`
- Barras de progresso baseadas em `minutes / (hoursTotal * 60)`

---

## Funcionalidades por view

| View | Descrição |
|------|-----------|
| **Login** | Tela de autenticação (email/senha) via Supabase Auth |
| **Dashboard** | Visão geral dos clientes com barras de consumo de horas |
| **Clientes** | CRUD de clientes; campos: nome, horas, CS, nº projeto, valor, notas, status |
| **Atendimentos** | Log de horas por cliente; filtros por cliente e período; exportação PDF |
| **Tarefas** | Kanban (Novas / Em Execução / Finalizadas) com drag-and-drop e métricas |
| **Agenda** | Calendário diário/semanal/mensal; 4 tipos de evento; eventos multi-dia (Data Inicial + Data Final); clicar no dia abre novo agendamento; excluir pelo modal de edição; sincronização Google Calendar |
| **Apontamentos** | Log diário: horário início/fim, nº projeto (texto livre + autocomplete de clientes), descrição; navegação por dia; total do dia calculado |

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
