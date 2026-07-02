# Painel de Indicadores — Evolução do Cliente

**Data**: 2026-07-02
**Status**: aprovado para planejamento

## Objetivo

Criar um painel de indicadores (estilo Power BI) que permita medir a evolução de cada cliente com base nas tarefas executadas e demais dados já existentes na plataforma (horas, agenda, implementações). Disponível tanto para o **consultor** (todos os clientes, com seletor) quanto para o **cliente** (Portal do Cliente, só o seu próprio projeto), incluindo um resumo automático gerado por IA e um chat para tirar dúvidas sobre o projeto.

## Escopo

Inclui:
- Nova view "Indicadores" na sidebar (consultor e Portal do Cliente)
- Agregação de tarefas, horas, agenda e implementações por cliente
- Resumo textual gerado por IA + chat de perguntas livres
- Exportação em PDF
- Extensão de RLS para o papel `client` ler dados do próprio projeto além de tasks/kanban_columns

Fora de escopo (não implementar agora):
- Dados financeiros/comissão no painel do cliente
- Snapshots históricos em tabela própria (tudo calculado sob demanda)
- Comparação entre clientes diferentes na visão do cliente (só vê o seu)

## Arquitetura

### Navegação e acesso
- Nova view `indicadores` na sidebar, ícone dedicado, seguindo padrão das demais views (`switchView`, `renderAll` guard por `currentView`)
- **Consultor**: seletor de cliente no topo da view (dropdown, mesmo padrão de outros filtros de cliente no app); ao trocar, recarrega os indicadores daquele `client_id`
- **Cliente (Portal)**: view abre direto sem seletor, usando o `client_id` resolvido de `user_roles` (mesma fonte já usada para Kanban read-only) — nunca lê `client_id` de input do usuário

### Dados — sem tabelas novas
`store.getClientIndicators(clientId)` faz queries paralelas: `tasks` (por client_id), `records` (por client_id, para horas), `agenda_events` (por client_id), `implementations` via `implementation_clients` (por client_id). Agrega tudo em memória, mesmo padrão de `getBatchStats()`/`_computeClientStats()`. Sem tabela de snapshot — toda métrica temporal é derivada de timestamps já existentes (`tasks.completed_at`, `tasks.created_at`, `records.date`, `agenda_events.date`, `implementations.implementation_date`).

### RLS — extensão para o papel `client`
Novas policies de leitura (`SELECT` apenas), restritas via `user_roles.client_id`, seguindo o modelo de `clients_read_own_tasks`/`clients_read_own_columns`:
- `clients` — o cliente pode ler a própria linha (nome, horas contratadas, status; **sem** `client_pays`/`hourly_rate` sendo exibidos na UI, mesmo que a policy libere a linha inteira — a ocultação de valores financeiros é feita na camada de apresentação, `renderIndicadores()` nunca renderiza esses campos quando `role === 'client'`)
- `records` — filtrado por `client_id`
- `agenda_events` — filtrado por `client_id`
- `implementations` + `implementation_clients` — filtrado por vínculo com o `client_id` do cliente

Migration SQL necessária antes do deploy desta fase (a ser detalhada no plano de implementação).

## Conteúdo do painel

1. **Resumo IA** (topo) — texto curto gerado sob demanda (botão "Gerar resumo", não automático a cada acesso, para controlar custo de API). Usa `aiClient` com o resumo estruturado dos dados já carregados como contexto.
2. **Cards de KPI** — tarefas concluídas (mês/total), horas consumidas vs. contratadas (reaproveita lógica de `_calcClientBalance`), taxa de conclusão no prazo, tempo médio de conclusão de tarefa.
3. **Gráfico de tarefas por período** — barras mensais (concluídas vs. criadas), últimos 6–12 meses, CSS puro (sem lib externa, mesmo padrão de `_buildProdChart`).
4. **Distribuição de status/prioridade** — tarefas atuais por coluna Kanban e por prioridade.
5. **Timeline do projeto** — feed cronológico combinando tarefas concluídas, atendimentos/agenda realizados e implementações entregues, mais recente no topo, com paginação ("carregar mais").
6. **Chat com IA** — caixa de chat no painel; perguntas em linguagem natural respondidas com base no contexto de dados já carregado (sem nova query por pergunta). Histórico mantido só em memória local da sessão, não persistido.

Financeiro/comissão nunca aparece para o cliente — nem nos KPIs nem no chat (o contexto passado à IA já não inclui esses campos quando o solicitante é `client`).

## Chat de IA — resolução de configuração

- **Consultor**: usa a própria `user_ai_config`, comportamento idêntico ao resto do app hoje.
- **Cliente**: usa a `user_ai_config` do **consultor dono do cliente** (resolvido via `user_roles.client_id` → `clients.user_id`). Isso exige que a Edge Function `ai-proxy` use `service_role` internamente para essa resolução (RLS normal bloquearia o cliente de ler a config do consultor) — mesmo padrão já usado na Edge Function `whatsapp-bot`. O cliente nunca configura a própria IA; se o consultor não tiver IA configurada, o resumo/chat ficam ocultos (`isConfigured` reflete a config resolvida, não a do usuário logado).

## Exportação em PDF

Botão "Exportar PDF" gera um PDF via jsPDF com: cabeçalho (cliente + período), cards de KPI, gráfico mensal (como imagem/tabela), timeline resumida. O chat de IA não entra no PDF. Mesmo padrão visual de `generateAgendaReport`.

## Considerações e riscos conhecidos

- **`ai-proxy` precisa de `SUPABASE_SERVICE_ROLE_KEY`** como secret novo (se ainda não tiver) para resolver a config do consultor a partir do cliente — checar antes do deploy, mesma pegadinha já documentada para `whatsapp-bot`.
- **Migration RLS é aditiva e somente leitura** — não deve alterar as policies existentes de `tasks`/`kanban_columns`; só adicionar novas para `clients`/`records`/`agenda_events`/`implementations`/`implementation_clients`, sempre restritas por `user_roles.client_id`.
- **Ocultação de dados financeiros é responsabilidade da camada de apresentação**, não do RLS — o RLS libera a leitura da linha do cliente para conveniência de outros campos (nome, horas contratadas), mas a UI e o prompt de IA precisam filtrar explicitamente `client_pays`/`hourly_rate`/comissão quando `role === 'client'`.
- **Nenhuma tabela nova** — todas as métricas são calculadas sob demanda; se no futuro for necessário comparar com estado passado (ex.: saldo em uma data específica), será preciso revisar essa decisão.
