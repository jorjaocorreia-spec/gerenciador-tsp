const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/calendar.events';

const GoogleCalendarAPI = {
    isEnabled: false,
    isAuthenticated: false,
    tokenClient: null,
    gapiInited: false,
    gisInited: false,
    _clientId: '',
    _apiKey: '',
    _STORAGE_KEY: 'gapi_calendar_token',

    _saveToken(tokenResp) {
        // Prefere o resp passado diretamente — gapi.client.getToken() ainda pode ser null
        // dentro do callback GIS, pois a sincronização com gapi é assíncrona via postMessage.
        const token = (tokenResp && tokenResp.access_token) ? tokenResp : gapi.client.getToken();
        if (!token || !token.access_token) return;
        try {
            localStorage.setItem(this._STORAGE_KEY, JSON.stringify({ ...token, _savedAt: Date.now() }));
        } catch {}
    },

    _loadSavedToken() {
        try {
            const raw = localStorage.getItem(this._STORAGE_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            const ageMs = Date.now() - (data._savedAt || 0);
            const maxAgeMs = ((data.expires_in || 3600) - 120) * 1000;
            return ageMs < maxAgeMs ? data : null;
        } catch { return null; }
    },

    clearSavedToken() {
        try { localStorage.removeItem(this._STORAGE_KEY); } catch {}
    },

    // Tenta obter token sem UI — funciona silenciosamente quando o usuário já tem
    // sessão Google ativa e já concedeu consentimento anteriormente.
    // Fire-and-forget: falha silenciosa se não houver sessão.
    _trySilentAuth() {
        if (!this.isEnabled || !this.tokenClient || this.isAuthenticated) return;
        this.tokenClient.callback = (resp) => {
            if (resp.error !== undefined) return; // sem sessão ativa — ok, usuário conecta manualmente
            this._saveToken(resp);
            this.isAuthenticated = true;
            if (window.app) { app.onCalendarAuthenticated(); app._updateGoogleSyncStatus(); }
        };
        try { this.tokenClient.requestAccessToken({ prompt: '' }); } catch {}
    },

    // Garante token válido antes de chamadas à API.
    // Tenta restaurar do localStorage; se expirado, tenta silent re-auth.
    // Retorna true se token disponível, false se precisar de interação do usuário.
    async _ensureToken() {
        if (this.isAuthenticated && gapi.client.getToken()?.access_token) return true;
        const saved = this._loadSavedToken();
        if (saved) {
            gapi.client.setToken(saved);
            this.isAuthenticated = true;
            return true;
        }
        // Token expirado — tenta silent re-auth com timeout de 5s
        return new Promise((resolve) => {
            const timer = setTimeout(() => resolve(false), 5000);
            this.tokenClient.callback = (resp) => {
                clearTimeout(timer);
                if (resp.error !== undefined) { this.isAuthenticated = false; resolve(false); return; }
                this._saveToken(resp);
                this.isAuthenticated = true;
                if (window.app) app._updateGoogleSyncStatus();
                resolve(true);
            };
            try { this.tokenClient.requestAccessToken({ prompt: '' }); }
            catch { clearTimeout(timer); resolve(false); }
        });
    },

    // Chamado após carregar as credenciais do Supabase.
    // Lida com dois cenários: scripts CDN já carregados, ou ainda pendentes.
    async configure(clientId, apiKey) {
        this._clientId = clientId || '';
        this._apiKey = apiKey || '';

        if (!this._clientId || !this._apiKey) return;

        if (this.gapiInited && this.gisInited) {
            // Scripts já carregaram antes das credenciais chegarem — reinicializa
            await this._applyConfig();
        }
        // Se os scripts ainda não carregaram, gapiLoaded/gisLoaded farão a init quando chamados
    },

    async _applyConfig() {
        if (!this._clientId || !this._apiKey) return;

        // Configura API key (síncrono)
        gapi.client.setApiKey(this._apiKey);

        // Cria token client (síncrono)
        try {
            this.tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: this._clientId,
                scope: SCOPES,
                callback: '',
            });
        } catch (err) {
            console.error('Erro ao configurar GIS client:', err);
            return;
        }

        // Habilita integração imediatamente
        this.isEnabled = true;
        console.log('Google Calendar habilitado. Carregando discovery doc...');

        // Carrega discovery doc em background (necessário para gapi.client.calendar)
        try {
            await gapi.client.load(DISCOVERY_DOC);
            console.log('Google Calendar API pronta.');
        } catch (err) {
            console.error('Erro ao carregar Calendar discovery doc:', JSON.stringify(err));
            // isEnabled permanece true — o erro aparecerá na primeira chamada de sync
        }

        const token = gapi.client.getToken();
        if (token && token.access_token) {
            this.isAuthenticated = true;
            if (window.app) app.onCalendarAuthenticated();
        } else {
            const saved = this._loadSavedToken();
            if (saved) {
                gapi.client.setToken(saved);
                this.isAuthenticated = true;
                if (window.app) app.onCalendarAuthenticated();
            } else {
                // Nenhum token válido — tenta conectar automaticamente se sessão Google ativa
                this._trySilentAuth();
            }
        }
        // Atualiza chip de status mesmo quando não autenticado
        if (window.app) app._updateGoogleSyncStatus();
    },

    async initGapiClient() {
        if (!gapi) return;
        return new Promise((resolve) => {
            gapi.load('client', async () => {
                // Marca como carregado; _applyConfig() fará a configuração real quando credentials chegarem
                this.gapiInited = true;
                if (this._clientId && this._apiKey) {
                    await this._applyConfig();
                }
                resolve();
            });
        });
    },

    initGisClient() {
        if (!google || !google.accounts || !google.accounts.oauth2) return;
        const clientId = this._clientId;
        if (!clientId) {
            // Credenciais ainda não chegaram; marca como pronto para quando configure() for chamado
            this.gisInited = true;
            return;
        }
        this.tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: SCOPES,
            callback: '',
        });
        this.gisInited = true;
        this._checkEnableStatus();
    },

    _checkEnableStatus() {
        if (this.gapiInited && this.gisInited && this._clientId && this._apiKey) {
            this._applyConfig();
        }
    },

    async authenticateGoogle() {
        if (!this.isEnabled) {
            if (window.Toast) Toast.show('Configure as credenciais do Google Calendar nas configurações da Agenda.', 'warning');
            return Promise.resolve(false);
        }
        return new Promise((resolve) => {
            this.tokenClient.callback = async (resp) => {
                if (resp.error !== undefined) {
                    console.error(resp);
                    resolve(false);
                    return;
                }
                this._saveToken(resp);
                this.isAuthenticated = true;
                resolve(true);
            };
            const prompt = gapi.client.getToken() === null ? 'consent' : '';
            this.tokenClient.requestAccessToken({ prompt });
        });
    },

    toGoogleDateTime(dateStr, timeStr) {
        return `${dateStr}T${timeStr}:00-03:00`;
    },

    async syncEventsFromGoogle(syncRangeDays = 30) {
        if (!await this._ensureToken()) return null;
        const timeMin = new Date();
        timeMin.setDate(timeMin.getDate() - syncRangeDays);
        const timeMax = new Date();
        timeMax.setDate(timeMax.getDate() + syncRangeDays);
        try {
            // Busca todos os calendários do usuário para capturar convites e calendários compartilhados
            let calendarIds = ['primary'];
            try {
                const calList = await gapi.client.calendar.calendarList.list({ minAccessRole: 'reader' });
                const items = calList.result.items || [];
                calendarIds = [...new Set(['primary', ...items.map(c => c.id)])];
            } catch (e) {
                console.warn('Não foi possível listar calendários; usando apenas primary.', e);
            }

            const seen = new Set();
            let allEvents = [];
            let fetchSuccessCount = 0;
            for (const calId of calendarIds) {
                try {
                    const response = await gapi.client.calendar.events.list({
                        calendarId: calId,
                        timeMin: timeMin.toISOString(),
                        timeMax: timeMax.toISOString(),
                        showDeleted: false,
                        singleEvents: true,
                        maxResults: 250,
                        orderBy: 'startTime',
                    });
                    for (const ev of (response.result.items || [])) {
                        if (!seen.has(ev.id)) { seen.add(ev.id); allEvents.push({ ...ev, _calendarId: calId }); }
                    }
                    fetchSuccessCount++;
                } catch (err) {
                    console.warn(`Falha ao buscar eventos do calendário ${calId}:`, err);
                }
            }
            // Se todos os calendários falharam, aborta para não deletar eventos locais via passo 3
            if (fetchSuccessCount === 0) {
                console.error('Todos os calendários falharam; sync abortado para preservar dados locais.');
                return null;
            }
            return allEvents;
        } catch (err) {
            console.error('Falha ao buscar eventos do Google.', err);
            return null;
        }
    },

    mapLocalToGoogleEvent(localEventData) {
        const isAllDay = !localEventData.startTime;
        const dateEnd = localEventData.dateEnd || localEventData.date;
        // Google all-day events: end date is exclusive, so add 1 day
        let googleEndDate = dateEnd;
        if (isAllDay) {
            const d = new Date(dateEnd + 'T12:00:00');
            d.setDate(d.getDate() + 1);
            googleEndDate = d.toISOString().split('T')[0];
        }
        const resource = {
            summary: localEventData.title || 'Evento TSP',
            description: (localEventData.description || '') + `\n\n[Gerado por TSP Manager - ID:${localEventData.id || ''}]`,
            location: localEventData.location || '',
            start: isAllDay
                ? { date: localEventData.date }
                : { dateTime: this.toGoogleDateTime(localEventData.date, localEventData.startTime), timeZone: 'America/Sao_Paulo' },
            end: isAllDay
                ? { date: googleEndDate }
                : { dateTime: this.toGoogleDateTime(dateEnd, localEventData.endTime), timeZone: 'America/Sao_Paulo' }
        };

        // Participantes
        if (localEventData.attendees) {
            const emails = localEventData.attendees.split(',').map(e => e.trim()).filter(Boolean);
            if (emails.length > 0) {
                resource.attendees = emails.map(email => ({ email }));
            }
        }

        // Google Meet — só cria na primeira vez (sem meetLink já salvo)
        if (localEventData.generateMeet && !localEventData.meetLink) {
            resource.conferenceData = {
                createRequest: {
                    requestId: crypto.randomUUID(),
                    conferenceSolutionKey: { type: 'hangoutsMeet' }
                }
            };
        }

        return resource;
    },

    async createGoogleEvent(eventData) {
        if (!await this._ensureToken()) return null;
        try {
            const params = { calendarId: 'primary', resource: this.mapLocalToGoogleEvent(eventData) };
            if (eventData.generateMeet) params.conferenceDataVersion = 1;
            if (eventData.attendees) params.sendUpdates = 'all';
            const request = await gapi.client.calendar.events.insert(params);
            return {
                id: request.result.id,
                meetLink: request.result.hangoutLink || ''
            };
        } catch (err) {
            console.error('Erro ao criar evento no Google', err);
            return null;
        }
    },

    async updateGoogleEvent(eventId, eventData) {
        if (!await this._ensureToken()) return false;
        try {
            const params = {
                calendarId: 'primary',
                eventId: eventId,
                resource: this.mapLocalToGoogleEvent(eventData)
            };
            if (eventData.generateMeet) params.conferenceDataVersion = 1;
            if (eventData.attendees) params.sendUpdates = 'all';
            const request = await gapi.client.calendar.events.update(params);
            return {
                ok: true,
                meetLink: request.result.hangoutLink || eventData.meetLink || ''
            };
        } catch (err) {
            console.error('Erro ao atualizar evento no Google', err);
            return false;
        }
    },

    async deleteGoogleEvent(eventId) {
        if (!eventId || !await this._ensureToken()) return false;
        try {
            await gapi.client.calendar.events.delete({ calendarId: 'primary', eventId });
            return true;
        } catch (err) {
            console.error('Erro ao deletar evento no Google', err);
            return false;
        }
    },

    async patchEventRsvp(calendarId, googleEventId, userEmail, responseStatus) {
        if (!await this._ensureToken()) return false;
        try {
            const getResp = await gapi.client.calendar.events.get({
                calendarId,
                eventId: googleEventId
            });
            const currentAttendees = getResp.result.attendees || [];
            let updated = false;
            const updatedAttendees = currentAttendees.map(a => {
                if (a.self || a.email === userEmail) {
                    updated = true;
                    return { ...a, responseStatus };
                }
                return a;
            });
            if (!updated) updatedAttendees.push({ email: userEmail, responseStatus });
            await gapi.client.calendar.events.patch({
                calendarId,
                eventId: googleEventId,
                sendUpdates: 'all',
                resource: { attendees: updatedAttendees }
            });
            return true;
        } catch (err) {
            console.error('Erro ao atualizar RSVP no Google', err);
            return false;
        }
    },
};

window.calendarAPI = GoogleCalendarAPI;

window.gapiLoaded = function () {
    window.calendarAPI.initGapiClient();
};

window.gisLoaded = function () {
    window.calendarAPI.initGisClient();
};
