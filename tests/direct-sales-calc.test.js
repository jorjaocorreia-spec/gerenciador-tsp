const assert = require('assert');
require('../js/direct-sales-calc.js');
const D = global.TSPDirectSales;

function run(name, fn) {
    try { fn(); console.log(`OK   ${name}`); }
    catch (err) { console.error(`FAIL ${name}`); console.error(err); process.exitCode = 1; }
}

run('addMonths: vira o ano para frente e para trás', () => {
    assert.strictEqual(D.addMonths('2026-11', 3), '2027-02');
    assert.strictEqual(D.addMonths('2026-01', -1), '2025-12');
    assert.strictEqual(D.addMonths('2026-10', 0), '2026-10');
});

run('dueDateFor: dia 31 em fevereiro vira último dia (ano comum e bissexto)', () => {
    assert.strictEqual(D.dueDateFor('2026-02', 31), '2026-02-28');
    assert.strictEqual(D.dueDateFor('2028-02', 31), '2028-02-29');
    assert.strictEqual(D.dueDateFor('2026-04', 31), '2026-04-30');
    assert.strictEqual(D.dueDateFor('2026-10', 5), '2026-10-05');
});

run('addMonthsKeepingDay: 31/01 -> 28/02 -> 31/03 (não encadeia o clamp)', () => {
    assert.strictEqual(D.addMonthsKeepingDay('2026-01-31', 1), '2026-02-28');
    assert.strictEqual(D.addMonthsKeepingDay('2026-01-31', 2), '2026-03-31');
});

run('splitInstallments: resto de centavos vai para a última parcela', () => {
    assert.deepStrictEqual(D.splitInstallments(10000, 3), [3333, 3333, 3334]);
    assert.deepStrictEqual(D.splitInstallments(10000, 1), [10000]);
    assert.strictEqual(D.splitInstallments(12345, 4).reduce((a, b) => a + b, 0), 12345);
});

run('splitInstallments: entradas inválidas lançam erro', () => {
    assert.throws(() => D.splitInstallments(10000, 0));
    assert.throws(() => D.splitInstallments(0, 2));
    assert.throws(() => D.splitInstallments(1, 2)); // total < n
    assert.throws(() => D.splitInstallments(100.5, 2));
});

run('serviceCharges: competence acompanha o mês do vencimento e chaves i:N', () => {
    const rows = D.serviceCharges(30000, 3, '2026-11-30');
    assert.deepStrictEqual(rows.map(r => r.chargeKey), ['i:1', 'i:2', 'i:3']);
    assert.deepStrictEqual(rows.map(r => r.dueDate), ['2026-11-30', '2026-12-30', '2027-01-30']);
    assert.deepStrictEqual(rows.map(r => r.competence), ['2026-11', '2026-12', '2027-01']);
    assert.deepStrictEqual(rows.map(r => r.amountCents), [10000, 10000, 10000]);
});

run('amountFor: sem ajustes usa o valor mensal', () => {
    assert.strictEqual(D.amountFor({ monthlyAmountCents: 50000 }, [], '2026-10'), 50000);
});

run('amountFor: ajustes fora de ordem seguem o de maior fromMonth <= competência', () => {
    const c = { monthlyAmountCents: 10000 };
    const adj = [
        { fromMonth: '2026-11', newAmountCents: 15000 },
        { fromMonth: '2026-12', newAmountCents: 20000 }
    ];
    assert.strictEqual(D.amountFor(c, adj, '2026-10'), 10000);
    assert.strictEqual(D.amountFor(c, adj, '2026-11'), 15000);
    assert.strictEqual(D.amountFor(c, adj, '2027-03'), 20000);
    // ajuste "tardio" cadastrado depois com from_month anterior não vence o de dezembro
    adj.push({ fromMonth: '2026-11', newAmountCents: 15000 });
    assert.strictEqual(D.amountFor(c, adj, '2026-12'), 20000);
});

