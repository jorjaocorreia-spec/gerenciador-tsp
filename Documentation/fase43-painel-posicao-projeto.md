# Fase 43 — Painel de Posição de Projeto por Cliente

**Status**: planejado, não implementado (2026-06-05)

**Objetivo**: tela unificada que consolida a posição completa de um cliente — chamados OTOBO, tarefas Kanban, atendimentos, agenda e saldo de horas — equivalente a uma planilha de acompanhamento de projeto, mas viva e automática.

**Motivação**: hoje o usuário precisa navegar entre 4–5 views para ter a visão completa de um cliente.

## Estrutura da view

**Ponto de acesso**: botão "Posição do Projeto" no modal do cliente (nova aba) OU novo item no sidebar (ícone `layout-dashboard`).

**Layout**: painéis por categoria, todos filtrados pelo cliente selecionado:

| Painel | Fonte de dados | Colunas |
|--------|---------------|---------|
| Saldo de Horas | `clients` + `records` | Cota mensal, horas usadas, % consumido, saldo acumulado |
| Chamados OTOBO | `tickets` | Nº ticket, solicitação, resp. T5, status, datas |
| Tarefas (Kanban) | `tasks` | Título, coluna, prioridade, data limite, % checklist |
| Próximos Agendamentos | `agenda_events` | Data, tipo, título, horário, Google Meet |
| Últimos Atendimentos | `records` | Data, início, fim, duração, descrição |

## Campos (inspirados na planilha de referência)

- **Prioridade**: alta/média/baixa herdada do chamado/tarefa; `?` sem prioridade
- **Ticket/Referência**: número do chamado OTOBO ou ID interno
- **Resp. SIGMA / Resp. T5**: `owner` do ticket; campo T5 livre (pode vir de `tasks.description` ou novo `assignee`)
- **Status**: badge colorido (Pendente / Em desenvolvimento / Resolvido / Concluído)
- **Data Entrega**: `due_date` da tarefa ou `date_delivery` a criar em `tickets`

## Interações

- Clicar em chamado/tarefa/agendamento → abre modal existente correspondente
- Botão "Exportar PDF" → jsPDF com todos os painéis
- Botão "Exportar Excel-like" → copiar TSV para área de transferência

## IA (se configurada)

- Botão `✨ Resumo do Projeto` → `aiClient.complete()` com todos os dados → parágrafo de situação, pontos de atenção, próximos passos

## Arquitetura

- **Sem nova tabela** — dados já existem; view é puramente de leitura e agregação
- **Sem nova rota de store** — usar `getTicketsByClient`, `getTasks`, `getAgendaEventsByClientAndRange`, `getRecords` com Promise.all
- `renderProjectDashboard(clientId)` — método em `app.js`; guarded por `currentView === 'project-dashboard'`
- `this._projectDashboardClientId` + `this._projectDashboardData` (cache para export sem re-fetch)
- Filtros: chamados por `linked_client_id`, tarefas por `client_id`, agenda próximos 30d, atendimentos últimos 90d

## Migration SQL

Nenhuma necessária. Opcional para "Data Entrega" nos chamados:
```sql
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS date_delivery DATE;
```

## Itens a decidir

1. Ponto de acesso: aba no modal de cliente vs. item do sidebar?
2. Filtro de período configurável ou janelas fixas (30d agenda, 90d atendimentos)?
3. PDF: único arquivo com todos os painéis ou um PDF por painel?
4. "Responsável T5" nos chamados: usar `owner` do OTOBO ou criar campo novo?
