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
- `initAfterAuth()` — ponto de entrada pós-login, chama `renderAll()`

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
| `agenda_events` | id, user_id, client_id, related_task_id, title, type, date, start_time, end_time, location, calendar_event_id |

### Fases de migração

- **Fase 1** ✅ — Supabase criado, tabelas e RLS configuradas
- **Fase 2** ✅ — Autenticação: tela de login/logout integrada ao app
- **Fase 3** ✅ — Reescrita do `store.js` para Supabase + adaptação completa do `app.js` para async/await
- **Fase 4** ✅ — Loading states (spinners) e error handling (Toast notifications) na UI
- **Fase 5** ✅ — Ferramenta de migração localStorage → Supabase (detecção automática + modal + limpeza)
- **Fase 6** 🔄 — Deploy final e testes com múltiplos usuários

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
- **Branch**: `main` → deploy automático via webhook
- NUNCA tocar em outros serviços da VPS (7dias, evolution-api, termix)

---

## Regras de desenvolvimento

### O que nunca alterar sem cuidado
- Schema das tabelas Supabase — mudanças requerem migration SQL e atualização do store.js
- `docker-entrypoint.sh` — qualquer var nova precisa ser adicionada aqui E no Easypanel
- IDs de elementos HTML — usados como seletores em `app.js`; renomear quebra a UI

### Padrões de código
- JavaScript vanilla ES6+; sem TypeScript, sem React, sem bundler
- CSS usa variáveis (`--primary`, `--bg-glass`, etc.) definidas em `:root`
- Todas as chamadas ao `store` são `async/await` — nunca chamar métodos do store sem `await`
- Pre-fetch de `clientsMap` antes de `forEach` para evitar chamadas async dentro de loops síncronos

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
| **Agenda** | Calendário diário/semanal; 4 tipos de evento; sincronização Google Calendar |

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
