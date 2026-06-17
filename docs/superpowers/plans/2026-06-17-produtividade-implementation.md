# Produtividade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the "Produtividade" feature — a new view that compares hours logged in `apontamentos` against a configurable weekly target (44h default, Mon-Fri, reduced by national/manual holidays), shows day/week/month breakdowns, an accumulated balance since a configurable start date, and PDF export for evidence to show superiors.

**Architecture:** Pure calculation logic lives in two new dependency-free browser scripts (`js/holidays.js`, `js/productivity-calc.js`) that are unit-testable directly with Node (no `window`/Supabase dependency). `js/store.js` gets thin Supabase-backed CRUD/orchestration methods that fetch data and delegate all math to those pure modules. `js/app.js` gets a new `AppController` view (`renderProdutividade`) following the exact patterns already used by `renderApontamentos`/`renderDashboard`/`_calcClientBalance`. No build step — plain `<script>` tags, no bundler, no new dependencies.

**Tech Stack:** Vanilla JS ES6+, Supabase (Postgres + RLS), jsPDF + jsPDF-AutoTable (already loaded via CDN), plain Node.js `assert` for unit tests (no test framework installed in this repo).

## Global Constraints

- No build step, no TypeScript, no bundler, no new npm dependencies — match existing vanilla JS style.
- Source of truth for "hora produtiva" is exclusively the `apontamentos` table — never `records`, `tasks.spent_minutes`, or `agenda_events`.
- Jornada is uniform across the 5 weekdays (`productivity_weekly_hours / 5` per day) — no per-weekday schedule editor.
- The current day never contributes to the accumulated balance — only days strictly before today count.
- All Supabase calls go through `this.db` (`window.supabaseClient`) and `this.userId` (`Auth.getUserId()`), scoped with `.eq('user_id', this.userId)`, matching every existing method in `js/store.js`.
- Follow CLAUDE.md sidebar rule: every nav-item needs `title="..."` and a `<span class="nav-label">` for collapse support.

---

### Task 1: Database migration (holidays table + user_profiles config columns)

**Files:**
- Create: `Documentation/fase43-produtividade-migration.sql`

**Interfaces:**
- Produces: `holidays` table (`id, user_id, date, name, source, created_at`) and two new columns on `user_profiles` (`productivity_start_date DATE`, `productivity_weekly_hours NUMERIC`) — consumed by Task 4, 5, 6.

- [ ] **Step 1: Write the migration file**

```sql
-- Fase: Produtividade
-- Executar manualmente no Supabase SQL Editor (klimkamnydfnzqetqlqm) antes do deploy desta feature.

CREATE TABLE IF NOT EXISTS holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  name TEXT NOT NULL,
  source TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_own_holidays" ON holidays;
CREATE POLICY "users_own_holidays" ON holidays FOR ALL USING (auth.uid() = user_id);

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS productivity_start_date DATE;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS productivity_weekly_hours NUMERIC DEFAULT 44;
```

- [ ] **Step 2: Run it in Supabase**

Open the Supabase SQL Editor for project `klimkamnydfnzqetqlqm` and run the file's contents. Confirm with:

```sql
SELECT column_name FROM information_schema.columns WHERE table_name = 'user_profiles' AND column_name LIKE 'productivity_%';
SELECT table_name FROM information_schema.tables WHERE table_name = 'holidays';
```

Expected: 2 rows from the first query (`productivity_start_date`, `productivity_weekly_hours`), 1 row from the second (`holidays`).

- [ ] **Step 3: Commit**

```bash
git add Documentation/fase43-produtividade-migration.sql
git commit -m "docs: migration SQL para feature Produtividade"
```

---

### Task 2: `js/holidays.js` — national holiday calculation (pure, Node-testable)

**Files:**
- Create: `js/holidays.js`
- Test: `tests/holidays.test.js`

**Interfaces:**
- Produces: global `TSPHolidays` object with `{ calculateEasterDate(year), toIsoUTC(date), getNationalHolidays(year), isNationalHoliday(dateStr, year?) }`. Consumed by Task 3 (`js/productivity-calc.js`).

- [ ] **Step 1: Write the failing test**

Create `tests/holidays.test.js`:

```javascript
require('../js/holidays.js');
const assert = require('assert');

// Páscoa conhecida (valores históricos verificáveis)
assert.strictEqual(global.TSPHolidays.calculateEasterDate(2024).toISOString().slice(0, 10), '2024-03-31');
assert.strictEqual(global.TSPHolidays.calculateEasterDate(2025).toISOString().slice(0, 10), '2025-04-20');

// Feriados fixos
assert.strictEqual(global.TSPHolidays.isNationalHoliday('2026-01-01'), true);
assert.strictEqual(global.TSPHolidays.isNationalHoliday('2026-12-25'), true);
assert.strictEqual(global.TSPHolidays.isNationalHoliday('2026-06-17'), false);

// Feriados móveis 2025 (Páscoa 2025-04-20): Carnaval terça = -47 dias = 2025-03-04, Sexta Santa = -2 dias = 2025-04-18
const holidays2025 = global.TSPHolidays.getNationalHolidays(2025);
assert.strictEqual(holidays2025['2025-03-04'], 'Carnaval (terça)');
assert.strictEqual(holidays2025['2025-03-03'], 'Carnaval (segunda)');
assert.strictEqual(holidays2025['2025-04-18'], 'Sexta-feira Santa');
assert.strictEqual(holidays2025['2025-06-19'], 'Corpus Christi');

console.log('holidays.test.js: todos os testes passaram');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/holidays.test.js`
Expected: `Error: Cannot find module '../js/holidays.js'`

- [ ] **Step 3: Write the implementation**

Create `js/holidays.js`:

