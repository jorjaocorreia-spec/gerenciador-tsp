-- Comissão CS: distribuição dos pools de vendas/mensalidade passa a ser
-- proporcional ao peso de horas de cada participante sobre a soma de todos
-- (share_i = percentual_i / sum_percentual), em vez de fatia fixa (pool/N)
-- por pessoa sem redistribuir a sobra de quem não bateu 15h. Precisamos da
-- soma de todos os percentuais do período — cacheada aqui pelo mesmo motivo
-- de participant_count: um consultor comum só enxerga a própria linha em
-- cs_commission_participants (RLS), então não teria como somar ele mesmo.
ALTER TABLE cs_commission_periods
  ADD COLUMN IF NOT EXISTS sum_percentual NUMERIC NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION sync_cs_commission_participant_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE cs_commission_periods
  SET participant_count = (
        SELECT count(*) FROM cs_commission_participants
        WHERE period_id = COALESCE(NEW.period_id, OLD.period_id)
      ),
      sum_percentual = (
        SELECT COALESCE(SUM(LEAST(hours_apontadas, 15) / 15.0), 0) FROM cs_commission_participants
        WHERE period_id = COALESCE(NEW.period_id, OLD.period_id)
      )
  WHERE id = COALESCE(NEW.period_id, OLD.period_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_sync_cs_commission_participant_count ON cs_commission_participants;
CREATE TRIGGER trg_sync_cs_commission_participant_count
AFTER INSERT OR UPDATE OR DELETE ON cs_commission_participants
FOR EACH ROW EXECUTE FUNCTION sync_cs_commission_participant_count();

-- Backfill dos períodos já existentes.
UPDATE cs_commission_periods p
SET sum_percentual = (
  SELECT COALESCE(SUM(LEAST(hours_apontadas, 15) / 15.0), 0) FROM cs_commission_participants
  WHERE period_id = p.id
);
