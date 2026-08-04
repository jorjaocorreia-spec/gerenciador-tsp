-- Comissão CS: horas vêm de Atendimentos (records) no cliente escolhido pelo
-- Gerente para cada consultor, não mais de Apontamentos por número de projeto
-- (na prática cada consultor já tem seu próprio cliente "CS" com números de
-- projeto inconsistentes entre si — casar por project_num era frágil).
ALTER TABLE cs_commission_participants
  ADD COLUMN IF NOT EXISTS hours_client_id UUID REFERENCES clients;