```javascript
(function (global) {
    function pad2(n) { return String(n).padStart(2, '0'); }

    // Algoritmo de Meeus/Jones/Butcher — calcula a data da Páscoa (calendário gregoriano)
    function calculateEasterDate(year) {
        const a = year % 19;
        const b = Math.floor(year / 100);
        const c = year % 100;
        const d = Math.floor(b / 4);
        const e = b % 4;
        const f = Math.floor((b + 8) / 25);
        const g = Math.floor((b - f + 1) / 3);
        const h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4);
        const k = c % 4;
        const l = (32 + 2 * e + 2 * i - h - k) % 7;
        const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const month = Math.floor((h + l - 7 * m + 114) / 31);
        const day = ((h + l - 7 * m + 114) % 31) + 1;
        return new Date(Date.UTC(year, month - 1, day));
    }

    function addDaysUTC(date, days) {
        return new Date(date.getTime() + days * 86400000);
    }

    function toIsoUTC(date) {
        return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
    }

    const _cache = {};

    function getNationalHolidays(year) {
        if (_cache[year]) return _cache[year];
        const easter = calculateEasterDate(year);
        const fixed = [
            [`${year}-01-01`, 'Confraternização Universal'],
            [`${year}-04-21`, 'Tiradentes'],
            [`${year}-05-01`, 'Dia do Trabalho'],
            [`${year}-09-07`, 'Independência do Brasil'],
            [`${year}-10-12`, 'Nossa Senhora Aparecida'],
            [`${year}-11-02`, 'Finados'],
            [`${year}-11-15`, 'Proclamação da República'],
            [`${year}-12-25`, 'Natal']
        ];
        const moveable = [
            [toIsoUTC(addDaysUTC(easter, -48)), 'Carnaval (segunda)'],
            [toIsoUTC(addDaysUTC(easter, -47)), 'Carnaval (terça)'],
            [toIsoUTC(addDaysUTC(easter, -2)), 'Sexta-feira Santa'],
            [toIsoUTC(addDaysUTC(easter, 60)), 'Corpus Christi']
        ];
        const map = {};
        [...fixed, ...moveable].forEach(([date, name]) => { map[date] = name; });
        _cache[year] = map;
        return map;
    }

    function isNationalHoliday(dateStr, year) {
        const y = year || parseInt(dateStr.slice(0, 4), 10);
        return Object.prototype.hasOwnProperty.call(getNationalHolidays(y), dateStr);
    }

    global.TSPHolidays = { calculateEasterDate, toIsoUTC, getNationalHolidays, isNationalHoliday };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/holidays.test.js`
Expected: `holidays.test.js: todos os testes passaram`

- [ ] **Step 5: Commit**

```bash
git add js/holidays.js tests/holidays.test.js
git commit -m "feat: calculadora de feriados nacionais (fixos + móveis via Páscoa)"
```

---

### Task 3: `js/productivity-calc.js` — meta/saldo aggregation (pure, Node-testable)

**Files:**
- Create: `js/productivity-calc.js`
- Test: `tests/productivity-calc.test.js`

**Interfaces:**
- Consumes: `global.TSPHolidays.isNationalHoliday(dateStr)` from Task 2.
- Produces: global `TSPProductivity` object with `{ minutesBetween(start,end), isWorkday(dateStr), dailyTargetMinutes(dateStr, weeklyHours, manualHolidayDates), computeDay(dateStr, items, weeklyHours, manualHolidayDates), computeRange(startDate, endDate, apontamentosByDate, weeklyHours, manualHolidayDates), computeAccumulatedBalance(startDate, todayStr, apontamentosByDate, weeklyHours, manualHolidayDates), getPeriodRange(period, refDateStr), fmtMinutes(totalMin) }`. `computeRange` return shape: `{ startDate, endDate, days: [{date, targetMinutes, actualMinutes, deltaMinutes}], targetMinutes, actualMinutes, deltaMinutes }`. Consumed by Task 6 (`store.js`) and Task 9 (`app.js`).

- [ ] **Step 1: Write the failing test**

Create `tests/productivity-calc.test.js`:

```javascript
require('../js/holidays.js');
require('../js/productivity-calc.js');
const assert = require('assert');
const P = global.TSPProductivity;

// minutesBetween
assert.strictEqual(P.minutesBetween('07:42', '12:00'), 258);
assert.strictEqual(P.minutesBetween('13:30', '18:00'), 270);
assert.strictEqual(P.minutesBetween('', '18:00'), 0);
assert.strictEqual(P.minutesBetween('18:00', '17:00'), 0);

// isWorkday — 2026-06-15 é segunda, 2026-06-20 sábado, 2026-06-21 domingo
assert.strictEqual(P.isWorkday('2026-06-15'), true);
assert.strictEqual(P.isWorkday('2026-06-20'), false);
assert.strictEqual(P.isWorkday('2026-06-21'), false);

// dailyTargetMinutes — 44h/5 = 528min (8h48)
assert.strictEqual(P.dailyTargetMinutes('2026-06-15', 44, new Set()), 528);
assert.strictEqual(P.dailyTargetMinutes('2026-01-01', 44, new Set()), 0); // feriado nacional
assert.strictEqual(P.dailyTargetMinutes('2026-06-15', 44, new Set(['2026-06-15'])), 0); // feriado manual
assert.strictEqual(P.dailyTargetMinutes('2026-06-20', 44, new Set()), 0); // fim de semana

// computeDay
const day = P.computeDay('2026-06-15', [
    { startTime: '07:42', endTime: '12:00' },
    { startTime: '13:30', endTime: '18:00' }
], 44, new Set());
assert.strictEqual(day.targetMinutes, 528);
assert.strictEqual(day.actualMinutes, 528);
assert.strictEqual(day.deltaMinutes, 0);

// computeRange — semana 15 a 19/06/2026 (seg-sex), sem apontamentos
const range = P.computeRange('2026-06-15', '2026-06-19', {}, 44, new Set());
assert.strictEqual(range.days.length, 5);
assert.strictEqual(range.targetMinutes, 528 * 5);
assert.strictEqual(range.actualMinutes, 0);
assert.strictEqual(range.deltaMinutes, -528 * 5);

// computeAccumulatedBalance — início 16/06 (terça), hoje 17/06 -> só conta 16/06
const acc = P.computeAccumulatedBalance('2026-06-16', '2026-06-17', {}, 44, new Set());
assert.strictEqual(acc.lastDate, '2026-06-16');
assert.strictEqual(acc.balanceMinutes, -528);

// getPeriodRange
assert.deepStrictEqual(P.getPeriodRange('day', '2026-06-17'), { startDate: '2026-06-17', endDate: '2026-06-17' });
assert.deepStrictEqual(P.getPeriodRange('week', '2026-06-17'), { startDate: '2026-06-15', endDate: '2026-06-21' });
assert.deepStrictEqual(P.getPeriodRange('month', '2026-06-17'), { startDate: '2026-06-01', endDate: '2026-06-30' });

// fmtMinutes
assert.strictEqual(P.fmtMinutes(90), '+1h 30min');
assert.strictEqual(P.fmtMinutes(-45), '-0h 45min');

console.log('productivity-calc.test.js: todos os testes passaram');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/productivity-calc.test.js`
Expected: `Error: Cannot find module '../js/productivity-calc.js'`

- [ ] **Step 3: Write the implementation**

Create `js/productivity-calc.js`:

```javascript
(function (global) {
    const Holidays = global.TSPHolidays;

    function pad2(n) { return String(n).padStart(2, '0'); }

    function toIsoLocal(date) {
        return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    }

    function addDaysLocal(date, days) {
        const d = new Date(date);
        d.setDate(d.getDate() + days);
        return d;
    }

    function minutesBetween(startTime, endTime) {
        if (!startTime || !endTime) return 0;
        const [sh, sm] = startTime.split(':').map(Number);
        const [eh, em] = endTime.split(':').map(Number);
        if ([sh, sm, eh, em].some(n => Number.isNaN(n))) return 0;
        const mins = (eh * 60 + em) - (sh * 60 + sm);
        return mins > 0 ? mins : 0;
    }

    function isWorkday(dateStr) {
        const d = new Date(dateStr + 'T12:00:00');
        const wd = d.getDay();
        return wd >= 1 && wd <= 5;
    }

    function dailyTargetMinutes(dateStr, weeklyHours, manualHolidayDates) {
        if (!isWorkday(dateStr)) return 0;
        if (Holidays.isNationalHoliday(dateStr)) return 0;
        if (manualHolidayDates && manualHolidayDates.has(dateStr)) return 0;
        return Math.round((weeklyHours / 5) * 60);
    }

    function computeDay(dateStr, apontamentosForDay, weeklyHours, manualHolidayDates) {
        const targetMinutes = dailyTargetMinutes(dateStr, weeklyHours, manualHolidayDates);
        const actualMinutes = (apontamentosForDay || []).reduce((s, a) => s + minutesBetween(a.startTime, a.endTime), 0);
        return { date: dateStr, targetMinutes, actualMinutes, deltaMinutes: actualMinutes - targetMinutes };
    }

    function computeRange(startDate, endDate, apontamentosByDate, weeklyHours, manualHolidayDates) {
        const days = [];
        let cur = new Date(startDate + 'T12:00:00');
        const end = new Date(endDate + 'T12:00:00');
        while (cur <= end) {
            const iso = toIsoLocal(cur);
            days.push(computeDay(iso, apontamentosByDate[iso], weeklyHours, manualHolidayDates));
            cur = addDaysLocal(cur, 1);
        }
        const targetMinutes = days.reduce((s, d) => s + d.targetMinutes, 0);
        const actualMinutes = days.reduce((s, d) => s + d.actualMinutes, 0);
        return { startDate, endDate, days, targetMinutes, actualMinutes, deltaMinutes: actualMinutes - targetMinutes };
    }

    function computeAccumulatedBalance(startDate, todayStr, apontamentosByDate, weeklyHours, manualHolidayDates) {
        const yesterday = addDaysLocal(new Date(todayStr + 'T12:00:00'), -1);
        const yesterdayIso = toIsoLocal(yesterday);
        if (yesterdayIso < startDate) return { balanceMinutes: 0, lastDate: null };
        const range = computeRange(startDate, yesterdayIso, apontamentosByDate, weeklyHours, manualHolidayDates);
        return { balanceMinutes: range.deltaMinutes, lastDate: yesterdayIso };
    }

    function getPeriodRange(period, refDateStr) {
        const ref = new Date(refDateStr + 'T12:00:00');
        if (period === 'day') {
            return { startDate: refDateStr, endDate: refDateStr };
        }
        if (period === 'week') {
            const dow = ref.getDay();
            const diffToMonday = dow === 0 ? -6 : 1 - dow;
            const monday = addDaysLocal(ref, diffToMonday);
            const sunday = addDaysLocal(monday, 6);
            return { startDate: toIsoLocal(monday), endDate: toIsoLocal(sunday) };
        }
        if (period === 'month') {
            const y = ref.getFullYear(), m = ref.getMonth();
            const first = new Date(y, m, 1);
            const last = new Date(y, m + 1, 0);
            return { startDate: toIsoLocal(first), endDate: toIsoLocal(last) };
        }
        throw new Error('Período inválido: ' + period);
    }

    function fmtMinutes(totalMin) {
        const sign = totalMin < 0 ? '-' : '+';
        const abs = Math.abs(Math.round(totalMin));
        const h = Math.floor(abs / 60);
        const m = abs % 60;
        return `${sign}${h}h ${String(m).padStart(2, '0')}min`;
    }

    global.TSPProductivity = {
        minutesBetween, isWorkday, dailyTargetMinutes, computeDay, computeRange,
        computeAccumulatedBalance, getPeriodRange, fmtMinutes, toIsoLocal, addDaysLocal
    };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/productivity-calc.test.js`
Expected: `productivity-calc.test.js: todos os testes passaram`

- [ ] **Step 5: Commit**

```bash
git add js/productivity-calc.js tests/productivity-calc.test.js
git commit -m "feat: cálculo puro de meta/saldo de produtividade"
```

---

### Task 4: `js/store.js` — holidays CRUD

**Files:**
- Modify: `js/store.js` (add mapper near other mappers, e.g. after `_apontamento` at line 68; add CRUD methods near `getApontamentos`/`addApontamento`/`deleteApontamento` around line 701)

**Interfaces:**
- Produces: `store._holiday(r)`, `store.getHolidays()`, `store.addHoliday(date, name)`, `store.deleteHoliday(id)`. Consumed by Task 6 and Task 9.

- [ ] **Step 1: Add the mapper**

In `js/store.js`, immediately after the `_apontamento` mapper (line 68, right before the `_column` mapper), add:

```javascript
    _holiday(r) {
        return { id: r.id, date: r.date, name: r.name, createdAt: r.created_at };
    }
```

- [ ] **Step 2: Add the CRUD methods**

Immediately after `deleteApontamento` (line 701), add:

```javascript
    async getHolidays() {
        const { data, error } = await this.db.from('holidays')
            .select('*').eq('user_id', this.userId).order('date');
        if (error) throw error;
        return (data || []).map(r => this._holiday(r));
    }

    async addHoliday(date, name) {
        const { data, error } = await this.db.from('holidays').insert({
            user_id: this.userId, date, name
        }).select().single();
        if (error) throw error;
        return this._holiday(data);
    }

    async deleteHoliday(id) {
        const { error } = await this.db.from('holidays').delete()
            .eq('id', id).eq('user_id', this.userId);
        if (error) throw error;
    }
```

- [ ] **Step 3: Verify no syntax errors**

Run: `node --check js/store.js`
Expected: no output (exit code 0). This only validates JS syntax — `this.db`/`this.userId` still require a browser session to actually execute, which is verified end-to-end in Task 11.

- [ ] **Step 4: Commit**

