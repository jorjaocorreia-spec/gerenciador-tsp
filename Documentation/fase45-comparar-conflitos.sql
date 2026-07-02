-- Compara as linhas conflitantes de otobo_config e user_settings entre a
-- conta antiga (jorjaocorreia@gmail.com) e a nova (jorge.henrique@tecinco.com.br).
-- Não mostra a senha/api_key em texto puro — só se está preenchida ou vazia,
-- pra você decidir qual linha manter sem expor a credencial na tela.

SELECT
  'otobo_config' AS tabela,
  u.email,
  oc.url,
  oc.username,
  (oc.password IS NOT NULL AND oc.password <> '') AS tem_senha,
  oc.updated_at,
  oc.last_sync_at
FROM otobo_config oc
JOIN auth.users u ON u.id = oc.user_id
WHERE u.email IN ('jorjaocorreia@gmail.com', 'jorge.henrique@tecinco.com.br');

SELECT
  'user_settings' AS tabela,
  u.email,
  us.*
FROM user_settings us
JOIN auth.users u ON u.id = us.user_id
WHERE u.email IN ('jorjaocorreia@gmail.com', 'jorge.henrique@tecinco.com.br');
