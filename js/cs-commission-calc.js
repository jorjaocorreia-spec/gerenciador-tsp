(function (global) {
    function computePercentual(hours) {
        const h = parseFloat(hours) || 0;
        return Math.min(h, 15) / 15;
    }

    function computeConsultantResult(hours, sumPercentuals, cancellationsCount, salesTotal, monthlyIncreaseTotal) {
        const percentual = computePercentual(hours);
        // Bônus de cancelamento: R$400 em 15h+ se cancellations_count===0 no
        // mês, senão R$0 — proporcional às horas abaixo de 15h (ex: 50% das
        // horas = R$200), igual ao bônus de apontamento.
        const bonus = ((parseInt(cancellationsCount) || 0) === 0 ? 400 : 0) * percentual;
        // Bônus de apontamento: R$450 em 15h+ (percentual=100%), proporcional
        // abaixo disso (ex: 50% das horas = R$225). Independe do bônus de
        // cancelamento — os dois são condições separadas.
        const apontamentoBonus = 450 * percentual;
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
        const total = bonus + apontamentoBonus + comissaoVendas + comissaoMensalidade;
        return { percentual, bonus, apontamentoBonus, comissaoVendas, comissaoMensalidade, total };
    }

    global.TSPCsCommission = { computePercentual, computeConsultantResult };
})(typeof window !== 'undefined' ? window : globalThis);
