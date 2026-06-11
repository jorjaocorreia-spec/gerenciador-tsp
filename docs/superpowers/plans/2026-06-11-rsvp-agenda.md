# RSVP de Eventos da Agenda Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar indicador "Você vai?" (Sim/Talvez/Não) nos blocos de eventos recebidos via convite do Google Calendar, sincronizando a resposta de volta ao Google e permitindo ocultar eventos declinados.

**Architecture:** A feature é puramente aditiva: novas colunas em `agenda_events` e `user_profiles`, novo método `patchEventRsvp` no `calendar.js`, extração de dados RSVP no loop de sync existente, indicador visual renderizado em `createEventBlockHtml`/`createAllDayBannerHtml`, e mini-popup de resposta gerenciado pelo AppController.

**Tech Stack:** Vanilla JS ES6+, Supabase PostgreSQL, Google Calendar API v3 (gapi), CSS custom properties, Lucide icons.

---

## Arquivos modificados

| Arquivo | O que muda |
|---------|-----------|
| `js/store.js` | `_event()` inclui novos campos; `addAgendaEvent`/`updateAgendaEvent` persistem campos novos; 4 novos métodos RSVP |
| `js/calendar.js` | `syncEventsFromGoogle` marca cada evento com `_calendarId`; novo método `patchEventRsvp` |
| `js/app.js` | Constructor + logout com novos campos; `executeBiDirectionalSync` extrai RSVP; `createEventBlockHtml`/`createAllDayBannerHtml` com indicador; 7 novos métodos; `initAfterAuth` carrega setting |
| `index.html` | Botão toggle no header da view Agenda |
| `styles/main.css` | Estilos do indicador, popup, evento declinado, ocultar declinados |

---

## Task 1: Migrations SQL no Supabase

**Files:**
- No files changed — executar no SQL Editor do Supabase

- [ ] **Step 1: Executar migrations no Supabase**

Abrir o Supabase SQL Editor (`https://supabase.com/dashboard/project/klimkamnydfnzqetqlqm/sql`) e executar:

```sql
ALTER TABLE agenda_events ADD COLUMN IF NOT EXISTS rsvp_status TEXT DEFAULT 'needsAction';
ALTER TABLE agenda_events ADD COLUMN IF NOT EXISTS is_invited BOOLEAN DEFAULT FALSE;
ALTER TABLE agenda_events ADD COLUMN IF NOT EXISTS calendar_id TEXT DEFAULT 'primary';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS hide_declined_events BOOLEAN DEFAULT FALSE;
```

- [ ] **Step 2: Verificar colunas criadas**

No SQL Editor, rodar:
```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'agenda_events'
  AND column_name IN ('rsvp_status', 'is_invited', 'calendar_id');

SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'user_profiles'
  AND column_name = 'hide_declined_events';
```

Resultado esperado: 4 linhas com os nomes, tipos e defaults corretos.

---

## Task 2: store.js — novos campos e métodos

**Files:**
- Modify: `js/store.js`

- [ ] **Step 1: Atualizar `_event()` para incluir os novos campos**

Localizar (linha ~44):
```js
    _event(r) {
        const legacySingle = r.related_task_id ? [r.related_task_id] : [];
        const relatedTaskIds = Array.isArray(r.related_task_ids) && r.related_task_ids.length > 0
            ? r.related_task_ids : legacySingle;
        return { id: r.id, clientId: r.client_id,
            relatedTaskId: r.related_task_id,
            relatedTaskIds,
            title: r.title, description: r.description || '', type: r.type || 'meeting',
            date: r.date, dateEnd: r.date_end || r.date,
            startTime: r.start_time || '', endTime: r.end_time || '',
            location: r.location || '', calendarEventId: r.calendar_event_id || null,
            meetLink: r.meet_link || '', attendees: r.attendees || '',
            createdAt: r.created_at };
    }
```

