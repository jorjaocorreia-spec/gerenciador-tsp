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
