# Produtividade — Correção do "ritmo esperado até hoje" — Design

**Data**: 2026-06-18
**Status**: Aprovado para implementação

## Problema

Na barra de progresso do card de período (Semana/Mês) em `_buildProdPeriodCard()` (`js/app.js`), o cálculo de `expectedToDate` soma o `targetMinutes` de **todos os dias com `date <= todayStr`**, incluindo o dia de hoje por completo — mesmo que o expediente de hoje ainda não tenha terminado.

Resultado: logo de manhã, antes de lançar qualquer apontamento, o usuário já aparece "abaixo do ritmo esperado" porque a meta inteira de hoje já está contabilizada como devida. Isso dá uma falsa impressão de improdutividade nas primeiras horas do dia.

O card "Saldo Acumulado" já não tem esse problema — `computeAccumulatedBalance()` em `js/productivity-calc.js` corta o intervalo em "ontem" (`yesterday`), nunca incluindo o dia em andamento. O bug é isolado ao cálculo de ritmo (`pace`) do card de período.

## Decisão

Excluir o dia de hoje do cálculo de `expectedToDate`, replicando o mesmo corte que `computeAccumulatedBalance()` já usa. "Esperado" passa a significar "soma das metas diárias de todos os dias *antes* de hoje, dentro do período" — nunca inclui a meta do dia em andamento.

Hoje continua contribuindo normalmente ao `actualMinutes` (o que já foi lançado hoje conta no progresso/barra), só não conta no lado "esperado".

## Mudanças

### 1. `js/productivity-calc.js` — nova função pura

```js
function computeExpectedToDate(days, todayStr) {
    return days.filter(d => d.date < todayStr).reduce((s, d) => s + d.targetMinutes, 0);
}
```

Exportada em `TSPProductivity` junto das demais (`computeAccumulatedBalance`, `computeRange`, etc.), seguindo o padrão existente de manter a lógica de cálculo fora de `app.js`.

### 2. `js/app.js` — `_buildProdPeriodCard()`

Linha 5904, dentro do branch `periodInProgress`:

```js
// antes
const expectedToDate = p.days.filter(d => d.date <= summary.todayStr).reduce((s, d) => s + d.targetMinutes, 0);

// depois
const expectedToDate = TSPProductivity.computeExpectedToDate(p.days, summary.todayStr);
```

Nenhuma outra variável do branch (`pacePct`, `paceDelta`, `tierColor`, `tierMessage`, `barColor`, `youPct`, `pct`) muda de fórmula — todas continuam consumindo `expectedToDate` como já faziam, apenas com o valor corrigido.

### 3. Texto — "até hoje" → "até ontem"

Dois pontos em `_buildProdPeriodCard()` mencionam "até hoje" referindo-se a este número; ambos passam a dizer "até ontem" para deixar explícito que o valor não inclui o dia em andamento:

- Tooltip do marcador (linha ~5926): `title="Meta esperada até hoje: ..."` → `title="Meta esperada até ontem: ..."`
- Legenda (linha ~5931): `"${pct}% realizado · ${pacePct}% esperado até hoje"` → `"${pct}% realizado · ${pacePct}% esperado até ontem"`

A mensagem de ritmo (`tierMessage`, ex.: "X abaixo do ritmo esperado — acelere...") não menciona "hoje" e não precisa mudar.

## Caso de borda aceito

No primeiro dia de um período (ex.: segunda-feira de manhã, início da semana), não há nenhum dia anterior dentro do período, então `expectedToDate = 0`. A barra de ritmo começa no estado "no ritmo" (azul) mesmo sem nada lançado ainda — comportamento correto, pois não existe ainda nenhum dia completo "devido". Consistente com o que já acontece no Saldo Acumulado.

## Fora de escopo

- Pro-rateamento de hoje por horário de trabalho (ex.: considerar fração do expediente já decorrida) — não implementado nesta correção; a decisão aprovada foi excluir hoje inteiramente do "esperado", não estimar parcialmente.
- Qualquer mudança no card "Saldo Acumulado" — já está correto.
- Qualquer mudança no gráfico "Realizado vs Meta por dia" — os marcadores ali representam a meta diária de cada dia individualmente, não o ritmo acumulado; não são afetados por este bug.

## Documentação

A entrada de armadilha em `CLAUDE.md` ("Produtividade: barra do card do período tem 3 estados de ritmo, não 2") documenta a fórmula antiga de `expectedToDate` e deve ser atualizada para refletir a exclusão do dia de hoje, como parte da implementação desta correção.