```bash
git add js/store.js
git commit -m "feat: CRUD de feriados manuais no store"
```

---

### Task 5: `js/store.js` — productivity config CRUD

**Files:**
- Modify: `js/store.js` (add methods right after the holidays CRUD added in Task 4)

**Interfaces:**
- Produces: `store.getProductivityConfig()` returns `{ startDate: string|null, weeklyHours: number }`; `store.saveProductivityConfig(startDate, weeklyHours)`. Consumed by Task 6 and Task 9.

- [ ] **Step 1: Add the methods**

Right after `deleteHoliday` (added in Task 4), add:

```javascript
    async getProductivityConfig() {
        const { data, error } = await this.db.from('user_profiles')
            .select('productivity_start_date, productivity_weekly_hours')
            .eq('user_id', this.userId).maybeSingle();
        if (error) throw error;
        return {
            startDate: data?.productivity_start_date || null,
            weeklyHours: data ? (parseFloat(data.productivity_weekly_hours) || 44) : 44
        };
    }

    async saveProductivityConfig(startDate, weeklyHours) {
        const { error } = await this.db.from('user_profiles').upsert({
            user_id: this.userId,
            productivity_start_date: startDate || null,
            productivity_weekly_hours: weeklyHours,
            updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
        if (error) throw error;
    }
```

- [ ] **Step 2: Verify no syntax errors**

Run: `node --check js/store.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add js/store.js
git commit -m "feat: config de meta semanal e data de inicio do saldo acumulado"
```

---

### Task 6: `js/store.js` — apontamentos por intervalo + orquestrador de produtividade

**Files:**
- Modify: `js/store.js` (add `getApontamentosByRange` near `getApontamentos`, i.e. right before the mapper-CRUD block edited in Task 4; add `getProductivitySummary` after the methods added in Task 5)

**Interfaces:**
- Consumes: `this.getProductivityConfig()`, `this.getHolidays()` (Task 5, 4), `global.TSPProductivity.getPeriodRange/computeRange/computeAccumulatedBalance/computeDay` (Task 3).
- Produces: `store.getApontamentosByRange(startDate, endDate)` → `Apontamento[]`. `store.getProductivitySummary(period, refDateStr)` → `{ config, todayStr, period: RangeResult, accumulated: {balanceMinutes, lastDate}|null, todayProgress: DayResult, items: Apontamento[] }`. Consumed by Task 9 (`app.js`).

- [ ] **Step 1: Add `getApontamentosByRange`**

In `js/store.js`, immediately before `async getApontamentos(date) {` (line 666), add:

```javascript
    async getApontamentosByRange(startDate, endDate) {
        const { data, error } = await this.db.from('apontamentos')
            .select('*').eq('user_id', this.userId)
            .gte('date', startDate).lte('date', endDate)
            .order('date').order('start_time');
        if (error) throw error;
        return (data || []).map(r => this._apontamento(r));
    }

```

- [ ] **Step 2: Add `getProductivitySummary`**

Right after `saveProductivityConfig` (added in Task 5), add:

```javascript
    async getProductivitySummary(period, refDateStr) {
        const config = await this.getProductivityConfig();
        const manualHolidays = await this.getHolidays();
        const manualHolidayDates = new Set(manualHolidays.map(h => h.date));

        const todayStr = new Date().toISOString().split('T')[0];
        const periodRange = TSPProductivity.getPeriodRange(period, refDateStr);

        let queryStart = periodRange.startDate;
        if (config.startDate && config.startDate < queryStart) queryStart = config.startDate;
        let queryEnd = periodRange.endDate;
        if (todayStr > queryEnd) queryEnd = todayStr;

        const items = await this.getApontamentosByRange(queryStart, queryEnd);
        const apontamentosByDate = {};
        items.forEach(it => {
            if (!apontamentosByDate[it.date]) apontamentosByDate[it.date] = [];
            apontamentosByDate[it.date].push(it);
        });

        const periodResult = TSPProductivity.computeRange(
            periodRange.startDate, periodRange.endDate, apontamentosByDate, config.weeklyHours, manualHolidayDates
        );

        let accumulated = null;
        if (config.startDate) {
            accumulated = TSPProductivity.computeAccumulatedBalance(
                config.startDate, todayStr, apontamentosByDate, config.weeklyHours, manualHolidayDates
            );
        }

        const todayItems = apontamentosByDate[todayStr] || [];
        const todayProgress = TSPProductivity.computeDay(todayStr, todayItems, config.weeklyHours, manualHolidayDates);

        return { config, todayStr, period: periodResult, accumulated, todayProgress, items };
    }
```

- [ ] **Step 3: Verify no syntax errors**

Run: `node --check js/store.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add js/store.js
git commit -m "feat: orquestrador getProductivitySummary no store"
```

---

### Task 7: HTML scaffolding — script tags, nav item, view section, config modal

**Files:**
- Modify: `index.html`

**Interfaces:**
- Produces: DOM elements `#view-produtividade`, `#produtividade-container`, `#prod-period-tabs`, `#btn-prod-prev`/`#btn-prod-next`/`#btn-prod-today`, `#modal-produtividade-config` with `#form-produtividade-config`, `#prod-weekly-hours`, `#prod-start-date`, `#prod-holiday-date`, `#prod-holiday-name`, `#prod-holidays-list`. Consumed by Task 8 and Task 9 (`app.js` reads/writes these IDs).

- [ ] **Step 1: Load the two new pure-logic scripts before `store.js`**

In `index.html`, find (around line 2318-2321):

```html
    <script src="js/calendar.js?v=21"></script>
    <script src="js/store.js?v=25"></script>
    <script src="js/ai.js?v=1"></script>
    <script src="js/app.js?v=33"></script>
```

Replace with:

```html
    <script src="js/calendar.js?v=21"></script>
    <script src="js/holidays.js?v=1"></script>
    <script src="js/productivity-calc.js?v=1"></script>
    <script src="js/store.js?v=26"></script>
    <script src="js/ai.js?v=1"></script>
    <script src="js/app.js?v=34"></script>
```

- [ ] **Step 2: Add the nav item**

Find (around line 102-104):

```html
            <li class="nav-item" data-view="chamados" title="Chamados">
                <i data-lucide="headphones"></i><span class="nav-label">Chamados</span>
            </li>
        </ul>
```

Replace with:

```html
            <li class="nav-item" data-view="chamados" title="Chamados">
                <i data-lucide="headphones"></i><span class="nav-label">Chamados</span>
            </li>
            <li class="nav-item" data-view="produtividade" title="Produtividade">
                <i data-lucide="trending-up"></i><span class="nav-label">Produtividade</span>
            </li>
        </ul>
```

