# Produtividade — Correção do "ritmo esperado até hoje" — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir o cálculo de "ritmo esperado" do card de período (Semana/Mês) em Produtividade para não contar a meta do dia de hoje (em andamento) como já devida.

**Architecture:** Extrair o cálculo de `expectedToDate` para uma função pura em `js/productivity-calc.js` (mesmo padrão de `computeAccumulatedBalance`), cobri-la com teste unitário Node, e trocar a fórmula inline em `js/app.js` por uma chamada a essa função. Ajustar dois textos de UI ("até hoje" → "até ontem") e atualizar a documentação de armadilhas em CLAUDE.md.

**Tech Stack:** JavaScript vanilla ES6+, teste unitário via `node` + `assert` (sem framework), Playwright para verificação visual pós-deploy.

## Global Constraints

- Nenhuma nova tabela ou coluna no Supabase — esta correção é puramente de lógica de cálculo + texto, sem mudança de schema.
- A função `computeExpectedToDate` deve seguir exatamente o padrão de exportação já usado em `js/productivity-calc.js` (objeto `TSPProductivity` anexado a `global`/`window`).
- Não alterar `computeAccumulatedBalance` nem o gráfico "Realizado vs Meta por dia" — ambos já estão corretos e fora do escopo desta correção.
- Deploy em produção é manual (webhook do Easypanel está quebrado) — após o push, o usuário precisa fazer o deploy manualmente antes da verificação Playwright em produção.

---

### Task 1: Função pura `computeExpectedToDate` em `productivity-calc.js`

**Files:**
- Modify: `js/productivity-calc.js`
- Test: `tests/productivity-calc.test.js`

**Interfaces:**
- Produces: `TSPProductivity.computeExpectedToDate(days, todayStr)` — `days` é um array de objetos `{ date: 'YYYY-MM-DD', targetMinutes: number, ... }` (mesmo formato retornado por `computeRange().days` / usado em `summary.period.days`); `todayStr` é uma string `'YYYY-MM-DD'`. Retorna um `number` (minutos) — soma de `targetMinutes` de todos os dias com `date < todayStr`.

- [ ] **Step 1: Escrever o teste que falha**

Abrir `tests/productivity-calc.test.js` e adicionar, antes da linha `console.log('productivity-calc.test.js: todos os testes passaram');`:

```javascript
// computeExpectedToDate — exclui o dia de hoje do esperado
const daysForExpected = [
    { date: '2026-06-15', targetMinutes: 528 },
    { date: '2026-06-16', targetMinutes: 528 },
    { date: '2026-06-17', targetMinutes: 528 },
    { date: '2026-06-18', targetMinutes: 528 },
    { date: '2026-06-19', targetMinutes: 528 },
];
// hoje = 17/06: soma só 15/06 e 16/06 (dias antes de hoje), nunca o próprio dia 17
assert.strictEqual(P.computeExpectedToDate(daysForExpected, '2026-06-17'), 528 * 2);
// hoje = 15/06 (primeiro dia do período): nenhum dia anterior -> 0
assert.strictEqual(P.computeExpectedToDate(daysForExpected, '2026-06-15'), 0);
// hoje = 20/06 (depois do período inteiro): soma todos os 5 dias
assert.strictEqual(P.computeExpectedToDate(daysForExpected, '2026-06-20'), 528 * 5);
// dias sem meta (fim de semana/feriado, targetMinutes=0) não somam nada
const daysWithWeekend = [
    { date: '2026-06-19', targetMinutes: 528 },
    { date: '2026-06-20', targetMinutes: 0 }, // sábado
    { date: '2026-06-21', targetMinutes: 0 }, // domingo
    { date: '2026-06-22', targetMinutes: 528 },
];
assert.strictEqual(P.computeExpectedToDate(daysWithWeekend, '2026-06-22'), 528);
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node tests/productivity-calc.test.js`
Expected: erro `TypeError: P.computeExpectedToDate is not a function`

- [ ] **Step 3: Implementar a função**

Em `js/productivity-calc.js`, adicionar a função depois de `computeAccumulatedBalance` (depois da linha 73, antes de `function getPeriodRange`):

```javascript
    function computeExpectedToDate(days, todayStr) {
        return days.filter(d => d.date < todayStr).reduce((s, d) => s + d.targetMinutes, 0);
    }
```

E adicionar `computeExpectedToDate` à lista exportada em `global.TSPProductivity` (linha ~104-107):

```javascript
    global.TSPProductivity = {
        minutesBetween, isWorkday, dailyTargetMinutes, getHolidayName, computeDay, computeRange,
        computeAccumulatedBalance, computeExpectedToDate, getPeriodRange, fmtMinutes, toIsoLocal, addDaysLocal
    };
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node tests/productivity-calc.test.js`
Expected: `productivity-calc.test.js: todos os testes passaram` (sem erros, exit code 0)

