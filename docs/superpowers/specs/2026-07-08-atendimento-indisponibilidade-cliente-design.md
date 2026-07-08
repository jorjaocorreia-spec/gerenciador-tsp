# Indisponibilidade do Cliente em Atendimentos

## Contexto

Quando o cliente não disponibiliza horário para os atendimentos contratados no mês (por exemplo: Taruma em Junho/2026, 4.75h/8h realizadas), o consultor precisa que:

1. As horas contratadas constem como "aplicadas" no Dashboard/Clientes/Saldo de horas — já que a disponibilidade era do consultor, não dele.
2. Exista um registro documentado, exportável, que possa ser repassado ao cliente como justificativa.
3. Essas horas **não** sejam cobradas de clientes com modelo de cobrança "Por Hora" (só faz sentido contar como "aplicada" para efeito de saldo/consumo de horas contratadas, não para faturamento por hora real trabalhada).
4. Essas horas **não** afetem a Produtividade (meta de apontamentos diários).

## Modelo de dados

Nova coluna na tabela `records` (a mesma tabela usada pela view Atendimentos):

```sql
ALTER TABLE records ADD COLUMN IF NOT EXISTS is_unavailability BOOLEAN DEFAULT false;
```

Quando `is_unavailability = true`:
- `start_time` e `end_time` ficam vazios (`''`) — mesma convenção já usada para eventos "dia inteiro" da Agenda.
- `minutes` é preenchido a partir de um campo de horas decimais informado pelo usuário (ex: `3.5` → `210` minutos), em vez de calculado a partir de início/fim.
- `description` é reaproveitado como campo de justificativa (não há coluna nova para isso).

Registros existentes continuam `is_unavailability = false` por padrão — nenhuma mudança de comportamento retroativa.

## UI — Atendimentos

**Modal de novo/editar Atendimento:**
- Novo checkbox: "Indisponibilidade do Cliente (horas perdidas)".
- Ao marcar:
  - Campos "Hora Início"/"Hora Fim" são ocultados.
  - Novo campo numérico "Quantidade de horas perdidas" (aceita decimais) aparece no lugar, convertido para minutos ao salvar (`horas * 60`).
  - O rótulo do campo de descrição muda para "Justificativa" (mesmo campo, texto do label diferente).
  - Cliente e data continuam obrigatórios.
- Ao desmarcar, volta ao formulário padrão de atendimento (Hora Início/Fim, descrição normal).

**Listagem de Atendimentos:**
- Registros com `is_unavailability = true` exibem badge/ícone distintivo (ex: ícone âmbar "⚠ Indisponibilidade do Cliente").
- Coluna de horário mostra "—" em vez de um intervalo de tempo (não houve atendimento real).

**Exportação em PDF (relatório de Atendimentos):**
- Registros de indisponibilidade aparecem destacados com a mesma etiqueta visual, mostrando a justificativa no lugar do horário — essa é a peça usada para documentar/repassar ao cliente.

## Impacto nos cálculos existentes

| Área | Mudança | Motivo |
|------|---------|--------|
| Dashboard / Clientes (`hoursUsed`, %, saldo restante) | Nenhuma alteração de código | Já somam `records.minutes` diretamente; a hora de indisponibilidade passa a contar como "aplicada" automaticamente |
| Saldo de horas (`openSaldoPanel`, `_calcClientBalance`) | Nenhuma alteração de código | Mesma razão acima — usa `records` do cliente sem distinção |
| Financeiro (`store.getFinancialSummary`, `store.getFinancialHistory`) | As queries passam a selecionar também `is_unavailability` e excluir esses registros da soma de minutos usada na fórmula | Essa soma de minutos só é consumida pela fórmula de clientes "Por Hora" (`TSPFinancial.computeEntry`); clientes Fixos pagam valor cheio independente de horas, então excluir da soma tem efeito zero neles e o efeito correto (não cobrar) nos clientes Por Hora |
| Produtividade (`productivity-calc.js`) | Nenhuma alteração | Já é calculada exclusivamente a partir de `apontamentos`, tabela sem nenhuma relação com `records` |

## Fora de escopo

- Não há vínculo com eventos da Agenda (é um lançamento manual independente, como um atendimento normal).
- Não há novo filtro dedicado na tela de Atendimentos para listar só indisponibilidades (a badge visual já resolve a necessidade de documentação).
- Não há geração de texto pronto separado do PDF — a exportação em PDF já existente cobre a necessidade de repasse ao cliente.

## Migration necessária antes do deploy

```sql
ALTER TABLE records ADD COLUMN IF NOT EXISTS is_unavailability BOOLEAN DEFAULT false;
```
