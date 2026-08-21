// js/process-timeline.js
(function (global) {
    const COMMENT_KIND_LABELS = {
        comment: 'Comentário',
        status_change: 'Mudança de status',
        completed: 'Concluída',
        uncompleted: 'Reaberta',
        time_added: 'Tempo registrado',
    };

    function buildTimeline({ tasks = [], events = [], records = [], tickets = [] } = {}) {
        const items = [];

        (tasks || []).forEach(t => {
            if (t.createdAt) {
                items.push({ kind: 'task', at: t.createdAt, title: t.title, subtitle: 'Tarefa criada', sourceId: t.id });
            }
            (t.comments || []).forEach(c => {
                if (!c.createdAt || !COMMENT_KIND_LABELS[c.type]) return;
                items.push({
                    kind: 'task_comment', at: c.createdAt, title: t.title,
                    subtitle: c.type === 'comment' ? (c.text || '') : COMMENT_KIND_LABELS[c.type],
                    sourceId: t.id,
                });
            });
        });

        (events || []).forEach(e => {
            const at = e.startTime ? `${e.date}T${e.startTime}:00` : `${e.date}T00:00:00`;
            items.push({ kind: 'agenda', at, title: e.title || '(sem título)', subtitle: 'Compromisso', sourceId: e.id });
        });

        (records || []).forEach(r => {
            items.push({
                kind: 'record', at: `${r.date}T00:00:00`, title: r.description || '(sem descrição)',
                subtitle: `Atendimento — ${r.minutes || 0} min`, sourceId: r.id,
            });
        });

        (tickets || []).forEach(k => {
            if (!k.updatedAtOtobo) return;
            items.push({
                kind: 'ticket', at: k.updatedAtOtobo, title: k.title || '(sem título)',
                subtitle: `Chamado #${k.ticketNumber || k.ticketId || ''}`, sourceId: k.id,
            });
        });

        return items.sort((a, b) => new Date(b.at) - new Date(a.at));
    }

    function computePendencies(tasks, columnsById) {
        return (tasks || []).filter(t => {
            const col = columnsById ? columnsById[t.status] : null;
            return !col || !col.isDone;
        });
    }

    global.TSPProcessTimeline = { buildTimeline, computePendencies };
})(typeof window !== 'undefined' ? window : global);