- [ ] **Step 3: Add the view section**

Find the end of the Chamados view section (around line 701-704):

```html
            <div id="chamados-content"></div>
        </section>

    </main>
```

Replace with:

```html
            <div id="chamados-content"></div>
        </section>

        <!-- VIEW: PRODUTIVIDADE -->
        <section class="view-section" id="view-produtividade">
            <div class="view-header">
                <div class="view-header-left">
                    <h1>Produtividade</h1>
                    <div class="apontamentos-date-nav" id="prod-period-tabs">
                        <button type="button" class="btn btn-secondary btn-sm" data-period="day" onclick="app.prodSetPeriod('day')">Dia</button>
                        <button type="button" class="btn btn-secondary btn-sm" data-period="week" onclick="app.prodSetPeriod('week')">Semana</button>
                        <button type="button" class="btn btn-secondary btn-sm" data-period="month" onclick="app.prodSetPeriod('month')">Mês</button>
                        <button id="btn-prod-prev" class="btn-icon" title="Anterior" onclick="app.prodNavigate(-1)">
                            <i data-lucide="chevron-left"></i>
                        </button>
                        <button id="btn-prod-next" class="btn-icon" title="Próximo" onclick="app.prodNavigate(1)">
                            <i data-lucide="chevron-right"></i>
                        </button>
                        <button id="btn-prod-today" class="btn btn-secondary btn-sm" onclick="app.prodGoToToday()">Hoje</button>
                    </div>
                </div>
                <div class="view-header-actions">
                    <button class="btn btn-secondary" onclick="app.openProdutividadeConfig()">
                        <i data-lucide="settings-2"></i>
                        <span class="nav-label">Configurar</span>
                    </button>
                    <button class="btn btn-primary" onclick="app.exportProdutividadePDF()">
                        <i data-lucide="file-down"></i>
                        <span class="nav-label">Exportar PDF</span>
                    </button>
                </div>
            </div>
            <div id="produtividade-container"></div>
        </section>

    </main>
```

- [ ] **Step 4: Add the config modal**

Find the end of the Implementation modal, right before the scripts comment (around line 1861-1863):

```html
            </form>
        </div>
    </div>

    <!-- SCRIPTS -->
```

Replace with:

```html
            </form>
        </div>
    </div>

    <!-- MODAL: CONFIGURAÇÃO DE PRODUTIVIDADE -->
    <div class="modal-overlay" id="modal-produtividade-config">
        <div class="modal glass" style="max-width: 520px;">
            <div class="modal-header">
                <h3>Configurar Produtividade</h3>
                <button class="close-modal" onclick="app.closeModal('modal-produtividade-config')"><i data-lucide="x"></i></button>
            </div>
            <form id="form-produtividade-config">
                <div class="form-group">
                    <label for="prod-weekly-hours">Meta semanal (horas)</label>
                    <input type="number" id="prod-weekly-hours" class="form-control" step="0.1" min="1" value="44" required>
                </div>
                <div class="form-group">
                    <label for="prod-start-date">Início do saldo acumulado</label>
                    <input type="date" id="prod-start-date" class="form-control">
                </div>
                <button type="submit" class="btn btn-primary" style="width:100%; justify-content:center; margin-top:8px;">Salvar</button>
            </form>
            <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.08);">
                <h4 style="margin:0 0 10px;font-size:0.95rem;">Feriados extras</h4>
                <div style="display:flex; gap:8px; margin-bottom:12px;">
                    <input type="date" id="prod-holiday-date" class="form-control" style="flex:1;">
                    <input type="text" id="prod-holiday-name" class="form-control" placeholder="Nome do feriado" style="flex:2;">
                    <button type="button" class="btn btn-secondary btn-sm" onclick="app.addProdHoliday()">Adicionar</button>
                </div>
                <div id="prod-holidays-list"></div>
            </div>
        </div>
    </div>

    <!-- SCRIPTS -->
```

- [ ] **Step 5: Verify the page still loads with no console errors**

