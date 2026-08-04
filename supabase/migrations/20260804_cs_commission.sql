-- Comissão CS: cliente administrativo do setor + tabelas de período/participantes.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_cs_project BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS cs_commission_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_month DATE NOT NULL UNIQUE,
  cancellations_count INT NOT NULL DEFAULT 0,
  sales_total NUMERIC NOT NULL DEFAULT 0,
  monthly_increase_total NUMERIC NOT NULL DEFAULT 0,
  participant_count INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE cs_commission_periods ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS cs_commission_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID REFERENCES cs_commission_periods ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users NOT NULL,
  hours_apontadas NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (period_id, user_id)
);
ALTER TABLE cs_commission_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "managers_all_cs_periods" ON cs_commission_periods FOR ALL
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'manager'));

CREATE POLICY "participants_read_own_cs_period" ON cs_commission_periods FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM cs_commission_participants p
    WHERE p.period_id = cs_commission_periods.id AND p.user_id = auth.uid()
  ));

CREATE POLICY "managers_all_cs_participants" ON cs_commission_participants FOR ALL
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'manager'));

CREATE POLICY "consultants_read_own_cs_participation" ON cs_commission_participants FOR SELECT
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION sync_cs_commission_participant_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE cs_commission_periods
  SET participant_count = (
    SELECT count(*) FROM cs_commission_participants
    WHERE period_id = COALESCE(NEW.period_id, OLD.period_id)
  )
  WHERE id = COALESCE(NEW.period_id, OLD.period_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_sync_cs_commission_participant_count ON cs_commission_participants;
CREATE TRIGGER trg_sync_cs_commission_participant_count
AFTER INSERT OR DELETE ON cs_commission_participants
FOR EACH ROW EXECUTE FUNCTION sync_cs_commission_participant_count();
