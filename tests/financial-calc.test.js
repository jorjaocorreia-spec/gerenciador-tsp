const assert = require('assert');
require('../js/financial-calc.js');
const TSPFinancial = global.TSPFinancial;

function run(name, fn) {
    try {
        fn();
        console.log(`OK   ${name}`);
    } catch (err) {
        console.error(`FAIL ${name}`);
        console.error(err);
        process.exitCode = 1;
    }
}

const NOW = new Date(2026, 5, 25); // 25/06/2026 (mês 6 = índice 5)

run('isEligible: cliente ativo, mês atual -> true', () => {
    const client = { status: 'active', createdAt: '2026-01-10' };
    assert.strictEqual(TSPFinancial.isEligible(client, 2026, 6, NOW), true);
});

run('isEligible: cliente finalizado, mês atual -> false', () => {
    const client = { status: 'finished', createdAt: '2026-01-10' };
    assert.strictEqual(TSPFinancial.isEligible(client, 2026, 6, NOW), false);
});

run('isEligible: cliente finalizado, mês passado em que existia -> true', () => {
    const client = { status: 'finished', createdAt: '2026-01-10' };
    assert.strictEqual(TSPFinancial.isEligible(client, 2026, 3, NOW), true);
});

run('isEligible: mês anterior à criação do cliente -> false', () => {
    const client = { status: 'active', createdAt: '2026-05-01' };
    assert.strictEqual(TSPFinancial.isEligible(client, 2026, 2, NOW), false);
});

run('isEligible: mês futuro, cliente ativo -> true', () => {
    const client = { status: 'active', createdAt: '2026-01-01' };
    assert.strictEqual(TSPFinancial.isEligible(client, 2026, 12, NOW), true);
});

run('isEligible: mês futuro, cliente finalizado -> false', () => {
    const client = { status: 'finished', createdAt: '2026-01-01' };
    assert.strictEqual(TSPFinancial.isEligible(client, 2026, 12, NOW), false);
});

run('isEligible: cliente criado no dia 1 do mês não é elegível no mês anterior (regressão timezone)', () => {
    const client = { status: 'active', createdAt: '2026-06-01' };
    assert.strictEqual(TSPFinancial.isEligible(client, 2026, 5, NOW), false);
    assert.strictEqual(TSPFinancial.isEligible(client, 2026, 6, NOW), true);
});

run('computeEntry: não elegível -> null', () => {
    const client = { billingModel: 'fixed', clientPays: 1000 };
    assert.strictEqual(TSPFinancial.computeEntry(client, 2026, 6, 0, false), null);
});

run('computeEntry: fixo elegível -> valor e comissão corretos', () => {
    const client = { billingModel: 'fixed', clientPays: 2000, consultantBonus: 50 };
    const entry = TSPFinancial.computeEntry(client, 2026, 6, 0, true);
    assert.strictEqual(entry.valor, 2000);
    assert.strictEqual(entry.comissao, 2000 * 0.43 + 50);
    assert.strictEqual(entry.detalhe, null);
});

run('computeEntry: fixo sem bônus -> comissão só 43%', () => {
    const client = { billingModel: 'fixed', clientPays: 1000, consultantBonus: 0 };
    const entry = TSPFinancial.computeEntry(client, 2026, 6, 0, true);
    assert.strictEqual(entry.comissao, 430);
});

run('computeEntry: por hora elegível -> valor = horas x rate, sem comissão', () => {
    const client = { billingModel: 'hourly', hourlyRate: 150 };
    const entry = TSPFinancial.computeEntry(client, 2026, 6, 750, true); // 750 min = 12.5h
    assert.strictEqual(entry.valor, 12.5 * 150);
    assert.strictEqual(entry.comissao, 0);
    assert.strictEqual(entry.detalhe.horas, 12.5);
    assert.strictEqual(entry.detalhe.rate, 150);
});

run('computeEntry: por hora sem registros no mês -> valor 0, ainda elegível', () => {
    const client = { billingModel: 'hourly', hourlyRate: 150 };
    const entry = TSPFinancial.computeEntry(client, 2026, 6, 0, true);
    assert.strictEqual(entry.valor, 0);
});

run('monthsWindow: 12 meses terminando em 2026-06 -> de 2025-07 a 2026-06', () => {
    const w = TSPFinancial.monthsWindow(12, 2026, 6);
    assert.strictEqual(w.length, 12);
    assert.deepStrictEqual(w[0], { year: 2025, month: 7 });
    assert.deepStrictEqual(w[11], { year: 2026, month: 6 });
});

run('monthsWindow: janela cruzando virada de ano', () => {
    const w = TSPFinancial.monthsWindow(3, 2026, 1);
    assert.deepStrictEqual(w, [
        { year: 2025, month: 11 },
        { year: 2025, month: 12 },
        { year: 2026, month: 1 }
    ]);
});

if (process.exitCode) {
    console.error('\nALGUM TESTE FALHOU');
} else {
    console.log('\nTODOS OS TESTES PASSARAM');
}
