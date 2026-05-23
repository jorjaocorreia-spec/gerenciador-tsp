/**
 * TSP Store - Gerencia o estado da aplicação via LocalStorage
 */
class TSPStore {
    constructor() {
        this.STORAGE_KEY = 'tsp_data_v1';
        this.data = {
            clients: [], // { id, name, hoursTotal, createdAt }
            records: [], // { id, clientId, date, minutes, description, createdAt }
            tasks: [],   // Kanban tasks array
            agendaEvents: [] // { id, title, description, type, clientId, relatedTaskId, date, startTime, endTime, location, createdAt, calendarEventId }
        };
        this.load();
    }

    // Carrega dados do LocalStorage
    load() {
        const stored = localStorage.getItem(this.STORAGE_KEY);
        if (stored) {
            try {
                this.data = JSON.parse(stored);

                // Sanitize existing records (Fix string concatenation bug)
                if (this.data.records) {
                    this.data.records.forEach(r => {
                        if (typeof r.minutes === 'string') {
                            r.minutes = parseInt(r.minutes, 10) || 0;
                        }
                    });
                }
                if (!this.data.tasks) {
                    this.data.tasks = [];
                }
                if (!this.data.agendaEvents) {
                    this.data.agendaEvents = [];
                }
            } catch (e) {
                console.error("Erro ao carregar dados do LocalStorage", e);
            }
        }
    }

