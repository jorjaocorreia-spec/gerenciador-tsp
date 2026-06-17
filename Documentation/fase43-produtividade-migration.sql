-- Fase: Produtividade
-- Executar manualmente no Supabase SQL Editor (klimkamnydfnzqetqlqm) antes do deploy desta feature.

CREATE TABLE IF NOT EXISTS holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  name TEXT NOT NULL,
  source TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_own_holidays" ON holidays;
CREATE POLICY "users_own_holidays" ON holidays FOR ALL USING (auth.uid() = user_id);

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS productivity_start_date DATE;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS productivity_weekly_hours NUMERIC DEFAULT 44;
