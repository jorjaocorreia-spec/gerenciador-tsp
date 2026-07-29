-- Fase 49 (extensão): Gerente também precisa ler holidays/user_profiles para a
-- view Produtividade renderizar a meta real do consultor supervisionado, em vez
-- de cair no fallback padrão de 44h/semana. Efeito colateral aceito (aprovado
-- pelo usuário): manager também pode ler whatsapp_number de outros consultores
-- via esta mesma tabela — RLS do Postgres é por linha, não por coluna.

CREATE POLICY "managers_read_all_holidays" ON holidays FOR SELECT
    USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'manager'));

CREATE POLICY "managers_read_all_user_profiles" ON user_profiles FOR SELECT
    USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'manager'));
