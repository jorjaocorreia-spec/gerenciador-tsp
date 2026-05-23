# GerenciadorTSP — Documentação para Claude Code

## O que é este projeto

Sistema web de gerenciamento de horas e consultoria para pequenas empresas ou consultores independentes. Permite controlar contratos de clientes, horas consumidas, tarefas (Kanban), agenda de atendimentos e sincronização com Google Calendar.

Aplicação 100% client-side (sem backend): roda no navegador com dados persistidos em `localStorage`, servida por um servidor HTTP Python local.

---

## Stack e dependências

- **Linguagens**: HTML5, CSS3, JavaScript ES6+ (vanilla, sem frameworks, sem build step)
- **Persistência**: `localStorage` (chave `tsp_data_v1`)
- **Servidor local**: Python 3 HTTP server na porta 8080
- **Bibliotecas (CDN)**:
  - Lucide Icons — ícones da UI
  - PDF.js — leitura/parsing de PDFs
  - jsPDF + jsPDF-AutoTable — geração de PDFs
  - Google Calendar API v3 + Google Identity Services (GIS) — integração de agenda
- **Design**: tema escuro, glassmorphism, variáveis CSS, fonte Inter

---

## Como rodar

```batch
# Windows — duplo clique ou via terminal:
.\Iniciar.bat

# Manual (PowerShell):
python -m http.server 8080
# Abrir: http://localhost:8080/index.html
```

**Requisitos**: Python 3.x instalado, navegador moderno, conexão com internet (CDNs e Google APIs).

Não há etapa de build, transpilação ou instalação de pacotes.

---

## Estrutura de arquivos

```
GerenciadorTSP/
├── index.html          # Estrutura HTML completa (modais, formulários, seções)
├── Iniciar.bat         # Script para iniciar servidor Python e abrir no browser
├── js/
│   ├── app.js          # AppController — lógica de UI, handlers, renderização, PDF
│   ├── store.js        # TSPStore — CRUD e persistência no localStorage
│   └── calendar.js     # GoogleCalendarAPI — OAuth e sincronização de eventos
├── styles/
│   └── main.css        # Sistema de design: variáveis, layouts, componentes, animações
├── Documentation/
│   ├── INSTRUCOES_GOOGLE_CALENDAR.md  # Guia de configuração da integração Google
│   └── GEMINI-Construtor-de-Sites.md  # Referência de design (não faz parte do app)
└── Sample Data/        # PDFs de exemplo para testar importação de ATAs
```

---

## Arquitetura

### Classes principais

**`AppController`** (`js/app.js`)
- Controla navegação entre views (Dashboard, Clientes, Atendimentos, Tarefas, Agenda)
- Gerencia modais, formulários e eventos de UI
- Renderiza todas as views dinamicamente no DOM
- Drag-and-drop do Kanban
- Importação e exportação de PDFs
- Ponto de entrada: instanciado no final do `index.html`

**`TSPStore`** (`js/store.js`)
- Operações CRUD para: Clientes, Registros (horas), Tarefas, Eventos de agenda
- Serialização/desserialização para `localStorage`
- Relacionamentos entre entidades (ex.: registros vinculados a clientes)

**`GoogleCalendarAPI`** (`js/calendar.js`)
- Gerenciamento de token OAuth 2.0
- Inicialização do GAPI client
- Sincronização bidirecional com Google Calendar (pull e push)
- Credenciais configuradas nas linhas 13-14 do arquivo

---

## Modelo de dados

```javascript
// Cliente
{ id, name, hoursTotal, csName, projectNum, clientPays, notes, status, createdAt }

// Registro de horas (Atendimento)
{ id, clientId, date, startTime, endTime, minutes, description, createdAt }

// Tarefa (Kanban)
{ id, clientId, title, description, status, priority, dueDate, estimatedMinutes, attachments, createdAt, timeSpent }
// status: 'new' | 'doing' | 'done'
// priority: 'low' | 'medium' | 'high'

// Evento de agenda
{ id, title, description, type, clientId, relatedTaskId, date, startTime, endTime, location, createdAt, calendarEventId }
// type: 'meeting' | 'consulting' | 'task' | 'reminder'
```

---

## Configuração do Google Calendar

As credenciais ficam em `js/calendar.js` (linhas 13-14):

```javascript
const CLIENT_ID = '...apps.googleusercontent.com';
const API_KEY = 'AIzaSy...';
```

Para configurar do zero, seguir `Documentation/INSTRUCOES_GOOGLE_CALENDAR.md`.
A origin `http://localhost:8080` deve estar autorizada no projeto Google Cloud.

---

## Regras de desenvolvimento

### O que nunca alterar sem cuidado
- `store.js` — toda mudança no esquema de dados pode corromper dados existentes no `localStorage`; migração manual pode ser necessária
- Credenciais em `calendar.js` — não commitar credenciais reais; usar variáveis de ambiente se o projeto evoluir para um servidor
- Chave `tsp_data_v1` no `localStorage` — renomear causa perda de todos os dados do usuário

### Padrões de código
- JavaScript vanilla ES6+; sem TypeScript, sem React, sem bundler
- Sem comentários redundantes — o código deve ser autoexplicativo via nomes
- CSS usa variáveis (`--primary`, `--bg-glass`, etc.) definidas em `:root`; sempre usar variáveis em vez de valores hardcoded
- IDs de elementos HTML são usados como seletores no `app.js`; manter consistência ao renomear

### Cálculos automáticos
- Comissão do consultor = 43% do valor pago pelo cliente (`clientPays * 0.43`)
- Duração do atendimento calculada a partir de `startTime` e `endTime`
- Barras de progresso baseadas em `minutes / (hoursTotal * 60)`

### Exportação de dados
- JSON backup/restore: exporta o objeto completo do `localStorage`
- PDF de registros: usa jsPDF com AutoTable; filtros de cliente e data são aplicados antes
- Importação de ATAs (PDF): parsing via PDF.js, extrai registros de presença

---

## Funcionalidades por view

| View | Descrição |
|------|-----------|
| **Dashboard** | Visão geral dos clientes com barras de consumo de horas |
| **Clientes** | CRUD de clientes; campos: nome, horas, CS, nº projeto, valor, notas, status |
| **Atendimentos** | Log de horas por cliente; filtros por cliente e período; exportação PDF |
| **Tarefas** | Kanban (Novas / Em Execução / Finalizadas) com drag-and-drop e métricas |
| **Agenda** | Calendário diário/semanal; 4 tipos de evento; sincronização Google Calendar |

---

## Limitações conhecidas

- Dados ficam somente no navegador (localStorage); não há backup automático em nuvem
- Google OAuth exige origin pública para produção (localhost funciona em dev)
- Sem autenticação de usuário: qualquer pessoa com acesso ao browser vê todos os dados
- Sem testes automatizados
- Arquivo `app.js` é extenso (71 KB); qualquer refatoração deve ser incremental

---

## Comandos úteis

```powershell
# Iniciar servidor
python -m http.server 8080

# Verificar se porta 8080 está em uso
netstat -ano | findstr :8080

# Parar processo na porta 8080 (substituir PID)
taskkill /PID <PID> /F
```
