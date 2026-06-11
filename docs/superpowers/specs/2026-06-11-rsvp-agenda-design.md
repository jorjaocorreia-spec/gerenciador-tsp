# Design: RSVP de Eventos da Agenda (Você vai?)

**Data:** 2026-06-11
**Status:** Aprovado

---

## Contexto

O GerenciadorTSP tem uma view de Agenda com sync bidirecional com o Google Calendar. Quando outra pessoa cria um evento no Google Calendar e convida o usuário, o evento já é sincronizado para o app. Falta, porém, a capacidade de responder (Sim/Talvez/Não) e visualizar o status de confirmação diretamente nos blocos de evento, como o Google Calendar nativo faz.

---

## Escopo

- RSVP apenas para eventos recebidos de convite — `is_invited === true`
- Resposta sincronizada de volta ao Google Calendar (`sendUpdates: 'all'`)
- Indicador visual no bloco do evento (não requer abrir o modal)
- Configuração por usuário para ocultar/mostrar eventos declinados

Fora do escopo: RSVP para eventos criados pelo próprio usuário, RSVP sem Google Calendar autenticado.

---

## Modelo de Dados

### Migrations SQL

```sql
-- Agenda events
ALTER TABLE agenda_events ADD COLUMN IF NOT EXISTS rsvp_status TEXT DEFAULT 'needsAction';
ALTER TABLE agenda_events ADD COLUMN IF NOT EXISTS is_invited BOOLEAN DEFAULT FALSE;

-- Configuração do usuário
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS hide_declined_events BOOLEAN DEFAULT FALSE;
```

### Valores de `rsvp_status`

| Valor | Significado |
|-------|-------------|
| `needsAction` | Sem resposta (estado inicial) |
| `accepted` | Confirmado — Sim |
| `tentative` | Talvez |
| `declined` | Recusado — Não |

### Detecção de `is_invited`

Um evento é marcado como `is_invited = true` durante o sync do Google Calendar quando:
1. `gEv.organizer?.self !== true` — outra pessoa criou o evento
2. `gEv.attendees?.some(a => a.self === true)` — o usuário está na lista de participantes

---

## UI

### Indicador no bloco do evento

- Círculo pequeno (10px) no canto inferior direito do `.event-block`
- Visível apenas quando `is_invited === true`
- Estados visuais:

| Status | Visual |
|--------|--------|
| `needsAction` | Círculo vazio (borda branca/cinza) |
| `accepted` | Círculo verde preenchido |
| `tentative` | Círculo amarelo preenchido |
| `declined` | Círculo vermelho, evento com `opacity: 0.45` |

### Mini-popup de RSVP

- Aberto ao clicar no indicador circular
- 3 botões inline: **Sim** / **Talvez** / **Não**
- Fechar ao clicar fora (sem alterar status)
- Spinner no círculo durante o patch ao Google Calendar
- Implementado como div posicionado absolutamente, fechado via `document.addEventListener('click')` com stopPropagation no próprio popup

### Eventos declinados

- Permanecem visíveis por padrão com `opacity: 0.45` e título com `text-decoration: line-through`
- Quando `hide_declined_events === true`: classe `rsvp-hidden` adicionada ao bloco, `display: none`

### Toggle "Ocultar declinados"

- Posicionado no header da view Agenda, ao lado do botão de sync Google
- Botão com ícone `eye-off` / `eye` que alterna estado
- Salvo em `user_profiles.hide_declined_events` (Supabase)
- Aplicado em tempo real via toggle de classe CSS, sem re-render

---

## Sync com Google Calendar

### Leitura (Google → App)

Em `syncEventsFromGoogle`, para cada evento recebido:

```js
const selfAttendee = gEv.attendees?.find(a => a.self === true);
const isInvited = gEv.organizer?.self !== true && !!selfAttendee;
const rsvpStatus = isInvited ? (selfAttendee.responseStatus || 'needsAction') : 'needsAction';
```

