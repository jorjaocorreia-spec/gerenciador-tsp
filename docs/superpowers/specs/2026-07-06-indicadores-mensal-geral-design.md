# Painel de Indicadores — Visão Mensal e Geral

Data: 2026-07-06

## Contexto

O painel de Indicadores (Fase 46) hoje mostra uma única visão acumulada de todo o
histórico do cliente: 4 KPIs (tarefas concluídas, horas consumidas, entregas no
prazo, tempo médio de conclusão), gráfico de evolução dos últimos 12 meses,
distribuição por status/prioridade, timeline dos últimos 60 eventos, resumo/chat
de IA e exportação em PDF. Consultor e cliente (Portal do Cliente) usam a mesma
view (`renderIndicadores()` em `js/app.js`, `getClientIndicators()` /
`_computeClientIndicators()` em `js/store.js`).

Falta uma visão que permita ao cliente acompanhar **o que foi feito num mês
específico**, navegando entre meses, além do panorama geral já existente.

## Objetivo

Dividir o painel em duas abas:

- **Mensal** (aba padrão ao abrir a view): KPIs e timeline recalculados apenas
  para um mês selecionável, com navegação entre meses.
- **Geral**: o que já existe hoje (KPIs acumulados, gráfico de 12 meses,
  distribuição por status/prioridade, timeline geral, IA, PDF).

## Não-objetivos

- Não introduzir novas tabelas nem migrations — tudo calculado em memória a
  partir dos dados já buscados por `getClientIndicators()`.
- Não alterar RLS nem a whitelist de campos financeiros (`safeClient` continua
  sem `clientPays`/`hourlyRate`/`consultantBonus`).
- Não mudar o comportamento da aba Geral além de mover a distribuição de
  status/prioridade e o gráfico de 12 meses para ficarem exclusivos dela (já é
  onde estão hoje — nenhuma mudança de fato, só clareza de que não migram para
  a Mensal).

## Design

### 1. `store.js`

`getClientIndicators(clientId)` mantém as mesmas 6 queries paralelas. Passa a
retornar também um campo `raw` com os arrays já normalizados usados no
cálculo (`tasks`, `records`, `events`, `columns`, `implementations`) — nunca
enviados à IA nem ao PDF, servem só para o recálculo mensal em memória sem
nova query ao trocar de mês.

Nova função pura `_computeMonthlyIndicators(raw, monthStr)` (mesma assinatura
de estilo de `_computeClientIndicators`, testável isoladamente no console):

- Filtra `tasks` concluídas com `completedAt` iniciando em `monthStr`.
- `hoursUsedInMonth` = soma de `records` cujo `date` inicia em `monthStr`,
  convertido para horas.
- `onTimeRateInMonth` e `avgCompletionDaysInMonth`: mesmas fórmulas do painel
  atual, mas o universo de tarefas é só as concluídas naquele mês.
- `timeline`: itens (tarefas concluídas, eventos com `date <= hoje`,
  implementações) cuja data cai em `monthStr` — sem o corte de 60 itens que
  existe na função Geral (esse corte permanece exclusivo dela).
- Não calcula gráfico de 12 meses nem distribuição por status/prioridade —
  ambos continuam exclusivos de `_computeClientIndicators` (Geral).
- Retorna `{ client: safeClient, month: monthStr, kpis: {...}, timeline: [...] }`.

`_computeClientIndicators` (Geral) não muda de comportamento, só passa a
devolver também o `raw` junto do resultado existente.

### 2. `js/app.js` — estado e navegação

Novo estado em `AppController`:

- `this.indicadoresTab = 'mensal'` — aba ativa (`'mensal' | 'geral'`).
- `this.indicadoresMonth` — `YYYY-MM` do mês selecionado na aba Mensal,
  inicializado no mês atual; resetado ao mês atual sempre que o cliente
  selecionado mudar.
- `this._indicadoresChatHistoryMensal` / `this._indicadoresChatHistoryGeral`
  — históricos de chat separados por aba (substituem o único
  `_indicadoresChatHistory` atual). Resetados ao trocar de cliente; o
  histórico Mensal também reseta ao navegar de mês (contexto diferente a cada
  mês, não faz sentido manter histórico misto).