run('subscriptionCompetences: respeita cancelamento e limite', () => {
    assert.deepStrictEqual(D.subscriptionCompetences('2026-10', null, '2027-01'),
        ['2026-10', '2026-11', '2026-12', '2027-01']);
    assert.deepStrictEqual(D.subscriptionCompetences('2026-10', '2026-12', '2027-03'),
        ['2026-10', '2026-11']);
    assert.deepStrictEqual(D.subscriptionCompetences('2026-10', '2026-10', '2027-03'), []);
    assert.deepStrictEqual(D.subscriptionCompetences('2026-12', null, '2026-10'), []);
});

run('ensureUntil: usa o maior entre mês visto e mês corrente, +3', () => {
    assert.strictEqual(D.ensureUntil('2026-10', '2026-10'), '2027-01');
    assert.strictEqual(D.ensureUntil('2026-05', '2026-10'), '2027-01'); // olhando o passado
    assert.strictEqual(D.ensureUntil('2027-02', '2026-10'), '2027-05');
});

run('isOverdue: só pendente com vencimento anterior a hoje', () => {
    assert.strictEqual(D.isOverdue({ status: 'pending', dueDate: '2026-10-08' }, '2026-10-09'), true);
    assert.strictEqual(D.isOverdue({ status: 'pending', dueDate: '2026-10-09' }, '2026-10-09'), false);
    assert.strictEqual(D.isOverdue({ status: 'paid', dueDate: '2026-01-01' }, '2026-10-09'), false);
});

run('computeMonthTotals: Faturado/A receber por competência, Recebido por paid_at, Atrasado global', () => {
    const charges = [
        { status: 'paid', amountCents: 10000 },
        { status: 'pending', amountCents: 5000 }
    ];
    const paidInMonth = [{ amountCents: 10000 }, { amountCents: 7000 }]; // 7000 = de outra competência
    const overdue = [{ amountCents: 5000 }, { amountCents: 3000 }];      // 3000 = de mês anterior
    assert.deepStrictEqual(D.computeMonthTotals({ charges, paidInMonth, overdue }),
        { faturado: 15000, recebido: 17000, aReceber: 5000, atrasado: 8000 });
});

run('computeHistory: Faturado por competência, Recebido por paid_at, deduplica por id', () => {
    const window = [{ year: 2026, month: 9 }, { year: 2026, month: 10 }];
    const charges = [
        { id: 'a', competence: '2026-09', amountCents: 10000, status: 'paid', paidAt: '2026-10-03' },
        { id: 'a', competence: '2026-09', amountCents: 10000, status: 'paid', paidAt: '2026-10-03' },
        { id: 'b', competence: '2026-10', amountCents: 5000, status: 'pending', paidAt: null }
    ];
    assert.deepStrictEqual(D.computeHistory(window, charges), [
        { year: 2026, month: 9, faturado: 10000, recebido: 0 },
        { year: 2026, month: 10, faturado: 5000, recebido: 10000 }
    ]);
});

run('parseMoneyToCents: formatos BR e inválidos', () => {
    assert.strictEqual(D.parseMoneyToCents('1.234,56'), 123456);
    assert.strictEqual(D.parseMoneyToCents('R$ 500'), 50000);
    assert.strictEqual(D.parseMoneyToCents('500,5'), 50050);
    assert.strictEqual(D.parseMoneyToCents('0,01'), 1);
    assert.strictEqual(D.parseMoneyToCents('abc'), null);
    assert.strictEqual(D.parseMoneyToCents(''), null);
    assert.strictEqual(D.parseMoneyToCents('10,999'), null);
});

run('formatCents: milhar e centavos', () => {
    assert.strictEqual(D.formatCents(123456), 'R$ 1.234,56');
    assert.strictEqual(D.formatCents(5), 'R$ 0,05');
    assert.strictEqual(D.formatCents(0), 'R$ 0,00');
    assert.strictEqual(D.formatCents(100000000), 'R$ 1.000.000,00');
});

run('toIsoLocal/currentMonthLocal: usam data local', () => {
    const d = new Date(2026, 9, 9, 23, 30); // 09/10/2026 23:30 local
    assert.strictEqual(D.toIsoLocal(d), '2026-10-09');
    assert.strictEqual(D.currentMonthLocal(d), '2026-10');
});
