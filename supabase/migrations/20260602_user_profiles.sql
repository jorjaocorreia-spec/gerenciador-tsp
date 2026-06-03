-- Fase 32: Perfil do usuário com número WhatsApp para bot
-- Armazena número de WhatsApp vinculado à conta para identificação no webhook

CREATE TABLE IF NOT EXISTS user_profiles (
    user_id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
    whatsapp_number TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_profile" ON user_profiles
    FOR ALL USING (auth.uid() = user_id);
