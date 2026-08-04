# Controle de Comissão — Consultores Customer Success — Design

**Data**: 2026-08-04
**Status**: Aprovado, aguardando plano de implementação

## Contexto

O setor de Customer Success (CS) tem uma comissão mensal calculada a partir de 4 componentes: bônus por ausência de cancelamentos, horas apontadas por consultor, valor total vendido pelo setor e valor de acréscimo de mensalidade das vendas do mês. A quantidade de consultores participantes varia mês a mês (hoje: Lally, Jorge, Gabriel; pode mudar). Todos os valores de entrada (cancelamentos, vendas, mensalidade) são informados manualmente por um Gerente; as horas de cada consultor são buscadas automaticamente dos apontamentos já lançados no sistema.

Os consultores de CS são usuários reais do GerenciadorTSP (role `consultant` ou `manager`, com login próprio). O próprio Gerente pode ser um dos participantes da comissão.

## Decisões de escopo

- **Cliente administrativo único** representa o setor CS: um cliente comum (com `is_cs_project = true`) que, além de continuar contando normalmente nos cálculos de horas/faturamento como qualquer outro cliente, ganha uma seção extra no próprio modal para o Gerente gerenciar a comissão do setor mês a mês. Não é um cliente sintético/fora do sistema — é um cliente real, criado como qualquer outro.
- **Horas por consultor são automáticas, com override manual**: calculadas a partir dos apontamentos de cada consultor filtrados pelo `project_num` do cliente administrativo, pré-preenchidas ao adicionar o participante ao período; o Gerente pode ajustar o valor antes de salvar. Uma vez salvo, o valor fica congelado (não recalcula sozinho depois).
- **Sem "fechamento" de mês** — meses passados continuam editáveis pelo Gerente, mesma filosofia do resto do app (Produtividade, Financeiro).
- **Visibilidade assimétrica**: o Gerente vê e edita tudo (todos os participantes, todos os valores). Um consultor comum só vê a própria linha de resultado — nunca as horas ou o resultado de um colega.
- **Integração com a view Financeiro existente**: a comissão CS aparece como mais uma linha na tabela de clientes de cada consultor participante (somando ao total a receber), não como uma tela/aba nova.

## 1. Modelo de dados

### `clients` (alteração)

```sql
ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_cs_project BOOLEAN DEFAULT FALSE;
```

Checkbox "Este é o projeto de Comissão CS" no modal de Cliente. Quando marcado, o `project_num` desse cliente passa a ser o identificador usado para filtrar os apontamentos de **todos os consultores participantes** (independente de quem é o dono do cliente) na hora de calcular as horas de CS. O cliente continua contando normalmente em Dashboard/Clientes/Financeiro do seu próprio dono — a flag não o remove de nenhum cálculo existente.

Só é esperado **um** cliente com essa flag ativa no sistema. Não há validação de unicidade no banco — é uma convenção de uso, documentada aqui e reforçada na UI (a seção de comissão só é útil/coerente com um único cliente administrativo).

### `cs_commission_periods` (nova)

Um registro por mês de referência.

```sql
CREATE TABLE cs_commission_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_month DATE NOT NULL UNIQUE, -- sempre dia 1 do mês
  cancellations_count INT NOT NULL DEFAULT 0,
  sales_total NUMERIC NOT NULL DEFAULT 0,
  monthly_increase_total NUMERIC NOT NULL DEFAULT 0,
  participant_count INT NOT NULL DEFAULT 0, -- mantido por trigger, ver abaixo
  created_by UUID REFERENCES auth.users NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE cs_commission_periods ENABLE ROW LEVEL SECURITY;
```

### `cs_commission_participants` (nova)

```sql
CREATE TABLE cs_commission_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID REFERENCES cs_commission_periods ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users NOT NULL,
  hours_apontadas NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (period_id, user_id)
);
ALTER TABLE cs_commission_participants ENABLE ROW LEVEL SECURITY;
```

