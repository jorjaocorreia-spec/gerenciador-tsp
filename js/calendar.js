/**
 * TSP Manager - Google Calendar Integration
 * 
 * ATENÇÃO USUÁRIO:
 * Você precisa criar um projeto no Google Cloud Console:
 * 1. Ativar a "Google Calendar API"
 * 2. Criar credenciais -> "Chave de API" (API Key)
 * 3. Criar credenciais -> "ID do cliente OAuth" (Aplicação da Web)
 *    - Adicionar http://localhost (ou o seu domínio) às Origens JavaScript Autorizadas
 * 4. Substitua as constantes abaixo pelas suas credenciais reais.
 */

const CLIENT_ID = (window.TSP_CONFIG && window.TSP_CONFIG.CLIENT_ID) || '';
const API_KEY = (window.TSP_CONFIG && window.TSP_CONFIG.API_KEY) || '';
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/calendar.events';

const GoogleCalendarAPI = {
    isEnabled: false,
    isAuthenticated: false,
    tokenClient: null,
    gapiInited: false,
    gisInited: false,

    init() {
        if (CLIENT_ID === 'SEU_CLIENT_ID_AQUI' || API_KEY === 'SUA_API_KEY_AQUI') {
            console.warn("Credenciais do Google Calendar ausentes. Substitua em js/calendar.js");
            return;
        }

        // Wait for both scripts to load in index.html, then we init.
        // In our app.js, we will call this when scripts trigger their onload.
    },

    async initGapiClient() {
        if (!gapi) return;
        return new Promise((resolve, reject) => {
            gapi.load('client', async () => {
                try {
                    await gapi.client.init({
                        apiKey: API_KEY,
                        discoveryDocs: [DISCOVERY_DOC],
                    });
                    this.gapiInited = true;
                    this.checkEnableStatus();
                    resolve();
                } catch (error) {
                    console.error("Erro ao inicializar GAPI client", error);
                    reject(error);
                }
            });
        });
    },

    initGisClient() {
        if (!google || !google.accounts || !google.accounts.oauth2) return;
        this.tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: '', // defined securely at request time
        });
        this.gisInited = true;
        this.checkEnableStatus();
    },

    checkEnableStatus() {
        if (this.gapiInited && this.gisInited) {
            this.isEnabled = true;
            console.log("Integração do Google Calendar inicializada e pronta para autorizar!");

            // Verifica se já existe um token ativo salvo e tenta usar?
            // A API GisToken no browser Vanilla geralmente exige prompt ou popup
            // se não estiver cacheado validamente (usa cookies do google accounts sob o capô).
            const token = gapi.client.getToken();
            if (token) {
                this.isAuthenticated = true;
                app.onCalendarAuthenticated();
            }
        }
    },

    async authenticateGoogle() {
        if (!this.isEnabled) {
            alert("A API do Google ainda não foi inicializada. Verifique as credenciais no js/calendar.js.");
            return Promise.resolve(false);
        }

        return new Promise((resolve) => {
            if (gapi.client.getToken() === null) {
                // Se não tem token, solicita ao usuário
                this.tokenClient.callback = async (resp) => {
                    if (resp.error !== undefined) {
                        console.error(resp);
                        resolve(false);
                        return;
                    }
                    this.isAuthenticated = true;
                    resolve(true);
                };
                this.tokenClient.requestAccessToken({ prompt: 'consent' });
            } else {
                // Já tem token
                this.tokenClient.callback = async (resp) => {
                    if (resp.error !== undefined) {
                        console.error(resp);
                        resolve(false);
                        return;
                    }
                    this.isAuthenticated = true;
                    resolve(true);
                };
                this.tokenClient.requestAccessToken({ prompt: '' }); // Pede refresh sem consentimento
            }
        });
    },

    // Convert local format to Google RFC3339 DateTime
    toGoogleDateTime(dateStr, timeStr) {
        // Date: YYYY-MM-DD, Time: HH:mm
        return `${dateStr}T${timeStr}:00-03:00`; // Assume timezone fixo Brasil (-03:00) para manter consistência sem libs extras, ajustável consoante o usuário.
    },

    // Retorna events do Google Calendar num periodo de 1 mês antes a 1 mês depois pra focar
    async syncEventsFromGoogle(syncRangeDays = 30) {
        if (!this.isAuthenticated) return null;

        const timeMin = new Date();
        timeMin.setDate(timeMin.getDate() - syncRangeDays);

        const timeMax = new Date();
        timeMax.setDate(timeMax.getDate() + syncRangeDays);

        try {
            const request = {
                calendarId: 'primary',
                timeMin: timeMin.toISOString(),
                timeMax: timeMax.toISOString(),
                showDeleted: false,
                singleEvents: true,
                maxResults: 250,
                orderBy: 'startTime',
            };

            const response = await gapi.client.calendar.events.list(request);
            return response.result.items;
        } catch (err) {
            console.error("Falha ao buscar eventos do Google.", err);
            return null;
        }
    },

    mapLocalToGoogleEvent(localEventData) {
        return {
            summary: localEventData.title || 'Evento TSP',
            description: (localEventData.description || '') + `\n\n[Gerado por TSP Manager - ID:${localEventData.id || ''}]`,
            location: localEventData.location || '',
            start: {
                dateTime: this.toGoogleDateTime(localEventData.date, localEventData.startTime),
                timeZone: 'America/Sao_Paulo'
            },
            end: {
                dateTime: this.toGoogleDateTime(localEventData.date, localEventData.endTime),
                timeZone: 'America/Sao_Paulo'
            }
        };
    },

    async createGoogleEvent(eventData) {
        if (!this.isAuthenticated) return null;
        try {
            const googleEventData = this.mapLocalToGoogleEvent(eventData);
            const request = await gapi.client.calendar.events.insert({
                calendarId: 'primary',
                resource: googleEventData
            });
            return request.result.id; // Retorna o ID do evento gerado pelo Google
        } catch (err) {
            console.error("Erro ao criar evento n Google", err);
            return null;
        }
    },

    async updateGoogleEvent(eventId, eventData) {
        if (!this.isAuthenticated) return false;
        try {
            const googleEventData = this.mapLocalToGoogleEvent(eventData);
            await gapi.client.calendar.events.update({
                calendarId: 'primary',
                eventId: eventId,
                resource: googleEventData
            });
            return true;
        } catch (err) {
            console.error("Erro ao atualizar evento no Google", err);
            return false;
        }
    },

    async deleteGoogleEvent(eventId) {
        if (!this.isAuthenticated || !eventId) return false;
        try {
            await gapi.client.calendar.events.delete({
                calendarId: 'primary',
                eventId: eventId
            });
            return true;
        } catch (err) {
            console.error("Erro ao deletar evento no Google", err);
            return false;
        }
    }
};

window.calendarAPI = GoogleCalendarAPI;

// Funções globais de callback que os scripts do Google no HTML irão chamar
window.gapiLoaded = function () {
    window.calendarAPI.initGapiClient();
};

window.gisLoaded = function () {
    window.calendarAPI.initGisClient();
};
