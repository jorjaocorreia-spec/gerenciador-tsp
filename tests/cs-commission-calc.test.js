const assert = require('assert');
require('../js/cs-commission-calc.js');
const TSPCsCommission = global.TSPCsCommission;

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

run('computePercentual: 0h -> 0%', () => {
    assert.strictEqual(TSPCsCommission.computePercentual(0), 0);
});

run('computePercentual: 3h -> 20%', () => {
    assert.strictEqual(TSPCsCommission.computePercentual(3), 0.2);
});

run('computePercentual: 5h -> 33,33%', () => {
    assert.ok(Math.abs(TSPCsCommission.computePercentual(5) - (5 / 15)) < 1e-9);
});

run('computePercentual: 15h -> 100%', () => {
    assert.strictEqual(TSPCsCommission.computePercentual(15), 1);
});

run('computePercentual: 18h -> 100% (capado em 15)', () => {
    assert.strictEqual(TSPCsCommission.computePercentual(18), 1);
});

run('computeConsultantResult: exemplo da spec — Gabriel (15h, sem cancelamento)', () => {
    const r = TSPCsCommission.computeConsultantResult(15, 3, 0, 24444, 2362);
    assert.ok(Math.abs(r.total - 1608.47) < 0.01, `total foi ${r.total}`);
    assert.strictEqual(r.bonus, 400);
});

run('computeConsultantResult: exemplo da spec — Gabriel (15h, com cancelamento)', () => {
    const r = TSPCsCommission.computeConsultantResult(15, 3, 1, 24444, 2362);
    assert.ok(Math.abs(r.total - 1208.47) < 0.01, `total foi ${r.total}`);
    assert.strictEqual(r.bonus, 0);
});

run('computeConsultantResult: Lally (0h) -> só o bônus, sem comissão', () => {
    const r = TSPCsCommission.computeConsultantResult(0, 3, 0, 24444, 2362);
    assert.strictEqual(r.percentual, 0);
    assert.strictEqual(r.comissaoVendas, 0);
    assert.strictEqual(r.comissaoMensalidade, 0);
    assert.strictEqual(r.total, 400);
});

run('computeConsultantResult: participantCount 0 não gera divisão por zero', () => {
    const r = TSPCsCommission.computeConsultantResult(10, 0, 0, 1000, 500);
    assert.ok(Number.isFinite(r.total));
});

if (process.exitCode) {
    console.error('\nALGUM TESTE FALHOU');
} else {
    console.log('\nTODOS OS TESTES PASSARAM');
}