Novos métodos:

- `switchIndicadoresTab(tab)` — troca `indicadoresTab` e re-renderiza a partir
  do `_indicadoresData` já em cache (sem nova query).
- `indicadoresNavMonth(delta)` / `indicadoresGoToCurrentMonth()` — mesmo
  padrão de `dashNavMonth`/`dashGoToCurrentMonth`: não avança além do mês
  atual; re-renderiza só a partir do `raw` em cache.

`renderIndicadores()` continua chamando `store.getClientIndicators(clientId)`
uma única vez por seleção de cliente (cacheado em `this._indicadoresData`,
que agora inclui `raw`). A partir do cache, monta o conteúdo via
`_renderIndicadoresMensalContent(monthlyData)` ou
`_renderIndicadoresGeralContent(data)` conforme `indicadoresTab` — chamando
`store._computeMonthlyIndicators(data.raw, indicadoresMonth)` sob demanda a
cada troca de mês/aba, sem tocar o banco.

### 3. UI

Duas abas (`Mensal` / `Geral`) no topo de `#indicadores-container`, reaproveitando
o padrão visual de abas já usado em outras views do app. Dentro da aba Mensal,
logo abaixo das abas, uma barra de navegação de mês idêntica à do Dashboard
(`◀ Mês/Ano ▶` + botão "Mês atual" que só aparece quando não está no mês
corrente).

**Aba Mensal** contém: KPI grid com as 4 métricas recalculadas para o mês
(tarefas concluídas no mês, horas usadas no mês — valor absoluto, sem
comparação —, taxa de entrega no prazo no mês, tempo médio de conclusão no
mês), timeline filtrada ao mês, resumo/chat de IA próprios e botão de export
PDF próprio.

**Aba Geral** mantém o que já existe hoje: KPIs acumulados, gráfico de 12
meses, distribuição por status/prioridade, timeline geral (cap 60), resumo/chat
de IA e export PDF (idênticos ao atual, sem mudança de comportamento).

### 4. IA (`js/ai.js`)

Novo `_buildIndicadoresMonthContext(monthlyData, monthLabel)`, análogo ao
`_buildIndicadoresContext` existente, mas usando os campos de
`_computeMonthlyIndicators` (sem gráfico de 12 meses nem distribuição).

Novos métodos `generateClientIndicatorsMonthSummary(monthlyData, monthLabel)`
e `chatAboutClientIndicatorsMonth(monthlyData, monthLabel, question, history)`
— mesmas regras de nunca mencionar valores financeiros. Os métodos existentes
(`generateClientIndicatorsSummary`, `chatAboutClientIndicators`) continuam
servindo exclusivamente a aba Geral.

### 5. PDF

Novo `exportIndicadoresMensalPDF()` ao lado do `exportIndicadoresPDF()`
existente (Geral, sem mudança de comportamento) — mesmo padrão de geração
(jsPDF + AutoTable), mas usando os dados/KPIs/timeline do mês selecionado no
título e conteúdo do documento.

## Compatibilidade Portal do Cliente

Nenhuma mudança de RLS ou de whitelist é necessária — tanto a aba Mensal
quanto a Geral operam sobre os mesmos dados já liberados por
`getClientIndicators()` para o papel `client`. A aba padrão (Mensal, mês
atual) vale tanto para consultor quanto para cliente-portal.

## Testes / verificação

- Trocar de aba não deve gerar nova query ao Supabase (verificar via
  DevTools → Network ao clicar em Mensal/Geral e ao navegar entre meses).
- Navegar para um mês antigo com poucas ou nenhuma tarefa/evento deve mostrar
  KPIs zerados/"—" sem erro.
- Não deve ser possível navegar para um mês futuro (botão "próximo" desabilitado
  no mês atual, mesmo padrão do Dashboard).
- Resumo e chat de IA da aba Mensal nunca devem mencionar valores financeiros
  (mesma regra já testada na Geral).
