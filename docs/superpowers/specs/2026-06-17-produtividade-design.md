# Produtividade — Design

**Data**: 2026-06-17
**Status**: Aprovado para implementação

## Objetivo

Medir as horas produtivas do usuário (dia/semana/mês), comparar com a meta de jornada contratual (44h semanais, ajustada por feriados), manter um saldo acumulado (banco de horas pessoal) e gerar evidências apresentáveis (dashboard ao vivo + PDF exportável) para mostrar a superiores se o trabalho realizado está acima, abaixo ou dentro da meta.

## Fonte de dados

A métrica de "hora produtiva" é definida exclusivamente pelos registros da tabela `apontamentos` já existente (log diário independente para ERP, com `start_time`/`end_time`/`project_num`/`description`). Nenhuma nova tabela de lançamento de tempo é criada — todo o cálculo deriva dos apontamentos existentes.

Não são usadas como fonte: `records` (atendimentos faturáveis por cliente), `tasks.spent_minutes` (tempo de tarefas) ou `agenda_events` — essas fontes não entram no cálculo de produtividade desta feature.

## Modelo de dados

### Nova tabela `holidays`

```sql
CREATE TABLE holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  name TEXT NOT NULL,
  source TEXT DEFAULT 'manual', -- sempre 'manual' nesta tabela
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_holidays" ON holidays FOR ALL USING (auth.uid() = user_id);
```

Armazena **apenas feriados extras manuais** (estaduais, municipais, pontos facultativos, ausências justificadas que o usuário queira excluir da meta). Feriados nacionais (fixos e móveis) **não são persistidos** — são calculados em JavaScript a cada carregamento da view, cacheados em memória por ano.

Feriados nacionais fixos: Confraternização Universal (01/01), Tiradentes (21/04), Dia do Trabalho (01/05), Independência (07/09), Nossa Senhora Aparecida (12/10), Finados (02/11), Proclamação da República (15/11), Natal (25/12).

Feriados nacionais móveis (calculados via algoritmo de Páscoa de Meeus/Jones/Butcher): Carnaval (segunda e terça, 48/47 dias antes da Páscoa), Sexta-feira Santa (2 dias antes), Corpus Christi (60 dias depois).

### Config de produtividade (em `user_profiles`)

```sql
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS productivity_start_date DATE;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS productivity_weekly_hours NUMERIC DEFAULT 44;
```

- `productivity_weekly_hours`: meta semanal total em horas (default 44). Distribuída igualmente entre os 5 dias úteis (Seg-Sex) — `metaDiaria = productivity_weekly_hours / 5`.
- `productivity_start_date`: data a partir da qual o saldo acumulado passa a ser calculado. Sem essa data configurada, o saldo acumulado não é exibido (estado vazio orientando a configurar).

Jornada fixa assumida: Segunda a Sexta, 07:42–12:00 e 13:30–18:00 (8h48/dia = 44h/semana com o default). O valor é editável via `productivity_weekly_hours`, mas a distribuição é sempre uniforme entre os 5 dias úteis — não há editor de horário por dia da semana (fora de escopo).

## Lógica de cálculo

- **Meta diária**: dia útil (Seg-Sex) e não-feriado (nacional ou manual) → `productivity_weekly_hours / 5`. Fim de semana ou feriado → 0.
- **Realizado diário**: soma de `(end_time - start_time)` de todos os `apontamentos` da data, em minutos.
- **Saldo do dia** = realizado − meta.
- **Semana**: agregação Seg-Dom; meta e realizado somados dia a dia dentro do intervalo.
- **Mês**: agregação por mês calendário; mesma lógica.
- **Saldo acumulado**: soma do saldo diário de todos os dias **completos** entre `productivity_start_date` (inclusive) e **ontem** (inclusive). O dia atual nunca entra no acumulado.
- **Dia em andamento (hoje)**: exibido separadamente como progresso (realizado parcial vs meta do dia), sem impactar o saldo acumulado e sem indicador de positivo/negativo até o dia terminar.
- **Mudança de `productivity_weekly_hours`**: recalcula retroativamente todo o histórico com o novo valor (sem versionamento de config).
- **Indicador visual**: verde quando saldo ≥ 0, vermelho quando < 0 — aplicado ao card do período e ao card de saldo acumulado.
- Dias úteis sem nenhum apontamento contam déficit total do dia (meta inteira como saldo negativo).

## View "Produtividade"

Novo item de navegação na sidebar (ícone `trending-up`), seguindo o padrão visual existente (glassmorphism, tema escuro).

### Componentes

1. **Card de Saldo Acumulado** — sempre visível no topo da view. Mostra o saldo total desde `productivity_start_date` em formato `+Xh Ymin` / `-Xh Ymin`, cor verde/vermelho. Se `productivity_start_date` não configurada, exibe estado vazio com CTA para configurar.
2. **Seletor de período** — abas Dia / Semana / Mês + navegação ◀ ▶, mesmo padrão UX de Apontamentos e Agenda.
3. **Card do período selecionado** — Meta, Realizado, Saldo, barra de progresso (verde ≥100%, âmbar/vermelho abaixo).
4. **Gráfico de barras** — Realizado vs Meta por dia dentro do período selecionado (5 barras na semana; todos os dias no mês). Reaproveita padrão visual de gráfico já usado no modal de ranking do Dashboard (Fase 37).
5. **Tabela detalhada** — lista os apontamentos do período (data, horário, duração, projeto, descrição) como evidência granular.
6. **Botão "Configurar"** — abre modal para editar `productivity_weekly_hours`, `productivity_start_date`, e gerenciar feriados manuais extras (listar/adicionar/remover).
7. **Botão "Exportar PDF"** — gera relatório do período selecionado.

## Exportação PDF

Reaproveita jsPDF + jsPDF-AutoTable (já usados no projeto para Ata SAP e Relatório de Agenda).

Conteúdo:
- Cabeçalho: nome do usuário, período (ex: "Semana de 09 a 13/06/2026"), data de geração
- Resumo: Meta, Realizado, Saldo do período
- Gráfico de barras renderizado em canvas e inserido como imagem
- Tabela detalhada dos apontamentos do período
- Rodapé: saldo acumulado total na data de geração
- **Nota**: o gráfico de barras foi propositalmente omitido na primeira versão (decisão do usuário após revisão final do branch); pode ser adicionado depois se sentir falta.

## Casos de borda

- **Sem `productivity_start_date`**: saldo acumulado oculto com CTA; metas por período continuam funcionando normalmente.
- **Feriados móveis**: calculados via algoritmo de Páscoa, cacheados em memória por ano (evita recálculo a cada render).
- **Apontamentos com horários vazios/inválidos**: tratados como 0 minutos no somatório, não quebram o cálculo.
- **Período totalmente no futuro**: meta exibida normalmente, realizado = 0; não distorce o saldo acumulado (que só considera até ontem).
- **`productivity_weekly_hours` alterado**: recálculo retroativo automático de todo o histórico exibido (sem necessidade de migrar dados, pois o saldo é sempre derivado em tempo de leitura).

## Fora de escopo

- Jornada com horários diferentes por dia da semana (editor de grade) — jornada é sempre uniforme entre os 5 dias úteis.
- Cruzamento com `records`, `tasks.spent_minutes` ou `agenda_events` para cálculo de produtividade.
- Histórico/versionamento de mudanças na meta semanal ao longo do tempo.
- Feriados nacionais como dados persistidos no banco (são sempre calculados client-side).
