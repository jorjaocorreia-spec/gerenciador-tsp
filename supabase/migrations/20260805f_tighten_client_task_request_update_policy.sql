-- Aperta a policy clients_update_own_pending_task_requests (20260805d), que
-- checava apenas user_roles.client_id — sem exigir hidden_from_client=false,
-- requested_by_client=true nem approval_status='pending' no próprio nível da
-- RLS. Isso reabria, por efeito colateral, a permissão de UPDATE em linhas
-- hidden_from_client=true que a migration de hardening 20260726b tinha
-- deliberadamente fechado para a policy irmã clients_reorder_own_tasks — a
-- trigger (enforce_client_task_position_only, 20260805e) ainda reduzia o
-- efeito prático a campos seguros, mas a RLS por si só ficava mais permissiva
-- do que o nome da policy prometia. Achado na revisão final de branch inteiro
-- da feature de edição de solicitação (2026-08-05).
DROP POLICY IF EXISTS "clients_update_own_pending_task_requests" ON tasks;
CREATE POLICY "clients_update_own_pending_task_requests" ON tasks
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = 'client'
              AND ur.client_id = tasks.client_id
        )
        AND tasks.hidden_from_client = false
        AND tasks.requested_by_client = true
        AND tasks.approval_status = 'pending'
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = 'client'
              AND ur.client_id = tasks.client_id
        )
        AND tasks.hidden_from_client = false
    );