Substituir por:
```js
    _event(r) {
        const legacySingle = r.related_task_id ? [r.related_task_id] : [];
        const relatedTaskIds = Array.isArray(r.related_task_ids) && r.related_task_ids.length > 0
            ? r.related_task_ids : legacySingle;
        return { id: r.id, clientId: r.client_id,
            relatedTaskId: r.related_task_id,
            relatedTaskIds,
            title: r.title, description: r.description || '', type: r.type || 'meeting',
            date: r.date, dateEnd: r.date_end || r.date,
            startTime: r.start_time || '', endTime: r.end_time || '',
            location: r.location || '', calendarEventId: r.calendar_event_id || null,
            meetLink: r.meet_link || '', attendees: r.attendees || '',
            rsvpStatus: r.rsvp_status || 'needsAction',
            isInvited: !!r.is_invited,
            calendarId: r.calendar_id || 'primary',
            createdAt: r.created_at };
    }
```

- [ ] **Step 2: Atualizar `addAgendaEvent` para persistir novos campos**

Localizar o bloco `.insert({` dentro de `addAgendaEvent` e adicionar os 3 novos campos ao final do objeto (antes de `}).select()`):

```js
            meet_link: eventData.meetLink || '', attendees: eventData.attendees || '',
            rsvp_status: eventData.rsvpStatus || 'needsAction',
            is_invited: eventData.isInvited || false,
            calendar_id: eventData.calendarId || 'primary'
```

- [ ] **Step 3: Atualizar `updateAgendaEvent` para persistir novos campos**

Localizar o bloco `.update({` dentro de `updateAgendaEvent` e adicionar os 3 novos campos ao final do objeto (antes de `}).eq('id'`):

```js
            meet_link: eventData.meetLink || '', attendees: eventData.attendees || '',
            rsvp_status: eventData.rsvpStatus || 'needsAction',
            is_invited: eventData.isInvited || false,
            calendar_id: eventData.calendarId || 'primary'
```

- [ ] **Step 4: Adicionar os 4 novos métodos ao store.js**

Logo após `deleteAgendaEvent`, adicionar:

```js
    async updateEventRsvp(id, rsvpStatus) {
        const { error } = await this.db.from('agenda_events')
            .update({ rsvp_status: rsvpStatus })
            .eq('id', id).eq('user_id', this.userId);
        if (error) throw error;
    }

    async getAgendaEventById(id) {
        const { data, error } = await this.db.from('agenda_events')
            .select('*').eq('id', id).eq('user_id', this.userId).single();
        if (error) throw error;
        return this._event(data);
    }

    async getHideDeclinedSetting() {
        const { data, error } = await this.db.from('user_profiles')
            .select('hide_declined_events').eq('user_id', this.userId).maybeSingle();
        if (error) throw error;
        return data ? !!data.hide_declined_events : false;
    }

    async saveHideDeclinedSetting(hide) {
        const { error } = await this.db.from('user_profiles').upsert({
            user_id: this.userId,
            hide_declined_events: hide,
            updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
        if (error) throw error;
    }
```

- [ ] **Step 5: Commit**

```bash
git add js/store.js
git commit -m "feat(rsvp): store - novos campos e métodos RSVP em agenda_events"
```

---

## Task 3: calendar.js — tag de calendarId e patchEventRsvp

**Files:**
- Modify: `js/calendar.js`

- [ ] **Step 1: Marcar cada evento com `_calendarId` no syncEventsFromGoogle**

Localizar (linha ~238):
```js
                    for (const ev of (response.result.items || [])) {
                        if (!seen.has(ev.id)) { seen.add(ev.id); allEvents.push(ev); }
                    }
```

Substituir por:
```js
                    for (const ev of (response.result.items || [])) {
                        if (!seen.has(ev.id)) { seen.add(ev.id); allEvents.push({ ...ev, _calendarId: calId }); }
                    }
```

- [ ] **Step 2: Adicionar método `patchEventRsvp` ao objeto `calendarAPI`**

Localizar o final do objeto `calendarAPI` (antes do último `};`) e adicionar:

```js
    async patchEventRsvp(calendarId, googleEventId, userEmail, responseStatus) {
        if (!await this._ensureToken()) throw new Error('Google Calendar não autenticado');
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
    },
```

- [ ] **Step 3: Commit**

