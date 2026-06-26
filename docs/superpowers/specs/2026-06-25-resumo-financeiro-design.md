# Design: Resumo Financeiro Mensal

## Contexto

Hoje não existe nenhuma visão consolidada de quanto há a receber por mês, somando todos os clientes. A informação existe espalhada: tela Clientes mostra "Paga/Recebe" (Fixo) ou "Faturado no mês" (Por Hora) cliente a cliente, sem total agregado e sem histórico.

Esta feature adiciona uma nova view "Financeiro" que consolida, por mês, o valor total a receber (bruto, todos os clientes) e a comissão do consultor (apenas clientes com modelo Fixo), além de um gráfico comparativo dos últimos 12 meses.

## Decisões

- **Nova view dedicada** no menu lateral ("Financeiro"), não um painel dentro do Dashboard.
- **Sem persistência de novos dados** — cálculo é feito em tempo real a partir de `clients` + `records`, sem nova tabela nem migration. Reaproveita os campos já existentes de `billingModel`, `clientPays`, `consultantBonus`, `hourlyRate`.
- **Sem controle de pagamento/conciliação** (pago vs pendente) — fora de escopo desta fase; o resumo mostra apenas o valor a receber calculado, não o status de recebimento.
- **Elegibilidade de cliente "Finalizado"**: como não existe histórico de mudança de status (só o status atual), a regra adotada é uma aproximação:
  - Para o **mês atual ou futuro**: só entra se `status === 'active'`.
  - Para **meses passados** (antes do mês atual): entra independente do status atual, desde que `createdAt` seja `<=` ao fim do mês em questão. Isso assume que o cliente esteve ativo desde a criação até ser finalizado — não é 100% fiel ao histórico real, mas é a melhor aproximação possível sem rastrear histórico de status.
- **Cliente Fixo**: conta o valor cheio (`clientPays`) em todo mês elegível, independente de ter ou não atendimento lançado naquele mês (cobrança recorrente, não vinculada a uso).
- **Cliente Por Hora**: conta `horasApontadasNoMês × hourlyRate`; se não houve atendimento no mês, aparece na tabela com valor R$ 0,00 (não é omitido).
- **Comissão do consultor**: só se aplica a clientes Fixo, replicando a fórmula já usada em `renderClients()` (`js/app.js:2337-2339`): `clientPays * 0.43 + (consultantBonus || 0)`. Clientes Por Hora não geram linha de comissão (mesma regra já documentada para o modelo Por Hora).
- **Histórico**: gráfico de barras dos últimos 12 meses (valor bruto total, sem breakdown de comissão), navegável para trás/frente em janelas de 12 meses, no mesmo padrão visual/de navegação já usado em Produtividade (`_buildProdChart`) e Agenda.
- **Sem exportação em PDF** nesta fase.

## Store (`js/store.js`)

### `getFinancialSummary(year, month)`

Calcula o resumo de um único mês:

1. Busca todos os `clients` do usuário (já existe via `getClients()` ou query direta).
2. Busca `records` (`client_id, minutes, date`) filtrados pelo mês (`date` dentro do range do mês), apenas para os clientes com `billingModel === 'hourly'` — mesmo padrão leve de campos já usado em `getBatchStats()`.
3. Para cada cliente, aplica a regra de elegibilidade (ver Decisões) e calcula:
   - Fixo elegível: `{ valor: clientPays, comissao: clientPays * 0.43 + (consultantBonus||0), detalhe: null }`.
   - Por Hora elegível: `{ valor: horasNoMes * hourlyRate, comissao: 0, detalhe: { horas: horasNoMes, rate: hourlyRate } }`.
   - Não elegível: cliente omitido do resultado.
4. Retorna `{ items: [{ client, valor, comissao, detalhe }], totalValor, totalComissao }`.

### `getFinancialHistory(monthsBack = 12, endYear, endMonth)`

Calcula a série histórica para o gráfico:

1. Busca todos os `clients` (uma vez).
2. Busca `records` (`client_id, minutes, date`) cobrindo a janela completa (`date >= primeiro dia do mês mais antigo` e `<= último dia do mês mais recente`) — uma única query, nunca uma por mês.
3. Agrupa os registros em memória por `YYYY-MM` e por `client_id` (soma de minutos).
4. Para cada um dos N meses da janela, repete a mesma lógica de elegibilidade e soma de `getFinancialSummary`, mas usando os dados já carregados em memória (sem nova query por mês).
5. Retorna `[{ year, month, totalValor }]` ordenado cronologicamente.

Ambos os métodos seguem o padrão existente de mappers (`_client()`) e não introduzem nenhuma tabela nova.

## UI — Nova view "Financeiro"

### Menu lateral

Novo item de navegação (ícone `circle-dollar-sign` ou `wallet`, Lucide), com `<span class="nav-label">Financeiro</span>` e `title="Financeiro"` (padrão de colapso do sidebar).

### Estrutura da view (`renderFinanceiro()`, guard `currentView === 'financeiro'`)

**Bloco 1 — Tabela do mês selecionado**

- Navegação `< Mês Atual >` (mesmo padrão de mês usado em Produtividade), estado em `this.financeiroRefDate` (instância de `AppController`, inicializado no mês atual no construtor).
- Tabela:

| Cliente | Modelo | Detalhe | Valor a receber | Comissão consultor |
|---|---|---|---|---|
| ... | Fixo / Por Hora | — / "Xh × R$Y" | `class="money-value"` | `class="money-value"` ou "—" para Por Hora |

- Linha de totais ao final: soma de "Valor a receber" (todos os modelos) e soma de "Comissão consultor" (apenas Fixo).
- Valores monetários sempre em `<span class="money-value">` para respeitar o toggle `sessionStorage.moneyHidden`.

**Bloco 2 — Gráfico histórico (12 meses)**

- Reaproveita o estilo visual de `_buildProdChart` (barras, grid escuro, tema do app).
- Eixo X: meses abreviados (`Jan/26`, `Fev/26`, ...). Eixo Y: valor total a receber (bruto).
- Tooltip nativo (`title`) por barra com o valor exato em R$.
- Navegação `<` `>` desliza a janela de 12 meses (estado em `this.financeiroHistEndDate`).
- A barra correspondente ao mês selecionado no Bloco 1 é destacada com cor diferenciada.

## Cálculos e fórmulas (consolidado)

```js
// Fixo
valor = client.clientPays;
comissao = client.clientPays * 0.43 + (client.consultantBonus || 0);

// Por Hora
const minutosNoMes = sum(records do cliente no mês);
const horas = minutosNoMes / 60;
valor = horas * client.hourlyRate;
comissao = 0;
```

## Fora de escopo

- Controle de pagamento/conciliação (pago vs pendente) — não há campo nem UI para marcar recebimento.
- Persistência/snapshot histórico — se o `hourlyRate` ou `clientPays` de um cliente mudar, o histórico recalculado reflete o valor *atual* desses campos para os registros de horas passados (não há "congelamento" de valores). Isso é aceitável nesta fase pois não há ainda necessidade de auditoria financeira imutável.
- Exportação em PDF.
- Rastreamento de histórico de mudança de `status` do cliente — a aproximação descrita em Decisões é o melhor possível sem essa informação.

## Arquivos afetados

- `js/store.js`: novos métodos `getFinancialSummary(year, month)` e `getFinancialHistory(monthsBack, endYear, endMonth)`.
- `js/app.js`: novo `renderFinanceiro()`, navegação de mês (`financeiroPrevMonth()`/`financeiroNextMonth()`), navegação de histórico, novo bloco de gráfico (reaproveitando padrão de `_buildProdChart`), registro da nova view em `switchView()`/`renderAll()`.
- `index.html`: novo item de navegação no sidebar + nova `<section class="view-section">` para "Financeiro" (tabela + gráfico).
- `CLAUDE.md`: documentar a nova view, os métodos do store e a regra de aproximação de elegibilidade para clientes finalizados.