    // Salva dados no LocalStorage
    save() {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.data));
    }

    // ==========================================
    // CLIENTES
    // ==========================================
    getClients() {
        return this.data.clients || [];
    }

    getClient(id) {
        return this.data.clients.find(c => c.id === id);
    }

    addClient(name, hoursTotal, csName, projectNum, clientPays, notes, status) {
        const newClient = {
            id: crypto.randomUUID(),
            name,
            hoursTotal: parseFloat(hoursTotal),
            csName: csName || '',
            projectNum: projectNum || '',
            clientPays: parseFloat(clientPays) || 0,
            notes: notes || '',
            status: status || 'active',
            createdAt: new Date().toISOString()
        };
        this.data.clients.push(newClient);
        this.save();
        return newClient;
    }

    updateClient(id, name, hoursTotal, csName, projectNum, clientPays, notes, status) {
        const client = this.getClient(id);
        if (client) {
            client.name = name;
            client.hoursTotal = parseFloat(hoursTotal);
            client.csName = csName || '';
            client.projectNum = projectNum || '';
            client.clientPays = parseFloat(clientPays) || 0;
            client.notes = notes || '';
            client.status = status || 'active';
            this.save();
        }
        return client;
    }

    deleteClient(id) {
        this.data.clients = this.data.clients.filter(c => c.id !== id);
        // Remove também os lançamentos associados
        this.data.records = this.data.records.filter(r => r.clientId !== id);
        if (this.data.tasks) {
            this.data.tasks = this.data.tasks.filter(t => t.clientId !== id);
        }
        this.save();
    }

    // ==========================================
    // LANÇAMENTOS (ATENDIMENTOS)
    // ==========================================
    getRecords() {
        return this.data.records || [];
    }

    getRecordsByClient(clientId) {
        return this.data.records.filter(r => r.clientId === clientId);
    }

    addRecord(clientId, date, startTime, endTime, minutes, description) {
        const newRecord = {
            id: crypto.randomUUID(),
            clientId,
            date,
            startTime,
            endTime,
            minutes: parseInt(minutes, 10),
            description,
            createdAt: new Date().toISOString()
        };
        this.data.records.push(newRecord);
        this.save();
        return newRecord;
    }

    getRecord(id) {
        return this.data.records.find(r => r.id === id);
    }

    updateRecord(id, clientId, date, startTime, endTime, minutes, description) {
        const index = this.data.records.findIndex(r => r.id === id);
        if (index !== -1) {
            this.data.records[index] = {
                ...this.data.records[index],
                clientId,
                date,
                startTime,
                endTime,
                minutes: parseInt(minutes, 10) || 0,
                description
            };
            this.save();
            return this.data.records[index];
        }
        return null;
    }

    deleteRecord(id) {
        this.data.records = this.data.records.filter(r => r.id !== id);
        this.save();
    }

    // ==========================================
    // TAREFAS (KANBAN)
    // ==========================================
    getTasks() {
        return this.data.tasks || [];
    }

    getTask(id) {
        return this.data.tasks.find(t => t.id === id);
    }

    getTasksByClient(clientId) {
        return this.getTasks().filter(t => t.clientId === clientId);
    }

    addTask(taskData) {
        const newTask = {
            id: crypto.randomUUID(),
            clientId: taskData.clientId,
            title: taskData.title,
            description: taskData.description || '',
            status: taskData.status || 'new', // new, doing, done
            priority: taskData.priority || 'medium', // low, medium, high
            dueDate: taskData.dueDate || '',
            estimatedMinutes: parseInt(taskData.estimatedMinutes, 10) || 0,
            spentMinutes: 0,
            attachments: taskData.attachments || [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        this.data.tasks.push(newTask);
        this.save();
        return newTask;
    }

    updateTask(taskData) {
        const index = this.data.tasks.findIndex(t => t.id === taskData.id);
        if (index !== -1) {
            this.data.tasks[index] = {
                ...this.data.tasks[index],
                ...taskData,
                updatedAt: new Date().toISOString()
            };
            this.save();
            return this.data.tasks[index];
        }
        return null;
    }

    deleteTask(id) {
        this.data.tasks = this.data.tasks.filter(t => t.id !== id);
        this.save();
    }

    updateTaskStatus(id, status) {
        const index = this.data.tasks.findIndex(t => t.id === id);
        if (index !== -1) {
            this.data.tasks[index].status = status;
            this.data.tasks[index].updatedAt = new Date().toISOString();
            this.save();
            return this.data.tasks[index];
        }
        return null;
    }

    addTaskTime(id, minutes) {
        const index = this.data.tasks.findIndex(t => t.id === id);
        if (index !== -1) {
            this.data.tasks[index].spentMinutes += (parseInt(minutes, 10) || 0);
            this.data.tasks[index].updatedAt = new Date().toISOString();
            this.save();
            return this.data.tasks[index];
        }
        return null;
    }

    // ==========================================
    // AGENDA
    // ==========================================
    getAgendaEvents() {
        return this.data.agendaEvents || [];
    }

    getAgendaEvent(id) {
        return this.data.agendaEvents.find(e => e.id === id);
    }

    addAgendaEvent(eventData) {
        const newEvent = {
            id: crypto.randomUUID(),
            title: eventData.title || '',
            description: eventData.description || '',
            type: eventData.type || 'meeting', // meeting, consulting, task, reminder
            clientId: eventData.clientId || null,
            relatedTaskId: eventData.relatedTaskId || null,
            date: eventData.date || '',
            startTime: eventData.startTime || '',
            endTime: eventData.endTime || '',
            location: eventData.location || '',
            createdAt: new Date().toISOString(),
            calendarEventId: eventData.calendarEventId || null
        };
        this.data.agendaEvents.push(newEvent);
        this.save();
        return newEvent;
    }

    updateAgendaEvent(eventData) {
        const index = this.data.agendaEvents.findIndex(e => e.id === eventData.id);
        if (index !== -1) {
            this.data.agendaEvents[index] = {
                ...this.data.agendaEvents[index],
                ...eventData
            };
            this.save();
            return this.data.agendaEvents[index];
        }
        return null;
    }

    deleteAgendaEvent(id) {
        this.data.agendaEvents = this.data.agendaEvents.filter(e => e.id !== id);
        this.save();
    }

    getEventsByDate(date) {
        return this.getAgendaEvents().filter(e => e.date === date);
    }

    getEventsByWeek(startDate, endDate) {
        // Assume startDate and endDate are 'YYYY-MM-DD' strings
        return this.getAgendaEvents().filter(e => e.date >= startDate && e.date <= endDate);
    }

    // ==========================================
    // ESTATÍSTICAS E CÁLCULOS
    // ==========================================

    // Retorna as horas consolidadas por cliente num dado mês/ano (ou todos, se omitido)
    // Para simplificar a 1a versão, vamos calcular o total global que está ativo
    getClientStats(clientId, yearMonth = null) {
        const client = this.getClient(clientId);
        if (!client) return null;

        let records = this.getRecordsByClient(clientId);

        // Se quiser filtrar por mês específico futuramente:
        if (yearMonth) {
            records = records.filter(r => r.date.startsWith(yearMonth));
        }

        const totalMinutesUsed = records.reduce((acc, obj) => acc + obj.minutes, 0);
        const hoursUsed = totalMinutesUsed / 60;

        // Calcular impacto das tarefas abertas
        const openTasks = this.getTasksByClient(clientId).filter(t => t.status !== 'done');
        const tasksEstimatedMinutes = openTasks.reduce((acc, t) => acc + t.estimatedMinutes, 0);
        const tasksSpentMinutes = openTasks.reduce((acc, t) => acc + t.spentMinutes, 0);

        const tasksEstimatedHours = tasksEstimatedMinutes / 60;
        const tasksSpentHours = tasksSpentMinutes / 60;

        const totalUsedWithTasks = hoursUsed + tasksSpentHours;
        const projectedHours = hoursUsed + tasksEstimatedHours;

        const percentage = client.hoursTotal > 0 ? (totalUsedWithTasks / client.hoursTotal) * 100 : 0;
        const isOverLimit = projectedHours > client.hoursTotal;

        return {
            client,
            hoursTotal: client.hoursTotal,
            hoursUsed: parseFloat(hoursUsed.toFixed(2)),
            totalUsedWithTasks: parseFloat(totalUsedWithTasks.toFixed(2)),
            projectedHours: parseFloat(projectedHours.toFixed(2)),
            tasksEstimatedHours: parseFloat(tasksEstimatedHours.toFixed(2)),
            tasksSpentHours: parseFloat(tasksSpentHours.toFixed(2)),
            hoursRemaining: parseFloat((Math.max(0, client.hoursTotal - totalUsedWithTasks)).toFixed(2)),
            percentage: Math.min(100, Math.round(percentage)),
            isOverLimit
        };
    }

    getAllStats() {
        return this.getClients().map(c => this.getClientStats(c.id));
    }

    // Retorna agrupamento dos lançamentos de um cliente por mês/ano (Ex: "2026-03")
    getMonthlyStatsByClient(clientId) {
        const client = this.getClient(clientId);
        if (!client) return [];

        const records = this.getRecordsByClient(clientId);
        const monthlyData = {};

        const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

        records.forEach(r => {
            // r.date formato: YYYY-MM-DD
            const yearMonth = r.date.substring(0, 7); // ex: "2026-03"

            if (!monthlyData[yearMonth]) {
                const parts = yearMonth.split('-');
                const monthName = monthNames[parseInt(parts[1], 10) - 1] + ' / ' + parts[0];
                monthlyData[yearMonth] = {
                    yearMonth,
                    monthName,
                    minutes: 0,
                    records: []
                };
            }
            monthlyData[yearMonth].minutes += r.minutes;
            monthlyData[yearMonth].records.push(r);
        });

        // Converte o objeto para array e ordena do mês mais antigo para o mais recente (Crescente)
        return Object.values(monthlyData).sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
    }

    // ==========================================
    // SISTEMA DE BACKUP (JSON)
    // ==========================================

    exportData() {
        const dataStr = JSON.stringify(this.data, null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        const dateStr = new Date().toISOString().split('T')[0];
        a.download = `tsp_backup_${dateStr}.json`;

        document.body.appendChild(a);
        a.click();

        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async importData(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const importedData = JSON.parse(e.target.result);

                    // Validação simples do formato
                    if (importedData.clients && Array.isArray(importedData.clients) &&
                        importedData.records && Array.isArray(importedData.records)) {

                        if (!importedData.tasks || !Array.isArray(importedData.tasks)) {
                            importedData.tasks = [];
                        }

                        if (!importedData.agendaEvents || !Array.isArray(importedData.agendaEvents)) {
                            importedData.agendaEvents = [];
                        }

                        this.data = importedData;
                        this.save();
                        resolve({ success: true, message: "Dados importados com sucesso!" });
                    } else {
                        reject(new Error("Formato de arquivo inválido."));
                    }
                } catch (error) {
                    reject(new Error("Falha ao ler o arquivo JSON."));
                }
            };
            reader.onerror = () => reject(new Error("Erro ao carregar o arquivo."));
            reader.readAsText(file);
        });
    }
}

// Expõe a instância globalmente
window.store = new TSPStore();