```bash
git add js/calendar.js
git commit -m "feat(rsvp): calendar - tag _calendarId no sync e método patchEventRsvp"
```

---

## Task 4: app.js — extração de RSVP no sync bidirecional

**Files:**
- Modify: `js/app.js` (método `executeBiDirectionalSync`)

- [ ] **Step 1: Extrair `isInvited`, `rsvpStatus` e `calendarId` do evento do Google**

Em `executeBiDirectionalSync`, localizar o bloco que monta `mappedData` (linha ~4547):

```js
                const mappedData = {
                    title: gEv.summary || 'Sem Título',
                    ...
                    attendees: (gEv.attendees || []).map(a => a.email).join(', ')
                };
```

Substituir por (adicionar 3 linhas ao final do objeto `mappedData`):

```js
                const selfAttendee = (gEv.attendees || []).find(a => a.self === true);
                const isInvited = gEv.organizer?.self !== true && !!selfAttendee;

                const mappedData = {
                    title: gEv.summary || 'Sem Título',
                    description: gEv.description || '',
                    type: 'meeting',
                    location: gEv.location || '',
                    date: evDate,
                    dateEnd: evDateEnd || evDate,
                    startTime: evStart,
                    endTime: evEnd,
                    calendarEventId: gEv.id,
                    meetLink: gEv.hangoutLink || '',
                    attendees: (gEv.attendees || []).map(a => a.email).join(', '),
                    isInvited,
                    rsvpStatus: isInvited ? (selfAttendee.responseStatus || 'needsAction') : 'needsAction',
                    calendarId: gEv._calendarId || 'primary'
                };
```

- [ ] **Step 2: Preservar `isInvited`, `rsvpStatus` e `calendarId` no update (match local)**

Localizar o bloco onde o match local é encontrado (linha ~4580):

```js
                if (effective) {
                    mappedData.id = effective.id;
                    mappedData.type = effective.type; // Preserva o tipo customizado do TSP
                    mappedData.clientId = effective.clientId;
                    mappedData.relatedTaskId = effective.relatedTaskId;
                    mappedData.relatedTaskIds = effective.relatedTaskIds || [];
                    if (!mappedData.meetLink) mappedData.meetLink = effective.meetLink || '';
                    processedLocalIds.add(effective.id);
                    resolvedGoogleKeys.add(googleKey);
                    await store.updateAgendaEvent(mappedData);
```

Substituir por:
```js
                if (effective) {
                    mappedData.id = effective.id;
                    mappedData.type = effective.type; // Preserva o tipo customizado do TSP
                    mappedData.clientId = effective.clientId;
                    mappedData.relatedTaskId = effective.relatedTaskId;
                    mappedData.relatedTaskIds = effective.relatedTaskIds || [];
                    if (!mappedData.meetLink) mappedData.meetLink = effective.meetLink || '';
                    // Preserva rsvpStatus local se o Google retornar 'needsAction' para evitar sobrescrever
                    // resposta já dada pelo usuário (pode acontecer em sincronizações com delay)
                    if (!isInvited) { mappedData.rsvpStatus = effective.rsvpStatus; mappedData.isInvited = false; }
                    processedLocalIds.add(effective.id);
                    resolvedGoogleKeys.add(googleKey);
                    await store.updateAgendaEvent(mappedData);
```

- [ ] **Step 3: Commit**

```bash
git add js/app.js
git commit -m "feat(rsvp): extrai isInvited, rsvpStatus e calendarId no sync bidirecional"
```

---

## Task 5: CSS — indicador, popup, declinado

**Files:**
- Modify: `styles/main.css`

- [ ] **Step 1: Adicionar estilos no final de `styles/main.css`**

Adicionar ao final do arquivo:

```css
/* =========================================
   RSVP — Você vai?
   ========================================= */

/* Indicador circular no event-block */
.rsvp-dot {
    position: absolute;
    bottom: 5px;
    right: 5px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    z-index: 2;
}
.rsvp-dot:hover {
    transform: scale(1.4);
    box-shadow: 0 0 0 3px rgba(255,255,255,0.3);
}
.rsvp-dot--needsAction {
    background: transparent;
    border: 2px solid rgba(255,255,255,0.7);
}
.rsvp-dot--accepted {
    background: #22c55e;
    border: 2px solid #16a34a;
}
.rsvp-dot--tentative {
    background: #f59e0b;
    border: 2px solid #d97706;
}
.rsvp-dot--declined {
    background: #ef4444;
    border: 2px solid #dc2626;
}
.rsvp-dot--loading {
    background: rgba(255,255,255,0.4);
    border: 2px solid rgba(255,255,255,0.6);
    animation: rsvp-spin 0.8s linear infinite;
}
@keyframes rsvp-spin {
    to { transform: rotate(360deg); }
}

/* Evento declinado */
.event-block.rsvp-declined {
    opacity: 0.45;
}
.event-block.rsvp-declined .event-title {
    text-decoration: line-through;
}
.allday-event-banner.rsvp-declined {
    opacity: 0.45;
    text-decoration: line-through;
}

/* Ocultar declinados */
.event-block.rsvp-hidden,
.allday-event-banner.rsvp-hidden {
    display: none !important;
}

/* Mini-popup "Você vai?" */
.rsvp-popup {
    position: fixed;
    z-index: 9999;
    background: var(--bg-glass, rgba(30, 30, 50, 0.95));
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 10px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    backdrop-filter: blur(12px);
    min-width: 110px;
}
.rsvp-popup-label {
    font-size: 0.7rem;
    color: rgba(255,255,255,0.5);
    text-align: center;
    margin-bottom: 2px;
}
.rsvp-option {
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 6px;
    color: white;
    font-size: 0.8rem;
    padding: 5px 10px;
    cursor: pointer;
    text-align: center;
    transition: background 0.15s ease;
}
.rsvp-option:hover { background: rgba(255,255,255,0.16); }
.rsvp-option[data-status="accepted"]:hover { background: rgba(34,197,94,0.25); border-color: #22c55e; }
.rsvp-option[data-status="tentative"]:hover { background: rgba(245,158,11,0.25); border-color: #f59e0b; }
.rsvp-option[data-status="declined"]:hover  { background: rgba(239,68,68,0.25); border-color: #ef4444; }

/* Botão toggle hide-declined no header da agenda */
#btn-toggle-hide-declined.active {
    background: rgba(239,68,68,0.18);
    border-color: rgba(239,68,68,0.4);
    color: #fca5a5;
}
```

- [ ] **Step 2: Commit**

```bash
git add styles/main.css
git commit -m "feat(rsvp): CSS - indicador, popup, declinado e toggle hide-declined"
```

---

## Task 6: index.html — botão toggle no header da Agenda

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Adicionar botão "Ocultar declinados" no header da Agenda**

Localizar (linha ~382):
```html
                        <button class="btn btn-secondary" id="btn-agenda-sync" onclick="app.promptGoogleSync()">
                            <i data-lucide="refresh-cw"></i> Sincronizar
                        </button>
```

Adicionar o botão imediatamente ANTES do `btn-agenda-sync`:
```html
                        <button class="btn btn-secondary btn-icon-sm" id="btn-toggle-hide-declined"
                                onclick="app.toggleHideDeclined()"
                                title="Ocultar eventos declinados">
                            <i data-lucide="eye-off"></i>
                        </button>
                        <button class="btn btn-secondary" id="btn-agenda-sync" onclick="app.promptGoogleSync()">
                            <i data-lucide="refresh-cw"></i> Sincronizar
                        </button>
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "feat(rsvp): botão toggle ocultar declinados no header da Agenda"
```

---

## Task 7: app.js — estado no constructor e cleanup no logout

**Files:**
- Modify: `js/app.js`

- [ ] **Step 1: Adicionar campos ao constructor**

Localizar no constructor (logo antes de `this._renderAllRunning = false;`, linha ~117):

```js
        // Guard para evitar renderAll() concorrente
        this._renderAllRunning = false;
```

Adicionar logo acima dessas linhas:
```js
        // RSVP da Agenda
        this._hideDeclinedEvents = false;
        this._rsvpPopupEventId   = null;
        this._closeRsvpOnOutsideClick = null;
        // Guard para evitar renderAll() concorrente
        this._renderAllRunning = false;
```

