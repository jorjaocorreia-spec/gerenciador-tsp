-- Solicitações de tarefa pelo Portal do Cliente: o cliente propõe uma
-- tarefa (título + descrição + anexos); ela fica pendente até o consultor
-- aprovar (entra no board) ou rejeitar. Reaproveita a tabela `tasks`
-- existente — sem tabela nova. Ver docs/superpowers/specs/2026-08-05-
-- solicitacoes-cliente-tarefas-design.md para o design completo.

-- 1) Colunas novas.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS requested_by_client BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- status (coluna Kanban, hoje um UUID de kanban_columns.id — ver nota
-- "Kanban Fase 22" no CLAUDE.md) precisa aceitar NULL enquanto a tarefa
-- está pending/rejected: ela não pertence a nenhuma coluna ainda.
ALTER TABLE tasks ALTER COLUMN status DROP NOT NULL;

-- 2) RLS de INSERT para o papel 'client' — aditiva, convive com a policy
--    de INSERT existente do consultor dono (auth.uid() = user_id).
CREATE POLICY "clients_insert_own_task_requests" ON tasks
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = 'client'
              AND ur.client_id = tasks.client_id
        )
    );

-- 3) Trigger BEFORE INSERT: quando quem insere tem papel 'client', força
--    server-side todos os campos sensíveis, mesmo que a chamada venha
--    direto da API REST do Supabase com o JWT do cliente (bypassando a
--    UI). Só título, descrição e anexos vêm do valor enviado pelo
--    cliente — mesmo padrão de defesa em profundidade de
--    enforce_client_task_position_only() (20260726b), incluindo o
--    SET search_path fixo desde a criação (não precisa de hardening
--    follow-up separado desta vez).
CREATE OR REPLACE FUNCTION enforce_client_task_request_insert()
RETURNS TRIGGER AS $$
DECLARE
    is_client BOOLEAN;
    owner_user_id UUID;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'client'
    ) INTO is_client;

    IF is_client THEN
        SELECT clients.user_id INTO owner_user_id
        FROM clients WHERE clients.id = NEW.client_id;

        NEW.user_id := owner_user_id;
        NEW.requested_by_client := true;
        NEW.approval_status := 'pending';
        NEW.status := NULL;
        NEW.priority := 'medium';
        NEW.position := 0;
        NEW.labels := '[]'::jsonb;
        NEW.checklist := '[]'::jsonb;
        NEW.due_date := NULL;
        NEW.cover_color := NULL;
        NEW.hidden_from_client := false;
        NEW.estimated_minutes := 0;
        NEW.spent_minutes := 0;
        NEW.comments := '[]'::jsonb;
        NEW.completed := false;
        NEW.completed_at := NULL;
        NEW.rejection_reason := NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_enforce_client_task_request_insert ON tasks;
CREATE TRIGGER trg_enforce_client_task_request_insert
    BEFORE INSERT ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION enforce_client_task_request_insert();
