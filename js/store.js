class TSPStore {
    get db() { return window.supabaseClient; }
    get userId() { return Auth.getUserId(); }

    // ── Mappers camelCase ↔ snake_case ────────────────────────────

    _client(r) {
        return { id: r.id, name: r.name, hoursTotal: parseFloat(r.hours_total) || 0,
            csName: r.cs_name || '', projectNum: r.project_num || '',
            clientPays: parseFloat(r.client_pays) || 0, notes: r.notes || '',
            status: r.status || 'active', createdAt: r.created_at };
    }

    _record(r) {
        return { id: r.id, clientId: r.client_id, date: r.date,
            startTime: r.start_time || '', endTime: r.end_time || '',
            minutes: parseInt(r.minutes) || 0, description: r.description || '',
            createdAt: r.created_at };
    }

    _task(r) {
        return { id: r.id, clientId: r.client_id, title: r.title,
            description: r.description || '', status: r.status || 'new',
            priority: r.priority || 'medium', dueDate: r.due_date || '',
            estimatedMinutes: parseInt(r.estimated_minutes) || 0,
            spentMinutes: parseInt(r.spent_minutes) || 0,
            createdAt: r.created_at, updatedAt: r.updated_at };
    }

    _event(r) {
        return { id: r.id, clientId: r.client_id, relatedTaskId: r.related_task_id,
            title: r.title, description: r.description || '', type: r.type || 'meeting',
            date: r.date, startTime: r.start_time || '', endTime: r.end_time || '',
            location: r.location || '', calendarEventId: r.calendar_event_id || null,
            createdAt: r.created_at };
    }

    // ── CLIENTES ─────────────────────────────────────────────────

    async getClients() {
        const { data, error } = await this.db.from('clients').select('*')
            .eq('user_id', this.userId).order('created_at');
        if (error) throw error;
        return data.map(r => this._client(r));
    }

    async getClient(id) {
        const { data, error } = await this.db.from('clients').select('*').eq('id', id).single();
        if (error) return null;
        return this._client(data);
    }

    async addClient(name, hoursTotal, csName, projectNum, clientPays, notes, status) {
        const { data, error } = await this.db.from('clients').insert({
            user_id: this.userId, name,
            hours_total: parseFloat(hoursTotal) || 0, cs_name: csName || '',
            project_num: projectNum || '', client_pays: parseFloat(clientPays) || 0,
            notes: notes || '', status: status || 'active'
        }).select().single();
        if (error) throw error;
        return this._client(data);
    }

    async updateClient(id, name, hoursTotal, csName, projectNum, clientPays, notes, status) {
        const { data, error } = await this.db.from('clients').update({
            name, hours_total: parseFloat(hoursTotal) || 0, cs_name: csName || '',
            project_num: projectNum || '', client_pays: parseFloat(clientPays) || 0,
            notes: notes || '', status: status || 'active'
        }).eq('id', id).select().single();
        if (error) throw error;
        return this._client(data);
    }

    async deleteClient(id) {
        const { error } = await this.db.from('clients').delete().eq('id', id);
        if (error) throw error;
    }

    // ── ATENDIMENTOS ──────────────────────────────────────────────

    async getRecords() {
        const { data, error } = await this.db.from('records').select('*')
            .eq('user_id', this.userId).order('date', { ascending: false });
        if (error) throw error;
        return data.map(r => this._record(r));
    }

    async getRecord(id) {
        const { data, error } = await this.db.from('records').select('*').eq('id', id).single();
        if (error) return null;
        return this._record(data);
    }

    async getRecordsByClient(clientId) {
        const { data, error } = await this.db.from('records').select('*')
            .eq('user_id', this.userId).eq('client_id', clientId).order('date', { ascending: false });
        if (error) throw error;
        return data.map(r => this._record(r));
    }

    async addRecord(clientId, date, startTime, endTime, minutes, description) {
        const { data, error } = await this.db.from('records').insert({
            user_id: this.userId, client_id: clientId, date,
            start_time: startTime || '', end_time: endTime || '',
            minutes: parseInt(minutes) || 0, description: description || ''
        }).select().single();
        if (error) throw error;
        return this._record(data);
    }

    async updateRecord(id, clientId, date, startTime, endTime, minutes, description) {
        const { data, error } = await this.db.from('records').update({
            client_id: clientId, date, start_time: startTime || '',
            end_time: endTime || '', minutes: parseInt(minutes) || 0,
            description: description || ''
        }).eq('id', id).select().single();
        if (error) throw error;
        return this._record(data);
    }

    async deleteRecord(id) {
        const { error } = await this.db.from('records').delete().eq('id', id);
        if (error) throw error;
    }

    // ── TAREFAS ───────────────────────────────────────────────────

    async getTasks() {
        const { data, error } = await this.db.from('tasks').select('*')
            .eq('user_id', this.userId).order('created_at');
        if (error) throw error;
        return data.map(r => this._task(r));
    }

    async getTask(id) {
        const { data, error } = await this.db.from('tasks').select('*').eq('id', id).single();
        if (error) return null;
        return this._task(data);
    }

    async getTasksByClient(clientId) {
        const { data, error } = await this.db.from('tasks').select('*')
            .eq('user_id', this.userId).eq('client_id', clientId);
        if (error) throw error;
        return data.map(r => this._task(r));
    }

    async addTask(taskData) {
        const { data, error } = await this.db.from('tasks').insert({
            user_id: this.userId, client_id: taskData.clientId || null,
            title: taskData.title, description: taskData.description || '',
            status: taskData.status || 'new', priority: taskData.priority || 'medium',
            due_date: taskData.dueDate || null,
            estimated_minutes: parseInt(taskData.estimatedMinutes) || 0,
            spent_minutes: 0
        }).select().single();
        if (error) throw error;
        return this._task(data);
    }

    async updateTask(taskData) {
        const { data, error } = await this.db.from('tasks').update({
            client_id: taskData.clientId || null, title: taskData.title,
            description: taskData.description || '', status: taskData.status,
            priority: taskData.priority, due_date: taskData.dueDate || null,
            estimated_minutes: parseInt(taskData.estimatedMinutes) || 0,
            updated_at: new Date().toISOString()
        }).eq('id', taskData.id).select().single();
        if (error) throw error;
        return this._task(data);
    }

    async updateTaskStatus(id, status) {
        const { data, error } = await this.db.from('tasks').update({
            status, updated_at: new Date().toISOString()
        }).eq('id', id).select().single();
        if (error) throw error;
        return this._task(data);
    }

    async addTaskTime(id, minutes) {
        const task = await this.getTask(id);
        if (!task) return null;
        const { data, error } = await this.db.from('tasks').update({
            spent_minutes: task.spentMinutes + (parseInt(minutes) || 0),
            updated_at: new Date().toISOString()
        }).eq('id', id).select().single();
        if (error) throw error;
        return this._task(data);
    }

    async deleteTask(id) {
        const { error } = await this.db.from('tasks').delete().eq('id', id);
        if (error) throw error;
    }

    // ── AGENDA ────────────────────────────────────────────────────

    async getAgendaEvents() {
        const { data, error } = await this.db.from('agenda_events').select('*')
            .eq('user_id', this.userId).order('date');
        if (error) throw error;
        return data.map(r => this._event(r));
    }

    async getAgendaEvent(id) {
        const { data, error } = await this.db.from('agenda_events').select('*').eq('id', id).single();
        if (error) return null;
        return this._event(data);
    }

    async addAgendaEvent(eventData) {
        const { data, error } = await this.db.from('agenda_events').insert({
            user_id: this.userId, client_id: eventData.clientId || null,
            related_task_id: eventData.relatedTaskId || null,
            title: eventData.title || '', description: eventData.description || '',
            type: eventData.type || 'meeting', date: eventData.date,
            start_time: eventData.startTime || '', end_time: eventData.endTime || '',
            location: eventData.location || '', calendar_event_id: eventData.calendarEventId || null
        }).select().single();
        if (error) throw error;
        return this._event(data);
    }

    async updateAgendaEvent(eventData) {
        const { data, error } = await this.db.from('agenda_events').update({
            client_id: eventData.clientId || null, related_task_id: eventData.relatedTaskId || null,
            title: eventData.title || '', description: eventData.description || '',
            type: eventData.type || 'meeting', date: eventData.date,
            start_time: eventData.startTime || '', end_time: eventData.endTime || '',
            location: eventData.location || '', calendar_event_id: eventData.calendarEventId || null
        }).eq('id', eventData.id).select().single();
        if (error) throw error;
        return this._event(data);
    }

    async deleteAgendaEvent(id) {
        const { error } = await this.db.from('agenda_events').delete().eq('id', id);
        if (error) throw error;
    }

    async getEventsByDate(date) {
        const { data, error } = await this.db.from('agenda_events').select('*')
            .eq('user_id', this.userId).eq('date', date);
        if (error) throw error;
        return data.map(r => this._event(r));
    }

    async getEventsByWeek(startDate, endDate) {
        const { data, error } = await this.db.from('agenda_events').select('*')
            .eq('user_id', this.userId).gte('date', startDate).lte('date', endDate)
            .order('date');
        if (error) throw error;
        return data.map(r => this._event(r));
    }

    // ── ESTATÍSTICAS ──────────────────────────────────────────────

    async getClientStats(clientId, yearMonth = null) {
        const client = await this.getClient(clientId);
        if (!client) return null;

        let records = await this.getRecordsByClient(clientId);
        if (yearMonth) records = records.filter(r => r.date.startsWith(yearMonth));

        const openTasks = (await this.getTasksByClient(clientId)).filter(t => t.status !== 'done');
        const totalMinutesUsed = records.reduce((acc, r) => acc + r.minutes, 0);
        const hoursUsed = totalMinutesUsed / 60;
        const tasksEstimatedHours = openTasks.reduce((acc, t) => acc + t.estimatedMinutes, 0) / 60;
        const tasksSpentHours = openTasks.reduce((acc, t) => acc + t.spentMinutes, 0) / 60;
        const totalUsedWithTasks = hoursUsed + tasksSpentHours;
        const projectedHours = hoursUsed + tasksEstimatedHours;
        const percentage = client.hoursTotal > 0 ? (totalUsedWithTasks / client.hoursTotal) * 100 : 0;

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
            isOverLimit: projectedHours > client.hoursTotal
        };
    }

    async getAllStats() {
        const clients = await this.getClients();
        return Promise.all(clients.map(c => this.getClientStats(c.id)));
    }

    async getMonthlyStatsByClient(clientId) {
        const client = await this.getClient(clientId);
        if (!client) return [];

        const records = await this.getRecordsByClient(clientId);
        const monthNames = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
        const monthlyData = {};

        records.forEach(r => {
            const yearMonth = r.date.substring(0, 7);
            if (!monthlyData[yearMonth]) {
                const parts = yearMonth.split('-');
                monthlyData[yearMonth] = {
                    yearMonth,
                    monthName: monthNames[parseInt(parts[1], 10) - 1] + ' / ' + parts[0],
                    minutes: 0, records: []
                };
            }
            monthlyData[yearMonth].minutes += r.minutes;
            monthlyData[yearMonth].records.push(r);
        });

        return Object.values(monthlyData).sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
    }

    // ── BACKUP ────────────────────────────────────────────────────

    async exportData() {
        const [clients, records, tasks, agendaEvents] = await Promise.all([
            this.getClients(), this.getRecords(), this.getTasks(), this.getAgendaEvents()
        ]);
        const blob = new Blob([JSON.stringify({ clients, records, tasks, agendaEvents }, null, 2)],
            { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tsp_backup_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async importData(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const d = JSON.parse(e.target.result);
                    if (!d.clients || !d.records) throw new Error('Formato inválido.');

                    const idMap = {};
                    for (const c of d.clients) {
                        const created = await this.addClient(c.name, c.hoursTotal, c.csName,
                            c.projectNum, c.clientPays, c.notes, c.status);
                        idMap[c.id] = created.id;
                    }
                    for (const r of d.records) {
                        if (idMap[r.clientId]) await this.addRecord(
                            idMap[r.clientId], r.date, r.startTime, r.endTime, r.minutes, r.description);
                    }
                    for (const t of (d.tasks || [])) {
                        await this.addTask({ ...t, clientId: idMap[t.clientId] || null });
                    }
                    for (const ev of (d.agendaEvents || [])) {
                        await this.addAgendaEvent({ ...ev, clientId: idMap[ev.clientId] || null });
                    }
                    resolve({ success: true, message: 'Dados importados com sucesso!' });
                } catch (err) { reject(err); }
            };
            reader.onerror = () => reject(new Error('Erro ao carregar o arquivo.'));
            reader.readAsText(file);
        });
    }
}

window.store = new TSPStore();