`hours_apontadas` é preenchido automaticamente pelo frontend no momento em que o Gerente adiciona o participante (ver seção 3) e pode ser editado antes de salvar — não é uma coluna calculada/gerada pelo banco.

### Trigger de `participant_count`

```sql
CREATE OR REPLACE FUNCTION sync_cs_commission_participant_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE cs_commission_periods
  SET participant_count = (
    SELECT count(*) FROM cs_commission_participants
    WHERE period_id = COALESCE(NEW.period_id, OLD.period_id)
  )
  WHERE id = COALESCE(NEW.period_id, OLD.period_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

CREATE TRIGGER trg_sync_cs_commission_participant_count
AFTER INSERT OR DELETE ON cs_commission_participants
FOR EACH ROW EXECUTE FUNCTION sync_cs_commission_participant_count();
```

Motivo de cachear a contagem em vez de deixar o frontend contar: a RLS de um consultor comum (seção 2) só permite ler a própria linha em `cs_commission_participants`, então um `count(*)` direto nessa tabela retornaria 1, nunca o total real. Expor `participant_count` diretamente no período (dado não sensível) resolve isso sem vazar as linhas dos colegas.

## 2. RLS

```sql
-- cs_commission_periods
CREATE POLICY "managers_all_cs_periods" ON cs_commission_periods FOR ALL
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'manager'));

CREATE POLICY "participants_read_own_cs_period" ON cs_commission_periods FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM cs_commission_participants p
    WHERE p.period_id = cs_commission_periods.id AND p.user_id = auth.uid()
  ));

-- cs_commission_participants
CREATE POLICY "managers_all_cs_participants" ON cs_commission_participants FOR ALL
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'manager'));

CREATE POLICY "consultants_read_own_cs_participation" ON cs_commission_participants FOR SELECT
  USING (user_id = auth.uid());
```

Um consultor comum: nunca lê `INSERT`/`UPDATE`/`DELETE` em nenhuma das duas tabelas (só o Gerente escreve); lê os totais do período apenas dos meses em que participou; lê apenas a própria linha de `hours_apontadas`.

## 3. Cálculo automático de horas

Ao o Gerente adicionar um consultor como participante de um período:

1. Busca o cliente com `is_cs_project = true` (deve existir exatamente um) e lê seu `project_num`.
2. Soma `apontamentos.minutes` onde `apontamentos.user_id = <consultor selecionado>` e `apontamentos.project_num = <project_num do cliente CS>`, dentro do mês de referência do período.
3. `horas = minutos_somados / 60`, pré-preenchido no campo do formulário; o Gerente pode ajustar antes de salvar.

Isso exige que o Gerente (que está logado) leia `apontamentos` de outro `user_id`. Reaproveita a policy de leitura cross-consultor do Gerente já existente (Fase 49 — "RLS somente-leitura cross-consultor em 9 tabelas"). Durante a implementação, confirmar que `apontamentos` está entre as 9 tabelas cobertas; se não estiver, adicionar a policy faltante seguindo o mesmo padrão (`managers_read_all_apontamentos`).

## 4. Fórmulas de cálculo

Toda a lógica abaixo é calculada em memória (JS), a partir dos 3 campos do período + linha de cada participante — sem tabela de "resultado" persistida, mesmo padrão de Produtividade/Financeiro (sempre recalculado, nunca congelado após o fato, exceto as próprias horas que já são um valor salvo).

- **Percentual de participação**: `percentual = Min(horas_apontadas, 15) / 15`
- **Bônus cancelamento**: `cancellations_count === 0` → R$ 400,00 para cada participante; caso contrário, R$ 0,00 para todos.
- **Pool de vendas**: `poolVendas = sales_total * 0.10`
- **Pool de mensalidade**: `poolMensalidade = monthly_increase_total * 0.50`
- **Comissão de vendas do consultor**: `(poolVendas / participant_count) * percentual`
- **Comissão de mensalidade do consultor**: `(poolMensalidade / participant_count) * percentual`
- **Total do consultor**: `bonus + comissaoVendas + comissaoMensalidade`

