(function (global) {
    const pad2 = (n) => String(n).padStart(2, '0');

    function toIsoLocal(d) {
        return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    }

    function currentMonthLocal(now) {
        now = now || new Date();
        return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
    }

    function addMonths(ym, n) {
        const [y, m] = ym.split('-').map(Number);
        const t = y * 12 + (m - 1) + n;
        return `${Math.floor(t / 12)}-${pad2((t % 12) + 1)}`;
    }

    function daysInMonth(ym) {
        const [y, m] = ym.split('-').map(Number);
        return new Date(y, m, 0).getDate();
    }

    function dueDateFor(ym, day) {
        return `${ym}-${pad2(Math.min(day, daysInMonth(ym)))}`;
    }

    // Sempre parte do dia ORIGINAL (31 -> 28 -> 31), nunca encadeia o clamp.
    function addMonthsKeepingDay(iso, k) {
        const day = parseInt(iso.slice(8, 10), 10);
        return dueDateFor(addMonths(iso.slice(0, 7), k), day);
    }

    function splitInstallments(totalCents, n) {
        if (!Number.isInteger(totalCents) || totalCents <= 0) throw new Error('Valor total inválido');
        if (!Number.isInteger(n) || n < 1) throw new Error('Número de parcelas inválido');
        if (totalCents < n) throw new Error('Valor total menor que o número de parcelas');
        const base = Math.floor(totalCents / n);
        const parts = new Array(n).fill(base);
        parts[n - 1] = totalCents - base * (n - 1);
        return parts;
    }

    function serviceCharges(totalCents, n, firstDueIso) {
        const amounts = splitInstallments(totalCents, n);
        return amounts.map((amountCents, i) => {
            const dueDate = addMonthsKeepingDay(firstDueIso, i);
            return { chargeKey: `i:${i + 1}`, competence: dueDate.slice(0, 7), dueDate, amountCents };
        });
    }

    function amountFor(contract, adjustments, competence) {
        let best = null;
        (adjustments || []).forEach(a => {
            if (a.fromMonth <= competence && (best === null || a.fromMonth > best.fromMonth)) best = a;
        });
        return best ? best.newAmountCents : contract.monthlyAmountCents;
    }

    function subscriptionCompetences(startMonth, cancelledFrom, untilMonth) {
        let last = untilMonth;
        if (cancelledFrom) {
            const limit = addMonths(cancelledFrom, -1);
            if (limit < last) last = limit;
        }
        const out = [];
        let cur = startMonth;
        while (cur <= last) { out.push(cur); cur = addMonths(cur, 1); }
        return out;
    }

    function ensureUntil(viewMonth, currentMonth) {
        const base = viewMonth > currentMonth ? viewMonth : currentMonth;
        return addMonths(base, 3);
    }

    function isOverdue(charge, todayIso) {
        return charge.status === 'pending' && charge.dueDate < todayIso;
    }

    const sum = (arr) => arr.reduce((acc, c) => acc + (c.amountCents || 0), 0);

    function computeMonthTotals({ charges, paidInMonth, overdue }) {
        return {
            faturado: sum(charges),
            recebido: sum(paidInMonth),
            aReceber: sum(charges.filter(c => c.status === 'pending')),
            atrasado: sum(overdue)
        };
    }

    function computeHistory(window, charges) {
        const seen = new Map();
        charges.forEach(c => { if (!seen.has(c.id)) seen.set(c.id, c); });
        const unique = Array.from(seen.values());
        return window.map(({ year, month }) => {
            const ym = `${year}-${pad2(month)}`;
            const faturado = sum(unique.filter(c => c.competence === ym));
            const recebido = sum(unique.filter(c => c.status === 'paid' && c.paidAt && c.paidAt.slice(0, 7) === ym));
            return { year, month, faturado, recebido };
        });
    }

    function parseMoneyToCents(str) {
        if (str === null || str === undefined) return null;
        const clean = String(str).replace(/R\$/gi, '').replace(/\s/g, '');
        if (!/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(clean) && !/^\d+(,\d{1,2})?$/.test(clean)) return null;
        const [rawInt, decPart = ''] = clean.split(',');
        const intPart = rawInt.replace(/\./g, '');
        return parseInt(intPart, 10) * 100 + parseInt((decPart + '0').slice(0, 2), 10);
    }

    function formatCents(cents) {
        const neg = cents < 0;
        const abs = Math.abs(Math.round(cents || 0));
        const intPart = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return `${neg ? '-' : ''}R$ ${intPart},${pad2(abs % 100)}`;
    }

    global.TSPDirectSales = {
        toIsoLocal, currentMonthLocal, addMonths, daysInMonth, dueDateFor, addMonthsKeepingDay,
        splitInstallments, serviceCharges, amountFor, subscriptionCompetences, ensureUntil,
        isOverdue, computeMonthTotals, computeHistory, parseMoneyToCents, formatCents
    };
})(typeof window !== 'undefined' ? window : globalThis);
