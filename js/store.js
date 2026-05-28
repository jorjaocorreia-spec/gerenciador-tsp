class TSPStore {
    get db() { return window.supabaseClient; }
    get userId() { return Auth.getUserId(); }

    // ── Mappers camelCase ↔ snake_case ────────────────────────────

    _client(r) {
        return { id: r.id, name: r.name, hoursTotal: parseFloat(r.hours_total) || 0,
            csName: r.cs_name || '', projectNum: r.project_num || '',
            clientPays: parseFloat(r.client_pays) || 0,
            consultantBonus: parseFloat(r.consultant_bonus) || 0,
            notes: r.notes || '', status: r.status || 'active',
            initialBalanceMinutes: parseInt(r.initial_balance_minutes) || 0,
            balanceStartDate: r.balance_start_date || null,
            createdAt: r.created_at };
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
            priority: r.priority || 'medium',
            position: parseInt(r.position) || 0,
            labels: Array.isArray(r.labels) ? r.labels : [],
            checklist: Array.isArray(r.checklist) ? r.checklist : [],
            coverColor: r.cover_color || null,
            dueDate: r.due_date || '',
            estimatedMinutes: parseInt(r.estimated_minutes) || 0,
            spentMinutes: parseInt(r.spent_minutes) || 0,
            attachments: Array.isArray(r.attachments) ? r.attachments : [],
            comments: Array.isArray(r.comments) ? r.comments : [],
            createdAt: r.created_at, updatedAt: r.updated_at };
    }

    _event(r) {
        return { id: r.id, clientId: r.client_id, relatedTaskId: r.related_task_id,
            title: r.title, description: r.description || '', type: r.type || 'meeting',
            date: r.date, dateEnd: r.date_end || r.date,
            startTime: r.start_time || '', endTime: r.end_time || '',
            location: r.location || '', calendarEventId: r.calendar_event_id || null,
            meetLink: r.meet_link || '', attendees: r.attendees || '',
            createdAt: r.created_at };
    }

    _apontamento(r) {
        return { id: r.id, date: r.date,
            startTime: r.start_time || '', endTime: r.end_time || '',
            projectNum: r.project_num || '', description: r.description || '',
            createdAt: r.created_at };
    }

    _column(r) {
        return { id: r.id, clientId: r.client_id || null,
            name: r.name, color: r.color || '#6366f1',
            position: parseInt(r.position) || 0, isDone: !!r.is_done,
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
        const { data, error } = await this.db.from('clients').select('*')
            .eq('id', id).eq('user_id', this.userId).single();
        if (error) return null;
        return this._client(data);
    }

    async addClient(name, hoursTotal, csName, projectNum, clientPays, consultantBonus, notes, status, initialBalanceMinutes, balanceStartDate) {
        const { data, error } = await this.db.from('clients').insert({
            user_id: this.userId, name,
            hours_total: parseFloat(hoursTotal) || 0, cs_name: csName || '',
            project_num: projectNum || '', client_pays: parseFloat(clientPays) || 0,
            consultant_bonus: parseFloat(consultantBonus) || 0,
            notes: notes || '', status: status || 'active',
            initial_balance_minutes: parseInt(initialBalanceMinutes) || 0,
            balance_start_date: balanceStartDate || null
        }).select().single();
        if (error) throw error;
        return this._client(data);
    }

    async updateClient(id, name, hoursTotal, csName, projectNum, clientPays, consultantBonus, notes, status, initialBalanceMinutes, balanceStartDate) {
        const { data, error } = await this.db.from('clients').update({
            name, hours_total: parseFloat(hoursTotal) || 0, cs_name: csName || '',
            project_num: projectNum || '', client_pays: parseFloat(clientPays) || 0,
            consultant_bonus: parseFloat(consultantBonus) || 0,
            notes: notes || '', status: status || 'active',
            initial_balance_minutes: parseInt(initialBalanceMinutes) || 0,
            balance_start_date: balanceStartDate || null
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
        const { data, error } = await this.db.from('records').select('*')
            .eq('id', id).eq('user_id', this.userId).single();
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
            .eq('user_id', this.userId).order('status').order('position');
        if (error) throw error;
        return data.map(r => this._task(r));
    }

    async getTask(id) {
        const { data, error } = await this.db.from('tasks').select('*')
            .eq('id', id).eq('user_id', this.userId).single();
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
        const targetStatus = taskData.status || 'new';
        const { data: existing } = await this.db.from('tasks')
            .select('position').eq('user_id', this.userId).eq('status', targetStatus)
            .order('position', { ascending: false }).limit(1);
        const nextPosition = (existing && existing.length > 0) ? (existing[0].position + 1) : 0;

        const { data, error } = await this.db.from('tasks').insert({
            user_id: this.userId, client_id: taskData.clientId || null,
            title: taskData.title, description: taskData.description || '',
            status: targetStatus, priority: taskData.priority || 'medium',
            position: nextPosition,
            labels: taskData.labels || [],
            checklist: taskData.checklist || [],
            cover_color: taskData.coverColor || null,
            due_date: taskData.dueDate || null,
            estimated_minutes: parseInt(taskData.estimatedMinutes) || 0,
            spent_minutes: 0,
            attachments: taskData.attachments || [],
            comments: []
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
            labels: taskData.labels || [],
            checklist: taskData.checklist || [],
            cover_color: taskData.coverColor || null,
            updated_at: new Date().toISOString(),
            attachments: taskData.attachments || [],
            ...(taskData.comments !== undefined && { comments: taskData.comments })
        }).eq('id', taskData.id).eq('user_id', this.userId).select().single();
        if (error) throw error;
        return this._task(data);
    }

    async reorderTasks(updates) {
        // updates: [{id, status, position}]
        const now = new Date().toISOString();
        const results = await Promise.all(
            updates.map(u =>
                this.db.from('tasks')
                    .update({ status: u.status, position: u.position, updated_at: now })
                    .eq('id', u.id)
                    .eq('user_id', this.userId)
            )
        );
        const failed = results.find(r => r.error);
        if (failed) throw failed.error;
    }

    async updateTaskChecklist(id, checklist) {
        const { data, error } = await this.db.from('tasks').update({
            checklist, updated_at: new Date().toISOString()
        }).eq('id', id).eq('user_id', this.userId).select().single();
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

    async addTaskComment(taskId, text) {
        const { data } = await this.db.from('tasks').select('comments').eq('id', taskId).eq('user_id', this.userId).single();
        const comments = Array.isArray(data?.comments) ? data.comments : [];
        comments.push({ id: crypto.randomUUID(), type: 'comment', text, createdAt: new Date().toISOString() });
        await this.db.from('tasks').update({ comments }).eq('id', taskId).eq('user_id', this.userId);
        return comments;
    }

    async logTaskActivity(taskId, type, activityData) {
        const { data } = await this.db.from('tasks').select('comments').eq('id', taskId).eq('user_id', this.userId).single();
        const comments = Array.isArray(data?.comments) ? data.comments : [];
        comments.push({ id: crypto.randomUUID(), type, activityData, createdAt: new Date().toISOString() });
        await this.db.from('tasks').update({ comments }).eq('id', taskId).eq('user_id', this.userId);
    }

    // ── AGENDA ────────────────────────────────────────────────────

    async getAgendaEvents() {
        const { data, error } = await this.db.from('agenda_events').select('*')
            .eq('user_id', this.userId).order('date');
        if (error) throw error;
        return data.map(r => this._event(r));
    }

    async getAgendaEvent(id) {
        const { data, error } = await this.db.from('agenda_events').select('*')
            .eq('id', id).eq('user_id', this.userId).single();
        if (error) return null;
        return this._event(data);
    }

    async addAgendaEvent(eventData) {
        const { data, error } = await this.db.from('agenda_events').insert({
            user_id: this.userId, client_id: eventData.clientId || null,
            related_task_id: eventData.relatedTaskId || null,
            title: eventData.title || '', description: eventData.description || '',
            type: eventData.type || 'meeting', date: eventData.date,
            date_end: eventData.dateEnd || eventData.date,
            start_time: eventData.startTime || '', end_time: eventData.endTime || '',
            location: eventData.location || '', calendar_event_id: eventData.calendarEventId || null,
            meet_link: eventData.meetLink || '', attendees: eventData.attendees || ''
        }).select().single();
        if (error) throw error;
        return this._event(data);
    }

    async updateAgendaEvent(eventData) {
        const { data, error } = await this.db.from('agenda_events').update({
            client_id: eventData.clientId || null, related_task_id: eventData.relatedTaskId || null,
            title: eventData.title || '', description: eventData.description || '',
            type: eventData.type || 'meeting', date: eventData.date,
            date_end: eventData.dateEnd || eventData.date,
            start_time: eventData.startTime || '', end_time: eventData.endTime || '',
            location: eventData.location || '', calendar_event_id: eventData.calendarEventId || null,
            meet_link: eventData.meetLink || '', attendees: eventData.attendees || ''
        }).eq('id', eventData.id).select().single();
        if (error) throw error;
        return this._event(data);
    }

    async deleteAgendaEvent(id) {
        const { error } = await this.db.from('agenda_events').delete().eq('id', id);
        if (error) throw error;
    }

    async getEventsByDate(date) {
        // Include single-day events on this date AND multi-day events spanning this date
        const { data, error } = await this.db.from('agenda_events').select('*')
            .eq('user_id', this.userId)
            .lte('date', date)
            .or(`date_end.gte.${date},and(date_end.is.null,date.eq.${date})`);
        if (error) throw error;
        return data.map(r => this._event(r));
    }

    async getEventsByWeek(startDate, endDate) {
        // Include events that overlap with the given range (overlap detection)
        const { data, error } = await this.db.from('agenda_events').select('*')
            .eq('user_id', this.userId)
            .lte('date', endDate)
            .or(`date_end.gte.${startDate},and(date_end.is.null,date.gte.${startDate})`)
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

        let doneIds = new Set(['done']);
        try {
            const cols = await this.getColumns(clientId);
            if (cols.length > 0) { doneIds = new Set(cols.filter(c => c.isDone).map(c => c.id)); doneIds.add('done'); }
        } catch (_) { /* use legacy fallback */ }
        const openTasks = (await this.getTasksByClient(clientId)).filter(t => !doneIds.has(t.status));
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

    // ── USER SETTINGS ─────────────────────────────────────────────

    async getUserSettings() {
        const uid = this.userId;
        if (!uid) return null;
        const { data, error } = await this.db
            .from('user_settings')
            .select('*')
            .eq('user_id', uid)
            .maybeSingle();
        if (error) { console.error('getUserSettings:', error); return null; }
        if (!data) return { googleClientId: '', googleApiKey: '' };
        return { googleClientId: data.google_client_id || '', googleApiKey: data.google_api_key || '' };
    }

    async saveUserSettings({ googleClientId, googleApiKey }) {
        const uid = this.userId;
        if (!uid) throw new Error('Usuário não autenticado.');
        const { error } = await this.db
            .from('user_settings')
            .upsert(
                { user_id: uid, google_client_id: googleClientId, google_api_key: googleApiKey, updated_at: new Date().toISOString() },
                { onConflict: 'user_id' }
            );
        if (error) throw error;
    }

    // ── APONTAMENTOS ─────────────────────────────────────────────

    async getApontamentos(date) {
        const { data, error } = await this.db.from('apontamentos')
            .select('*')
            .eq('user_id', this.userId)
            .eq('date', date)
            .order('start_time');
        if (error) throw error;
        return (data || []).map(r => this._apontamento(r));
    }

    async addApontamento(date, startTime, endTime, projectNum, description) {
        const { data, error } = await this.db.from('apontamentos').insert({
            user_id: this.userId, date,
            start_time: startTime, end_time: endTime,
            project_num: projectNum, description: description || ''
        }).select().single();
        if (error) throw error;
        return this._apontamento(data);
    }

    async updateApontamento(id, date, startTime, endTime, projectNum, description) {
        const { data, error } = await this.db.from('apontamentos').update({
            date, start_time: startTime, end_time: endTime,
            project_num: projectNum, description: description || ''
        }).eq('id', id).eq('user_id', this.userId).select().single();
        if (error) throw error;
        return this._apontamento(data);
    }

    async deleteApontamento(id) {
        const { error } = await this.db.from('apontamentos').delete()
            .eq('id', id).eq('user_id', this.userId);
        if (error) throw error;
    }

    // ── KANBAN COLUMNS ────────────────────────────────────────────

    async getColumns(clientId) {
        let q = this.db.from('kanban_columns').select('*')
            .eq('user_id', this.userId).order('position');
        if (clientId) q = q.eq('client_id', clientId);
        else q = q.is('client_id', null);
        const { data, error } = await q;
        if (error) throw error;
        return (data || []).map(r => this._column(r));
    }

    async getAllColumns() {
        const { data, error } = await this.db.from('kanban_columns').select('*')
            .eq('user_id', this.userId).order('position');
        if (error) throw error;
        return (data || []).map(r => this._column(r));
    }

    async ensureDefaultColumns(clientId) {
        const existing = await this.getColumns(clientId);
        if (existing.length > 0) return existing;
        const rows = [
            { user_id: this.userId, client_id: clientId || null, name: 'Novas',       color: '#4a9eff', position: 0, is_done: false },
            { user_id: this.userId, client_id: clientId || null, name: 'Em Execução', color: '#ff922b', position: 1, is_done: false },
            { user_id: this.userId, client_id: clientId || null, name: 'Finalizadas', color: '#51cf66', position: 2, is_done: true  },
        ];
        const { data, error } = await this.db.from('kanban_columns').insert(rows).select();
        if (error) throw error;
        return (data || []).map(r => this._column(r)).sort((a, b) => a.position - b.position);
    }

    async addColumn(clientId, name, color, isDone) {
        const existing = await this.getColumns(clientId);
        const position = existing.length > 0 ? Math.max(...existing.map(c => c.position)) + 1 : 0;
        const { data, error } = await this.db.from('kanban_columns').insert({
            user_id: this.userId, client_id: clientId || null,
            name, color: color || '#6366f1', position, is_done: !!isDone
        }).select().single();
        if (error) throw error;
        return this._column(data);
    }

    async updateColumn(id, { name, color, isDone }) {
        const { data, error } = await this.db.from('kanban_columns').update({
            name, color: color || '#6366f1', is_done: !!isDone
        }).eq('id', id).eq('user_id', this.userId).select().single();
        if (error) throw error;
        return this._column(data);
    }

    async deleteColumn(id) {
        const { error } = await this.db.from('kanban_columns').delete()
            .eq('id', id).eq('user_id', this.userId);
        if (error) throw error;
    }

    async reorderColumns(updates) {
        // updates: [{id, position}]
        const results = await Promise.all(
            updates.map(u =>
                this.db.from('kanban_columns')
                    .update({ position: u.position })
                    .eq('id', u.id).eq('user_id', this.userId)
            )
        );
        const failed = results.find(r => r.error);
        if (failed) throw failed.error;
    }

    // ── IMPLEMENTAÇÕES ────────────────────────────────────────────

    _implementation(r) {
        return {
            id: r.id,
            name: r.name,
            type: r.type || 'feature',
            description: r.description || '',
            codeScript: r.code_script || '',
            status: r.status || 'active',
            version: r.version || '',
            implementationDate: r.implementation_date || '',
            notes: r.notes || '',
            attachments: Array.isArray(r.attachments) ? r.attachments : [],
            clientIds: [], // preenchido opcionalmente por getImplementationsWithClients
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        };
    }

    async getImplementations() {
        const { data, error } = await this.db.from('implementations')
            .select('*')
            .eq('user_id', this.userId)
            .order('name');
        if (error) throw error;
        return (data || []).map(r => this._implementation(r));
    }

    async getImplementationsWithClients() {
        const [impls, links] = await Promise.all([
            this.getImplementations(),
            this.db.from('implementation_clients')
                .select('implementation_id, client_id')
                .eq('user_id', this.userId)
        ]);
        if (links.error) throw links.error;
        const map = {};
        (links.data || []).forEach(l => {
            if (!map[l.implementation_id]) map[l.implementation_id] = [];
            map[l.implementation_id].push(l.client_id);
        });
        return impls.map(impl => ({ ...impl, clientIds: map[impl.id] || [] }));
    }

    async addImplementation({ name, type, description, codeScript, status, version, implementationDate, notes, attachments }) {
        const { data, error } = await this.db.from('implementations').insert({
            user_id: this.userId, name, type, description: description || '',
            code_script: codeScript || '', status: status || 'active',
            version: version || '', implementation_date: implementationDate || null,
            notes: notes || '', attachments: attachments || []
        }).select().single();
        if (error) throw error;
        return this._implementation(data);
    }

    async updateImplementation(id, { name, type, description, codeScript, status, version, implementationDate, notes, attachments }) {
        const { data, error } = await this.db.from('implementations').update({
            name, type, description: description || '',
            code_script: codeScript || '', status: status || 'active',
            version: version || '', implementation_date: implementationDate || null,
            notes: notes || '', attachments: attachments || [],
            updated_at: new Date().toISOString()
        }).eq('id', id).eq('user_id', this.userId).select().single();
        if (error) throw error;
        return this._implementation(data);
    }

    async deleteImplementation(id) {
        const { error } = await this.db.from('implementations').delete()
            .eq('id', id).eq('user_id', this.userId);
        if (error) throw error;
    }

    async setImplementationClients(implementationId, clientIds) {
        // Substituição completa dos vínculos
        await this.db.from('implementation_clients').delete()
            .eq('implementation_id', implementationId).eq('user_id', this.userId);
        if (!clientIds || clientIds.length === 0) return;
        const rows = clientIds.map(cid => ({
            user_id: this.userId,
            implementation_id: implementationId,
            client_id: cid
        }));
        const { error } = await this.db.from('implementation_clients').insert(rows);
        if (error) throw error;
    }

    // ── TREINAMENTOS ────────────────────────────────────────────

    _training(r) {
        return {
            id: r.id,
            title: r.title,
            description: r.description || '',
            category: r.category || 'geral',
            status: r.status || 'active',
            attachments: Array.isArray(r.attachments) ? r.attachments : [],
            clientIds: [],
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        };
    }

    async getTrainings() {
        const { data, error } = await this.db.from('trainings')
            .select('*')
            .eq('user_id', this.userId)
            .order('title');
        if (error) throw error;
        return (data || []).map(r => this._training(r));
    }

    async getTrainingsWithClients() {
        const [trainings, links] = await Promise.all([
            this.getTrainings(),
            this.db.from('training_clients')
                .select('training_id, client_id')
                .eq('user_id', this.userId)
        ]);
        if (links.error) throw links.error;
        const map = {};
        (links.data || []).forEach(l => {
            if (!map[l.training_id]) map[l.training_id] = [];
            map[l.training_id].push(l.client_id);
        });
        return trainings.map(t => ({ ...t, clientIds: map[t.id] || [] }));
    }

    async addTraining({ title, description, category, status, attachments }) {
        const { data, error } = await this.db.from('trainings').insert({
            user_id: this.userId, title,
            description: description || '',
            category: category || 'geral',
            status: status || 'active',
            attachments: attachments || []
        }).select().single();
        if (error) throw error;
        return this._training(data);
    }

    async updateTraining(id, { title, description, category, status, attachments }) {
        const { data, error } = await this.db.from('trainings').update({
            title, description: description || '',
            category: category || 'geral',
            status: status || 'active',
            attachments: attachments || [],
            updated_at: new Date().toISOString()
        }).eq('id', id).eq('user_id', this.userId).select().single();
        if (error) throw error;
        return this._training(data);
    }

    async deleteTraining(id) {
        const { error } = await this.db.from('trainings').delete()
            .eq('id', id).eq('user_id', this.userId);
        if (error) throw error;
    }

    async setTrainingClients(trainingId, clientIds) {
        await this.db.from('training_clients').delete()
            .eq('training_id', trainingId).eq('user_id', this.userId);
        if (!clientIds || clientIds.length === 0) return;
        const rows = clientIds.map(cid => ({
            user_id: this.userId,
            training_id: trainingId,
            client_id: cid
        }));
        const { error } = await this.db.from('training_clients').insert(rows);
        if (error) throw error;
    }

    // ── REGRAS DE AGENDAMENTO ─────────────────────────────────────

    _rule(r) {
        return {
            id: r.id,
            clientId: r.client_id,
            title: r.title,
            eventType: r.event_type || 'meeting',
            description: r.description || '',
            daysOfWeek: Array.isArray(r.days_of_week) ? r.days_of_week : [],
            startTime: r.start_time || '',
            endTime: r.end_time || '',
            frequency: r.frequency || 'weekly',
            periodStart: r.period_start || '',
            periodEnd: r.period_end || '',
            location: r.location || '',
            attendees: r.attendees || '',
            generateMeet: !!r.generate_meet,
            isActive: r.is_active !== false,
            lastGeneratedUntil: r.last_generated_until || null,
            createdAt: r.created_at,
        };
    }

    async getSchedulingRules(clientId) {
        const { data, error } = await this.db.from('scheduling_rules')
            .select('*')
            .eq('user_id', this.userId)
            .eq('client_id', clientId)
            .order('created_at');
        if (error) throw error;
        return (data || []).map(r => this._rule(r));
    }

    async addSchedulingRule({ clientId, title, eventType, description, daysOfWeek, startTime, endTime, frequency, periodStart, periodEnd, location, attendees, generateMeet }) {
        const { data, error } = await this.db.from('scheduling_rules').insert({
            user_id: this.userId,
            client_id: clientId,
            title: title || 'Atendimento',
            event_type: eventType || 'meeting',
            description: description || '',
            days_of_week: daysOfWeek || [],
            start_time: startTime || '',
            end_time: endTime || '',
            frequency: frequency || 'weekly',
            period_start: periodStart,
            period_end: periodEnd,
            location: location || '',
            attendees: attendees || '',
            generate_meet: !!generateMeet,
            is_active: true,
        }).select().single();
        if (error) throw error;
        return this._rule(data);
    }

    async updateSchedulingRule(id, { title, eventType, description, daysOfWeek, startTime, endTime, frequency, periodStart, periodEnd, location, attendees, generateMeet }) {
        const { data, error } = await this.db.from('scheduling_rules').update({
            title: title || 'Atendimento',
            event_type: eventType || 'meeting',
            description: description || '',
            days_of_week: daysOfWeek || [],
            start_time: startTime || '',
            end_time: endTime || '',
            frequency: frequency || 'weekly',
            period_start: periodStart,
            period_end: periodEnd,
            location: location || '',
            attendees: attendees || '',
            generate_meet: !!generateMeet,
        }).eq('id', id).eq('user_id', this.userId).select().single();
        if (error) throw error;
        return this._rule(data);
    }

    async deleteSchedulingRule(id) {
        const { error } = await this.db.from('scheduling_rules').delete()
            .eq('id', id).eq('user_id', this.userId);
        if (error) throw error;
    }

    async updateRuleLastGenerated(id, date) {
        const { error } = await this.db.from('scheduling_rules').update({
            last_generated_until: date
        }).eq('id', id).eq('user_id', this.userId);
        if (error) throw error;
    }
}

window.store = new TSPStore();
