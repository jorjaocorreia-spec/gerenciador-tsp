# Vendas Diretas (Financeiro) — Design

Data: 2026-10-09 (revisada após análise crítica no mesmo dia)

## Objetivo

Controlar vendas feitas diretamente pelo Jorge, fora dos contratos Tecinco/TSP: **serviços** (à vista ou parcelados) e **mensalidades** (recorrentes). Valores, clientes e totais ficam totalmente separados do Financeiro atual (Tecinco: valor a receber, comissão 43%, histórico de 12 meses). Aqui não há comissão nem consumo de horas; o valor é integral.

## Decisões fechadas

- Cadastro de clientes próprio (`direct_clients`), separado de `clients`.
- Abordagem **híbrida**: parcelas de serviço criadas no cadastro; cobranças de mensalidade criadas sob demanda; tudo em `direct_charges`.
- Mensalidade: geração automática até cancelar; reajuste "a partir de um mês".
- Serviço parcelado: divisão automática igual, com edição individual de cada parcela.
- Separação total: nada se soma aos números Tecinco (sem resumo combinado, sem gráfico misto).
- **Nada retroativo:** cobranças só existem da data de cadastro para frente. Mensalidade: `start_month` >= mês corrente. Serviço: data da 1ª parcela >= hoje. Para registrar algo já recebido hoje, cadastrar à vista com vencimento hoje e marcar como paga.
- **Acesso restrito a duas contas** (lista fixa de e-mails, sem tabela de acesso): `jorge.henrique@tecinco.com.br` e `testes@teste.com` (esta existe para testes automatizados e **nunca** deve receber dado real, pois a senha dela é pública no repo). Ninguém mais: nem Gerente em Modo Supervisão, nem Portal do Cliente.

## Definições dos totais do mês

- **Faturado:** soma das cobranças com `competence` = mês.
- **A receber:** soma das cobranças `pending` com `competence` = mês.
- **Recebido:** soma das cobranças `paid` com `paid_at` dentro do mês (**data do pagamento**, qualquer competência). Por isso Faturado − Recebido pode não ser igual a A receber; a UI mostra um tooltip `.info-tooltip` explicando.
- **Atrasado:** soma de **todas** as cobranças `pending` com `due_date < hoje`, de qualquer mês (não só o visualizado). "Hoje" em data local, nunca `toISOString()`.
- Gráfico de 12 meses: Faturado (por competência) vs Recebido (por `paid_at`), com o mês final parametrizável (setas de histórico).

## Dados (migration única)

Todas as tabelas com `user_id uuid not null references auth.users`, RLS ativa. Valores monetários em **centavos inteiros**; datas em `DATE` (nunca timestamptz para vencimento/pagamento). `competence` em `text` `YYYY-MM` com CHECK de formato.

| Tabela | Campos e restrições |
|---|---|
| `direct_clients` | id, user_id, name, contact, notes, active, created_at. `UNIQUE (id, user_id)` |
| `direct_contracts` | id, user_id, client_id, kind (`service`\|`subscription`), description, total_amount_cents + installments (só serviço), monthly_amount_cents + due_day (só mensalidade), start_month, cancelled_from (mensalidade; nulo = ativa), created_at. `UNIQUE (id, user_id)`; FK composta `(client_id, user_id)` → `direct_clients(id, user_id)` **ON DELETE RESTRICT** |
| `direct_charges` | id, user_id, contract_id, charge_key, competence, due_date, amount_cents, status (`pending`\|`paid`), paid_at DATE, manually_edited bool default false, created_at. FK composta `(contract_id, user_id)` → `direct_contracts(id, user_id)` ON DELETE CASCADE. **`UNIQUE (contract_id, charge_key)`** não parcial |
| `direct_contract_adjustments` | id, user_id, contract_id, from_month, new_amount_cents, created_at. FK composta idem. `UNIQUE (contract_id, from_month)` (novo ajuste no mesmo mês substitui) |

- `charge_key`: `m:YYYY-MM` (mensalidade) ou `i:N` (parcela N de serviço). Permite `upsert(..., {onConflict:'contract_id,charge_key'})` e não impede duas parcelas de serviço no mesmo mês.
- **FKs compostas `(id, user_id)`** impedem uma conta de apontar para linha de outra (a checagem de FK ignora RLS; sem isso, `testes@teste.com` poderia referenciar um contrato do Jorge, e o CASCADE atingiria dados alheios).
- **CHECK constraints:** `amount_cents >= 0` (e total/mensal > 0), `installments >= 1`, `due_day BETWEEN 1 AND 31`, enums de `kind` e `status`, `(status = 'paid') = (paid_at IS NOT NULL)`, campos obrigatórios por `kind` (serviço exige total e parcelas; mensalidade exige valor mensal, due_day e start_month), formato de `competence`/`start_month`/`from_month`.
- **Trigger BEFORE DELETE em `direct_contracts`:** rejeita a exclusão se houver cobrança `paid` (a regra vale no banco, não só na UI).

