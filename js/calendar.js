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
        try {
            gapi.client.setApiKey(this._apiKey);
            await gapi.client.load(DISCOVERY_DOC);
            this.gapiInited = true;
        } catch (err) {
            console.error('Erro ao configurar GAPI client:', JSON.stringify(err));
            return;
        }
        try {
            this.tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: this._clientId,
                scope: SCOPES,
                callback: '',
            });
            this.gisInited = true;
        } catch (err) {
            console.error('Erro ao configurar GIS client:', err);
            return;
        }
        this._checkEnableStatus();
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
        if (!this.gapiInited || !this.gisInited) return;
        if (!this._clientId || !this._apiKey) return;
        this.isEnabled = true;
        console.log('Google Calendar inicializado e pronto.');
        const token = gapi.client.getToken();
        if (token) {
            this.isAuthenticated = true;
            if (window.app) app.onCalendarAuthenticated();
        }
    },

    async authenticateGoogle() {
        if (!this.isEnabled) {
            alert('Configure as credenciais do Google Calendar nas configurações da Agenda.');
            return Promise.resolve(false);
        }
        return new Promise((resolve) => {
            this.tokenClient.callback = async (resp) => {
                if (resp.error !== undefined) {
                    console.error(resp);
                    resolve(false);
                    return;
                }
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
        if (!this.isAuthenticated) return null;
        const timeMin = new Date();
        timeMin.setDate(timeMin.getDate() - syncRangeDays);
        const timeMax = new Date();
        timeMax.setDate(timeMax.getDate() + syncRangeDays);
        try {
            const response = await gapi.client.calendar.events.list({
                calendarId: 'primary',
                timeMin: timeMin.toISOString(),
                timeMax: timeMax.toISOString(),
                showDeleted: false,
                singleEvents: true,
                maxResults: 250,
                orderBy: 'startTime',
            });
            return response.result.items;
        } catch (err) {
            console.error('Falha ao buscar eventos do Google.', err);
            return null;
        }
    },

    mapLocalToGoogleEvent(localEventData) {
        return {
            summary: localEventData.title || 'Evento TSP',
            description: (localEventData.description || '') + `\n\n[Gerado por TSP Manager - ID:${localEventData.id || ''}]`,
            location: localEventData.location || '',
            start: { dateTime: this.toGoogleDateTime(localEventData.date, localEventData.startTime), timeZone: 'America/Sao_Paulo' },
            end:   { dateTime: this.toGoogleDateTime(localEventData.date, localEventData.endTime),   timeZone: 'America/Sao_Paulo' }
        };
    },

    async createGoogleEvent(eventData) {
        if (!this.isAuthenticated) return null;
        try {
            const request = await gapi.client.calendar.events.insert({
                calendarId: 'primary',
                resource: this.mapLocalToGoogleEvent(eventData)
            });
            return request.result.id;
        } catch (err) {
            console.error('Erro ao criar evento no Google', err);
            return null;
        }
    },

    async updateGoogleEvent(eventId, eventData) {
        if (!this.isAuthenticated) return false;
        try {
            await gapi.client.calendar.events.update({
                calendarId: 'primary',
                eventId: eventId,
                resource: this.mapLocalToGoogleEvent(eventData)
            });
            return true;
        } catch (err) {
            console.error('Erro ao atualizar evento no Google', err);
            return false;
        }
    },

    async deleteGoogleEvent(eventId) {
        if (!this.isAuthenticated || !eventId) return false;
        try {
            await gapi.client.calendar.events.delete({ calendarId: 'primary', eventId });
            return true;
        } catch (err) {
            console.error('Erro ao deletar evento no Google', err);
            return false;
        }
    }
};

window.calendarAPI = GoogleCalendarAPI;

window.gapiLoaded = function () {
    window.calendarAPI.initGapiClient();
};

window.gisLoaded = function () {
    window.calendarAPI.initGisClient();
};
