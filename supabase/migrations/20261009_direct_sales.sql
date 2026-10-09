-- Vendas Diretas (Financeiro): serviços e mensalidades fora dos contratos Tecinco.
-- Acesso restrito a duas contas via direct_sales_allowed() + RLS por user_id.
-- Sem nenhuma policy para manager/client (Modo Supervisão e Portal nunca enxergam).
-- Para alterar a lista de contas: CREATE OR REPLACE FUNCTION direct_sales_allowed()
-- e atualizar DIRECT_SALES_ALLOWED_EMAILS em js/app.js.

CREATE OR REPLACE FUNCTION direct_sales_allowed() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((auth.jwt() ->> 'email') IN ('jorge.henrique@tecinco.com.br', 'testes@teste.com'), false)
$$;

CREATE TABLE IF NOT EXISTS direct_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  contact TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (id, user_id)
);

CREATE TABLE IF NOT EXISTS direct_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  client_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('service', 'subscription')),
  description TEXT NOT NULL DEFAULT '',
  total_amount_cents BIGINT,
  installments INTEGER,
  monthly_amount_cents BIGINT,
  due_day INTEGER,
  start_month TEXT NOT NULL CHECK (start_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  cancelled_from TEXT CHECK (cancelled_from IS NULL OR cancelled_from ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (id, user_id),
  FOREIGN KEY (client_id, user_id) REFERENCES direct_clients (id, user_id) ON DELETE NO ACTION,
  CHECK (
    (kind = 'service' AND total_amount_cents IS NOT NULL AND total_amount_cents > 0
       AND installments IS NOT NULL AND installments >= 1
       AND monthly_amount_cents IS NULL AND due_day IS NULL AND cancelled_from IS NULL)
    OR
    (kind = 'subscription' AND monthly_amount_cents IS NOT NULL AND monthly_amount_cents > 0
       AND due_day IS NOT NULL AND due_day BETWEEN 1 AND 31
       AND total_amount_cents IS NULL AND installments IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS direct_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  contract_id UUID NOT NULL,
  charge_key TEXT NOT NULL,
  competence TEXT NOT NULL CHECK (competence ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  due_date DATE NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  paid_at DATE,
  manually_edited BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (contract_id, charge_key),
  FOREIGN KEY (contract_id, user_id) REFERENCES direct_contracts (id, user_id) ON DELETE CASCADE,
  CHECK ((status = 'paid') = (paid_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_direct_charges_user_competence ON direct_charges (user_id, competence);
CREATE INDEX IF NOT EXISTS idx_direct_charges_user_paid_at ON direct_charges (user_id, paid_at);
CREATE INDEX IF NOT EXISTS idx_direct_charges_user_status_due ON direct_charges (user_id, status, due_date);

CREATE TABLE IF NOT EXISTS direct_contract_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  contract_id UUID NOT NULL,
  from_month TEXT NOT NULL CHECK (from_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  new_amount_cents BIGINT NOT NULL CHECK (new_amount_cents > 0),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (contract_id, from_month),
  FOREIGN KEY (contract_id, user_id) REFERENCES direct_contracts (id, user_id) ON DELETE CASCADE
);

-- RLS: dono + conta permitida (leitura E escrita)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['direct_clients', 'direct_contracts', 'direct_charges', 'direct_contract_adjustments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS ds_own ON %I', t);
    EXECUTE format(
      'CREATE POLICY ds_own ON %I FOR ALL USING (user_id = auth.uid() AND direct_sales_allowed()) WITH CHECK (user_id = auth.uid() AND direct_sales_allowed())',
      t);
  END LOOP;
END $$;

-- Funções auxiliares (SECURITY INVOKER: RLS continua valendo)
CREATE OR REPLACE FUNCTION direct_due_date(p_competence text, p_due_day int) RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT (to_date(p_competence || '-01', 'YYYY-MM-DD')
    + (LEAST(p_due_day,
        EXTRACT(day FROM (to_date(p_competence || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day'))::int) - 1))::date
$$;

CREATE OR REPLACE FUNCTION direct_amount_for(p_contract uuid, p_competence text) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT a.new_amount_cents FROM direct_contract_adjustments a
      WHERE a.contract_id = p_contract AND a.from_month <= p_competence
      ORDER BY a.from_month DESC LIMIT 1),
    (SELECT c.monthly_amount_cents FROM direct_contracts c WHERE c.id = p_contract))
$$;

-- Cobrança nunca nasce em competência cancelada
CREATE OR REPLACE FUNCTION direct_charges_check_cancel() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE cf text;
BEGIN
  SELECT cancelled_from INTO cf FROM direct_contracts WHERE id = NEW.contract_id;
  IF cf IS NOT NULL AND NEW.competence >= cf THEN
    RAISE EXCEPTION 'Contrato cancelado a partir de %', cf;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_direct_charges_check_cancel ON direct_charges;
CREATE TRIGGER trg_direct_charges_check_cancel BEFORE INSERT ON direct_charges
  FOR EACH ROW EXECUTE FUNCTION direct_charges_check_cancel();

-- Contrato com cobrança paga não pode ser apagado (vale mesmo via API direta)
CREATE OR REPLACE FUNCTION direct_contracts_block_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM direct_charges WHERE contract_id = OLD.id AND status = 'paid') THEN
    RAISE EXCEPTION 'Contrato possui cobranças pagas e não pode ser excluído';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_direct_contracts_block_delete ON direct_contracts;
CREATE TRIGGER trg_direct_contracts_block_delete BEFORE DELETE ON direct_contracts
  FOR EACH ROW EXECUTE FUNCTION direct_contracts_block_delete();

-- Geração idempotente e atômica das mensalidades
CREATE OR REPLACE FUNCTION ensure_direct_charges(p_contract_id uuid, p_until text) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  c direct_contracts%ROWTYPE;
  cur date; last_m date; comp text; n int := 0;
BEGIN
  SELECT * INTO c FROM direct_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND OR c.kind <> 'subscription' THEN RETURN 0; END IF;
  cur := to_date(c.start_month || '-01', 'YYYY-MM-DD');
  last_m := to_date(p_until || '-01', 'YYYY-MM-DD');
  IF c.cancelled_from IS NOT NULL THEN
    IF (to_date(c.cancelled_from || '-01', 'YYYY-MM-DD') - interval '1 month')::date < last_m THEN
      last_m := (to_date(c.cancelled_from || '-01', 'YYYY-MM-DD') - interval '1 month')::date;
    END IF;
  END IF;
  WHILE cur <= last_m LOOP
    comp := to_char(cur, 'YYYY-MM');
    INSERT INTO direct_charges (user_id, contract_id, charge_key, competence, due_date, amount_cents)
    VALUES (c.user_id, c.id, 'm:' || comp, comp, direct_due_date(comp, c.due_day), direct_amount_for(c.id, comp))
    ON CONFLICT (contract_id, charge_key) DO NOTHING;
    IF FOUND THEN n := n + 1; END IF;
    cur := (cur + interval '1 month')::date;
  END LOOP;
  RETURN n;
END $$;

-- Reajuste: grava o ajuste e recalcula cada pendente não editada pela mesma função de valor
CREATE OR REPLACE FUNCTION adjust_direct_contract(p_contract_id uuid, p_from_month text, p_new_amount_cents bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE c direct_contracts%ROWTYPE;
BEGIN
  SELECT * INTO c FROM direct_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND OR c.kind <> 'subscription' THEN RAISE EXCEPTION 'Contrato de mensalidade não encontrado'; END IF;
  IF p_new_amount_cents IS NULL OR p_new_amount_cents <= 0 THEN RAISE EXCEPTION 'Valor inválido'; END IF;
  IF p_from_month < c.start_month THEN RAISE EXCEPTION 'Mês anterior ao início do contrato'; END IF;
  IF c.cancelled_from IS NOT NULL AND p_from_month >= c.cancelled_from THEN
    RAISE EXCEPTION 'Mês posterior ao cancelamento do contrato';
  END IF;
  INSERT INTO direct_contract_adjustments (user_id, contract_id, from_month, new_amount_cents)
  VALUES (c.user_id, c.id, p_from_month, p_new_amount_cents)
  ON CONFLICT (contract_id, from_month) DO UPDATE SET new_amount_cents = EXCLUDED.new_amount_cents;
  UPDATE direct_charges
     SET amount_cents = direct_amount_for(contract_id, competence)
   WHERE contract_id = c.id AND status = 'pending' AND manually_edited = false
     AND competence >= p_from_month;
END $$;

-- Cancelamento: define cancelled_from e apaga as pendentes dessa competência em diante
CREATE OR REPLACE FUNCTION cancel_direct_contract(p_contract_id uuid, p_from_month text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE c direct_contracts%ROWTYPE;
BEGIN
  SELECT * INTO c FROM direct_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND OR c.kind <> 'subscription' THEN RAISE EXCEPTION 'Contrato de mensalidade não encontrado'; END IF;
  IF p_from_month < c.start_month THEN RAISE EXCEPTION 'Mês anterior ao início do contrato'; END IF;
  UPDATE direct_contracts SET cancelled_from = p_from_month WHERE id = c.id;
  DELETE FROM direct_charges
   WHERE contract_id = c.id AND status = 'pending' AND competence >= p_from_month;
END $$;