### Segurança (barreira real, no banco)

Policy `FOR ALL` com `USING` e `WITH CHECK` em cada tabela:

```
user_id = auth.uid()
AND (auth.jwt() ->> 'email') IN ('jorge.henrique@tecinco.com.br', 'testes@teste.com')
```

- Nenhuma policy para `manager` ou `client`.
- A lista aparece em dois lugares (migration e constante `DIRECT_SALES_ALLOWED_EMAILS` em `js/app.js`, só para exibir a aba). Alterar a lista exige nova migration + deploy. Aceito de propósito (muda raramente); se divergirem, a aba aparece mas o banco nega tudo, nunca o contrário.
- A aba só aparece quando o e-mail da sessão está na lista **e** `store.isManagerView === false`.

## Regras de negócio

Lógica pura em `js/direct-sales-calc.js` (testável via Node, mesmo padrão de `financial-calc.js`).

- **Serviço:** `splitInstallments(totalCents, n)` exige `n >= 1`, divide em parcelas iguais e põe o resto de centavos na última. Uma cobrança por mês a partir da data da 1ª parcela (>= hoje). O dia de vencimento é derivado sempre do dia da 1ª parcela (31 → 28 → 31, sem encadear o clamp). À vista = 1 parcela. `competence` = mês do `due_date`, **recalculada sempre que a data da parcela é editada**.
- **Parcela de serviço editada** (valor/data): `manually_edited = true`. Se a soma divergir do total, a UI avisa (não bloqueia).
- **Mensalidade:** `start_month` >= mês corrente. Vencimento no próprio mês da competência; `due_day` > último dia do mês vira o último dia. Cobranças criadas de `start_month` até `min(mês visualizado + 3, mês anterior a cancelled_from)`.
- **Valor de uma competência** = `amountFor(competence, contract, adjustments)`: o ajuste de maior `from_month <= competence`, senão `monthly_amount_cents`. Função única, usada na geração e no reajuste.
- **Reajuste:** `from_month` deve estar entre `start_month` e antes de `cancelled_from`. Faz upsert do ajuste e **recalcula, com `amountFor`**, cada cobrança `pending` com `competence >= from_month` e `manually_edited = false`. Pagas e editadas manualmente não mudam. Não há "UPDATE em massa com valor fixo", o que evita erro com reajustes fora de ordem.
- **Cancelamento (mensalidade):** define `cancelled_from`; apaga `pending` com `competence >= cancelled_from`. Pagas e anteriores permanecem. Reativar = limpar `cancelled_from` (a geração recria o que faltar). Serviços não têm cancelamento (para encerrar, exclui-se o contrato se não houver parcela paga, ou edita-se/zera-se as parcelas pendentes).
- **Geração atômica:** feita por **função SQL (RPC)** `ensure_direct_charges(contract_id, until_month)` que lê contrato e ajustes na mesma transação, gera de `start_month` (já validado como >= mês de cadastro, então nada é retroativo) até o limite, ignora competências `>= cancelled_from`, e é idempotente via `UNIQUE (contract_id, charge_key)`. Evita corrida entre aba aberta gerando e outra cancelando/reajustando. Trigger BEFORE INSERT em `direct_charges` rejeita `competence >= cancelled_from` do contrato.
- **Pagamento:** "marcar paga" grava `paid_at` (data escolhida, padrão hoje); desfazer volta a `pending` e `paid_at = null`. Desfazer em competência `>= cancelled_from` pede confirmação (vira pendência órfã).
- **Edição de contrato:** só descrição e cliente. Valor muda por reajuste (mensalidade) ou por edição de parcela (serviço). Qualquer **cobrança isolada de mensalidade** pode ter valor e vencimento editados (desconto/juros do mês), com `manually_edited = true`.
- **Exclusão:** de contrato só sem cobrança paga (garantido por trigger) e com `_twostepDelete`. Cliente: inativar, não apagar; inativar cliente com mensalidade ativa é bloqueado (cancelar antes).
- **Fora de escopo:** pagamento parcial de uma cobrança.

## Interface

A view Financeiro ganha `role="tablist"` com **Tecinco** (conteúdo atual, inalterado) e **Vendas Diretas** (só para contas permitidas, fora de Modo Supervisão).

