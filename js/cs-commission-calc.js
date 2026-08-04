(function (global) {
    function computePercentual(hours) {
        const h = parseFloat(hours) || 0;
        return Math.min(h, 15) / 15;
    }

    function computeConsultantResult(hours, sumPercentuals, cancellationsCount, salesTotal, monthlyIncreaseTotal) {
        const percentual = computePercentual(hours);
        const bonus = (parseInt(cancellationsCount) || 0) === 0 ? 400 : 0;
        const poolVendas = (parseFloat(salesTotal) || 0) * 0.10;
        const poolMensalidade = (parseFloat(monthlyIncreaseTotal) || 0) * 0.50;
        // share = fatia do consultor sobre a soma dos percentuais de TODOS os
        // participantes do período — o pool inteiro é sempre distribuído
        // (soma das comissões de todos = pool), proporcional ao peso de horas
        // de cada um, sem sobra retida de quem não bateu 15h.
        const denom = parseFloat(sumPercentuals) || 0;
        const share = denom > 0 ? percentual / denom : 0;
        const comissaoVendas = poolVendas * share;
        const comissaoMensalidade = poolMensalidade * share;
        const total = bonus + comissaoVendas + comissaoMensalidade;
        return { percentual, bonus, comissaoVendas, comissaoMensalidade, total };
    }

    global.TSPCsCommission = { computePercentual, computeConsultantResult };
})(typeof window !== 'undefined' ? window : globalThis);