Esses valores são passados ao `addAgendaEvent` / `updateAgendaEvent`.

### Escrita (App → Google)

Ao mudar RSVP localmente, chamar `gapi.client.calendar.events.patch`:

```js
{
  calendarId: event.calendarId,  // calendário de origem
  eventId: event.calendarEventId,
  resource: {
    attendees: [
      ...otherAttendees,
      { email: userEmail, responseStatus: newStatus }
    ]
  },
  sendUpdates: 'all'  // notifica o organizador
}
```

O `calendarId` de origem deve ser armazenado junto ao evento (ver abaixo).

---

## Armazenamento do `calendarId` de origem

O Google Calendar permite que o evento pertença a um calendário secundário (não `primary`). Já existe a coluna `calendar_event_id` em `agenda_events`; é necessário também armazenar o `calendarId` para fazer o patch corretamente.

**Migration adicional:**
```sql
ALTER TABLE agenda_events ADD COLUMN IF NOT EXISTS calendar_id TEXT DEFAULT 'primary';
```

Durante o sync, ao importar cada evento, salvar `calendar_id = calendarId` (o ID do calendário de onde veio).

---

## Novos Métodos

### `js/app.js`

| Método | Descrição |
|--------|-----------|
| `_renderRsvpIndicator(event)` | Retorna HTML do círculo indicador |
| `openRsvpPopup(eventId, anchorEl, e)` | Abre mini-popup com Sim/Talvez/Não |
| `closeRsvpPopup()` | Fecha popup ativo |
| `setRsvpResponse(eventId, status)` | Atualiza DB + Google Calendar |
| `toggleHideDeclined()` | Alterna configuração + salva no DB |
| `_applyDeclinedVisibility()` | Aplica/remove `rsvp-hidden` nos blocos |

### `js/store.js`

| Método | Descrição |
|--------|-----------|
| `updateEventRsvp(eventId, rsvpStatus)` | UPDATE `agenda_events` SET `rsvp_status` |
| `getHideDeclinedSetting()` | Lê `user_profiles.hide_declined_events` |
| `saveHideDeclinedSetting(bool)` | Salva `user_profiles.hide_declined_events` |

### `js/calendar.js`

| Método | Descrição |
|--------|-----------|
| `patchEventRsvp(calendarId, googleEventId, userEmail, responseStatus)` | `events.patch` via Google Calendar API |

---

## CSS

```css
/* Indicador RSVP */
.rsvp-dot { /* círculo 10px, posição absolute bottom-right */ }
.rsvp-dot.needsAction { /* borda branca, fundo transparente */ }
.rsvp-dot.accepted { /* fundo verde */ }
.rsvp-dot.tentative { /* fundo amarelo */ }
.rsvp-dot.declined { /* fundo cinza/vermelho */ }

/* Evento declinado */
.event-block.rsvp-declined { opacity: 0.45; }
.event-block.rsvp-declined .event-title { text-decoration: line-through; }

/* Ocultar declinados */
.event-block.rsvp-hidden { display: none; }

/* Mini-popup */
.rsvp-popup { /* posição absolute, glassmorphism, z-index alto */ }
```

---

## Tratamento de Erros

- Se Google Calendar não estiver autenticado ao tentar responder: Toast "Autentique o Google Calendar para responder"
- Se o patch ao Google falhar: reverter status local, Toast de erro
- Se `calendar_id` não estiver salvo (eventos antigos): tentar `primary` como fallback

---

## Migrations Completas (ordem de execução)

```sql
ALTER TABLE agenda_events ADD COLUMN IF NOT EXISTS rsvp_status TEXT DEFAULT 'needsAction';
ALTER TABLE agenda_events ADD COLUMN IF NOT EXISTS is_invited BOOLEAN DEFAULT FALSE;
ALTER TABLE agenda_events ADD COLUMN IF NOT EXISTS calendar_id TEXT DEFAULT 'primary';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS hide_declined_events BOOLEAN DEFAULT FALSE;
```