- [ ] **Step 5: Commit**

```bash
git add js/productivity-calc.js tests/productivity-calc.test.js
git commit -m "fix: exclui dia em andamento do calculo de ritmo esperado em Produtividade"
```

---

### Task 2: Usar `computeExpectedToDate` em `_buildProdPeriodCard` + ajustar textos

**Files:**
- Modify: `js/app.js:5904` (cálculo), `js/app.js:5926` (tooltip), `js/app.js:5931` (legenda)

**Interfaces:**
- Consumes: `TSPProductivity.computeExpectedToDate(days, todayStr)` (produzido na Task 1).

- [ ] **Step 1: Substituir o cálculo inline**

Em `js/app.js`, dentro de `_buildProdPeriodCard(summary)`, no branch `else if (periodInProgress) {`, localizar:

```javascript
            const expectedToDate = p.days.filter(d => d.date <= summary.todayStr).reduce((s, d) => s + d.targetMinutes, 0);
```

Substituir por:

```javascript
            const expectedToDate = TSPProductivity.computeExpectedToDate(p.days, summary.todayStr);
```

- [ ] **Step 2: Ajustar o tooltip do marcador**

Na mesma função, localizar:

```javascript
            paceMarkerHtml = `<div title="Meta esperada até hoje: ${this._prodFmtAbs(expectedToDate)}" style="position:absolute;top:-3px;bottom:-3px;left:${pacePct}%;width:3px;background:rgba(255,255,255,0.9);border-radius:1px;box-shadow:0 0 0 1px rgba(0,0,0,0.4);"></div>`;
```

Substituir `"Meta esperada até hoje:` por `"Meta esperada até ontem:`:

```javascript
            paceMarkerHtml = `<div title="Meta esperada até ontem: ${this._prodFmtAbs(expectedToDate)}" style="position:absolute;top:-3px;bottom:-3px;left:${pacePct}%;width:3px;background:rgba(255,255,255,0.9);border-radius:1px;box-shadow:0 0 0 1px rgba(0,0,0,0.4);"></div>`;
```

- [ ] **Step 3: Ajustar a legenda**

Localizar:

```javascript
            legendHtml = `<span class="text-muted">${pct}% realizado · ${pacePct}% esperado até hoje</span>`;
```

Substituir por:

```javascript
            legendHtml = `<span class="text-muted">${pct}% realizado · ${pacePct}% esperado até ontem</span>`;
```

- [ ] **Step 4: Confirmar que não restou nenhuma ocorrência antiga**

Run: `Select-String -Path js\app.js -Pattern "esperado até hoje"`
Expected: nenhuma linha encontrada (output vazio)

- [ ] **Step 5: Commit**

```bash
git add js/app.js
git commit -m "fix: usa computeExpectedToDate no card de periodo e ajusta texto para 'esperado até ontem'"
```

---

### Task 3: Atualizar documentação de armadilhas em `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Localizar e substituir a entrada de armadilha desatualizada**

Em `CLAUDE.md`, localizar o parágrafo (na seção de armadilhas de Produtividade):

