(function (global) {
    function computePercentual(hours) {
        const h = parseFloat(hours) || 0;
        return Math.min(h, 15) / 15;
    }

    function computeConsultantResult(hours, participantCount, cancellationsCount, salesTotal, monthlyIncreaseTotal) {
        const percentual = computePercentual(hours);
        // Bônus de cancelamento: R$400 em 15h+ se cancellations_count===0 no
        // mês, senão R$0 — proporcional às horas abaixo de 15h (ex: 50% das
        // horas = R$200), igual ao bônus de apontamento.
        const bonus = ((parseInt(cancellationsCount) || 0) === 0 ? 400 : 0) * percentual;
        // Bônus de apontamento: R$450 em 15h+ (percentual=100%), proporcional
        // abaixo disso (ex: 50% das horas = R$225). Independe do bônus de
        // cancelamento — os dois são condições separadas.
        const apontamentoBonus = 450 * percentual;
        // Cota de cada consultor no pool: primeiro divide igualmente entre os
        // N participantes do período, depois escala pelo percentual individual
        // de horas — igual à planilha de referência do usuário. Diferente de
        // um "share" ponderado pela soma dos percentuais: aqui a fatia que um
        // consultor abaixo de 15h deixa de receber NÃO é redistribuída aos
        // demais, ela simplesmente não é paga a ninguém.
        const n = parseInt(participantCount) || 0;
        const poolVendas = (parseFloat(salesTotal) || 0) * 0.10;
        const poolMensalidade = (parseFloat(monthlyIncreaseTotal) || 0) * 0.50;
        const comissaoVendas = n > 0 ? (poolVendas / n) * percentual : 0;
        const comissaoMensalidade = n > 0 ? (poolMensalidade / n) * percentual : 0;
        const total = bonus + apontamentoBonus + comissaoVendas + comissaoMensalidade;
        return { percentual, bonus, apontamentoBonus, comissaoVendas, comissaoMensalidade, total };
    }

    global.TSPCsCommission = { computePercentual, computeConsultantResult };
})(typeof window !== 'undefined' ? window : globalThis);