- A aba ativa fica em `this.financeiroTab` (persistida em `sessionStorage`, sobrevive ao `renderAll`). `renderFinanceiro()` despacha pela aba ativa: com "Vendas Diretas" ativa, **não** recarrega dados Tecinco, e vice-versa.
- O **mês é compartilhado** entre as abas (mesmos botões de navegação do cabeçalho).
- Todos os valores novos (cards, lista, prévia de parcelas, tabela de contratos, gráfico) levam a classe `.money-value`, para o botão de ocultar valores funcionar.

Aba Vendas Diretas:

1. Botões "Nova venda", "Nova mensalidade", "Clientes".
2. Quatro cards: Faturado, Recebido, A receber, Atrasado (definições acima). Atrasado em vermelho só quando > 0; sem verde em "Recebido".
3. Lista de cobranças do mês: cliente, descrição ("Mensalidade" / "Serviço 2/6"), vencimento, valor, status; filtro Todas/Pendentes/Atrasadas/Pagas (Atrasadas inclui meses anteriores); "Marcar paga" com seletor de data; selo textual nas atrasadas.
4. Gráfico de 12 meses (Faturado vs Recebido) com builder próprio e duas cores da paleta (sem o verde do par delta), legenda, e mês final parametrizável.
5. Tabela de contratos (ativos e encerrados), filtro por cliente; ações editar, reajustar, cancelar/reativar, excluir.

Modais (via `openModal`, labels com `for`): Cliente; Nova venda (cliente com criação rápida, descrição, total, nº de parcelas, data da 1ª >= hoje, prévia editável das parcelas); Nova mensalidade (cliente, descrição, valor mensal, dia de vencimento, mês de início >= mês corrente); Reajustar; Cancelar (2 passos).

Carregamento só ao abrir a aba (guard por view e por aba ativa), fora do `renderAll()` das outras views. Cache em memória (`_directSales*`) invalidado no logout e nas mutações, com uma Promise de carga compartilhada e mutação otimista aplicada depois.

## Store

Convenção do Proxy de Modo Supervisão: **qualquer método sem prefixo `get`/`_` é tratado como escrita e bloqueado**; portanto métodos de leitura **nunca** escrevem. `getDirectClients`, `getDirectContracts`, `getDirectCharges(month)`, `getDirectOverdue()`, `getDirectHistory(12, endYear, endMonth)`; escrita: `addDirectClient`, `addDirectService`, `addDirectSubscription`, `ensureDirectCharges` (chama a RPC; a UI a chama **antes** do `get`), `markDirectChargePaid`, `updateDirectCharge`, `adjustDirectContract`, `cancelDirectContract`, etc. Mappers snake→camel `_directClient()`, `_directContract()`, `_directCharge()`.

## Testes

- **Unitários Node** (`tests/direct-sales-calc.test.js`): `splitInstallments` (resto, n=1, total < n), clamp de dia 31 sem encadear, competência recalculada após editar data, `amountFor` e reajustes fora de ordem/repetidos no mesmo mês, geração idempotente com colchão e sem retroativo, cancelamento preservando pagas, totais por definição (Recebido por `paid_at`, Atrasado de meses anteriores aparecendo no mês atual), data local.
- **Isolamento (SQL/API):** `jorjaocorreia@gmail.com` (client) e Gerente em Modo Supervisão não leem nem escrevem; **uma conta consultora fora da lista** não consegue inserir linha com o próprio `user_id` (exercita a cláusula de e-mail); `testes@teste.com` não consegue inserir contrato/cobrança apontando para `client_id`/`contract_id` do Jorge (FK composta); exclusão de contrato com cobrança paga é barrada pelo banco.
- **E2E Playwright** (produção, com `testes@teste.com`, limpando os dados no fim): venda parcelada, mensalidade, pagar/desfazer, reajuste, cancelar/reativar, edição de contrato com cobranças existentes, aba visível só para as contas permitidas, aba Tecinco e totais atuais idênticos, botão de ocultar valores cobrindo os valores novos.

## Riscos mapeados

- Concorrência: RPC transacional + `UNIQUE (contract_id, charge_key)` + trigger de cancelamento.
- Ponto flutuante: centavos inteiros.
- Reajuste vs edição manual: `manually_edited`.
- Lista de e-mails duplicada: migration nova + constante ao alterar.
- Conta `testes@teste.com` tem senha pública: sem dados reais nela.
- Deploy no Easypanel continua manual; migration aplicada via Management API antes do deploy.

## Fora de escopo

Comissão, horas, integração com Tecinco, resumo combinado, pagamento parcial, notificações de cobrança, emissão de nota/recibo, múltiplas moedas.