- [ ] **Step 2: Adicionar cleanup no handler de logout**

Localizar no handler de logout (linha ~8996, logo após `window.app._aptGenEntries = null;`):

```js
            window.app._aptGenEntries = null;
            window.app._tasksCache = null;
```

Adicionar entre essas duas linhas:
```js
            window.app._aptGenEntries = null;
            window.app._hideDeclinedEvents = false;
            window.app._rsvpPopupEventId = null;
            if (window.app._closeRsvpOnOutsideClick) {
                document.removeEventListener('click', window.app._closeRsvpOnOutsideClick);
                window.app._closeRsvpOnOutsideClick = null;
            }
            window.app.closeRsvpPopup();
            window.app._tasksCache = null;
```

- [ ] **Step 3: Carregar setting no `initAfterAuth`**

Localizar em `initAfterAuth` (linha ~1792):
```js
        aiClient.loadConfig().then(() => this._updateAIStatusBadge());
        await this.renderAll();
```

Substituir por:
```js
        aiClient.loadConfig().then(() => this._updateAIStatusBadge());
        store.getHideDeclinedSetting().then(val => {
            this._hideDeclinedEvents = val;
            this._updateHideDeclinedBtn();
        }).catch(() => {});
        await this.renderAll();
```

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat(rsvp): constructor, logout cleanup e carregamento de setting no initAfterAuth"
```

---

## Task 8: app.js — indicador RSVP em createEventBlockHtml e createAllDayBannerHtml

**Files:**
- Modify: `js/app.js`

- [ ] **Step 1: Adicionar helper `_renderRsvpIndicator`**

Logo antes de `createAllDayBannerHtml` (linha ~4334), adicionar:

```js
    _renderRsvpIndicator(ev) {
        if (!ev.isInvited) return '';
        const status = ev.rsvpStatus || 'needsAction';
        const labels = { needsAction: 'Sem resposta', accepted: 'Confirmado', tentative: 'Talvez', declined: 'Declinado' };
        return `<button class="rsvp-dot rsvp-dot--${status}"
                        title="Você vai? ${labels[status] || ''}"
                        data-event-id="${ev.id}"
                        onclick="event.stopPropagation(); app.openRsvpPopup('${ev.id}', this, event)">
                </button>`;
    }
```

- [ ] **Step 2: Injetar indicador em `createEventBlockHtml`**

Em `createEventBlockHtml`, localizar a estrutura do retorno:

```js
        return `
            <div class="event-block ${typeClass}"
                 style="top: ${top}px; height: ${height}px; width: ${width}; left: ${left}; right: auto;"
                 onclick="event.stopPropagation(); app.editAgendaEvent('${ev.id}')">
```

Substituir por (adiciona `data-event-id`, `data-rsvp`, e classes condicionais):

```js
        const rsvpDeclinedClass = ev.isInvited && ev.rsvpStatus === 'declined' ? ' rsvp-declined' : '';
        const rsvpHiddenClass   = ev.isInvited && ev.rsvpStatus === 'declined' && this._hideDeclinedEvents ? ' rsvp-hidden' : '';
        return `
            <div class="event-block ${typeClass}${rsvpDeclinedClass}${rsvpHiddenClass}"
                 data-event-id="${ev.id}"
                 data-rsvp="${ev.rsvpStatus || 'needsAction'}"
                 style="top: ${top}px; height: ${height}px; width: ${width}; left: ${left}; right: auto;"
                 onclick="event.stopPropagation(); app.editAgendaEvent('${ev.id}')">
```

E adicionar o indicador logo antes do fechamento `</div>` final do bloco retornado:

```js
                ${clientName}
            </div>
            ${this._renderRsvpIndicator(ev)}
        </div>
