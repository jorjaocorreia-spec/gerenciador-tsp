(function (global) {
    const Holidays = global.TSPHolidays;

    function pad2(n) { return String(n).padStart(2, '0'); }

    function toIsoLocal(date) {
        return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    }

    function addDaysLocal(date, days) {
        const d = new Date(date);
        d.setDate(d.getDate() + days);
        return d;
    }

    function minutesBetween(startTime, endTime) {
        if (!startTime || !endTime) return 0;
        const [sh, sm] = startTime.split(':').map(Number);
        const [eh, em] = endTime.split(':').map(Number);
        if ([sh, sm, eh, em].some(n => Number.isNaN(n))) return 0;
        const mins = (eh * 60 + em) - (sh * 60 + sm);
        return mins > 0 ? mins : 0;
    }

    function isWorkday(dateStr) {
        const d = new Date(dateStr + 'T12:00:00');
        const wd = d.getDay();
        return wd >= 1 && wd <= 5;
    }

    function dailyTargetMinutes(dateStr, weeklyHours, manualHolidayDates) {
        if (!isWorkday(dateStr)) return 0;
        if (Holidays.isNationalHoliday(dateStr)) return 0;
        if (manualHolidayDates && manualHolidayDates.has(dateStr)) return 0;
        return Math.round((weeklyHours / 5) * 60);
    }

    function computeDay(dateStr, apontamentosForDay, weeklyHours, manualHolidayDates) {
        const targetMinutes = dailyTargetMinutes(dateStr, weeklyHours, manualHolidayDates);
        const actualMinutes = (apontamentosForDay || []).reduce((s, a) => s + minutesBetween(a.startTime, a.endTime), 0);
        return { date: dateStr, targetMinutes, actualMinutes, deltaMinutes: actualMinutes - targetMinutes };
    }

    function computeRange(startDate, endDate, apontamentosByDate, weeklyHours, manualHolidayDates) {
        const days = [];
        let cur = new Date(startDate + 'T12:00:00');
        const end = new Date(endDate + 'T12:00:00');
        while (cur <= end) {
            const iso = toIsoLocal(cur);
            days.push(computeDay(iso, apontamentosByDate[iso], weeklyHours, manualHolidayDates));
            cur = addDaysLocal(cur, 1);
        }
        const targetMinutes = days.reduce((s, d) => s + d.targetMinutes, 0);
        const actualMinutes = days.reduce((s, d) => s + d.actualMinutes, 0);
        return { startDate, endDate, days, targetMinutes, actualMinutes, deltaMinutes: actualMinutes - targetMinutes };
    }

    function computeAccumulatedBalance(startDate, todayStr, apontamentosByDate, weeklyHours, manualHolidayDates) {
        const yesterday = addDaysLocal(new Date(todayStr + 'T12:00:00'), -1);
        const yesterdayIso = toIsoLocal(yesterday);
        if (yesterdayIso < startDate) return { balanceMinutes: 0, lastDate: null };
        const range = computeRange(startDate, yesterdayIso, apontamentosByDate, weeklyHours, manualHolidayDates);
        return { balanceMinutes: range.deltaMinutes, lastDate: yesterdayIso };
    }

    function getPeriodRange(period, refDateStr) {
        const ref = new Date(refDateStr + 'T12:00:00');
        if (period === 'day') {
            return { startDate: refDateStr, endDate: refDateStr };
        }
        if (period === 'week') {
            const dow = ref.getDay();
            const diffToMonday = dow === 0 ? -6 : 1 - dow;
            const monday = addDaysLocal(ref, diffToMonday);
            const sunday = addDaysLocal(monday, 6);
            return { startDate: toIsoLocal(monday), endDate: toIsoLocal(sunday) };
        }
        if (period === 'month') {
            const y = ref.getFullYear(), m = ref.getMonth();
            const first = new Date(y, m, 1);
            const last = new Date(y, m + 1, 0);
            return { startDate: toIsoLocal(first), endDate: toIsoLocal(last) };
        }
        throw new Error('Período inválido: ' + period);
    }

    function fmtMinutes(totalMin) {
        const sign = totalMin < 0 ? '-' : '+';
        const abs = Math.abs(Math.round(totalMin));
        const h = Math.floor(abs / 60);
        const m = abs % 60;
        return `${sign}${h}h ${String(m).padStart(2, '0')}min`;
    }

    global.TSPProductivity = {
        minutesBetween, isWorkday, dailyTargetMinutes, computeDay, computeRange,
        computeAccumulatedBalance, getPeriodRange, fmtMinutes, toIsoLocal, addDaysLocal
    };
})(typeof window !== 'undefined' ? window : globalThis);
