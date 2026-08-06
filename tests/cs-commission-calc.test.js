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

// A partir de 2026-08-06 a distribuição dos pools (vendas/mensalidade) segue
// a planilha de referência do usuário: primeiro divide o pool igualmente
// entre os N participantes do período (pool/N), depois escala essa cota pelo
// percentual individual de horas (pool/N * percentual). A fatia que um
// participante abaixo de 15h deixa de receber NÃO é redistribuída aos
// demais — o pool pode ficar parcialmente não distribuído quando alguém não
// bate 15h. Isso substitui a versão anterior (2026-08-05), que ponderava
// pelo peso de horas sobre a soma dos percentuais de todos (share =
// percentual / sumPercentuals) e sempre fechava 100% do pool.

run('computeConsultantResult: cenário 0h/5h/15h com 3 participantes — pool não é totalmente distribuído quando alguém fica abaixo de 15h', () => {
    const n = 3;
    const r15 = TSPCsCommission.computeConsultantResult(15, n, 0, 24444, 2362);
    const r5 = TSPCsCommission.computeConsultantResult(5, n, 0, 24444, 2362);
    const r0 = TSPCsCommission.computeConsultantResult(0, n, 0, 24444, 2362);
    const poolVendas = 24444 * 0.10; // 2444.4
    const poolMensalidade = 2362 * 0.50; // 1181
    const quotaVendas = poolVendas / n; // 814.8
    const quotaMensalidade = poolMensalidade / n; // 393.6667
    assert.ok(Math.abs(r15.comissaoVendas - quotaVendas) < 0.01); // 15h = 100% -> cota cheia
    assert.ok(Math.abs(r5.comissaoVendas - quotaVendas * (5 / 15)) < 0.01);
    assert.strictEqual(r0.comissaoVendas, 0);
    assert.ok(Math.abs(r15.comissaoMensalidade - quotaMensalidade) < 0.01);
    assert.ok(Math.abs(r5.comissaoMensalidade - quotaMensalidade * (5 / 15)) < 0.01);
    // soma das 3 comissões de vendas fica ABAIXO do pool inteiro (sobra não redistribuída)
    const somaVendas = r15.comissaoVendas + r5.comissaoVendas + r0.comissaoVendas;
    assert.ok(somaVendas < poolVendas - 0.01, `soma foi ${somaVendas}, pool era ${poolVendas}`);
});

run('computeConsultantResult: com cancelamento -> sem bônus (mesmo em 15h), comissões e apontamento continuam proporcionais', () => {
    const r = TSPCsCommission.computeConsultantResult(15, 1, 1, 24444, 2362);
    assert.strictEqual(r.bonus, 0);
    assert.ok(Math.abs(r.apontamentoBonus - 450) < 0.01); // independe do cancelamento
    assert.ok(Math.abs(r.comissaoVendas - 2444.4) < 0.01); // único participante -> pool/1 * 100%
});

run('computeConsultantResult: único participante com 100% -> leva o pool inteiro + R$400 bônus + R$450 apontamento', () => {
    const r = TSPCsCommission.computeConsultantResult(15, 1, 0, 1000, 500);
    assert.ok(Math.abs(r.bonus - 400) < 0.01);
    assert.ok(Math.abs(r.apontamentoBonus - 450) < 0.01);
    assert.ok(Math.abs(r.comissaoVendas - 100) < 0.01);
    assert.ok(Math.abs(r.comissaoMensalidade - 250) < 0.01);
});

run('computeConsultantResult: bônus de cancelamento e de apontamento são proporcionais abaixo de 15h (50% das horas -> R$200 e R$225)', () => {
    const r = TSPCsCommission.computeConsultantResult(7.5, 1, 0, 0, 0);
    assert.ok(Math.abs(r.bonus - 200) < 0.01, `bonus foi ${r.bonus}`);
    assert.ok(Math.abs(r.apontamentoBonus - 225) < 0.01, `apontamentoBonus foi ${r.apontamentoBonus}`);
});

run('computeConsultantResult: participantCount 0 e 0h -> tudo zero (percentual 0), sem divisão por zero', () => {
    const r = TSPCsCommission.computeConsultantResult(0, 0, 0, 1000, 500);
    assert.ok(Number.isFinite(r.total));
    assert.strictEqual(r.bonus, 0);
    assert.strictEqual(r.apontamentoBonus, 0);
    assert.strictEqual(r.comissaoVendas, 0);
    assert.strictEqual(r.comissaoMensalidade, 0);
});

run('computeConsultantResult: cenário real jul/26 (Ially 13,5833h de 15h, 3 participantes) bate com a planilha do usuário', () => {
    const n = 3;
    const r = TSPCsCommission.computeConsultantResult(13.583333333333334, n, 0, 29724, 4715);
    // Total do setor (planilha): 400 + 450 + 2972.40/3 + 2357.50/3 = 2626.6333...
    // Total Ially = (13.5833/15) * 2626.6333 ~= 2378.51
    assert.ok(Math.abs(r.total - 2378.51) < 0.5, `total foi ${r.total}`);
});

if (process.exitCode) {
    console.error('\nALGUM TESTE FALHOU');
} else {
    console.log('\nTODOS OS TESTES PASSARAM');
}
