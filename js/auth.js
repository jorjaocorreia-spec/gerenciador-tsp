const Auth = {
    client: null,
    currentUser: null,

    init() {
        const { createClient } = supabase;
        this.client = createClient(
            window.TSP_CONFIG.SUPABASE_URL,
            window.TSP_CONFIG.SUPABASE_ANON_KEY
        );
        window.supabaseClient = this.client;
    },

    async getSession() {
        const { data: { session } } = await this.client.auth.getSession();
        this.currentUser = session?.user ?? null;
        return this.currentUser;
    },

    async signIn(email, password) {
        const { data, error } = await this.client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        this.currentUser = data.user;
        return data.user;
    },

    async signOut() {
        await this.client.auth.signOut();
        this.currentUser = null;
        this.showAuthScreen();
    },

    getUserId() {
        return this.currentUser?.id ?? null;
    },

    getUserEmail() {
        return this.currentUser?.email ?? '';
    },

    // ── UI ──────────────────────────────────────────

    showAuthScreen() {
        document.getElementById('auth-screen').style.display = 'flex';
        document.querySelector('.sidebar').style.display = 'none';
        document.getElementById('main-content').style.display = 'none';
    },

    hideAuthScreen() {
        document.getElementById('auth-screen').style.display = 'none';
        document.querySelector('.sidebar').style.display = '';
        document.getElementById('main-content').style.display = '';
        const emailEl = document.getElementById('user-email-display');
        if (emailEl) emailEl.textContent = this.getUserEmail();
    },

    showMessage(text, isError = true) {
        const el = document.getElementById('auth-message');
        el.textContent = text;
        el.style.display = 'block';
        el.style.background = isError ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)';
        el.style.color = isError ? '#ef4444' : '#10b981';
        el.style.border = isError ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(16,185,129,0.3)';
    },

    clearMessage() {
        const el = document.getElementById('auth-message');
        el.style.display = 'none';
        el.textContent = '';
    },

    async handleSubmit(e) {
        e.preventDefault();
        const email = document.getElementById('auth-email').value.trim();
        const password = document.getElementById('auth-password').value;
        const btn = document.getElementById('auth-submit');

        btn.disabled = true;
        btn.textContent = 'Aguarde...';
        this.clearMessage();

        try {
            await this.signIn(email, password);
            this.hideAuthScreen();
            if (window.app) window.app.initAfterAuth();
        } catch (err) {
            const msgs = {
                'Invalid login credentials': 'E-mail ou senha incorretos.',
                'Email not confirmed': 'Confirme seu e-mail antes de entrar.',
            };
            this.showMessage(msgs[err.message] || err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Entrar';
        }
    }
};

window.Auth = Auth;