Run: `python -m http.server 8080` from `d:\GerenciadorTSP`, open `http://localhost:8080/index.html` in a browser, open DevTools console.
Expected: no red errors (the new `app.prodXxx`/`openProdutividadeConfig` handlers don't exist yet — Task 8/9 add them — so clicking the new nav item or buttons now is expected to throw; just confirm the page itself loads, the new nav item "Produtividade" is visible with a `trending-up` icon, and no errors fire on initial load).

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: scaffolding HTML da view Produtividade (nav, secao, modal de config)"
```

---

### Task 8: `js/app.js` — controller wiring (state, navigation, config modal handlers)

**Files:**
- Modify: `js/app.js` (constructor near line 57-80; `switchView` near line 341-385; `init()` near line 90-145; new methods placed near `aptNavigateDay` at line 5680)

**Interfaces:**
- Consumes: `store.getProductivityConfig`, `store.saveProductivityConfig`, `store.getHolidays`, `store.addHoliday`, `store.deleteHoliday` (Task 4, 5).
- Produces: `app.prodPeriod`, `app.prodRefDate`, `app.prodSetPeriod(period)`, `app.prodNavigate(delta)`, `app.prodGoToToday()`, `app.openProdutividadeConfig()`, `app.addProdHoliday()`, `app.removeProdHoliday(id)`, `app.handleProdutividadeConfigSubmit(e)`, `app._renderProdHolidaysList()`. Consumed by the HTML from Task 7 (`onclick` attributes) and by Task 9 (`renderProdutividade` reads `this.prodPeriod`/`this.prodRefDate`).

- [ ] **Step 1: Add controller state**

In `js/app.js`, inside the `AppController` constructor, right after the line `this.aptCurrentDate = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'`, add:

```javascript
        this.prodPeriod = 'week'; // 'day' | 'week' | 'month'
        this.prodRefDate = new Date().toISOString().split('T')[0];
        this._prodSummary = null;
        this._prodConfigHolidays = [];
```

- [ ] **Step 2: Wire `switchView`**

In `switchView(viewName)`, find:

```javascript
    const VIEW_ORDER = ['dashboard','clients','records','tasks','agenda','apontamentos','implementations','trainings','chamados'];
```

Replace with:

```javascript
    const VIEW_ORDER = ['dashboard','clients','records','tasks','agenda','apontamentos','implementations','trainings','chamados','produtividade'];
```

Then find the chain of `if (viewName === 'dashboard') { ... } else if (...) { ... }` and add a final branch right before its closing brace:

```javascript
    } else if (viewName === 'produtividade') {
        this.renderProdutividade();
    }
```

- [ ] **Step 3: Wire the config form submit listener**

In `init()`, right after the block that adds the `.nav-item` click listeners, add:

```javascript
        document.getElementById('form-produtividade-config')?.addEventListener('submit', (e) => this.handleProdutividadeConfigSubmit(e));
```

- [ ] **Step 4: Add navigation and config methods**

Right after `aptNavigateDay(delta) { ... }` (line 5680-5685), add:

```javascript
    prodSetPeriod(period) {
        this.prodPeriod = period;
        this.renderProdutividade();
    }

    prodNavigate(delta) {
        const d = new Date(this.prodRefDate + 'T12:00:00');
        if (this.prodPeriod === 'day') d.setDate(d.getDate() + delta);
        else if (this.prodPeriod === 'week') d.setDate(d.getDate() + delta * 7);
        else d.setMonth(d.getMonth() + delta);
        this.prodRefDate = d.toISOString().split('T')[0];
        this.renderProdutividade();
    }

    prodGoToToday() {
        this.prodRefDate = new Date().toISOString().split('T')[0];
        this.renderProdutividade();
    }

    async openProdutividadeConfig() {
        const [config, holidays] = await Promise.all([
            store.getProductivityConfig(),
            store.getHolidays()
        ]);
        document.getElementById('prod-weekly-hours').value = config.weeklyHours;
        document.getElementById('prod-start-date').value = config.startDate || '';
        this._prodConfigHolidays = holidays;
        this._renderProdHolidaysList();
        this.openModal('modal-produtividade-config');
    }

    _renderProdHolidaysList() {
        const list = document.getElementById('prod-holidays-list');
        if (!list) return;
        if (this._prodConfigHolidays.length === 0) {
            list.innerHTML = `<p class="text-muted" style="font-size:0.85rem;">Nenhum feriado manual cadastrado.</p>`;
            return;
        }
        list.innerHTML = this._prodConfigHolidays.map(h => {
            const [y, m, d] = h.date.split('-');
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
                <span style="font-size:0.85rem;">${d}/${m}/${y} — ${escapeHtml(h.name)}</span>
                <button type="button" class="btn-icon" onclick="app.removeProdHoliday('${h.id}')" title="Remover"><i data-lucide="trash-2" style="width:14px;height:14px;"></i></button>
            </div>`;
        }).join('');
        lucide.createIcons();
    }

    async addProdHoliday() {
        const dateInput = document.getElementById('prod-holiday-date');
        const nameInput = document.getElementById('prod-holiday-name');
        const date = dateInput.value;
        const name = nameInput.value.trim();
        if (!date || !name) { Toast.show('Informe data e nome do feriado.', 'error'); return; }
        try {
            const created = await store.addHoliday(date, name);
            this._prodConfigHolidays.push(created);
            this._prodConfigHolidays.sort((a, b) => a.date.localeCompare(b.date));
            dateInput.value = '';
            nameInput.value = '';
            this._renderProdHolidaysList();
        } catch (err) {
            Toast.show('Erro ao adicionar feriado: ' + err.message, 'error');
        }
    }

    async removeProdHoliday(id) {
        try {
            await store.deleteHoliday(id);
            this._prodConfigHolidays = this._prodConfigHolidays.filter(h => h.id !== id);
            this._renderProdHolidaysList();
        } catch (err) {
            Toast.show('Erro ao remover feriado: ' + err.message, 'error');
        }
    }

    async handleProdutividadeConfigSubmit(e) {
        e.preventDefault();
        const weeklyHours = parseFloat(document.getElementById('prod-weekly-hours').value) || 44;
        const startDate = document.getElementById('prod-start-date').value || null;
        try {
            await store.saveProductivityConfig(startDate, weeklyHours);
            Toast.show('Configuração salva.', 'success');
            this.closeModal('modal-produtividade-config');
            this.renderProdutividade();
        } catch (err) {
            Toast.show('Erro ao salvar: ' + err.message, 'error');
        }
    }
```

- [ ] **Step 5: Verify no syntax errors**

Run: `node --check js/app.js`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add js/app.js
git commit -m "feat: controller da view Produtividade (navegacao e modal de config)"
```

---

### Task 9: `js/app.js` — `renderProdutividade` (balance card, period card, chart, table)

**Files:**
- Modify: `js/app.js` (add methods right after the methods added in Task 8, i.e. after `handleProdutividadeConfigSubmit`)

**Interfaces:**
- Consumes: `store.getProductivitySummary(period, refDateStr)` (Task 6), `TSPProductivity.fmtMinutes` (Task 3), `escapeHtml`, `spinnerHtml`, `lucide.createIcons()` (existing globals in `app.js`).
- Produces: `app.renderProdutividade()`, `app._buildProdBalanceCard`, `app._buildProdPeriodCard`, `app._buildProdChart`, `app._buildProdTable`, `app._prodFmtAbs`. Consumed by `switchView` (Task 8) and Task 10 (PDF export reads `this._prodSummary`).

- [ ] **Step 1: Add `renderProdutividade` and its card builders**

Right after `handleProdutividadeConfigSubmit` (added in Task 8), add:

