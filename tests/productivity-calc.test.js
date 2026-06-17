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
