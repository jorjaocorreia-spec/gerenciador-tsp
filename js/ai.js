/**
 * TSPAIClient — cliente de IA configurável por usuário (OpenAI ou Anthropic)
 * Todas as chamadas passam pela Edge Function ai-proxy para evitar CORS e proteger a API key.
 */
class TSPAIClient {
    constructor() {
        this._configured = false;
        this._provider = null;
        this._model = null;
    }

    get isConfigured() { return this._configured; }
    get provider() { return this._provider; }
    get model() { return this._model; }

    async loadConfig() {
        try {
            const config = await store.getAIConfig();
            if (config && config.apiKey) {
                this._provider = config.provider;
                this._model = config.model;
                this._configured = true;
                return true;
            }
        } catch {}
        this._configured = false;
        return false;
    }

    reset() {
        this._configured = false;
        this._provider = null;
        this._model = null;
    }

    // Chamada genérica — base de todas as features de IA
    async complete(systemPrompt, userPrompt) {
        if (!this._configured) throw new Error('IA não configurada.');

        const { data: { session } } = await window.supabaseClient.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error('Sessão expirada.');

        const res = await fetch(
            `${window.TSP_CONFIG.SUPABASE_URL}/functions/v1/ai-proxy`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'apikey': window.TSP_CONFIG.SUPABASE_ANON_KEY,
                },
                body: JSON.stringify({ action: 'complete', systemPrompt, userPrompt }),
            }
        );

        const json = await res.json();
        if (!res.ok || json.error) throw new Error(json.error || 'Erro na chamada de IA.');
        return json.content;
    }

    async testConnection() {
        return this.complete('Você é um assistente de testes. Responda apenas com a palavra "ok".', 'Conexão de teste.');
    }

    // ── Features específicas ─────────────────────────────────────────

    async improveAtendimentoDescription(rawDescription, clientName, projectNum, durationLabel) {
        const system = `Você é um assistente especializado em consultoria de TI.
Reescreva descrições de atendimento de forma profissional, clara e objetiva.
Mantenha as informações técnicas e operacionais do texto original.
Responda APENAS com a descrição melhorada, sem explicações adicionais, sem aspas, sem prefixos.`;

        const user = `Cliente: ${clientName}${projectNum ? ` (Projeto ${projectNum})` : ''}
Duração: ${durationLabel}
Descrição original: ${rawDescription}

Reescreva de forma profissional mantendo o conteúdo técnico.`;

        return this.complete(system, user);
    }

    async suggestTaskNextSteps(taskTitle, taskDescription, checklistItems, activityLog) {
        const system = `Você é um assistente especializado em gestão de projetos de TI e consultoria SAP.
Analise a tarefa fornecida e sugira de 3 a 6 próximos passos concretos e acionáveis.
Responda APENAS com uma lista JSON no formato: ["passo 1", "passo 2", "passo 3"]
Sem explicações, sem markdown, apenas o array JSON.`;

        const existingItems = checklistItems?.map(i => `- [${i.done ? 'x' : ' '}] ${i.text}`).join('\n') || '';
        const recentActivity = activityLog?.slice(0, 5).map(c => c.text).join('\n') || '';

        const user = `Tarefa: ${taskTitle}
${taskDescription ? `Descrição: ${taskDescription}` : ''}
${existingItems ? `Checklist atual:\n${existingItems}` : ''}
${recentActivity ? `Atividade recente:\n${recentActivity}` : ''}

Sugira os próximos passos.`;

        const raw = await this.complete(system, user);
        try {
            const arr = JSON.parse(raw.trim());
            if (Array.isArray(arr)) return arr;
        } catch {}
        // fallback: tentar extrair linhas
        return raw.split('\n').map(l => l.replace(/^[-*\d.)\s]+/, '').trim()).filter(Boolean).slice(0, 6);
    }

    async improveImplementationDescription(title, type, rawDescription, codeSnippet) {
        const system = `Você é um especialista técnico em SAP e sistemas de gestão.
Reescreva a descrição de uma implementação técnica de forma clara, estruturada e profissional.
Use linguagem técnica adequada. Responda APENAS com a descrição melhorada, sem explicações ou prefixos.`;

        const typeLabels = {
            trigger: 'Trigger de banco de dados', procedure: 'Procedure/Script',
            feature: 'Funcionalidade', customization: 'Customização',
            integration: 'Integração', report: 'Relatório Customizado'
        };

        const user = `Implementação: ${title}
Tipo: ${typeLabels[type] || type}
${rawDescription ? `Descrição original: ${rawDescription}` : ''}
${codeSnippet ? `Trecho do código/script:\n${codeSnippet.substring(0, 500)}` : ''}

Reescreva a descrição de forma técnica e profissional.`;

        return this.complete(system, user);
    }

    async generateDashboardInsights(clientStats, monthLabel) {
        const system = `Você é um consultor de TI analisando a carteira de clientes de um profissional de consultoria SAP.
Analise os dados de consumo de horas do mês e forneça uma análise inteligente e prática.
Seja direto, use linguagem profissional mas acessível.
Estruture a resposta em 3 seções curtas:
1. Visão Geral — saúde geral da carteira (2-3 frases)
2. Atenção Necessária — clientes que precisam de ação imediata (limite excedido, projeção crítica)
3. Oportunidades — clientes com horas subutilizadas ou potencial de expansão
Responda APENAS com o texto das 3 seções, sem bullet points excessivos, sem markdown, sem cabeçalhos com #.
Use "→" para separar o nome do cliente da observação. Máximo 200 palavras.`;

        const lines = clientStats.map(s =>
            `${s.client.name}${s.client.projectNum ? ` (Proj.${s.client.projectNum})` : ''}: ` +
            `${s.hoursUsed}h usadas / ${s.hoursTotal}h contratadas (${s.percentage}%) | ` +
            `Projeção: ${s.projectedHours}h | Tarefas abertas: ${s.tasksEstimatedHours}h estimadas | ` +
            `Status: ${s.isOverLimit ? 'ACIMA DO LIMITE' : s.percentage >= 80 ? 'ATENÇÃO' : s.percentage <= 20 ? 'SUBUTILIZADO' : 'NORMAL'}`
        ).join('\n');

        const user = `Mês de referência: ${monthLabel}\nTotal de clientes ativos: ${clientStats.length}\n\nDados por cliente:\n${lines}`;

        return this.complete(system, user);
    }

    async parseAgendaNaturalLanguage(text, todayDate) {
        const dayNames = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
        const todayObj = new Date(todayDate + 'T12:00:00');
        const todayDayName = dayNames[todayObj.getDay()];

        const system = `Você é um assistente que interpreta descrições de eventos em linguagem natural e retorna JSON estruturado.
Hoje é ${todayDate} (${todayDayName}).
Interprete o texto e retorne APENAS um objeto JSON com estes campos:
{
  "title": "título do evento",
  "type": "meeting|consulting|task|reminder",
  "date": "YYYY-MM-DD",
  "dateEnd": "YYYY-MM-DD",
  "startTime": "HH:MM",
  "endTime": "HH:MM",
  "allDay": false,
  "location": "",
  "description": ""
}
Regras:
- type: meeting = reunião/meeting/alinhamento, consulting = consultoria/atendimento/suporte, task = tarefa/trabalho/bloco, reminder = lembrete/aviso
- Se horário não mencionado: startTime="" endTime="" allDay=true
- Se só início informado sem duração: endTime = startTime + 1h
- Se duração mencionada: calcule endTime a partir do startTime
- dateEnd igual a date por padrão; só diferente se evento multi-dia
- Datas relativas (hoje, amanhã, próxima sexta etc.) baseadas em hoje = ${todayDate}
- Responda APENAS com o JSON puro, sem markdown, sem \`\`\`, sem explicações`;

        const raw = await this.complete(system, `Texto: ${text}`);
        const cleaned = raw.trim().replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
        return JSON.parse(cleaned);
    }

    async generateAgendaReportNarrative(clientName, events, startDate, endDate) {
        const system = `Você é um consultor de TI escrevendo um relatório mensal para um cliente.
Escreva um texto profissional e amigável resumindo os atendimentos do período.
Use linguagem clara, destaque as principais atividades realizadas.
Formate para envio por WhatsApp ou e-mail.
Responda APENAS com o texto do relatório, sem título, sem explicações adicionais.`;

        const eventLines = events.map(ev => {
            const date = ev.date ? new Date(ev.date + 'T00:00:00').toLocaleDateString('pt-BR') : '';
            const time = ev.startTime ? ` ${ev.startTime}${ev.endTime ? '–' + ev.endTime : ''}` : ' (dia inteiro)';
            return `- ${date}${time}: ${ev.title}${ev.description ? ` — ${ev.description}` : ''}`;
        }).join('\n');

        const start = new Date(startDate + 'T00:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

        const user = `Cliente: ${clientName}
Período: ${start}
Total de atendimentos: ${events.length}

Atendimentos realizados:
${eventLines}

Escreva o relatório mensal.`;

        return this.complete(system, user);
    }
}

window.aiClient = new TSPAIClient();
