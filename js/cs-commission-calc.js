(function (global) {
    function computePercentual(hours) {
        const h = parseFloat(hours) || 0;
        return Math.min(h, 15) / 15;
    }

    function computeConsultantResult(hours, participantCount, cancellationsCount, salesTotal, monthlyIncreaseTotal) {
        const percentual = computePercentual(hours);
        const bonus = (parseInt(cancellationsCount) || 0) === 0 ? 400 : 0;
        const poolVendas = (parseFloat(salesTotal) || 0) * 0.10;
        const poolMensalidade = (parseFloat(monthlyIncreaseTotal) || 0) * 0.50;
        const n = Math.max(1, parseInt(participantCount) || 0);
        const comissaoVendas = (poolVendas / n) * percentual;
        const comissaoMensalidade = (poolMensalidade / n) * percentual;
        const total = bonus + comissaoVendas + comissaoMensalidade;
        return { percentual, bonus, comissaoVendas, comissaoMensalidade, total };
    }

    global.TSPCsCommission = { computePercentual, computeConsultantResult };
})(typeof window !== 'undefined' ? window : globalThis);
