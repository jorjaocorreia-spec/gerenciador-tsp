-- Fase 47: Central de Notificações
CREATE TABLE IF NOT EXISTS app_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_label TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE app_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "consultants_read_notifications" ON app_notifications;
CREATE POLICY "consultants_read_notifications" ON app_notifications
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'consultant')
  );

CREATE TABLE IF NOT EXISTS notification_reads (
  user_id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE notification_reads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_notification_reads" ON notification_reads;
CREATE POLICY "users_own_notification_reads" ON notification_reads
  FOR ALL USING (auth.uid() = user_id);
