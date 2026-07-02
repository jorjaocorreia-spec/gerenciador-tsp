-- Fase 45: Bootstrap de todos os consultores já cadastrados como role='consultant'
-- Rodar uma única vez no SQL Editor do Supabase, DEPOIS de aplicar
-- supabase/migrations/20260701_user_roles.sql (tabela + policies).
--
-- Assume que, neste momento, TODO usuário existente em auth.users é um
-- consultor (ninguém foi convidado como 'client' ainda). Se isso não for
-- mais verdade no futuro, não rodar este script de novo sem revisar.

INSERT INTO user_roles (user_id, role)
SELECT id, 'consultant' FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- Conferência: lista todos os usuários e seu papel atual.
-- Qualquer linha com role = NULL é alguém que ficou de fora (não deveria
-- acontecer com o INSERT acima, mas serve como checagem).
SELECT u.email, ur.role, ur.client_id, ur.created_at
FROM auth.users u
LEFT JOIN user_roles ur ON ur.user_id = u.id
ORDER BY u.email;
