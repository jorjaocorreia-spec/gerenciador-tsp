-- Fase 45: Migra todos os dados de jorjaocorreia@gmail.com para
-- jorge.henrique@tecinco.com.br (mesma pessoa, troca de e-mail de login).
--
-- Percorre TODA tabela do schema public que tenha uma coluna user_id e
-- troca o valor do usuário antigo pelo novo. Usa information_schema em vez
-- de uma lista fixa de tabelas, para não depender de memorizar o schema
-- completo e não deixar nenhuma tabela de fora.
--
-- Tabelas onde user_id é PRIMARY KEY (ex.: otobo_config, user_ai_config,
-- user_profiles) só têm 1 linha por usuário; se jorge.henrique@tecinco.com.br
-- já tiver uma linha própria nessas tabelas, a migração dessa tabela
-- específica é pulada com um aviso (conflito de chave primária) — nesse
-- caso, decida manualmente qual das duas linhas manter.

DO $$
DECLARE
  old_id uuid;
  new_id uuid;
  rec RECORD;
  affected_count int;
BEGIN
  SELECT id INTO old_id FROM auth.users WHERE email = 'jorjaocorreia@gmail.com';
  SELECT id INTO new_id FROM auth.users WHERE email = 'jorge.henrique@tecinco.com.br';

  IF old_id IS NULL THEN
    RAISE EXCEPTION 'jorjaocorreia@gmail.com não encontrado em auth.users';
  END IF;
  IF new_id IS NULL THEN
    RAISE EXCEPTION 'jorge.henrique@tecinco.com.br não encontrado em auth.users';
  END IF;

  FOR rec IN
    SELECT table_name
    FROM information_schema.columns
    WHERE column_name = 'user_id'
      AND table_schema = 'public'
      AND table_name <> 'user_roles' -- não mexer na tabela de papéis aqui
  LOOP
    BEGIN
      EXECUTE format('UPDATE %I SET user_id = $1 WHERE user_id = $2', rec.table_name)
        USING new_id, old_id;
      GET DIAGNOSTICS affected_count = ROW_COUNT;
      RAISE NOTICE 'Tabela %: % linha(s) migrada(s)', rec.table_name, affected_count;
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'Tabela %: CONFLITO (jorge.henrique já tem uma linha própria) — verifique manualmente', rec.table_name;
    END;
  END LOOP;
END $$;

-- Verificação: qualquer tabela que ainda apareça aqui embaixo tem linhas
-- que NÃO foram migradas (provavelmente por conflito de chave primária,
-- reportado como NOTICE acima).
DO $$
DECLARE
  old_id uuid;
  rec RECORD;
  cnt int;
BEGIN
  SELECT id INTO old_id FROM auth.users WHERE email = 'jorjaocorreia@gmail.com';
  FOR rec IN
    SELECT table_name FROM information_schema.columns
    WHERE column_name = 'user_id' AND table_schema = 'public' AND table_name <> 'user_roles'
  LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE user_id = $1', rec.table_name)
      INTO cnt USING old_id;
    IF cnt > 0 THEN
      RAISE NOTICE 'AINDA SOBROU: % tem % linha(s) com o user_id antigo', rec.table_name, cnt;
    END IF;
  END LOOP;
  RAISE NOTICE 'Verificação concluída.';
END $$;