```

**Atenção:** o `_renderRsvpIndicator` gera um `<button>` que deve ser filho do `.event-block` — posicionado via `position: absolute`. O `.event-block` já tem `position: absolute`; como seus filhos diretos usam posicionamento normal, o dot com `position: absolute` dentro do block funcionará corretamente. Rever a estrutura do `createEventBlockHtml` para garantir que o `.rsvp-dot` é filho direto do `.event-block` (não do wrapper interno), assim o `position: absolute; bottom: 5px; right: 5px` fica relativo ao `.event-block`.

A estrutura final correta do retorno:
```js
        return `
            <div class="event-block ${typeClass}${rsvpDeclinedClass}${rsvpHiddenClass}"
                 data-event-id="${ev.id}"
                 data-rsvp="${ev.rsvpStatus || 'needsAction'}"
                 style="top: ${top}px; height: ${height}px; width: ${width}; left: ${left}; right: auto;"
                 onclick="event.stopPropagation(); app.editAgendaEvent('${ev.id}')">

                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div class="event-title">${escapeHtml(ev.title)}</div>
                    <button class="btn btn-danger" style="padding: 2px 4px; font-size: 0.6rem; border-radius: 4px; background: rgba(0,0,0,0.3); border:none; color:white;"
                            onclick="event.stopPropagation();app.deleteAgendaEvent('${ev.id}', this)">
                        <i data-lucide="x" style="width: 12px; height: 12px;"></i>
                    </button>
                </div>
                <div class="event-meta">
                    <div style="display:flex; align-items:center; gap:4px;">
                       <i data-lucide="clock" style="width:10px; height:10px;"></i>
                       ${ev.startTime} - ${ev.endTime}
                       ${ev.calendarEventId ? '<i data-lucide="calendar" style="width:10px; height:10px; margin-left:4px; color:#60a5fa;" title="Sincronizado via Google"></i>' : ''}
                       ${ev.meetLink ? `<a href="${escapeHtml(ev.meetLink)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Entrar no Google Meet" style="color:#34d399; display:flex; align-items:center;"><i data-lucide="video" style="width:11px; height:11px;"></i></a>` : ''}
                    </div>
                    ${clientName}
                </div>
                ${this._renderRsvpIndicator(ev)}
            </div>
        `;
```

- [ ] **Step 3: Injetar indicador e `data-*` em `createAllDayBannerHtml`**

Localizar:
```js
    createAllDayBannerHtml(ev, clientsMap = {}) {
        const typeClass = 'type-' + ev.type;
        const clientName = ev.clientId && clientsMap[ev.clientId]
            ? escapeHtml(clientsMap[ev.clientId].name) : '';
        return `<div class="allday-event-banner ${typeClass}"
                     onclick="event.stopPropagation(); app.editAgendaEvent('${ev.id}')"
                     title="${escapeHtml(ev.title)}${clientName ? ' · ' + clientName : ''}">
            <i data-lucide="sun" style="width:11px; height:11px; flex-shrink:0;"></i>
            <span>${escapeHtml(ev.title)}${clientName ? ' · ' + clientName : ''}</span>
        </div>`;
    }
```

Substituir por:
```js
    createAllDayBannerHtml(ev, clientsMap = {}) {
        const typeClass = 'type-' + ev.type;
        const clientName = ev.clientId && clientsMap[ev.clientId]
            ? escapeHtml(clientsMap[ev.clientId].name) : '';
        const rsvpDeclinedClass = ev.isInvited && ev.rsvpStatus === 'declined' ? ' rsvp-declined' : '';
        const rsvpHiddenClass   = ev.isInvited && ev.rsvpStatus === 'declined' && this._hideDeclinedEvents ? ' rsvp-hidden' : '';
        return `<div class="allday-event-banner ${typeClass}${rsvpDeclinedClass}${rsvpHiddenClass}"
                     data-event-id="${ev.id}"
                     data-rsvp="${ev.rsvpStatus || 'needsAction'}"
                     onclick="event.stopPropagation(); app.editAgendaEvent('${ev.id}')"
                     title="${escapeHtml(ev.title)}${clientName ? ' · ' + clientName : ''}">
            <i data-lucide="sun" style="width:11px; height:11px; flex-shrink:0;"></i>
            <span>${escapeHtml(ev.title)}${clientName ? ' · ' + clientName : ''}</span>
            ${this._renderRsvpIndicator(ev)}
        </div>`;
    }