```
- **Produtividade: barra do card do período tem 3 estados de ritmo, não 2** — `_buildProdPeriodCard()` calcula `expectedToDate` (soma de `targetMinutes` de `p.days` com `date <= summary.todayStr`) e classifica em 3 faixas, só quando `periodInProgress` (`this.prodPeriod !== 'day'` e hoje dentro de `[p.startDate, p.endDate]`): **vermelho** se `actualMinutes < expectedToDate` (atrasado em relação ao ritmo); **azul/ciano** (`#38bdf8`/`#0ea5e9`, cor exclusiva desse estado — não reutilizar em outro contexto da Produtividade) se `actualMinutes >= expectedToDate` mas ainda `< targetMinutes` (no ritmo, meta total ainda não atingida); **verde** se `actualMinutes >= targetMinutes` (meta do período batida ou superada). Em Dia ou em períodos totalmente passados/futuros (`!periodInProgress`), volta ao binário simples vermelho/verde por `p.deltaMinutes`. Nunca comparar `actualMinutes` só com `targetMinutes` (meta total) para decidir a cor durante o período em andamento — é exatamente esse cálculo que fazia a barra parecer "sempre atrasada" antes desta correção.
```

Substituir por (acrescenta a explicação da exclusão do dia de hoje e remove a referência à fórmula antiga `<=`):

```
- **Produtividade: barra do card do período tem 3 estados de ritmo, não 2** — `_buildProdPeriodCard()` calcula `expectedToDate` via `TSPProductivity.computeExpectedToDate(p.days, summary.todayStr)` (soma de `targetMinutes` apenas dos dias com `date < todayStr` — o dia de hoje, em andamento, NUNCA conta no esperado, mesmo que já tenha passado boa parte do expediente) e classifica em 3 faixas, só quando `periodInProgress` (`this.prodPeriod !== 'day'` e hoje dentro de `[p.startDate, p.endDate]`): **vermelho** se `actualMinutes < expectedToDate` (atrasado em relação ao ritmo); **azul/ciano** (`#38bdf8`/`#0ea5e9`, cor exclusiva desse estado — não reutilizar em outro contexto da Produtividade) se `actualMinutes >= expectedToDate` mas ainda `< targetMinutes` (no ritmo, meta total ainda não atingida); **verde** se `actualMinutes >= targetMinutes` (meta do período batida ou superada). Em Dia ou em períodos totalmente passados/futuros (`!periodInProgress`), volta ao binário simples vermelho/verde por `p.deltaMinutes`. Nunca comparar `actualMinutes` só com `targetMinutes` (meta total) para decidir a cor durante o período em andamento — é exatamente esse cálculo que fazia a barra parecer "sempre atrasada" antes desta correção. No primeiro dia de um período (nenhum dia anterior ainda), `expectedToDate = 0` e a barra começa no estado azul ("no ritmo") mesmo sem nada lançado — comportamento esperado, consistente com `computeAccumulatedBalance`. Textos da UI dizem "esperado até ontem" (não "até hoje") para deixar isso explícito.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: atualiza armadilha de Produtividade sobre expectedToDate excluir hoje"
```

---

### Task 4: Push, deploy manual e verificação em produção

**Files:**
- Nenhum arquivo novo — apenas operações de git/deploy/verificação.

- [ ] **Step 1: Push para o GitHub**

```bash
git push origin main
```

- [ ] **Step 2: Avisar o usuário para fazer o deploy manual**

Informar: "Push feito. Por favor, faça o deploy manual no Easypanel (serviço `gerenciador-tsp`) antes de eu validar em produção — o webhook automático está quebrado."

Aguardar confirmação do usuário de que o deploy foi concluído antes do próximo passo.

- [ ] **Step 3: Escrever script de verificação Playwright**

Criar `C:\Users\jorge\AppData\Local\Temp\playwright-test-prod-pace.js`:

```javascript
const { chromium } = require('playwright');

const TARGET_URL = 'https://jorge-gerenciador-tsp.27pl2o.easypanel.host';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto(TARGET_URL);
  await page.fill('input[type="email"]', 'jorjaocorreia@gmail.com');
  await page.fill('input[type="password"]', 'Jhc1881//');
  await page.click('button[type="submit"]');
  await page.waitForSelector('#app-container, .sidebar', { timeout: 15000 }).catch(() => {});

  await page.click('[data-view="productivity"], a[href="#productivity"], text=Produtividade');
  await page.waitForTimeout(1500);

  // garante que estamos na visão Semana (onde periodInProgress costuma ocorrer)
  await page.click('text=Semana').catch(() => {});
  await page.waitForTimeout(1000);

  const bodyText = await page.textContent('body');
  const hasOldWording = bodyText.includes('esperado até hoje');
  const hasNewWording = bodyText.includes('esperado até ontem');

  console.log('Contém texto antigo ("esperado até hoje")?', hasOldWording);
  console.log('Contém texto novo ("esperado até ontem")?', hasNewWording);

  await page.screenshot({ path: 'C:\\Users\\jorge\\AppData\\Local\\Temp\\produtividade-pace-check.png', fullPage: true });
  console.log('Screenshot salvo em produtividade-pace-check.png');

  await browser.close();

  if (hasOldWording) {
    console.error('FALHA: texto antigo ainda presente.');
    process.exit(1);
  }
  console.log('OK: nenhuma ocorrência do texto antigo encontrada.');
})();
```

- [ ] **Step 4: Executar o script**

Run:
```
cd "d:\GerenciadorTSP\skills\playwright-skill"
node run.js "C:\Users\jorge\AppData\Local\Temp\playwright-test-prod-pace.js"
```
Expected: `OK: nenhuma ocorrência do texto antigo encontrada.` no console e o screenshot salvo confirmando visualmente o card de período exibindo "esperado até ontem" (quando a visão Semana estiver com `periodInProgress` verdadeiro).

Observação: se a view "Semana" do usuário não estiver em `periodInProgress` no momento do teste (ex.: navegou para outra semana), o texto "esperado até ontem"/"até hoje" não aparece — nesse caso a verificação de "nenhuma ocorrência do texto antigo" ainda é válida (não há regressão), mas a confirmação visual completa deve ser feita olhando o screenshot e garantindo que a semana exibida inclui o dia de hoje.

- [ ] **Step 5: Reportar resultado ao usuário**

Resumir ao usuário: lógica corrigida e coberta por teste unitário (Task 1), textos atualizados, CLAUDE.md atualizado, e verificação em produção confirmando a nova redação sem regressão.