```javascript
    _prodFmtAbs(totalMin) {
        const abs = Math.round(Math.abs(totalMin));
        const h = Math.floor(abs / 60);
        const m = abs % 60;
        return `${h}h ${String(m).padStart(2, '0')}min`;
    }

    async renderProdutividade() {
        if (this.currentView !== 'produtividade') return;
        const container = document.getElementById('produtividade-container');
        if (!container) return;
        container.innerHTML = spinnerHtml;

        document.querySelectorAll('#prod-period-tabs button[data-period]').forEach(btn => {
            btn.classList.toggle('active-mode', btn.dataset.period === this.prodPeriod);
        });

        try {
            const summary = await store.getProductivitySummary(this.prodPeriod, this.prodRefDate);
            this._prodSummary = summary;
            container.innerHTML = '';
            container.appendChild(this._buildProdBalanceCard(summary));
            container.appendChild(this._buildProdPeriodCard(summary));
            container.appendChild(this._buildProdChart(summary));
            container.appendChild(this._buildProdTable(summary));
            lucide.createIcons();
            requestAnimationFrame(() => requestAnimationFrame(() => {
                document.querySelectorAll('#produtividade-container .prod-bar-fill').forEach(bar => {
                    bar.style.width = bar.dataset.w + '%';
                });
            }));
        } catch (err) {
            container.innerHTML = `<div class="glass" style="padding:24px;"><p class="text-muted">Erro ao carregar: ${err.message}</p></div>`;
        }
    }

    _buildProdBalanceCard(summary) {
        const card = document.createElement('div');
        card.className = 'glass stat-card';
        card.style.marginBottom = '16px';
        if (!summary.accumulated) {
            card.innerHTML = `
                <div class="stat-header"><span class="client-name">Saldo Acumulado</span></div>
                <p class="text-muted" style="margin:8px 0 0;">Configure a data de início para acompanhar o saldo acumulado.</p>
                <button class="btn btn-secondary btn-sm" style="margin-top:12px;align-self:flex-start;" onclick="app.openProdutividadeConfig()">Configurar</button>
            `;
            return card;
        }
        const bal = summary.accumulated.balanceMinutes;
        const color = bal >= 0 ? '#4ade80' : '#f87171';
        const [sy, sm, sd] = summary.config.startDate.split('-');
        const [ly, lm, ld] = summary.accumulated.lastDate.split('-');
        card.innerHTML = `
            <div class="stat-header">
                <span class="client-name">Saldo Acumulado</span>
                <span style="font-weight:700;font-size:1.4rem;color:${color};">${TSPProductivity.fmtMinutes(bal)}</span>
            </div>
            <p class="text-muted" style="margin:4px 0 0;font-size:0.8rem;">Desde ${sd}/${sm}/${sy} até ${ld}/${lm}/${ly}</p>
        `;
        return card;
    }

    _buildProdPeriodCard(summary) {
        const p = summary.period;
        const isTodayInProgress = (this.prodPeriod === 'day' && this.prodRefDate === summary.todayStr);
        const pct = p.targetMinutes > 0 ? Math.round(p.actualMinutes / p.targetMinutes * 100) : 0;
        const deltaColor = isTodayInProgress ? 'var(--text-muted)' : (p.deltaMinutes >= 0 ? '#4ade80' : '#f87171');
        const barColor = isTodayInProgress ? 'linear-gradient(90deg,#a855f7,#7c3aed)' : (p.deltaMinutes >= 0 ? 'linear-gradient(90deg,#22c55e,#16a34a)' : '#f87171');
        const periodLabel = { day: 'Dia', week: 'Semana', month: 'Mês' }[this.prodPeriod];
        const deltaLabel = isTodayInProgress ? 'em andamento' : TSPProductivity.fmtMinutes(p.deltaMinutes);
        const card = document.createElement('div');
        card.className = 'glass stat-card';
        card.style.marginBottom = '16px';
        card.innerHTML = `
            <div class="stat-header">
                <span class="client-name">${periodLabel}: ${this._prodFmtAbs(p.actualMinutes)} / ${this._prodFmtAbs(p.targetMinutes)}</span>
                <span style="font-weight:600;color:${deltaColor}">${deltaLabel}</span>
            </div>
            <div class="progress-container">
                <div class="progress-bar" style="width:${Math.min(100, pct)}%; background:${barColor};"></div>
            </div>
            <div style="font-size:0.85rem;margin-top:8px;">
                <span class="text-muted">${pct}% da meta</span>
            </div>
        `;
        return card;
    }

    _buildProdChart(summary) {
        const wrap = document.createElement('div');
        wrap.className = 'glass';
        wrap.style.padding = '20px 24px';
        wrap.style.marginBottom = '16px';
        const days = summary.period.days;
        const maxMin = Math.max(...days.map(d => Math.max(d.targetMinutes, d.actualMinutes)), 1);
        const rows = days.map(d => {
            const [, m, dd] = d.date.split('-');
            const label = `${dd}/${m}`;
            const actualPct = Math.round(d.actualMinutes / maxMin * 100);
            const targetPct = Math.round(d.targetMinutes / maxMin * 100);
            const barColor = d.deltaMinutes >= 0 ? 'linear-gradient(90deg,#22c55e,#16a34a)' : '#f87171';
            return `
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                    <span style="width:46px;font-size:0.75rem;color:var(--text-muted);flex-shrink:0;">${label}</span>
                    <div style="flex:1;position:relative;height:14px;background:rgba(255,255,255,0.07);border-radius:4px;overflow:hidden;">
                        <div style="position:absolute;top:0;left:0;height:100%;width:${targetPct}%;border-right:2px dashed rgba(255,255,255,0.35);"></div>
                        <div class="prod-bar-fill" data-w="${actualPct}" style="height:100%;width:0;background:${barColor};border-radius:4px;transition:width 0.55s ease;"></div>
                    </div>
                    <span style="width:90px;text-align:right;font-size:0.78rem;color:var(--text-muted);flex-shrink:0;">${this._prodFmtAbs(d.actualMinutes)}</span>
                </div>`;
        }).join('');
        wrap.innerHTML = `<h3 style="margin:0 0 16px;font-size:1rem;">Realizado vs Meta por dia</h3>${rows}`;
        return wrap;
    }

    _buildProdTable(summary) {
        const wrap = document.createElement('div');
        wrap.className = 'glass';
        wrap.style.padding = '0';
        const items = [...summary.items]
            .filter(it => it.date >= summary.period.startDate && it.date <= summary.period.endDate)
            .sort((a, b) => a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date));
        if (items.length === 0) {
            wrap.innerHTML = `<p class="text-muted" style="text-align:center;padding:24px;">Nenhum apontamento neste período.</p>`;
            return wrap;
        }
        const rows = items.map(it => {
            const [y, m, d] = it.date.split('-');
            const dur = TSPProductivity.minutesBetween(it.startTime, it.endTime);
            return `<tr>
                <td>${d}/${m}/${y}</td>
                <td>${escapeHtml(it.startTime)} – ${escapeHtml(it.endTime)}</td>
                <td>${escapeHtml(it.projectNum)}</td>
                <td>${escapeHtml(it.description)}</td>
                <td style="text-align:right;">${this._prodFmtAbs(dur)}</td>
            </tr>`;
        }).join('');
        wrap.innerHTML = `
            <table class="data-table" style="margin:0;">
                <thead><tr><th>Data</th><th>Horário</th><th>Proj.</th><th>Descrição</th><th style="text-align:right;">Duração</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
        return wrap;
    }
