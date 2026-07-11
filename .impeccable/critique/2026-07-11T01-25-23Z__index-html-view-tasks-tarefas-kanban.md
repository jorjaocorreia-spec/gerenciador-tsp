---
target: Tela de Tarefas (Kanban)
total_score: 28
p0_count: 0
p1_count: 3
timestamp: 2026-07-11T01-25-23Z
slug: index-html-view-tasks-tarefas-kanban
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Optimistic quick-add updates instantly; column counts live-update. No skeleton loading on first board render (spinner instead), which the product register asks for. |
| 2 | Match System / Real World | 4 | Portuguese domain vocabulary throughout ("Mover para", "Cliente Paga", column names) reads naturally for a Brazilian consultant. |
| 3 | User Control and Freedom | 3 | Quick-add and modal both have clear exits. Column-delete-blocked toast is a dead end — no link to the tasks blocking it. |
| 4 | Consistency and Standards | 2 | Priority badge colors (`#ff6b6b`/`#ff922b`/`#51cf66`) literally reuse the Kanban column category hues (`--kb-color-doing`/`--kb-color-done`) for an unrelated meaning — same color, two meanings, on the same card. |
| 5 | Error Prevention | 3 | Column deletion blocked when tasks exist; quick-add has a documented retry-and-preserve-text safety net born from a real production incident. |
| 6 | Recognition Rather Than Recall | 2 | Labels and Cover are color-only signifiers — an untitled label renders as a bare dot with empty `title=""`, unreadable to colorblind users or screen readers. |
| 7 | Flexibility and Efficiency | 3 | Quick-add and drag-and-drop are fast paths; no keyboard-only reorder, no bulk actions. |
| 8 | Aesthetic and Minimalist Design | 3 | Board/card layout is restrained; Cover and Label swatch pickers are the one place color noise creeps in. |
| 9 | Error Recovery | 3 | Toasts name the object and count precisely ("X possui N tarefa(s). Mova-as antes de excluir."). |
| 10 | Help and Documentation | 2 | No inline help for Cover/Labels/Checklist on first use; the modal's 8 sidebar sections rely entirely on trial and error. |
| **Total** | | **28/40** | **Good — solid foundation, address the color-semantics and modal-hierarchy gaps.** |

## Anti-Patterns Verdict

**Start here.** Does this look AI-generated? Mostly no — but one clause of the project's own written design system is being broken by a live feature.

**LLM assessment (Assessment A, with real Playwright screenshots of the running app):** No gradient text, no hero-metric cards, no decorative glassmorphism beyond the app-wide standard, no uniform-reflex animation. The 3-color Kanban category system (blue/orange/green tied to column identity) is implemented faithfully at the column level. The one real violation is the **Cover** feature: an 8-swatch decorative palette (`#4a9eff,#ff922b,#51cf66,#ffd43b,#cc5de8,#ff6b6b,#22d3ee,#f97316`) that paints a full-width 32px bar across the top of a card with no semantic tie to anything — this directly contradicts DESIGN.md's own rule that multi-color coding is scoped to exactly 3 hues, reserved for the Kanban column. It's a second, uncontrolled accent system hiding inside a feature, not an AI-generated tell in the traditional sense, but exactly the kind of "second brand accent creeping in" the system explicitly warns against.

**Deterministic scan (Assessment B):** `detect.mjs` ran clean (exit 2 = findings present, not a crash) against `index.html` and `main.css`: 369 total findings, of which **50 are in-scope** for the Tarefas/Kanban surface (3 in `index.html`, 47 in `main.css`) once findings belonging to other views (Dashboard, Agenda, Chamados, etc., bundled in the same files) are filtered out. In-scope highlights:
- **`side-tab` (warning) at `main.css:4077`** — a literal `border-left: 3px solid rgba(139,92,246,0.5)` inside the Kanban drag/cascade block. This is the exact pattern the shared absolute bans list names first: *"Side-stripe borders... never intentional."* This is a real, confirmed instance, not a false positive.
- **`bounce-easing` (warning) × 4** at lines 3932, 3944, 3953, 4044 — `cubic-bezier(0.34, 1.56, 0.64, 1)` on `.kb-card-dropped`, `.kb-column-cascade`, `.kb-card-new`. The product register's motion rule is explicit: "ease-out with exponential curves... no bounce, no elastic." These four animations use a bounce curve.
- **`design-system-color` advisories** repeatedly flag the same undocumented red (`#ff6b6b`) reused ~14 times across `.kb-badge-priority-high`, `.kb-badge-due-overdue`, `.kb-action-danger`, and delete-hover states — corroborating Assessment A's finding independently: priority/status colors are hard-coded and duplicated rather than drawn from the app's actual `--danger-color`/`--warning-color`/`--success-color` tokens.
- **`design-system-radius` advisories** at 2px, 3px, and 6px scattered across the same card/modal family — the Kanban card ecosystem doesn't consistently use the documented radius scale (`sm:4px / md:8px / lg:12px`).
- **`design-system-font-size` advisories** cluster at 10–13px across badges, column headers, and modal sections — a lot of near-miss sizes off the type ramp, though none individually severe.

