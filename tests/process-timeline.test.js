// tests/process-timeline.test.js
const assert = require('assert');
require('../js/process-timeline.js');
const T = global.TSPProcessTimeline;

function run(name, fn) {
    try { fn(); console.log(`OK   ${name}`); }
    catch (err) { console.error(`FAIL ${name}`); console.error(err); process.exitCode = 1; }
}

run('buildTimeline: mescla tarefa, comentário, evento, atendimento e chamado ordenados por data desc', () => {
    const tasks = [{
        id: 't1', title: 'Levantamento de regras', createdAt: '2026-08-01T10:00:00.000Z',
        comments: [{ id: 'c1', type: 'comment', text: 'Cliente confirmou regras', createdAt: '2026-08-03T12:00:00.000Z' }]
    }];
    const events = [{ id: 'e1', title: 'Kickoff', date: '2026-08-02', startTime: '09:00' }];
    const records = [{ id: 'r1', date: '2026-08-04', minutes: 90, description: 'Configuração inicial' }];
    const tickets = [{ id: 'k1', ticketNumber: '1001', title: 'Erro na tabela', updatedAtOtobo: '2026-08-05T08:00:00.000Z' }];

    const timeline = T.buildTimeline({ tasks, events, records, tickets });

    assert.strictEqual(timeline.length, 5); // criação da tarefa + comentário + evento + atendimento + chamado
    assert.strictEqual(timeline[0].kind, 'ticket');
    assert.strictEqual(timeline[1].kind, 'record');
    assert.strictEqual(timeline[2].kind, 'task_comment');
    assert.strictEqual(timeline[3].kind, 'agenda');
    assert.strictEqual(timeline[4].kind, 'task');
});

run('buildTimeline: ignora comments que não são type=comment/status_change/completed/time_added', () => {
    const tasks = [{
        id: 't1', title: 'X', createdAt: '2026-08-01T10:00:00.000Z',
        comments: [{ id: 'c1', type: 'unknown_type', text: 'y', createdAt: '2026-08-02T10:00:00.000Z' }]
    }];
    const timeline = T.buildTimeline({ tasks, events: [], records: [], tickets: [] });
    assert.strictEqual(timeline.length, 1); // só a criação da tarefa
});

run('buildTimeline: lida com listas vazias/ausentes', () => {
    const timeline = T.buildTimeline({});
    assert.deepStrictEqual(timeline, []);
});

run('computePendencies: retorna só tarefas cuja coluna não é isDone', () => {
    const columnsById = {
        'col-todo': { id: 'col-todo', isDone: false },
        'col-done': { id: 'col-done', isDone: true },
    };
    const tasks = [
        { id: 't1', status: 'col-todo' },
        { id: 't2', status: 'col-done' },
        { id: 't3', status: 'col-inexistente' }, // coluna deletada: trata como pendente
    ];
    const pend = T.computePendencies(tasks, columnsById);
    assert.deepStrictEqual(pend.map(t => t.id), ['t1', 't3']);
});
