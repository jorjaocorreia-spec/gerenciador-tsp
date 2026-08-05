-- Edição de solicitação de tarefa pelo cliente enquanto ainda está pendente.
-- Mesmo padrão de defesa em profundidade já usado em
-- enforce_client_task_position_only (20260726) e
-- enforce_client_task_request_insert (20260805c). Ver
-- docs/superpowers/specs/2026-08-05-edicao-solicitacao-tarefa-cliente-design.md.

-- ATENÇÃO (adicionado em 2026-08-05, revisão final da feature de edição):
-- a trigger/função criadas abaixo (enforce_client_task_request_update /
-- trg_enforce_client_task_request_update) foram REMOVIDAS pela migration
-- 20260805e_fix_client_task_trigger_conflict.sql — colidiam com a trigger
-- BEFORE UPDATE mais antiga trg_enforce_client_task_position_only (Fase
-- 45/49), que o Postgres executa antes por ordem alfabética de nome,
-- apagando as edições antes desta trigger capturá-las. A lógica de edição
-- de solicitação pendente hoje vive consolidada dentro de
-- enforce_client_task_position_only (ver 20260805e). Este arquivo é mantido
-- por completude histórica (e porque a policy abaixo continua válida, só
-- apertada depois por 20260805f) — não copiar o padrão de trigger separada
-- abaixo para uma feature nova; ver a nota "única trigger BEFORE UPDATE em
-- tasks" no CLAUDE.md.

-- 1) RLS de UPDATE para o papel 'client' — aditiva, convive com as policies
--    de UPDATE existentes do consultor dono e da reordenação de cards.
CREATE POLICY "clients_update_own_pending_task_requests" ON tasks
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = 'client'
              AND ur.client_id = tasks.client_id
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = 'client'
              AND ur.client_id = tasks.client_id
        )
    );

-- 2) Trigger BEFORE UPDATE: quando quem edita tem papel 'client', só permite
--    a alteração se a linha ainda estiver 'pending' (OLD, não NEW — o
--    cliente não pode usar essa via para "revalidar" uma linha já decidida).
--    Se estiver pending, só title/description/attachments passam do valor
--    enviado; todo o resto (inclusive uma tentativa de setar
--    approval_status/status/user_id) é reconstruído de OLD. Se não estiver
--    pending, a linha inteira é reconstruída de OLD — a tentativa de edição
--    vira no-op silencioso, mesmo via chamada direta à API REST.
CREATE OR REPLACE FUNCTION enforce_client_task_request_update()
RETURNS TRIGGER AS $$
DECLARE
    is_client BOOLEAN;
    new_title TEXT := NEW.title;
    new_description TEXT := NEW.description;
    new_attachments JSONB := NEW.attachments;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'client'
    ) INTO is_client;

    IF is_client THEN
        IF OLD.approval_status = 'pending' THEN
            NEW := OLD;
            NEW.title := new_title;
            NEW.description := new_description;
            NEW.attachments := new_attachments;
            NEW.updated_at := now();
        ELSE
            NEW := OLD;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_enforce_client_task_request_update ON tasks;
CREATE TRIGGER trg_enforce_client_task_request_update
    BEFORE UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION enforce_client_task_request_update();