No false positives identified; every in-scope finding checked out against the actual CSS. Live browser evidence for Assessment B specifically was unavailable (no browser-automation tool exposed in that isolated context) — but Assessment A independently obtained real Playwright screenshots of the empty dashboard, empty Kanban, quick-add flow, populated board, and the full task detail modal, so the "browser inspection when available" requirement is satisfied by A even though B's browser step is marked unavailable in its own report.

**Visual overlays**: not available this run — no `impeccable` live-server overlay was injected (B correctly declined to spin one up per its instructions, and no separate browser tool was exposed to it). Assessment A's screenshots are the visual evidence for this run; no injected on-page overlay exists to view in a `[Human]` tab.

## Overall Impression

The Tarefas board is one of the more disciplined screens in the app — quick-add, drag-and-drop, and the two-step delete pattern all show real engineering against past production incidents (documented directly in CLAUDE.md), and the sanctioned 3-color Kanban system is respected at the column level. The gap is that two *newer* features — **Cover** and **priority badges** — quietly reuse or expand the color vocabulary without checking it against the column-color system already in place, creating a real semantic collision on the card face (same orange means "Em Execução" in one spot and "Média prioridade" in another). The task modal's sidebar has also grown to 8 flat, equally-weighted sections without any grouping, which is the single biggest cognitive-load issue on the surface. None of this is AI-slop in the generic sense — it's feature-creep against an otherwise well-specified system, which is an easier fix than a redesign.

## What's Working

1. **The 3-color Kanban system is implemented faithfully where it's supposed to be** — column dots, "Mover para" buttons, and the default (Cover-unset) card treatment all correctly restrict themselves to blue/orange/green tied to column identity.
2. **Error recovery is genuinely mature.** The quick-add retry-and-preserve-text flow and the two-step delete confirmation both show evidence of being hardened against real production bugs (both documented in CLAUDE.md) rather than generic scaffolding — this is exactly the "earned familiarity" a product-register tool should have.
3. **Empty states teach.** Both the Dashboard and the un-filtered Kanban board ("Selecione um cliente nos filtros para visualizar o Kanban") tell the user precisely what to do next instead of showing a blank void.

## Priority Issues

**[P1] Priority badge colors collide with Kanban column category colors**
- **Why it matters**: `.kb-badge-priority-medium` and `--kb-color-doing` are the literal same hex (`#ff922b`); same for priority-low vs. `--kb-color-done` (`#51cf66`). A "Média" priority badge on a card in the *Novas* column renders in the exact orange used to mean "this task belongs to Em Execução" elsewhere on the same board — confirmed both by direct visual inspection (Assessment A) and by the detector flagging the same hex reused across unrelated rules (Assessment B). This is a direct hit on both Consistency (heuristic 4) and Recognition (heuristic 6).
- **Fix**: Give priority its own palette drawn from the app's actual `--danger-color`/`--warning-color`/`--success-color` tokens (already reserved for exactly this kind of semantic state), instead of the ad-hoc `#ff6b6b`/`#ff922b`/`#51cf66` triad that happens to overlap the Kanban category hues.
- **Suggested command**: `/impeccable colorize` (scoped to Kanban badges) or `/impeccable polish`

**[P1] A literal side-stripe border exists in the Kanban CSS, violating the project's own explicit ban**
- **Why it matters**: `main.css:4077` has `border-left: 3px solid rgba(139,92,246,0.5)` inside the Kanban drag/cascade block — flagged by the detector's `side-tab` rule. The shared absolute-bans list names this pattern first and says it is "never intentional." Whatever this element is (a done-marker or drag-affordance), it's the exact anti-pattern the system is supposed to reject everywhere.
- **Fix**: Replace with a full border, a background tint, a leading icon, or remove the stripe entirely — whichever conveys the same state without the banned pattern.
- **Suggested command**: `/impeccable polish`

