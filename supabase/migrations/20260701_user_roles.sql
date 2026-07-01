-- Fase 45: Controle de acesso por níveis de usuário (Portal do Cliente)
-- Papel 'consultant' = acesso total (atual). Papel 'client' = somente-leitura
-- da view Tarefas, restrito a um client_id.

CREATE TABLE IF NOT EXISTS user_roles (
    user_id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('consultant', 'client')),
    client_id UUID REFERENCES clients ON DELETE CASCADE,
    invited_by UUID REFERENCES auth.users,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Usuário só lê a própria role. INSERT/UPDATE/DELETE não têm policy
-- (negados por padrão) — gerenciamento só via Edge Function com service role.
CREATE POLICY "read_own_role" ON user_roles
    FOR SELECT USING (auth.uid() = user_id);

-- Papel 'client' lê tarefas de QUALQUER user_id, desde que o client_id bata
-- com o vínculo registrado em user_roles. Convive com a policy existente
-- (auth.uid() = user_id) que dá ao consultor dono acesso total às próprias tasks.
CREATE POLICY "clients_read_own_tasks" ON tasks
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = 'client'
              AND ur.client_id = tasks.client_id
        )
    );

-- Mesma lógica para as colunas do Kanban (o board precisa delas para renderizar).
CREATE POLICY "clients_read_own_columns" ON kanban_columns
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = 'client'
              AND ur.client_id = kanban_columns.client_id
        )
    );
