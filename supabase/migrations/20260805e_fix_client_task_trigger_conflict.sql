-- Corrige conflito entre trg_enforce_client_task_position_only (Fase 45/49,
-- reordenação de cards) e trg_enforce_client_task_request_update (Task 1 desta
-- feature, 20260805d) — o Postgres executa triggers BEFORE UPDATE na mesma
-- linha em ordem alfabética de nome ("position_only" antes de "request_update"),
-- e a trigger de posição fazia NEW := OLD incondicional para QUALQUER UPDATE de
-- um usuário client, apagando title/description/attachments antes da segunda
-- trigger capturar os valores enviados pelo cliente. Reordenar as duas não
-- resolveria (a de posição sempre faz NEW := OLD, não importa a ordem).
--
-- Correção: consolida as duas responsabilidades na trigger de posição
-- (já testada em produção desde a Fase 45/49), que passa a também preservar
-- title/description/attachments quando OLD.approval_status='pending'. A
-- trigger/função separada da Task 1 é removida — sua responsabilidade foi
-- absorvida aqui. Comportamento existente de reordenação (tarefas sempre
-- approval_status='approved' nesse fluxo) fica 100% inalterado, pois o novo
-- trecho condicional nunca dispara para essas linhas.
CREATE OR REPLACE FUNCTION enforce_client_task_position_only()
RETURNS TRIGGER AS $$
DECLARE
    is_client BOOLEAN;
    new_position INTEGER := NEW.position;
    new_title TEXT := NEW.title;
    new_description TEXT := NEW.description;
    new_attachments JSONB := NEW.attachments;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'client'
    ) INTO is_client;

    IF is_client THEN
        NEW := OLD;
        NEW.position := new_position;
        IF OLD.approval_status = 'pending' THEN
            NEW.title := new_title;
            NEW.description := new_description;
            NEW.attachments := new_attachments;
            NEW.updated_at := now();
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_enforce_client_task_request_update ON tasks;
DROP FUNCTION IF EXISTS enforce_client_task_request_update();
