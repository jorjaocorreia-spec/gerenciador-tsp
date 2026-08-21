-- Processos do Cliente: catálogo reutilizável de tipos de processo (por
-- consultor) + instância de um tipo aplicada a um cliente. Timeline e
-- pendências são calculadas em memória (js/process-timeline.js) a partir
-- dos itens já existentes vinculados via process_id — nenhuma tabela de
-- "comunicações"/log nova; uma comunicação avulsa vira uma Tarefa
-- vinculada ao processo. Ver docs/superpowers/specs/2026-08-21-processos-cliente-design.md.

CREATE TABLE IF NOT EXISTS process_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  color TEXT DEFAULT '#8b5cf6',
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE process_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_process_types" ON process_types;
CREATE POLICY "users_own_process_types" ON process_types
  FOR ALL USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS client_processes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  client_id UUID REFERENCES clients ON DELETE CASCADE NOT NULL,
  process_type_id UUID REFERENCES process_types ON DELETE SET NULL,
  status TEXT DEFAULT 'active',
  started_at DATE DEFAULT CURRENT_DATE,
  completed_at DATE,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE client_processes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_client_processes" ON client_processes;
CREATE POLICY "users_own_client_processes" ON client_processes
  FOR ALL USING (auth.uid() = user_id);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS process_id UUID REFERENCES client_processes ON DELETE SET NULL;
ALTER TABLE agenda_events ADD COLUMN IF NOT EXISTS process_id UUID REFERENCES client_processes ON DELETE SET NULL;
ALTER TABLE records ADD COLUMN IF NOT EXISTS process_id UUID REFERENCES client_processes ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS process_id UUID REFERENCES client_processes ON DELETE SET NULL;
