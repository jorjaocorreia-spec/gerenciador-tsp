-- Notas Rápidas: inbox pessoal de anotações sem destino definido ainda.
-- Isolada por user_id, sem policy cross-role (nem manager em Modo Supervisão,
-- nem client no Portal, acessam notas de outro usuário) — mesmo padrão de
-- notification_reads (20260707_notificacoes.sql).
CREATE TABLE IF NOT EXISTS quick_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  text TEXT NOT NULL,
  client_id UUID REFERENCES clients ON DELETE SET NULL,
  suggested_date DATE,
  is_today BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'pending',
  resolution_type TEXT,
  resolved_task_id UUID REFERENCES tasks ON DELETE SET NULL,
  resolved_event_id UUID REFERENCES agenda_events ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

ALTER TABLE quick_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_own_quick_notes" ON quick_notes;
CREATE POLICY "users_own_quick_notes" ON quick_notes
  FOR ALL USING (auth.uid() = user_id);
