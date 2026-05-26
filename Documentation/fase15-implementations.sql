-- Fase 15: Tabela de Implementações
-- Executar no SQL Editor do Supabase

-- ── 1. Tabela principal ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS implementations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'feature',
    -- valores aceitos: trigger, procedure, feature, customization, integration
    description TEXT NOT NULL DEFAULT '',
    code_script TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    -- valores aceitos: active, testing, discontinued
    version TEXT NOT NULL DEFAULT '',
    implementation_date DATE,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── 2. Tabela de vínculo M:N (implementation ↔ client) ──────────
CREATE TABLE IF NOT EXISTS implementation_clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
    implementation_id UUID REFERENCES implementations ON DELETE CASCADE NOT NULL,
    client_id UUID REFERENCES clients ON DELETE CASCADE NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (implementation_id, client_id)
);

-- ── 3. RLS — implementations ────────────────────────────────────
ALTER TABLE implementations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "implementations: select own" ON implementations
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "implementations: insert own" ON implementations
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "implementations: update own" ON implementations
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "implementations: delete own" ON implementations
    FOR DELETE USING (auth.uid() = user_id);

-- ── 4. RLS — implementation_clients ─────────────────────────────
ALTER TABLE implementation_clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "impl_clients: select own" ON implementation_clients
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "impl_clients: insert own" ON implementation_clients
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "impl_clients: update own" ON implementation_clients
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "impl_clients: delete own" ON implementation_clients
    FOR DELETE USING (auth.uid() = user_id);

-- ── 5. Índices ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_implementations_user ON implementations (user_id);
CREATE INDEX IF NOT EXISTS idx_impl_clients_impl ON implementation_clients (implementation_id);
CREATE INDEX IF NOT EXISTS idx_impl_clients_client ON implementation_clients (client_id);
