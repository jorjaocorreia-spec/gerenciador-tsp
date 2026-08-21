# Processos do Cliente — Design

Data: 2026-08-21

## Contexto e objetivo

Hoje, quando o consultor implanta algo em um cliente (ex.: "Tabela de Preços"), o trabalho fica espalhado por Tarefas (Kanban), Agenda, Atendimentos e Chamados — sem nenhum jeito de ver, de forma agregada e cronológica, tudo o que já foi feito, comunicado ou está pendente especificamente sobre aquela implantação. O objetivo desta feature é dar essa visão agregada **sem duplicar ou substituir** os controles que já existem (Kanban continua sendo o Kanban; Agenda continua sendo a Agenda) — o Processo é uma camada de agregação por cima do que já existe, não um sistema paralelo.

## Modelo de dados

### `process_types` (catálogo de tipos de processo)

Catálogo reutilizável, isolado por `user_id` (qualquer consultor cria/edita os próprios tipos — mesmo padrão de `kanban_columns`).

```sql
CREATE TABLE process_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  color TEXT DEFAULT '#8b5cf6',
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE process_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_process_types" ON process_types FOR ALL USING (auth.uid() = user_id);
```

### `client_processes` (instância de um tipo aplicada a um cliente)

```sql
CREATE TABLE client_processes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  client_id UUID REFERENCES clients ON DELETE CASCADE NOT NULL,
  process_type_id UUID REFERENCES process_types ON DELETE SET NULL,
  status TEXT DEFAULT 'active', -- 'active' | 'paused' | 'completed' | 'cancelled'
  started_at DATE DEFAULT CURRENT_DATE,
  completed_at DATE,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE client_processes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_client_processes" ON client_processes FOR ALL USING (auth.uid() = user_id);
```

`process_type_id` é `ON DELETE SET NULL` (não `CASCADE`): apagar um tipo do catálogo não pode apagar o histórico de processos já rodados com aquele tipo — só desvincula o nome.

Um cliente pode ter múltiplos `client_processes` `active` simultaneamente (ex.: "Tabela de Preços" e "Onboarding" rodando juntos).

### Vínculo nas tabelas existentes

Cada uma ganha uma coluna nullable, sem `NOT NULL`, sem afetar nenhuma linha existente:

```sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS process_id UUID REFERENCES client_processes ON DELETE SET NULL;
ALTER TABLE agenda_events ADD COLUMN IF NOT EXISTS process_id UUID REFERENCES client_processes ON DELETE SET NULL;
ALTER TABLE records ADD COLUMN IF NOT EXISTS process_id UUID REFERENCES client_processes ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS process_id UUID REFERENCES client_processes ON DELETE SET NULL;
```

`ON DELETE SET NULL` em todas: apagar um `client_process` nunca apaga a tarefa/evento/atendimento/chamado real — só remove o vínculo. Isso é deliberado — o dado de negócio (a tarefa, a hora lançada) é mais importante que o agrupamento.

Nenhuma tabela nova para "comunicações". Uma comunicação avulsa (ex.: "liguei pro cliente e avisei X") vira uma Tarefa vinculada ao processo — pode ser criada e concluída na hora, com o relato no comentário. A timeline do processo reaproveita o histórico de comentários/atividade que as Tarefas já têm (`comments[]` JSONB, cada item já com timestamp).

## Cálculo de pendências

Sem checklist própria no processo. Pendência = qualquer tarefa vinculada (`tasks.process_id = X`) cuja coluna (`status` → `kanban_columns.id`) não tem `is_done = true`. É uma query derivada em memória, mesmo padrão de `_computeClientStats`/contagem de tarefas abertas já usado em outras views — nenhum campo novo de "pendente" é persistido.

## Vinculação — os dois fluxos

1. **Nos modais existentes** (Tarefa, Compromisso/Agenda, Atendimento, Chamado): select opcional "Processo", populado só com os `client_processes` de status `active` do cliente selecionado no modal naquele momento. Sem cliente selecionado ou sem processo ativo daquele cliente, o campo fica oculto (mesmo padrão condicional já usado por outros campos opcionais do app, ex. `agenda-generate-meet-row`).
2. **Na tela do Processo**: botão "Vincular existente" abre um buscador simples, já travado no cliente do processo, para anexar tarefas/eventos/atendimentos/chamados criados antes do processo existir. Grava só o `UPDATE ... SET process_id = X` no item escolhido.

## Nova view "Processos"

Novo item no sidebar (mesmo padrão de nav-item dos demais — `tabindex`, `role="button"`, `aria-current`, ícone Lucide, `.nav-label`).

### Lista

Cards ou linhas agrupadas por cliente, com filtro de status (`.status-filter-tab`, default exibe só `active`, mesmo componente já usado em Clientes). Cada item mostra: nome do tipo, cliente, status, contagem de pendências.

### Detalhe de um processo (`openProcessDetail(id)`)

- **Header**: cliente, tipo (nome + cor do `process_types`), status (editável via select — muda `client_processes.status`, e ao marcar `completed` seta `completed_at = hoje`), datas.
- **Pendências**: lista as tarefas vinculadas não concluídas (deriva do cálculo acima), com link para abrir a tarefa no Kanban.
- **Timeline única**: mescla, ordenada por data/hora decrescente (mais recente primeiro, mesmo padrão de `_renderTaskComments`):
  - Tarefas vinculadas: evento de criação + cada comentário/mudança de status/registro de tempo do `comments[]` de cada uma (reaproveita a mesma renderização já usada no modal de Tarefa, adaptada para múltiplas tarefas).
  - Eventos de agenda vinculados: data/hora + título.
  - Atendimentos vinculados: data + duração + descrição.
  - Chamados vinculados: criação/atualização do ticket (via `updated_at_otobo`).
  - Cada item da timeline tem um ícone diferente por tipo de origem (tarefa/agenda/atendimento/chamado), mesmo padrão visual de badges já usado em Chamados (`.ticket-type-badge` etc.), nunca reaproveitando uma cor já reservada (violeta = IA).
- **Botão "Vincular existente"** (fluxo 2 acima).

### Gestão do catálogo de tipos

Modal simples ("Gerenciar Tipos de Processo"), CRUD básico (nome, descrição, cor) — mesmo padrão estrutural de gestão de colunas Kanban (`_renderManageColumnsList`), sem herdar código dele (entidades diferentes).

## Fora de escopo

- Nenhuma mudança nas colunas do Kanban existente, em `getBatchStats`, ou no cálculo de stats de cliente.
- Portal do Cliente **não** ganha acesso a Processos nesta fase — mesma cautela já aplicada a dados internos do consultor (ex. `implementations.code_script` em Indicadores). Pode ser reavaliado depois, mas não faz parte desta spec.
- Modo Supervisão (Gerente): sem tratamento especial nesta fase — os métodos de escrita seguem a convenção `get`/`_` para leitura vs. `add/update/delete/...` para escrita já usada em todo o app, então o guard existente do Proxy (Fase 49) já bloqueia escrita em Modo Supervisão automaticamente, sem código extra.
- Sem migração de dados históricos — tarefas/eventos/atendimentos/chamados já existentes ficam com `process_id = null` até serem vinculados manualmente via "Vincular existente".

## Testes

Segue o padrão Playwright já usado no projeto: criar tipo de processo → instanciar num cliente → vincular tarefa/evento/atendimento via modal → vincular item pré-existente via "Vincular existente" → conferir timeline ordenada corretamente → marcar tarefa como concluída e conferir que sai de pendências → marcar processo como concluído.