```

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat(rsvp): indicador RSVP em event blocks e all-day banners"
```

---

## Task 9: app.js — métodos RSVP (popup + resposta)

**Files:**
- Modify: `js/app.js`

- [ ] **Step 1: Adicionar os 3 métodos de popup logo após `_renderRsvpIndicator`**

```js
    openRsvpPopup(eventId, anchorEl, e) {
        e.stopPropagation();
        this.closeRsvpPopup();
        this._rsvpPopupEventId = eventId;

        const popup = document.createElement('div');
        popup.className = 'rsvp-popup';
        popup.id = 'rsvp-popup-active';
        popup.innerHTML = `
            <span class="rsvp-popup-label">Você vai?</span>
            <button class="rsvp-option" data-status="accepted"
                    onclick="event.stopPropagation(); app.setRsvpResponse('${eventId}', 'accepted')">Sim</button>
            <button class="rsvp-option" data-status="tentative"
                    onclick="event.stopPropagation(); app.setRsvpResponse('${eventId}', 'tentative')">Talvez</button>
            <button class="rsvp-option" data-status="declined"
                    onclick="event.stopPropagation(); app.setRsvpResponse('${eventId}', 'declined')">Não</button>
        `;
        document.body.appendChild(popup);

        const rect = anchorEl.getBoundingClientRect();
        popup.style.top  = (rect.bottom + 6) + 'px';
        popup.style.left = rect.left + 'px';

        // Fecha ao clicar fora — setTimeout evita que o clique que abriu o popup seja capturado
        setTimeout(() => {
            this._closeRsvpOnOutsideClick = (ev) => {
                if (!popup.contains(ev.target)) this.closeRsvpPopup();
            };
            document.addEventListener('click', this._closeRsvpOnOutsideClick);
        }, 0);
    }

    closeRsvpPopup() {
        const existing = document.getElementById('rsvp-popup-active');
        if (existing) existing.remove();
        if (this._closeRsvpOnOutsideClick) {
            document.removeEventListener('click', this._closeRsvpOnOutsideClick);
            this._closeRsvpOnOutsideClick = null;
        }
        this._rsvpPopupEventId = null;
    }

    async setRsvpResponse(eventId, status) {
        this.closeRsvpPopup();

        // Optimistic: muda dot imediatamente para "loading"
        document.querySelectorAll(`.rsvp-dot[data-event-id="${eventId}"]`).forEach(el => {
            el.className = 'rsvp-dot rsvp-dot--loading';
        });

        try {
            await store.updateEventRsvp(eventId, status);

            // Atualiza DOM sem re-render completo
            const labels = { needsAction: 'Sem resposta', accepted: 'Confirmado', tentative: 'Talvez', declined: 'Declinado' };
            document.querySelectorAll(`.rsvp-dot[data-event-id="${eventId}"]`).forEach(el => {
                el.className = `rsvp-dot rsvp-dot--${status}`;
                el.title = `Você vai? ${labels[status] || ''}`;
            });
            document.querySelectorAll(`.event-block[data-event-id="${eventId}"], .allday-event-banner[data-event-id="${eventId}"]`).forEach(el => {
                el.dataset.rsvp = status;
                el.classList.toggle('rsvp-declined', status === 'declined');
                el.classList.toggle('rsvp-hidden', status === 'declined' && this._hideDeclinedEvents);
            });

            // Sync ao Google Calendar (não bloqueia — falha silenciosa com toast)
            if (calendarAPI.isAuthenticated) {
                store.getAgendaEventById(eventId).then(ev => {
                    if (ev.calendarEventId && ev.calendarId) {
                        const userEmail = Auth.getUserEmail();
                        calendarAPI.patchEventRsvp(ev.calendarId, ev.calendarEventId, userEmail, status)
                            .catch(err => {
                                console.warn('RSVP sync ao Google falhou:', err);
                                Toast.show('Resposta salva localmente. Sync com Google falhou.', 'warning');
                            });
                    }
                }).catch(() => {});
            }
        } catch (err) {
            console.error('Erro ao salvar RSVP:', err);
            Toast.show('Erro ao salvar resposta RSVP', 'error');
            // Reverte via re-render
            await this.renderAgenda();
        }
    }
```

