(function (global) {
    function isEligible(client, year, month, now) {
        now = now || new Date();
        const selectedYM = year * 12 + (month - 1);
        const currentYM = now.getFullYear() * 12 + now.getMonth();
        let createdYM = -Infinity;
        if (client.createdAt) {
            const isoStr = String(client.createdAt);
            const createdYear = parseInt(isoStr.slice(0, 4), 10);
            const createdMonth = parseInt(isoStr.slice(5, 7), 10); // 1-12
            if (!isNaN(createdYear) && !isNaN(createdMonth)) {
                createdYM = createdYear * 12 + (createdMonth - 1);
            }
        }
        if (selectedYM < createdYM) return false;
        if (selectedYM >= currentYM) {
            return client.status === 'active';
        }
        return true;
    }

    function computeEntry(client, year, month, minutesInMonth, eligible) {
        if (!eligible) return null;
        if (client.billingModel === 'hourly') {
            const horas = (minutesInMonth || 0) / 60;
            const valor = horas * (client.hourlyRate || 0);
            return { client, valor, comissao: valor, detalhe: { horas, rate: client.hourlyRate || 0 } };
        }
        const valor = client.clientPays || 0;
        const comissao = (client.clientPays || 0) * 0.43 + (client.consultantBonus || 0);
        return { client, valor, comissao, detalhe: null };
    }

    function monthsWindow(monthsBack, endYear, endMonth) {
        const result = [];
        let y = endYear, m = endMonth;
        for (let i = 0; i < monthsBack; i++) {
            result.unshift({ year: y, month: m });
            m -= 1;
            if (m < 1) { m = 12; y -= 1; }
        }
        return result;
    }

    global.TSPFinancial = { isEligible, computeEntry, monthsWindow };
})(typeof window !== 'undefined' ? window : globalThis);
