# Vendas Diretas (Financeiro) — Design

Data: 2026-10-09

## Objetivo

Controlar vendas feitas diretamente pelo Jorge, fora dos contratos Tecinco/TSP: **serviços** (à vista ou parcelados) e **mensalidades** (recorrentes). Valores, clientes e totais ficam totalmente separados do Financeiro atual (Tecinco: valor a receber, comissão 43%, histórico de 12 meses). Aqui não há comissão nem consumo de horas; o valor é integral.

O controle responde, por mês: **faturado**, **recebido**, **a receber** e **atrasado**.

## Decisões fechadas

- Cadastro de clientes próprio (`direct_clients`), separado de `clients`.
- Abordagem **híbrida**: parcelas de serviço criadas no cadastro; cobranças de mensalidade criadas sob demanda; tudo em `direct_charges`.
- Mensalidade: geração automática até cancelar; reajuste "a partir de um mês".
- Serviço parcelado: divisão automática igual, com edição individual de cada parcela.
- Separação total: nada se soma aos números Tecinco (sem resumo combinado, sem gráfico misto).
- **Acesso restrito a duas contas**: `jorge.henrique@tecinco.com.br` e `testes@teste.com` (a segunda existe para testes automatizados). Ninguém mais — nem Gerente em Modo Supervisão, nem Portal do Cliente.

## Dados (migration única)

Todas as tabelas com `user_id uuid references auth.users`, RLS ativa.

| Tabela | Campos |
|---|---|
| `direct_clients` | id, user_id, name, contact, notes, active, created_at |
| `direct_contracts` | id, user_id, client_id, kind (`service`\|`subscription`), description, total_amount_cents (serviço), monthly_amount_cents (mensalidade), installments (serviço), due_day, start_month (`YYYY-MM`), cancelled_from (`YYYY-MM`, nulo se ativa), created_at |
| `direct_charges` | id, user_id, contract_id, competence (`YYYY-MM`), due_date, amount_cents, status (`pending`\|`paid`), paid_at, manually_edited bool default false, installment_number (serviço), created_at |
| `direct_contract_adjustments` | id, user_id, contract_id, from_month, new_amount_cents, created_at |

- Valores monetários em **centavos inteiros** (nunca float).
- Índice único `(contract_id, competence)` em `direct_charges` para as mensalidades (idempotência); para serviços a unicidade é `(contract_id, installment_number)`.
- `ON DELETE CASCADE` de contrato para cobranças e ajustes; cliente com contratos não é apagado (só inativado).

### Segurança (barreira real, no banco)

Em cada uma das 4 tabelas, policy `FOR ALL` com `USING` e `WITH CHECK`:

```
user_id = auth.uid()
AND (auth.jwt() ->> 'email') IN ('jorge.henrique@tecinco.com.br', 'testes@teste.com')
```

- Nenhuma policy para papel `manager` ou `client`: Modo Supervisão e Portal do Cliente nunca enxergam esses dados, nem via API direta.
- Lista de e-mails duplicada em uma constante no front (`DIRECT_SALES_ALLOWED_EMAILS`, `js/app.js`) só para exibir/ocultar a aba. Se a lista mudar, atualizar migration (nova) e constante. É conveniência de UI; quem protege o dado é o banco.
- A aba só aparece quando o e-mail da sessão está na lista **e** `store.isManagerView === false`.

## Regras de negócio

Toda a lógica vive em `js/direct-sales-calc.js` (módulo puro, testável via Node, mesmo padrão de `financial-calc.js`).

- **Serviço:** `splitInstallments(totalCents, n)` divide em parcelas iguais; o resto de centavos vai para a última. Uma cobrança por mês a partir da data da 1ª parcela. À vista = 1 parcela. Cada parcela é editável (valor/data) e recebe `manually_edited = true`; se a soma divergir do total, a UI avisa (não bloqueia).
- **Mensalidade:** `ensureCharges(contract, adjustments, existing, untilMonth)` cria cobranças de `start_month` até `min(mês visualizado + 3, mês anterior a cancelled_from)`. Idempotente (`upsert ... ignoreDuplicates` sobre o índice único). Valor da competência = último ajuste com `from_month <= competence`, senão `monthly_amount_cents`.
- **Vencimento:** `due_day` maior que o último dia do mês vira o último dia (31 em fevereiro → 28/29).
- **Reajuste:** insere em `direct_contract_adjustments` e atualiza o valor das cobranças `pending` com `competence >= from_month` e `manually_edited = false`. Cobranças pagas ou editadas manualmente não mudam.
- **Cancelamento:** define `cancelled_from`; apaga cobranças `pending` com `competence >= cancelled_from`. Pagas e anteriores permanecem.
- **Pagamento:** "marcar paga" grava `paid_at` (data escolhida, padrão hoje); é desfazível (volta a `pending`, `paid_at = null`).
- **Atrasado:** `pending` com `due_date < hoje`, **hoje em data local** (nunca `toISOString()`).
- **Totais do mês** (por `competence`): faturado = soma de todas; recebido = soma das `paid`; a receber = soma das `pending`; atrasado = subconjunto das `pending` vencidas.
- **Exclusão de contrato:** só se não houver cobrança paga; confirmação em 2 passos (`_twostepDelete`). Cliente: inativar, não apagar.

