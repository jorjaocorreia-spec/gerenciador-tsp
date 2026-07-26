-- Portal do Cliente: reordenar cards de tarefas dentro da mesma coluna.
-- O cliente define a prioridade (ordem em tasks.position); nenhum outro
-- campo pode ser alterado por esse papel, nem mesmo via chamada direta
-- à API REST do Supabase com o JWT do usuário-cliente.

-- 1) RLS de UPDATE para o papel 'client' — aditiva, convive com a policy
--    existente do consultor dono (auth.uid() = user_id).
CREATE POLICY "clients_reorder_own_tasks" ON tasks
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

-- 2) Trigger: quando quem edita tem papel 'client', reconstrói a linha a
--    partir de OLD e só aceita a nova posição. Roda para TODO UPDATE em
--    tasks (inclusive do consultor), mas só altera algo quando is_client
--    é verdadeiro — para o consultor é um no-op, comportamento inalterado.
CREATE OR REPLACE FUNCTION enforce_client_task_position_only()
RETURNS TRIGGER AS $$
DECLARE
    is_client BOOLEAN;
    new_position INTEGER := NEW.position;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'client'
    ) INTO is_client;

    IF is_client THEN
        NEW := OLD;
        NEW.position := new_position;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_enforce_client_task_position_only ON tasks;
CREATE TRIGGER trg_enforce_client_task_position_only
    BEFORE UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION enforce_client_task_position_only();
