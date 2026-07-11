---
target: "Chamados view (index.html #view-chamados)"
total_score: 26
p0_count: 0
p1_count: 2
timestamp: 2026-07-11T01-20-33Z
slug: index-html-view-chamados
---
Method: dual-agent (A: affa9fae2de2397eb · B: a5bee0ad7f0116423)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Sync spinner + last-sync timestamp exist, but every `renderChamados()` call blanks the whole panel with a full-page spinner instead of a partial refresh |
| 2 | Match System / Real World | 3 | Raw OTOBO English enum values (`new`, `open`, `in treatment`) leak unmapped into badges next to otherwise-localized pt-BR labels |
| 3 | User Control and Freedom | 3 | "Limpar" only clears all 6 filters at once — no per-filter clear inside each dropdown |
| 4 | Consistency and Standards | 3 | Reuses established card/button patterns well, but status and priority badges reuse the *same* 4 hex colors for two different taxonomies |
| 5 | Error Prevention | 2 | Shift+click "sync completa" is a materially destructive-adjacent action (can delete cached tickets per `deleteTicketsNotIn`) discoverable only via a hover tooltip |
| 6 | Recognition Rather Than Recall | 2 | No aggregate "active filters" chip strip — user must reopen each of 6 dropdowns to recall current filter state |
| 7 | Flexibility and Efficiency | 3 | Filters persist to `otobo_config.local_filters` (debounced), incremental sync, Shift+click power shortcut |
| 8 | Aesthetic and Minimalist Design | 3 | Ticket cards are lean and well-restrained; the 6-dropdown filter bar is a flat, ungrouped, unbroken row |
| 9 | Error Recovery | 2 | Load failure renders raw `err.message` (a JS/Postgrest exception string) directly into the empty state, no retry action |
| 10 | Help and Documentation | 2 | No contextual help in the triage view itself; OTOBO jargon ("fila", queue/owner concepts) unexplained |
| **Total** | | **26/40** | **Acceptable — solid bones, filter bar and error/status feedback need work** |

## Anti-Patterns Verdict

**LLM assessment**: The view is largely disciplined against generic AI-dashboard tells — no gradient text, no hero-metric cards, no decorative glassmorphism, no eyebrow scaffolding. Ticket cards (number, clamped title, 2-3 badges, meta chips) are a genuinely good, restrained IA choice that avoids the "identical repeated card grid" trap by grouping meaningfully by client. Two real design-system violations stand out: `.ticket-type-badge` uses a fourth unauthorized purple (`#9f7aea`) that competes with the app's reserved violet accent for no functional reason, and status/priority badges reuse identical hex values (`#68d391` for both "status: open" and "priority: low"; `#f6ad55` for both "status: pending" and "priority: high") — which directly undercuts the one thing this view exists to do: let a consultant recognize ticket state at a glance.

**Deterministic scan**: `detect.mjs` found 81 findings across the whole `index.html`, but only **1 is inside the Chamados block** (lines 729-796): an advisory `design-system-font-size` hit on `#chamados-sync-info`'s inline `font-size: 0.8rem`, off the DESIGN.md type ramp. Everything else the detector flagged (layout-transition, overused-font, other color/radius advisories) lives elsewhere in the file, unrelated to this view. No false positives to flag on the one in-scope finding.

**Visual overlays**: Not available this run — no browser/screenshot tool was exposed in either sub-agent's toolset, and the app requires Supabase auth to reach real ticket data, so no live rendering could be captured. Assessment B substituted a static HTML/CSS scan instead (see below); treat the "not statically verifiable" items as open questions for a manual look in the browser.

## Overall Impression

Chamados has good bones — the client-grouped card layout matches how a consultant actually thinks about triage, and the cards themselves resist every "AI dashboard" cliché this system explicitly bans. The two real problems are structural, not decorative: the filter bar throws 6 equal-weight dropdowns plus search plus clear into one flat, ungrouped row (a textbook cognitive-load violation), and the status/priority badge palette collides with itself, undermining the exact "recognize urgency at a glance" job the screen exists for. Neither is a rewrite — both are targeted fixes.

## What's Working

1. **Card grouping by linked client** mirrors the consultant's real mental model ("what does client X need from me") rather than a flat ticket list.
2. **Restrained ticket cards** — number, clamped title, 2-3 badges, 3 meta chips — avoid the hero-metric and decorative-clutter traps entirely; information-dense without noise.
3. **State persistence done right**: filters debounce-save to `otobo_config.local_filters` and restore on reopen; incremental sync avoids full re-fetches. Respects the needs of a tool used many times a day.

## Priority Issues

**[P1] Filter bar has zero grouping for 8 controls in one row**
- **Why it matters**: `.chamados-filters` renders search + 6 `.mf-wrap` dropdowns + Clear as one flat `flex-wrap` row with uniform visual weight. This fails the working-memory rule (≤4 items per decision group) — a consultant triaging under time pressure has to scan/recall 6 independent multi-select states with no visual grouping, and status/priority/queue/owner/type/client are semantically distinct axes (ticket state vs. routing vs. our-own CRM client) collapsed into one undifferentiated strip.
- **Fix**: Cluster into 2 visually distinct groups (e.g. "Buscar + Status + Prioridade" vs. "Fila + Proprietário + Tipo + Cliente"), or default to search + status + client visible and tuck the rest behind a "Mais filtros" disclosure.
- **Suggested command**: `/impeccable layout`