Horas acima de 15 são tratadas como 15 (`Min`). Arredondamento monetário só na exibição final (2 casas decimais); os cálculos intermediários usam ponto flutuante sem arredondar a cada etapa.

## 5. UI

### Modal de Cliente (Gerente)

Quando `is_cs_project` está marcado no formulário, exibe uma seção "Comissão CS" adicional dentro do próprio modal, com:

- Navegação de mês (padrão já usado em Produtividade/Financeiro).
- Campos: cancelamentos do mês, valor total vendido, valor de acréscimo de mensalidade.
- Gestão de participantes: adicionar consultor (select com usuários `consultant`/`manager` ainda não incluídos no período) → busca automática das horas (seção 3) → campo editável; remover participante.
- Grade com todos os participantes do mês: consultor, horas, %, bônus, comissão vendas, comissão mensalidade, total.
- Todo esse bloco só é visível/editável para `app.userRole === 'manager'`. Um consultor comum que abrir esse mesmo cliente (se for dele) não vê a seção — a gestão da comissão é exclusiva do Gerente, mesmo que o cliente administrativo pertença tecnicamente à carteira dele.

### View Financeiro (todo consultor, incluindo o Gerente quando participante)

A tabela de clientes existente ganha uma linha extra "Comissão CS", inserida junto com as demais linhas de cliente do mês selecionado, somando ao "Total a Receber" já calculado hoje. Essa linha só aparece se o usuário logado tiver uma linha em `cs_commission_participants` para o mês selecionado. Um ícone ⓘ na linha abre o tooltip padrão do app (`.info-tooltip`) com o detalhamento: horas apontadas, percentual, bônus, comissão vendas, comissão mensalidade.

## 6. Casos de borda

- Nenhum cliente com `is_cs_project = true` cadastrado ainda → Gerente não vê a seção de comissão em nenhum modal (é preciso marcar um cliente primeiro).
- Mês sem período criado → nenhum consultor vê a linha "Comissão CS" naquele mês em Financeiro; o Gerente, ao marcar o cliente administrativo e navegar para aquele mês, vê um estado vazio com opção de criar o período.
- Consultor sem apontamentos no `project_num` do CS naquele mês → horas = 0 → percentual = 0% → só recebe o bônus (se não houve cancelamento); comissões de vendas/mensalidade ficam R$ 0,00.
- Consultor removido do período depois de já ter uma linha salva → a linha (e o histórico de horas) é excluída (`ON DELETE CASCADE` via remoção do registro em `cs_commission_participants`); o trigger recalcula `participant_count`.

## Testes

- **RLS**: consultor comum consegue `SELECT` a própria linha de participante e os totais do próprio período; não consegue ler a linha de outro consultor no mesmo período; não consegue `INSERT`/`UPDATE`/`DELETE` em nenhuma das duas tabelas. Gerente consegue tudo.
- **Cálculo**: casos de 0/1+ cancelamentos, horas 0/parcial/15/acima de 15, 1 participante vs N participantes — comparar com os exemplos numéricos da especificação original (vendas R$24.444, mensalidade R$2.362, 3 consultores com 0h/5h/15h).
- **Frontend**: Gerente cria período, adiciona participante e confirma que as horas vêm pré-calculadas dos apontamentos reais; consultor comum abre Financeiro e vê só a própria linha somando ao total; consultor sem participação no mês não vê a linha.

## Fora de escopo (YAGNI)

- Integração automática de cancelamentos com qualquer sistema externo (CRM, OTOBO etc.) — entrada é sempre manual pelo Gerente.
- Histórico de mudança de participantes dentro do mesmo mês (auditoria de quem foi adicionado/removido e quando).
- Suporte a mais de um cliente administrativo simultâneo (múltiplos "setores" com comissão própria) — o design assume um único cliente `is_cs_project = true`.
- Exportação em PDF do detalhamento da comissão CS (pode ser considerado depois, reaproveitando o padrão de export já usado em Produtividade/Financeiro).
