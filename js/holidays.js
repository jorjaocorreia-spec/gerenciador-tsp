(function (global) {
    function pad2(n) { return String(n).padStart(2, '0'); }

    // Algoritmo de Meeus/Jones/Butcher — calcula a data da Páscoa (calendário gregoriano)
    function calculateEasterDate(year) {
        const a = year % 19;
        const b = Math.floor(year / 100);
        const c = year % 100;
        const d = Math.floor(b / 4);
        const e = b % 4;
        const f = Math.floor((b + 8) / 25);
        const g = Math.floor((b - f + 1) / 3);
        const h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4);
        const k = c % 4;
        const l = (32 + 2 * e + 2 * i - h - k) % 7;
        const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const month = Math.floor((h + l - 7 * m + 114) / 31);
        const day = ((h + l - 7 * m + 114) % 31) + 1;
        return new Date(Date.UTC(year, month - 1, day));
    }

    function addDaysUTC(date, days) {
        return new Date(date.getTime() + days * 86400000);
    }

    function toIsoUTC(date) {
        return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
    }

    const _cache = {};

    function getNationalHolidays(year) {
        if (_cache[year]) return _cache[year];
        const easter = calculateEasterDate(year);
        const fixed = [
            [`${year}-01-01`, 'Confraternização Universal'],
            [`${year}-04-21`, 'Tiradentes'],
            [`${year}-05-01`, 'Dia do Trabalho'],
            [`${year}-09-07`, 'Independência do Brasil'],
            [`${year}-10-12`, 'Nossa Senhora Aparecida'],
            [`${year}-11-02`, 'Finados'],
            [`${year}-11-15`, 'Proclamação da República'],
            [`${year}-12-25`, 'Natal']
        ];
        const moveable = [
            [toIsoUTC(addDaysUTC(easter, -48)), 'Carnaval (segunda)'],
            [toIsoUTC(addDaysUTC(easter, -47)), 'Carnaval (terça)'],
            [toIsoUTC(addDaysUTC(easter, -2)), 'Sexta-feira Santa'],
            [toIsoUTC(addDaysUTC(easter, 60)), 'Corpus Christi']
        ];
        const map = {};
        [...fixed, ...moveable].forEach(([date, name]) => { map[date] = name; });
        _cache[year] = map;
        return map;
    }

    function isNationalHoliday(dateStr, year) {
        const y = year || parseInt(dateStr.slice(0, 4), 10);
        return Object.prototype.hasOwnProperty.call(getNationalHolidays(y), dateStr);
    }

    global.TSPHolidays = { calculateEasterDate, toIsoUTC, getNationalHolidays, isNationalHoliday };
})(typeof window !== 'undefined' ? window : globalThis);