- [ ] **Step 2: Commit**

```bash
git add js/app.js
git commit -m "feat(rsvp): openRsvpPopup, closeRsvpPopup e setRsvpResponse"
```

---

## Task 10: app.js — toggle hide-declined

**Files:**
- Modify: `js/app.js`

- [ ] **Step 1: Adicionar os 2 métodos de toggle e visibilidade**

Logo após `setRsvpResponse`, adicionar:

```js
    async toggleHideDeclined() {
        this._hideDeclinedEvents = !this._hideDeclinedEvents;
        this._updateHideDeclinedBtn();
        this._applyDeclinedVisibility();
        store.saveHideDeclinedSetting(this._hideDeclinedEvents).catch(err => {
            console.warn('Erro ao salvar preferência de declinados:', err);
        });
    }

    _updateHideDeclinedBtn() {
        const btn = document.getElementById('btn-toggle-hide-declined');
        if (!btn) return;
        const icon = btn.querySelector('i');
        if (icon) {
            icon.setAttribute('data-lucide', this._hideDeclinedEvents ? 'eye' : 'eye-off');
            lucide.createIcons();
        }
        btn.title = this._hideDeclinedEvents ? 'Mostrar eventos declinados' : 'Ocultar eventos declinados';
        btn.classList.toggle('active', this._hideDeclinedEvents);
    }

    _applyDeclinedVisibility() {
        document.querySelectorAll(
            '.event-block[data-rsvp="declined"], .allday-event-banner[data-rsvp="declined"]'
        ).forEach(el => {
            el.classList.toggle('rsvp-hidden', this._hideDeclinedEvents);
        });
    }
```

- [ ] **Step 2: Commit**

```bash
git add js/app.js
git commit -m "feat(rsvp): toggleHideDeclined, _updateHideDeclinedBtn e _applyDeclinedVisibility"
```

---

## Task 11: Verificação manual

**Files:** Nenhum arquivo modificado

- [ ] **Step 1: Iniciar servidor dev**

```powershell
cd d:\GerenciadorTSP
python -m http.server 8080
```

Abrir `http://localhost:8080/index.html`

- [ ] **Step 2: Verificar indicadores em eventos convite**

1. Autenticar no app e no Google Calendar
2. Sincronizar a agenda (botão "Sincronizar")
3. Verificar que eventos onde você foi convidado (`is_invited = true`) exibem o círculo no canto inferior direito do bloco
4. Eventos sem convite NÃO devem ter o círculo

- [ ] **Step 3: Testar fluxo de RSVP**

1. Clicar no círculo de um evento convidado → popup "Você vai?" com Sim/Talvez/Não
2. Clicar "Sim" → círculo vira verde, popup fecha
3. Clicar "Não" → círculo vira vermelho, evento fica semi-transparente com título riscado
4. Clicar "Talvez" → círculo vira amarelo

- [ ] **Step 4: Testar toggle ocultar declinados**

1. Declinar um evento (círculo vermelho)
2. Clicar no botão `eye-off` no header da Agenda → evento some
3. Clicar novamente → evento reaparece
4. Navegar para outra view e voltar → configuração persiste (buscada do DB)

- [ ] **Step 5: Verificar que o status é persistido após reload**

1. Responder "Sim" em um evento
2. Recarregar a página (`F5`)
3. Sincronizar a agenda
4. O evento deve continuar com o círculo verde

- [ ] **Step 6: Push final**

```bash
git push origin main
```

---

## Migrations SQL — resumo final (executar no Supabase antes do deploy)

```sql
ALTER TABLE agenda_events ADD COLUMN IF NOT EXISTS rsvp_status TEXT DEFAULT 'needsAction';
ALTER TABLE agenda_events ADD COLUMN IF NOT EXISTS is_invited BOOLEAN DEFAULT FALSE;
ALTER TABLE agenda_events ADD COLUMN IF NOT EXISTS calendar_id TEXT DEFAULT 'primary';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS hide_declined_events BOOLEAN DEFAULT FALSE;
```
