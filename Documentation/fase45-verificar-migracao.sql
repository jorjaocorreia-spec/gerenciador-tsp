-- Verificação direta (sem depender de RAISE NOTICE): para cada tabela com
-- coluna user_id, mostra quantas linhas ainda pertencem à conta antiga
-- (jorjaocorreia@gmail.com) e quantas já pertencem à nova
-- (jorge.henrique@tecinco.com.br). Se a migração funcionou, a coluna
-- "linhas_antigo" deve ser 0 em todas as linhas do resultado.

DO $$
DECLARE
  old_id uuid;
  new_id uuid;
  rec RECORD;
  cnt_old int;
  cnt_new int;
BEGIN
  SELECT id INTO old_id FROM auth.users WHERE email = 'jorjaocorreia@gmail.com';
  SELECT id INTO new_id FROM auth.users WHERE email = 'jorge.henrique@tecinco.com.br';

  DROP TABLE IF EXISTS _migracao_check;
  CREATE TEMP TABLE _migracao_check (tabela text, linhas_antigo int, linhas_novo int);

  FOR rec IN
    SELECT DISTINCT table_name FROM information_schema.columns
    WHERE column_name = 'user_id' AND table_schema = 'public' AND table_name <> 'user_roles'
  LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE user_id = $1', rec.table_name) INTO cnt_old USING old_id;
    EXECUTE format('SELECT count(*) FROM %I WHERE user_id = $1', rec.table_name) INTO cnt_new USING new_id;
    INSERT INTO _migracao_check VALUES (rec.table_name, cnt_old, cnt_new);
  END LOOP;
END $$;

SELECT * FROM _migracao_check ORDER BY tabela;