**[P1] No aggregate "active filters" summary**
- **Why it matters**: Each dropdown only shows its own truncated label ("2 selecionados"); there's no single scannable strip of active filter values. This is a pure recognition-over-recall failure (Nielsen #6) — to know what's currently narrowing the ticket list, the user must reopen every dropdown one by one.
- **Fix**: Render a row of removable chips (one per active filter value) above the dropdown row, mirroring whatever pattern the Tarefas filter bar already uses for consistency.
- **Suggested command**: `/impeccable clarify`

**[P2] Status and priority badges share identical hex colors for different taxonomies**
- **Why it matters**: `ticket-status-open`/`ticket-priority-2-low` are both `#68d391`; `ticket-status-pending`/`ticket-priority-4-high` are both `#f6ad55` (main.css:3554-3562). These sit side by side on every card. Reusing the same color for two different semantic axes actively works against "recognize status/priority at a glance" and violates the app's own functional-color-single-meaning rule.
- **Fix**: Give priority its own distinct ramp (neutral→amber→red intensity) fully separate from status's blue/green/amber/gray scheme.
- **Suggested command**: `/impeccable colorize`

**[P2] Raw exception text shown to the user on load failure**
- **Why it matters**: `Erro ao carregar chamados: ${escapeHtml(err.message)}` (app.js:10387) surfaces a raw JS/Postgrest error string with no guidance or retry — exactly where a user is trying to find urgent work, this reads as "the app is broken" rather than offering a path forward.
- **Fix**: Replace with a friendly pt-BR message plus a "Tentar novamente" button; log the raw error to console only.
- **Suggested command**: `/impeccable harden`

**[P3] `.ticket-type-badge` uses a 4th unauthorized purple (`#9f7aea`)**
- **Why it matters**: Distinct from both `--primary` (#8b5cf6) and the AI accent (#a78bfa) — a plain metadata badge shouldn't compete for the app's one reserved accent hue, diluting what violet signals elsewhere.
- **Fix**: Reuse the existing neutral/gray badge treatment or pick a distinct non-purple hue.
- **Suggested command**: `/impeccable colorize`

**[P3] Shift+click "sync completa" is undiscoverable and has no focus-visible affordance on filter dropdowns**
- **Why it matters**: The full-sync shortcut (`onclick="app.syncChamados(event.shiftKey)"`) relies entirely on a hover tooltip most users won't read, for an action that can delete cached tickets. Separately, `.mf-wrap.mf-open .mf-btn { outline: none; }` strips the focus outline while a filter dropdown is open with no replacement indicator anywhere nearby — a keyboard user loses visible focus the moment they open a dropdown.
- **Fix**: Add an explicit secondary "Sincronização completa" action alongside the tooltip; restore a visible focus style for `.mf-btn` when `.mf-open`.
- **Suggested command**: `/impeccable audit`

## Persona Red Flags

**Alex (Power User)**: Every `renderChamados()` call — even a simple return to the view — blanks the whole panel with a full spinner instead of keeping the last-rendered cards visible during refresh; for a screen opened many times a day, that's a repeated "wait, then re-scan from scratch" tax. Alex also can't recall which of the 6 filters are active without reopening each one, and is unlikely to ever discover Shift+click full-sync (only a tooltip signals it exists), risking silently missing tickets outside the ~500-recent sync window documented in CLAUDE.md.

**Sam (Accessibility-Dependent User)**: The `.mf-wrap` custom dropdowns are plain `<div>`/`<button>` combos with **no `aria-haspopup`, `aria-expanded`, or `role="listbox"`** anywhere in the markup (confirmed by whole-file grep — only 2 unrelated `aria-` hits exist in all of `index.html`). A screen reader announces "Todos os status" with no indication it opens a multi-select panel. Worse, opening a dropdown **strips the visible focus outline** (`.mf-wrap.mf-open .mf-btn { outline: none; }`) with nothing supplied to replace it, and there's no Escape-key handler to dismiss an open dropdown — a keyboard user can get stuck. Most seriously: ticket cards (`.ticket-card.clickable-card`) have a JS click listener but no `tabindex`, `role="button"`, or keydown handler — Sam **cannot open a ticket at all without a mouse**, which is a hard blocker on this view's primary action, not just friction.

## Minor Observations

- `linkEl.href` in `openChamadoModal` builds a URL from `ticket.ticketId` without `encodeURIComponent`, inconsistent with the `escapeHtml` discipline used everywhere else in the same function (likely benign since IDs are numeric, but worth normalizing).
- The "Última sync" label always reads "(incremental)" — worth confirming this is accurate immediately after a first full sync.
- `.ticket-meta-item` wraps via `flex-wrap`, so long owner/queue text likely reflows gracefully, but this wasn't visually confirmed.
- Dropdown clipping risk is softer than the classic `overflow:hidden` case: `.main-content`'s `overflow-y:auto` computes `overflow-x` to `auto` too (not `hidden`), so a `.mf-dropdown` opened near an edge would scroll into view rather than being invisibly clipped — still worth a manual check near the right/bottom edge of the panel.

## Questions to Consider

- Given OTOBO tickets can number in the thousands and this tool caps at ~500 recent by design, does a flat 6-dropdown filter bar actually scale, or does it need to become a proper faceted-search sidebar as filter axes grow?
- Is "grouped by client" the right *default* view for triage, or would a flat "urgent first" sort (by priority + last-updated) better serve the "did I miss something urgent" job, with client-grouping as an optional toggle?
- Should status and priority stay as two separately-colored badges competing for the same palette, or would a single combined severity chip reduce the redundant color-decoding per card?
- Should a destructive-adjacent action (full resync, which can delete cached tickets) ever live behind an undocumented Shift+click, even for a power-user tool?
