-- Fase: Painel de Indicadores — Evolução do Cliente
-- Extensão de RLS para o papel 'client' (Portal do Cliente) ler, além de
-- tasks/kanban_columns (já liberados na Fase 45), os demais dados do
-- próprio projeto: dados do cliente, horas, agenda e implementações.
-- Todas as policies são SELECT-only e seguem o mesmo padrão de
-- clients_read_own_tasks/clients_read_own_columns (EXISTS em user_roles
-- casando user_roles.client_id com o client_id da linha).

-- Cliente lê a própria linha em `clients` (nome, horas contratadas, status).
-- A UI/prompt de IA são responsáveis por nunca exibir client_pays/hourly_rate/
-- consultant_bonus para o papel client — esta policy libera a linha inteira.
CREATE POLICY "clients_read_own_client_row" ON clients
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = 'client'
              AND ur.client_id = clients.id
        )
    );

CREATE POLICY "clients_read_own_records" ON records
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = 'client'
              AND ur.client_id = records.client_id
        )
    );

CREATE POLICY "clients_read_own_agenda_events" ON agenda_events
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = 'client'
              AND ur.client_id = agenda_events.client_id
        )
    );

-- implementations não tem client_id direto — o vínculo é via implementation_clients.
CREATE POLICY "clients_read_own_implementations" ON implementations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM implementation_clients ic
            JOIN user_roles ur ON ur.client_id = ic.client_id
            WHERE ic.implementation_id = implementations.id
              AND ur.user_id = auth.uid()
              AND ur.role = 'client'
        )
    );

CREATE POLICY "clients_read_own_implementation_clients" ON implementation_clients
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = 'client'
              AND ur.client_id = implementation_clients.client_id
        )
    );