## Interface

A view Financeiro ganha `role="tablist"` com duas abas: **Tecinco** (conteúdo atual, inalterado) e **Vendas Diretas** (só para contas permitidas, fora de Modo Supervisão).

Aba Vendas Diretas:

1. Cabeçalho: navegação de mês (padrão do Financeiro), botões "Nova venda", "Nova mensalidade", "Clientes".
2. Quatro cards: Faturado, Recebido, A receber, Atrasado. Atrasado em vermelho só quando > 0. Sem verde em "Recebido" (verde é reservado a delta financeiro).
3. Lista de cobranças do mês: cliente, descrição ("Mensalidade" / "Serviço 2/6"), vencimento, valor, status; filtro Todas/Pendentes/Atrasadas/Pagas; "Marcar paga" com mini-seletor de data; selo textual para atrasadas (não só cor).
4. Gráfico de 12 meses: faturado vs recebido, padrão de `_buildFinanceiroChart`, apenas dados de Vendas Diretas.
5. Tabela de contratos (ativos e encerrados), filtro por cliente; ações editar, reajustar, cancelar, excluir.

Modais (via `openModal`, labels com `for`): Cliente; Nova venda (cliente com criação rápida, descrição, total, nº de parcelas, data da 1ª, prévia editável das parcelas); Nova mensalidade (cliente, descrição, valor mensal, dia de vencimento, mês de início); Reajustar (novo valor, a partir de qual mês); Cancelar (a partir de qual mês, confirmação em 2 passos).

Carregamento: dados buscados só ao abrir a aba, com guard `currentView === 'financeiro'` e aba ativa; não entra no `renderAll()` das outras views. Cache em memória (`_directSales*`) invalidado no logout e em mutações; mutações otimistas seguem o padrão `_ensureAgendaCache`-like (uma Promise de carga compartilhada, mutação aplicada depois).

## Store

Métodos novos em `js/store.js` seguindo a convenção do Proxy de Modo Supervisão: leitura com prefixo `get` (`getDirectClients`, `getDirectContracts`, `getDirectCharges(month)`, `getDirectHistory(12)`), escrita com `add/update/delete/set` (`addDirectClient`, `addDirectService`, `addDirectSubscription`, `markDirectChargePaid`, `adjustDirectContract`, `cancelDirectContract`, ...). Mappers snake→camel `_directClient()`, `_directContract()`, `_directCharge()`.

## Testes

- Unitários Node (`tests/direct-sales-calc.test.js`): divisão de parcelas com resto, vencimento em fevereiro, geração idempotente e colchão de 3 meses, reajuste só em pendentes não editadas, cancelamento preservando pagas, totais e atraso com data local.
- E2E Playwright contra produção: venda parcelada, mensalidade, pagar/desfazer, reajuste, cancelamento; aba visível só para as contas permitidas; aba Tecinco e totais atuais idênticos. Usar `testes@teste.com` (nunca dados reais do Jorge) e limpar os dados criados no fim.
- Isolamento: com uma terceira conta (ex.: `jorjaocorreia@gmail.com`, papel client) as consultas às 4 tabelas voltam vazias/negadas; com Gerente em Modo Supervisão, idem.

## Riscos mapeados

- Geração concorrente (duas abas): índice único + `ignoreDuplicates`.
- Ponto flutuante: centavos inteiros, formatação só na tela.
- Reajuste vs parcelas editadas: flag `manually_edited` protege.
- Mudança da lista de e-mails exige migration + constante.
- Deploy no Easypanel continua manual; migration aplicada via Management API antes do deploy.

## Fora de escopo

Comissão, horas, integração com Tecinco, resumo combinado, notificações de cobrança, emissão de nota/recibo, múltiplas moedas.
