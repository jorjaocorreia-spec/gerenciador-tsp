# Phase 22 — Chamados (OTOBO Integration)
_Context captured: 2026-05-27_

---

## Domain

View "Chamados" — painel de acompanhamento dos chamados em andamento com clientes, integrado ao OTOBO via REST API. Leitura somente, dados cacheados no Supabase, sincronização manual.

---

## Decisions

### Autenticação e Configuração OTOBO

- **Configuração via tela no app**: URL do OTOBO + usuário + senha salvos por usuário no Supabase (nova tabela `otobo_config` com `user_id`, `url`, `username`, `password_enc` ou simplesmente `password`).
- **Config acessível via modal dentro da view Chamados**: botão "Configurar OTOBO" no topo da view abre modal com os campos. Se não configurado, view exibe empty state com CTA para configurar.
- **URL OTOBO é pública** (acessível da internet): chamada API feita direto do browser. Investigar CORS — OTOBO pode precisar de configuração adicional no servidor. Se CORS bloquear, avaliar proxy simples ou extensão browser.

### Integração OTOBO

- **Modo de uso: somente leitura**. Nenhuma escrita de volta ao OTOBO. O app é um painel de acompanhamento passivo.
- **Endpoint principal**: `TicketSearch` para buscar todos os chamados não fechados (status != Fechado/Resolvido) de todos os clientes. Sem filtro por agente responsável — visão ampla da carteira.
- **Endpoint de detalhe**: `TicketGet` com `AllArticles=1` para buscar artigos (mensagens) do chamado ao abrir o modal de detalhe.
- **Autenticação OTOBO**: Basic Auth via header `Authorization: Basic base64(user:pass)` nas chamadas à REST API.

### Armazenamento de Dados

- **Cache no Supabase + refresh manual**: nova tabela `tickets` armazena o snapshot dos chamados. Botão "Sincronizar" na view dispara chamada ao OTOBO e atualiza o cache.
- **Tabela `tickets` (Supabase)**:
  - `id` UUID PK
  - `user_id` UUID → auth.users (RLS: `auth.uid() = user_id`)
  - `ticket_id` TEXT (ID do ticket no OTOBO)
  - `ticket_number` TEXT (número legível ex: "2026052700001")
  - `title` TEXT
  - `status` TEXT
  - `priority` TEXT
  - `queue` TEXT
  - `customer_name` TEXT (nome do cliente no OTOBO)
  - `owner` TEXT (agente responsável)
  - `created_at_otobo` TIMESTAMPTZ
  - `updated_at_otobo` TIMESTAMPTZ
  - `raw_data` JSONB (dados completos do ticket para usar no modal de detalhe)
  - `synced_at` TIMESTAMPTZ DEFAULT now()
  - `linked_client_id` UUID → clients (nullable, resultado do match por nome)
- **Tabela `otobo_config` (Supabase)**:
  - `user_id` UUID PK → auth.users
  - `url` TEXT (ex: "https://helpdesk.empresa.com")
  - `username` TEXT
  - `password` TEXT (plain text, RLS garante isolamento por usuário)
  - `updated_at` TIMESTAMPTZ DEFAULT now()

### Vínculo com Clientes TSP

- **Match por nome do cliente**: comparar `customer_name` do ticket OTOBO com `clients.name` no TSP.
- **Estratégia de match**: normalização simples (lowercase + trim). Se não encontrar match exato, registrar `linked_client_id = null` e exibir o chamado numa seção "Sem cliente vinculado".
- **Sem criação automática de cliente**: diferente da importação PDF, chamados sem match não criam cliente. Apenas exibem o nome do OTOBO.

### Layout e UI

- **View "Chamados"**: nav item novo no sidebar (entre Implementações e Apontamentos sugerido), ícone `ticket` ou `headphones` (Lucide).
- **Layout cards por cliente**: agrupado por `linked_client_id`, igual ao padrão da view Implementações (`renderImplementations()`). Seção extra no final para chamados sem vínculo.
- **Campos visíveis no card**:
  - Número do ticket (`#ticket_number`)
  - Título (truncado)
  - Status (badge colorido: aberto=azul, em atendimento=laranja, aguardando=amarelo)
  - Prioridade (badge: urgente=vermelho, alta=laranja, média=cinza, baixa=verde)
  - Responsável (owner)
  - Fila (queue)
  - Datas: abertura + última atualização (formato relativo "há X dias")
- **Botão "Sincronizar"** no topo da view (igual ao padrão da Agenda). Exibe timestamp do último sync.
- **Botão "Configurar OTOBO"** no topo, abre modal de configuração.

### Modal de Detalhe do Chamado

- **Modal two-panel** (padrão do app): conteúdo principal à esquerda, sidebar de ações à direita.
- **Conteúdo esquerdo**: título completo, descrição, histórico de artigos (mensagens) do ticket em ordem cronológica.
- **Sidebar direita**: badges de status/prioridade, fila, responsável, cliente vinculado, datas, link "Abrir no OTOBO" (nova aba).
- **Artigos carregados on-demand**: ao abrir o modal, faz chamada `TicketGet` com `AllArticles=1`. Spinner durante carregamento. Dados dos artigos NÃO são cacheados no Supabase (somente o snapshot do ticket).

### Tratamento de Erros e Estados

- **OTOBO não configurado**: empty state com ícone + texto explicativo + botão "Configurar OTOBO".
- **OTOBO inacessível** (rede, CORS, auth falhou): toast de erro + manter dados do cache anterior visíveis com aviso de "Última sync: [data]".
- **Sem chamados**: empty state "Nenhum chamado em aberto".
- **CORS**: se a API OTOBO retornar erro de CORS, exibir mensagem específica orientando o administrador a configurar `Access-Control-Allow-Origin` no servidor OTOBO.

---

## Canonical Refs

- `js/app.js` — padrão de views, modais, renderização, Toast, spinner
- `js/store.js` — padrão CRUD Supabase, mappers camelCase, async/await
- `js/auth.js` — Auth.getUserId(), supabaseClient
- `styles/main.css` — variáveis CSS, glassmorphism, badges
- `index.html` — estrutura sidebar, modais existentes (referência para novos)
- CLAUDE.md seção "Implementações" — padrão de cards agrupados por tipo a replicar
- CLAUDE.md seção "Armadilhas conhecidas" — sidebar nav-label, lucide.createIcons()

---

## Deferred Ideas

- **Notas internas por chamado** (salvas no TSP, não no OTOBO) — descartado desta fase, pode ser Fase 23.
- **Escrita no OTOBO** (mudar status, adicionar nota) — mais complexo, fase futura.
- **SLA / Prazo de resolução** — não selecionado; adicionar na Fase 23 se o OTOBO da empresa usar SLA.
- **Filtro por responsável** (meus chamados vs todos) — simplicidade nesta fase; filtro pode ser Fase 23.
- **Notificações** de novos chamados — feature separada.