```

- [ ] **Step 2: Verify no syntax errors**

Run: `node --check js/app.js`
Expected: no output.

- [ ] **Step 3: Manual verification in the browser**

Run: `python -m http.server 8080` from `d:\GerenciadorTSP`, open `http://localhost:8080/index.html`, log in, click "Produtividade" in the sidebar.
Expected: the view renders with a balance card (likely showing "Configure a data de início..." since the config hasn't been set yet), a period card showing Meta/Realizado/Saldo for the current week, a horizontal bar chart with one row per weekday, and a table (likely "Nenhum apontamento neste período" unless you already have apontamentos this week). No console errors.

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat: renderProdutividade com cards, grafico de barras e tabela"
```

---

### Task 10: `js/app.js` — PDF export

**Files:**
- Modify: `js/app.js` (add method right after `_buildProdTable`, added in Task 9)

**Interfaces:**
- Consumes: `this._prodSummary` (set by `renderProdutividade` in Task 9), `window.jspdf` (already loaded via CDN, used by `exportFilteredToPDF`), `TSPProductivity.minutesBetween/fmtMinutes`.
- Produces: `app.exportProdutividadePDF()`. Consumed by the "Exportar PDF" button added in Task 7.

- [ ] **Step 1: Add the export method**

Right after `_buildProdTable` (added in Task 9), add:

```javascript
    async exportProdutividadePDF() {
        const summary = this._prodSummary;
        if (!summary) { Toast.show('Carregue o período antes de exportar.', 'info'); return; }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const periodLabel = { day: 'Dia', week: 'Semana', month: 'Mês' }[this.prodPeriod];
        const fmtDate = iso => iso.split('-').reverse().join('/');

        doc.setFontSize(16);
        doc.text('Relatório de Produtividade', 14, 18);
        doc.setFontSize(10);
        doc.text(`Período (${periodLabel}): ${fmtDate(summary.period.startDate)} a ${fmtDate(summary.period.endDate)}`, 14, 26);
        doc.text(`Gerado em: ${fmtDate(new Date().toISOString().split('T')[0])}`, 14, 32);

        doc.setFontSize(11);
        doc.text(`Meta: ${this._prodFmtAbs(summary.period.targetMinutes)}`, 14, 42);
        doc.text(`Realizado: ${this._prodFmtAbs(summary.period.actualMinutes)}`, 14, 48);
        doc.text(`Saldo do período: ${TSPProductivity.fmtMinutes(summary.period.deltaMinutes)}`, 14, 54);
        let nextY = 60;
        if (summary.accumulated) {
            doc.text(`Saldo acumulado (até ${fmtDate(summary.accumulated.lastDate)}): ${TSPProductivity.fmtMinutes(summary.accumulated.balanceMinutes)}`, 14, nextY);
            nextY += 6;
        }

        const items = [...summary.items]
            .filter(it => it.date >= summary.period.startDate && it.date <= summary.period.endDate)
            .sort((a, b) => a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date));

        const rows = items.map(it => [
            fmtDate(it.date),
            `${it.startTime} – ${it.endTime}`,
            it.projectNum,
            it.description.substring(0, 60)
        ]);

        doc.autoTable({
            startY: nextY + 6,
            head: [["Data", "Horário", "Projeto", "Descrição"]],
            body: rows,
            styles: { fontSize: 8 },
            headStyles: { fillColor: [79, 70, 229] },
        });

        doc.save(`produtividade_${this.prodPeriod}_${new Date().getTime()}.pdf`);
    }
```

- [ ] **Step 2: Verify no syntax errors**

Run: `node --check js/app.js`
Expected: no output.

- [ ] **Step 3: Manual verification in the browser**

With the dev server running and the Produtividade view open (with at least one apontamento logged in the current period — create one via the Apontamentos view if needed), click "Exportar PDF".
Expected: a file `produtividade_week_<timestamp>.pdf` downloads; opening it shows the header, Meta/Realizado/Saldo summary, and a table with the apontamentos of the period.

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat: exportacao PDF do relatorio de produtividade"
```

---

### Task 11: End-to-end verification, CLAUDE.md update, and final commit

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run the unit tests**

Run: `node tests/holidays.test.js && node tests/productivity-calc.test.js`
Expected: both print their "todos os testes passaram" lines, no errors.

- [ ] **Step 2: Run the Supabase migration if not already applied**

Confirm Task 1's SQL ran successfully against the `klimkamnydfnzqetqlqm` project (re-run the verification query from Task 1 Step 2 if unsure).

- [ ] **Step 3: Full manual walkthrough**

With `python -m http.server 8080` running and logged in:
1. Open Produtividade — confirm balance card prompts to configure (if not yet configured).
2. Click "Configurar" → set "Início do saldo acumulado" to a date a few weeks in the past, save.
3. Add a manual holiday for a weekday in the current month, save, confirm it now shows 0 target minutes on the chart for that day.
4. Switch between Dia / Semana / Mês tabs and use prev/next — confirm the period card and chart update and the date range in the chart matches expectations.
5. Go to Apontamentos, add a record for today, return to Produtividade, refresh the "Dia" tab — confirm "em andamento" label appears (not colored red/green) since today is in progress.
6. Click "Exportar PDF" — confirm the file downloads with correct data.
7. Check DevTools console throughout — no errors.

- [ ] **Step 4: Update CLAUDE.md**

Add a new row to the "Fases implementadas" table in `CLAUDE.md` (find the table ending with row `42 | RSVP na agenda...`) with:

```
| 43 | Produtividade: meta semanal vs apontamentos, feriados nacionais/manuais, saldo acumulado, export PDF |
```

Also add a new "Funcionalidades por view" table row after the Chamados row:

```
| **Produtividade** | Meta de horas (apontamentos) vs realizado por dia/semana/mês; feriados nacionais calculados + manuais; saldo acumulado desde data configurável; exportação PDF |
```

And add a pitfalls entry under the existing "Armadilhas conhecidas" section (near the other Apontamentos/Agenda entries):

```
- **Produtividade: hoje nunca entra no saldo acumulado** — `computeAccumulatedBalance` em `js/productivity-calc.js` sempre calcula até ontem; o card de saldo acumulado nunca reflete o dia em andamento. Para alterar esse comportamento, mudar `computeAccumulatedBalance`, não `renderProdutividade`.
- **Produtividade: feriados nacionais nunca são persistidos** — `js/holidays.js` calcula fixos e móveis (Páscoa via Meeus/Jones/Butcher) em memória, cacheados por ano; a tabela `holidays` no Supabase guarda só os extras manuais. Nunca tentar popular `holidays` com feriados nacionais — duplicaria a lógica e quebraria o cache de `getNationalHolidays`.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: documenta feature de Produtividade no CLAUDE.md"
```

- [ ] **Step 6: Push (after explicit user confirmation)**

Per project convention, deploy to production is manual via Easypanel after pushing. Ask the user before running `git push origin main` — do not push automatically.
