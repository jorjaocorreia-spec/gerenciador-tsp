# Design: Cobrança "Por Hora" por cliente

## Contexto

Hoje, todo cliente tem um modelo de cobrança fixo: campo `client_pays` (valor mensal digitado manualmente) e o consultor recebe 43% desse valor + um bônus opcional (`consultant_bonus`). Isso não serve para clientes cobrados por hora trabalhada — o valor faturado deveria ser calculado a partir das horas realmente apontadas no mês, não digitado.

Esta feature adiciona um segundo modelo de cobrança, "Por Hora", que coexiste com o modelo "Valor Fixo" atual. Cada cliente usa um dos dois modelos, nunca os dois ao mesmo tempo.

## Decisões

- **Coexistência de modelos**: o modelo atual (`client_pays` + comissão 43%) não é alterado. Um novo modelo "Por Hora" é adicionado como alternativa por cliente.
- **Fonte das horas**: apenas Atendimentos (tabela `records`) — a mesma fonte já usada para `hoursUsed` em `_computeClientStats`/`getBatchStats`. Não inclui horas de Tarefas.
- **Período**: mês atual, mesmo padrão usado no Dashboard/Clientes (`hoursUsed` já é filtrado por mês em `getBatchStats`).
- **Sem comissão no modelo Por Hora**: não há cálculo de 43% nem de bônus adicional para clientes nesse modelo — apenas o valor total faturado (`horas × valor/hora`).
- **Exibição**: tela Clientes (substitui o bloco "Paga/Recebe" por "Valor/hora" + "Faturado no mês") e Dashboard (linha extra nos cards, nos dois modos: mensal e "Totalizar Horas").

## Modelo de dados

Migration na tabela `clients`:

```sql
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS billing_model TEXT DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC DEFAULT 0;
```

- `billing_model`: `'fixed'` (comportamento atual, default) ou `'hourly'` (novo).
- `hourly_rate`: valor em R$ por hora, usado apenas quando `billing_model === 'hourly'`.
- Clientes existentes ficam com `billing_model = 'fixed'` automaticamente — nenhuma mudança de comportamento ou de UI para eles.

## UI — Modal de Cliente (`index.html` + `js/app.js`)

Novo radio/toggle "Modelo de Cobrança" inserido logo após o campo Status, com duas opções:

- **Valor Fixo** (default, selecionado para clientes existentes) — mantém visível o bloco atual: Cliente Paga, Recebe 43%, Valor Adicional, Total Consultor. Sem mudanças nesse caminho.
- **Por Hora** — esconde o bloco atual de 4 campos e mostra um único campo novo: **"Valor por Hora (R$)"**.

Novo método `toggleBillingModel()` (mesmo padrão de `toggleAllDayAgenda`/`toggleAllDayRule`) alterna a visibilidade dos dois blocos via `style.display`, chamado no `change` dos radios e em `openEditClient()` para refletir o modelo salvo do cliente.

`handleClientSubmit()` lê o radio selecionado e monta os parâmetros adequados:
- modelo `fixed`: comportamento atual (`clientPays`, `consultantBonus`).
- modelo `hourly`: `hourlyRate`; `clientPays`/`consultantBonus` ficam `0`/vazios para esse cliente.

## Store (`js/store.js`)

- `_client()`: mapper passa a retornar também `billingModel: r.billing_model || 'fixed'` e `hourlyRate: parseFloat(r.hourly_rate) || 0`.
- `addClient()` / `updateClient()`: recebem 2 novos parâmetros (`billingModel`, `hourlyRate`) e os persistem em `billing_model`/`hourly_rate`. Mantém a convenção posicional já usada nessas funções (lista de parâmetros já longa — não introduzir refactor para objeto de opções nesta feature, fora de escopo).

## Cálculo

Sem custo de query adicional. `_computeClientStats()` já calcula `hoursUsed` (minutos do mês / 60) tanto em `getBatchStats()` (Dashboard/Clientes) quanto em `getClientStats()` (fallback individual). Para clientes com `billingModel === 'hourly'`:

```js
const monthlyValue = hoursUsed * client.hourlyRate;
```

Calculado no momento da renderização (em `renderClients()` e `renderDashboard()`), não armazenado no banco.

## Exibição

### Tela Clientes (`renderClients()`)

Para clientes `billing_model === 'fixed'`: bloco atual inalterado (`Paga: R$ X | Recebe: R$ Y`).

Para clientes `billing_model === 'hourly'`: bloco substituído por:
```
Valor/hora: R$ 150,00 | Faturado no mês: R$ 4.500,00 (30h apontadas)
```
Usando `<span class="money-value">` nos valores monetários, para respeitar o toggle existente de ocultar dinheiro (`sessionStorage.moneyHidden`).

### Dashboard (`renderDashboard()`)

Card normal (modo mensal) e card do modo "Totalizar Horas": para clientes `hourly`, adiciona uma linha extra abaixo da barra de progresso com o valor faturado no período exibido, também com `class="money-value"`. Cards de clientes `fixed` permanecem idênticos aos atuais (sem nenhum valor monetário, como é hoje).

## Fora de escopo

- Exportação em PDF/relatórios — nenhum PDF/relatório existente usa `client_pays` hoje, então nada precisa ser alterado ali.
- Comissão customizada (%) para o modelo Por Hora — descartado; modelo Por Hora não tem nenhuma divisão consultor/empresa, só o valor total faturado.
- Inclusão de horas de Tarefas no cálculo — descartado; só Atendimentos.
- Refactor do parâmetro posicional longo de `addClient`/`updateClient` para objeto — fora de escopo, seguir o padrão existente.

## Arquivos afetados

- `js/store.js`: `_client()`, `addClient()`, `updateClient()`.
- `js/app.js`: `handleClientSubmit()`, `openEditClient()`, novo `toggleBillingModel()`, `renderClients()`, `renderDashboard()`.
- `index.html`: novo radio "Modelo de Cobrança" + campo "Valor por Hora" no modal de cliente.
- `CLAUDE.md`: documentar a migration SQL obrigatória antes do deploy (padrão do projeto) e novas armadilhas, se surgirem durante a implementação.
