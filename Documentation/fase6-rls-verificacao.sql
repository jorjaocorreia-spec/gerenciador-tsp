-- ============================================================
-- FASE 6 — Verificação e garantia de RLS completo
-- Rodar no Supabase → SQL Editor
-- ============================================================

-- 1. Verifica se RLS está ativo nas 4 tabelas
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('clients', 'records', 'tasks', 'agenda_events');
-- Esperado: rowsecurity = true para todas

-- 2. Lista todas as políticas existentes
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('clients', 'records', 'tasks', 'agenda_events')
ORDER BY tablename, cmd;

-- ============================================================
-- Se alguma política estiver faltando, execute abaixo:
-- ============================================================

-- CLIENTS
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clients_select_own" ON clients;
DROP POLICY IF EXISTS "clients_insert_own" ON clients;
DROP POLICY IF EXISTS "clients_update_own" ON clients;
DROP POLICY IF EXISTS "clients_delete_own" ON clients;

CREATE POLICY "clients_select_own" ON clients FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "clients_insert_own" ON clients FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "clients_update_own" ON clients FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "clients_delete_own" ON clients FOR DELETE USING (auth.uid() = user_id);

-- RECORDS
ALTER TABLE records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "records_select_own" ON records;
DROP POLICY IF EXISTS "records_insert_own" ON records;
DROP POLICY IF EXISTS "records_update_own" ON records;
DROP POLICY IF EXISTS "records_delete_own" ON records;

CREATE POLICY "records_select_own" ON records FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "records_insert_own" ON records FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "records_update_own" ON records FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "records_delete_own" ON records FOR DELETE USING (auth.uid() = user_id);

-- TASKS
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tasks_select_own" ON tasks;
DROP POLICY IF EXISTS "tasks_insert_own" ON tasks;
DROP POLICY IF EXISTS "tasks_update_own" ON tasks;
DROP POLICY IF EXISTS "tasks_delete_own" ON tasks;

CREATE POLICY "tasks_select_own" ON tasks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "tasks_insert_own" ON tasks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "tasks_update_own" ON tasks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "tasks_delete_own" ON tasks FOR DELETE USING (auth.uid() = user_id);

-- AGENDA_EVENTS
ALTER TABLE agenda_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agenda_select_own" ON agenda_events;
DROP POLICY IF EXISTS "agenda_insert_own" ON agenda_events;
DROP POLICY IF EXISTS "agenda_update_own" ON agenda_events;
DROP POLICY IF EXISTS "agenda_delete_own" ON agenda_events;

CREATE POLICY "agenda_select_own" ON agenda_events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "agenda_insert_own" ON agenda_events FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "agenda_update_own" ON agenda_events FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "agenda_delete_own" ON agenda_events FOR DELETE USING (auth.uid() = user_id);
