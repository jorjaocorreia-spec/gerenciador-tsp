-- Fase 49: Nível de acesso "Gerente" — supervisor somente-leitura cross-consultor
-- Gerente é, por padrão, um consultor pleno; a leitura cross-user é aditiva e
-- ativada via user_roles.role = 'manager'. Nenhuma policy de escrita é criada
-- para managers — INSERT/UPDATE/DELETE continuam exigindo auth.uid() = user_id.

ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_check
    CHECK (role IN ('consultant', 'client', 'manager'));

CREATE POLICY "managers_read_all_clients" ON clients FOR SELECT
    USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'manager'));

CREATE POLICY "managers_read_all_records" ON records FOR SELECT
    USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'manager'));

CREATE POLICY "managers_read_all_tasks" ON tasks FOR SELECT
    USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'manager'));

CREATE POLICY "managers_read_all_kanban_columns" ON kanban_columns FOR SELECT
    USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'manager'));

CREATE POLICY "managers_read_all_agenda_events" ON agenda_events FOR SELECT
    USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'manager'));

CREATE POLICY "managers_read_all_apontamentos" ON apontamentos FOR SELECT
    USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'manager'));

CREATE POLICY "managers_read_all_implementations" ON implementations FOR SELECT
    USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'manager'));

CREATE POLICY "managers_read_all_implementation_clients" ON implementation_clients FOR SELECT
    USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'manager'));

CREATE POLICY "managers_read_all_tickets" ON tickets FOR SELECT
    USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'manager'));