**[P1] The task detail modal sidebar is a flat wall of 8 co-equal sections**
- **Why it matters**: Mover para → Labels → Cover → Cliente → Prioridade → Prazo → Estimado → Ocultar do Portal all stack with identical typographic weight and no grouping. Cognitive-load checklist fails on chunking (no groups of ≤4), hierarchy (Cliente/Prioridade are load-bearing but visually equal to the rarely-touched Cover/Ocultar do Portal toggles), and progressive disclosure (nothing collapses). For a consultant meant to dip in and out "between client calls," this asks for a full scan of 8 sections just to bump a priority or move a card.
- **Fix**: Group into 2-3 labeled clusters (e.g. "Organização": Mover para / Cliente / Prioridade; "Aparência": Labels / Cover; "Planejamento": Prazo / Estimado / Visibilidade), and consider collapsing Cover and "Ocultar do Portal" by default since they're edge-case toggles, not everyday fields.
- **Suggested command**: `/impeccable layout`

**[P2] Cover feature exceeds the sanctioned 3-hue Kanban color budget**
- **Why it matters**: The Cover picker offers 8 swatches (5 beyond the 3 sanctioned category hues) and paints a full-width 32px bar across the card top — the design system explicitly reserves multi-color coding for column category only. This is a second, uncontrolled accent system quietly living inside a "nice to have" feature.
- **Fix**: Either fold Cover into the same 3 category hues (removing the 5 extra swatches) or document it explicitly in DESIGN.md as a deliberate second exception, the way the AI-accent and financial-delta exceptions already are.
- **Suggested command**: `/impeccable colorize`

**[P2] Bounce easing on card animations, plus color-only labels**
- **Why it matters**: Four Kanban animations (`.kb-card-dropped`, `.kb-column-cascade` ×2, `.kb-card-new`) use `cubic-bezier(0.34, 1.56, 0.64, 1)` — a bounce curve — directly contradicting the product register's own motion rule ("ease-out... no bounce, no elastic"). Separately, an untitled label renders as a bare color dot with an empty `title=""`, giving colorblind users or screen readers no way to identify it — the label picker's only tooltip is the raw hex code, not a name.
- **Fix**: Swap the bounce curves for an ease-out-quart/expo equivalent already used elsewhere in the app. Require (or auto-generate) a label name before a swatch can be saved, and surface that name in the tooltip instead of the hex value.
- **Suggested command**: `/impeccable animate` (motion), `/impeccable clarify` (labels)

## Persona Red Flags

**Alex (Power User, consultant in flow between calls)**: The always-expanded 8-section modal sidebar works against a fast in-and-out edit — bumping a priority or moving a card means visually scanning past Labels/Cover/Attachments chrome first. No "quick edit" path exists distinct from the full modal, and there's no keyboard-only way to reorder or move a card (drag only).

**Sam (Accessibility-dependent user)**: Meaning is conveyed by color alone in three places simultaneously — priority badge, label dot, and cover strip — and per the P1 finding above, two of those three color systems aren't even internally distinguishable from each other by hue. An untitled label's only identifier is a raw hex code in a native `title` attribute, which is not the same as a real accessible name.

## Minor Observations

- `.kb-badge` text sits at 10px — legible in isolation, but a card carrying priority + due-date + checklist + attachment badges simultaneously would get dense; worth a look once a real card accumulates that many badges.
- Radius values across the Kanban card/modal family drift between 2px, 3px, and 6px rather than the documented `sm:4px / md:8px / lg:12px` scale — minor design-system hygiene, not user-visible on its own, but worth tightening while touching this component family.
- Focus-visible handling is solid app-wide (violet ring via `box-shadow`, never a bare `outline:none`) — no accessibility regression there, worth preserving as any of the above fixes land.
- Column-delete-blocked toast names the object and count precisely but doesn't offer a way to jump to the blocking tasks — a small dead end, not urgent.

## Questions to Consider

- The Cover feature was clearly added after the 3-color Kanban rule was set — was it meant to bypass that rule deliberately, or is it feature creep that slipped past the system?
- Does "Média prioridade" need a color at all, given it already carries a text label — would removing color from priority (text-only, like a `Baixa/Média/Alta` chip) resolve the collision more simply than finding a fourth hue?
- If the modal sidebar were grouped into clusters, would Cover and "Ocultar do Portal" actually earn a permanently-visible slot, or would collapsing them by default better match how often a consultant actually touches them day to day?
