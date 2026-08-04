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

// A partir de 2026-08-05 a distribuição dos pools (vendas/mensalidade) passa
// a ser proporcional ao peso de horas de cada participante sobre a SOMA dos
// percentuais de todos (share = percentual / sumPercentuals) — o pool inteiro
// é sempre 100% distribuído, sem sobra retida de quem não bateu 15h (a versão
// anterior usava pool/participantCount por pessoa, deixando sobra não
// redistribuída quando alguém tinha menos de 15h).

run('computeConsultantResult: cenário 0h/5h/15h — soma das comissões de todos fecha exatamente o pool', () => {
    const sumPercentuals = 0 / 15 + 5 / 15 + 15 / 15; // 1.3333...
    const r15 = TSPCsCommission.computeConsultantResult(15, sumPercentuals, 0, 24444, 2362);
    const r5 = TSPCsCommission.computeConsultantResult(5, sumPercentuals, 0, 24444, 2362);
    const r0 = TSPCsCommission.computeConsultantResult(0, sumPercentuals, 0, 24444, 2362);
    assert.ok(Math.abs(r15.total - 3119.05) < 0.01, `15h total foi ${r15.total}`);
    assert.ok(Math.abs(r5.total - 1306.35) < 0.01, `5h total foi ${r5.total}`);
    assert.strictEqual(r0.total, 400); // share 0 -> só o bônus
    const poolVendas = 24444 * 0.10;
    const poolMensalidade = 2362 * 0.50;
    assert.ok(Math.abs((r15.comissaoVendas + r5.comissaoVendas + r0.comissaoVendas) - poolVendas) < 0.01);
    assert.ok(Math.abs((r15.comissaoMensalidade + r5.comissaoMensalidade + r0.comissaoMensalidade) - poolMensalidade) < 0.01);
});

run('computeConsultantResult: com cancelamento -> sem bônus, comissões continuam proporcionais', () => {
    const r = TSPCsCommission.computeConsultantResult(15, 1, 1, 24444, 2362);
    assert.strictEqual(r.bonus, 0);
    assert.ok(Math.abs(r.comissaoVendas - 2444.4) < 0.01);
});

run('computeConsultantResult: único participante com 100% -> leva o pool inteiro', () => {
    const r = TSPCsCommission.computeConsultantResult(15, 1, 0, 1000, 500);
    assert.ok(Math.abs(r.comissaoVendas - 100) < 0.01);
    assert.ok(Math.abs(r.comissaoMensalidade - 250) < 0.01);
});

run('computeConsultantResult: sumPercentuals 0 (ninguém com horas) não gera divisão por zero', () => {
    const r = TSPCsCommission.computeConsultantResult(0, 0, 0, 1000, 500);
    assert.ok(Number.isFinite(r.total));
    assert.strictEqual(r.comissaoVendas, 0);
    assert.strictEqual(r.comissaoMensalidade, 0);
});

if (process.exitCode) {
    console.error('\nALGUM TESTE FALHOU');
} else {
    console.log('\nTODOS OS TESTES PASSARAM');
}
