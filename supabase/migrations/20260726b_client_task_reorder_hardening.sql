-- Hardening follow-up a 20260726_client_task_reorder.sql, a partir da
-- revisão final whole-branch da feature de reordenação de tarefas pelo
-- Portal do Cliente. Fecha 2 gaps identificados nessa revisão:

-- 1) A policy original não excluía hidden_from_client = true. Como
--    getClientPortalTasks() filtra .eq('hidden_from_client', false), uma
--    tarefa oculta do cliente nunca aparece no DOM/reorderData do drag —
--    então o reorder do cliente reescrevia position 0..n só sobre as
--    tarefas visíveis, colidindo com o position das ocultas na mesma
--    coluna (ambas podiam ficar com o mesmo valor). Recriada com
--    AND hidden_from_client = false: o cliente não pode mais alterar
--    position de uma tarefa que nem consegue ver no próprio portal.
DROP POLICY IF EXISTS "clients_reorder_own_tasks" ON tasks;
CREATE POLICY "clients_reorder_own_tasks" ON tasks
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = 'client'
              AND ur.client_id = tasks.client_id
        )
        AND tasks.hidden_from_client = false
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

-- 2) enforce_client_task_position_only() é SECURITY DEFINER sem
--    search_path fixo — auth.uid()/user_roles resolviam contra o
--    search_path do chamador (que sempre inclui pg_temp primeiro),
--    então uma relação temporária chamada user_roles no schema do
--    chamador poderia, em tese, neutralizar a checagem is_client.
--    CREATE OR REPLACE preserva a trigger existente (mesmo nome de
--    função), só adiciona SET search_path.
--    Nota para manutenção futura: essa trigger é BEFORE UPDATE e
--    depende de rodar sem qualquer outra trigger BEFORE UPDATE em
--    tasks reescrevendo updated_at depois dela — Postgres ordena
--    triggers BEFORE alfabeticamente pelo nome. Se algum dia for
--    adicionada uma trigger tipo "update_timestamp"/"zz_..." nesta
--    tabela, ela rodaria DEPOIS desta (ordem alfabética) e poderia
--    reintroduzir o bump de updated_at que esta feature existe para
--    evitar. Nomear qualquer trigger futura em tasks com prefixo que
--    ordene antes de "trg_enforce_..." (ex.: "a_") ou revisar esta nota.
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
