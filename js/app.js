/**
 * TSP App - Controlador da Lógica da Interface
 */

const Toast = {
    show(message, type = 'info', duration = 3500) {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            document.body.appendChild(container);
        }
        const icons = { success: 'check-circle', error: 'x-circle', info: 'info' };
        const el = document.createElement('div');
        el.className = `toast toast-${type}`;
        el.innerHTML = `<i data-lucide="${icons[type] || 'info'}" style="width:16px;height:16px;flex-shrink:0;"></i><span>${message}</span>`;
        container.appendChild(el);
        lucide.createIcons();
        setTimeout(() => {
            el.style.animation = 'toast-out 0.3s ease forwards';
            setTimeout(() => el.remove(), 300);
        }, duration);
    }
};

const spinnerHtml = '<div class="spinner-wrap"><div class="spinner"></div></div>';

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

class AppController {
    constructor() {
        this.currentView = 'dashboard';
        this.selectedClient = null;
        this.selectedMonth = null;
        this.pendingPdfRecords = []; // Armazena temporariamente os registros do PDF lido
        this.agendaCurrentDate = new Date();
        this.agendaViewMode = 'weekly'; // daily or weekly
        this.init();
    }

    init() {
        // Inicializar ícones
        lucide.createIcons();

        // Bind Navegação
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const view = e.currentTarget.getAttribute('data-view');
                this.switchView(view);
            });
        });

        // Configurar Formulários
        document.getElementById('form-client').addEventListener('submit', this.handleClientSubmit.bind(this));
        document.getElementById('form-record').addEventListener('submit', this.handleRecordSubmit.bind(this));
        document.getElementById('form-task').addEventListener('submit', this.handleTaskSubmit.bind(this));
        document.getElementById('form-task-time').addEventListener('submit', this.handleTaskTimeSubmit.bind(this));
        document.getElementById('form-agenda-event').addEventListener('submit', this.handleAgendaSubmit.bind(this));

        // Calculo de tempo automático
        document.getElementById('record-start').addEventListener('input', this.calculateTimeDiff.bind(this));
        document.getElementById('record-end').addEventListener('input', this.calculateTimeDiff.bind(this));

        // Calculo valor do consultor automático
        document.getElementById('client-pays').addEventListener('input', this.calculateConsultantValue.bind(this));

        // Sets default date in record form to today
        document.getElementById('record-date').valueAsDate = new Date();

        // Configurar Importação de PDF
        this.setupPdfImport();

        // Renderizar Views
        this.renderAll();
    }

    // ===================================
    // NAVEGAÇÃO / ROTEAMENTO
    // ===================================
    switchView(viewName) {
        this.currentView = viewName;

        // Update nav UI
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
            if (item.getAttribute('data-view') === viewName) {
                item.classList.add('active');
            }
        });

        // Update sections
        document.querySelectorAll('.view-section').forEach(section => {
            section.classList.remove('active');
            if (section.id === `view-${viewName}`) {
                section.classList.add('active');
            }
        });

        this.renderAll();
    }

    // ===================================
    // MODAIS
    // ===================================
    openModal(modalId) {
        document.getElementById(modalId).classList.add('active');
        if (modalId === 'modal-record' || modalId === 'modal-task' || modalId === 'modal-agenda-event') {
            this.updateClientSelects();
        }
        if (modalId === 'modal-task') {
            if (!document.getElementById('task-id').value) {
                document.getElementById('task-status').value = 'new';
                document.getElementById('task-priority').value = 'medium';
            }
        }
        if (modalId === 'modal-agenda-event') {
            this.updateAgendaTaskSelect();
            if (!document.getElementById('agenda-id').value) {
                document.getElementById('agenda-date').valueAsDate = new Date();
            }
        }
    }

    closeModal(modalId) {
        document.getElementById(modalId).classList.remove('active');

        if (modalId === 'modal-client') {
            document.getElementById('form-client').reset();
            document.getElementById('client-id').value = '';
            document.getElementById('modal-client-title').innerText = 'Novo Cliente';
        }
        if (modalId === 'modal-task') {
            document.getElementById('form-task').reset();
            document.getElementById('task-id').value = '';
            document.getElementById('modal-task-title').innerText = 'Nova Tarefa';
        }
        if (modalId === 'modal-task-time') {
            document.getElementById('form-task-time').reset();
            document.getElementById('time-task-id').value = '';
        }
        if (modalId === 'modal-agenda-event') {
            document.getElementById('form-agenda-event').reset();
            document.getElementById('agenda-id').value = '';
            document.getElementById('modal-agenda-title').innerText = 'Novo Agendamento';
        }
    }

    // ===================================
    // FORM SUBMITS
    // ===================================
    async handleClientSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('client-id').value;
        const name = document.getElementById('client-name').value;
        const hours = document.getElementById('client-hours').value;
        const projectNum = document.getElementById('client-project').value;
        const csName = document.getElementById('client-cs').value;
        const clientPays = document.getElementById('client-pays').value;
        const notes = document.getElementById('client-notes').value;
        const status = document.getElementById('client-status').value;
        const btn = e.target.querySelector('[type="submit"]');
        btn.disabled = true;

        try {
            if (id) {
                await store.updateClient(id, name, hours, csName, projectNum, clientPays, notes, status);
            } else {
                await store.addClient(name, hours, csName, projectNum, clientPays, notes, status);
            }
            e.target.reset();
            document.getElementById('client-id').value = '';
            this.closeModal('modal-client');
            await this.renderAll();
            Toast.show(id ? 'Cliente atualizado.' : 'Cliente cadastrado.', 'success');
        } catch (err) {
            Toast.show('Erro ao salvar cliente: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    calculateConsultantValue() {
        const inputPays = document.getElementById('client-pays').value;
        const inputReceives = document.getElementById('consultant-receives');
        if (inputPays && !isNaN(inputPays)) {
            const receivesValue = parseFloat(inputPays) * 0.43;
            inputReceives.value = `R$ ${receivesValue.toFixed(2).replace('.', ',')}`;
        } else {
            inputReceives.value = '';
        }
    }

    calculateTimeDiff() {
        const start = document.getElementById('record-start').value;
        const end = document.getElementById('record-end').value;
        const calcInput = document.getElementById('record-calculated');

        if (start && end) {
            const [startH, startM] = start.split(':').map(Number);
            const [endH, endM] = end.split(':').map(Number);

            let diffMins = (endH * 60 + endM) - (startH * 60 + startM);
            if (diffMins < 0) {
                diffMins += 24 * 60; // Passou da meia noite
            }

            const hours = Math.floor(diffMins / 60);
            const mins = diffMins % 60;

            calcInput.value = `${hours}h ${mins}m (${diffMins} min)`;
            calcInput.dataset.minutes = diffMins;
        } else {
            calcInput.value = '';
            calcInput.dataset.minutes = 0;
        }
    }

    async handleRecordSubmit(e) {
        e.preventDefault();
        const recordId = document.getElementById('record-id').value;
        const clientId = document.getElementById('record-client').value;
        const date = document.getElementById('record-date').value;
        const startTime = document.getElementById('record-start').value;
        const endTime = document.getElementById('record-end').value;
        const minutes = document.getElementById('record-calculated').dataset.minutes;
        const desc = document.getElementById('record-desc').value;

        if (!minutes || minutes <= 0) {
            Toast.show('Preencha horários válidos.', 'error');
            return;
        }

        const btn = e.target.querySelector('[type="submit"]');
        btn.disabled = true;

        try {
            if (recordId) {
                await store.updateRecord(recordId, clientId, date, startTime, endTime, minutes, desc);
            } else {
                await store.addRecord(clientId, date, startTime, endTime, minutes, desc);
            }
            e.target.reset();
            document.getElementById('record-id').value = '';
            document.getElementById('record-calculated').dataset.minutes = 0;
            document.getElementById('record-date').valueAsDate = new Date();
            this.closeModal('modal-record');
            await this.renderAll();
            Toast.show(recordId ? 'Atendimento atualizado.' : 'Atendimento lançado.', 'success');
        } catch (err) {
            Toast.show('Erro ao salvar atendimento: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    async handleDeleteClient(id) {
        if (confirm("Tem certeza que deseja excluir este cliente e TODOS os seus atendimentos?")) {
            try {
                await store.deleteClient(id);
                await this.renderAll();
                Toast.show('Cliente excluído.', 'success');
            } catch (err) {
                Toast.show('Erro ao excluir cliente: ' + err.message, 'error');
            }
        }
    }

    async handleDeleteRecord(id) {
        if (confirm("Deseja realmente apagar este lançamento?")) {
            try {
                await store.deleteRecord(id);
                await this.renderAll();
                Toast.show('Atendimento excluído.', 'success');
            } catch (err) {
                Toast.show('Erro ao excluir atendimento: ' + err.message, 'error');
            }
        }
    }

    async handleEditRecord(id) {
        const r = await store.getRecord(id);
        if (!r) return;
        document.getElementById('record-id').value = r.id;
        document.getElementById('record-client').value = r.clientId;
        document.getElementById('record-date').value = r.date;
        document.getElementById('record-start').value = r.startTime;
        document.getElementById('record-end').value = r.endTime;
        document.getElementById('record-desc').value = r.description;

        document.getElementById('record-calculated').value = r.minutes + ' min';
        document.getElementById('record-calculated').dataset.minutes = r.minutes;

        this.openModal('modal-record');
    }

    async handleViewRecord(id) {
        const r = await store.getRecord(id);
        if (!r) return;
        const client = await store.getClient(r.clientId);

        document.getElementById('view-record-client').value = client ? client.name : '<Deletado>';
        document.getElementById('view-record-date').value = r.date.split('-').reverse().join('/');
        document.getElementById('view-record-time').value = r.minutes + ' minutos';

        const timeRange = (r.startTime && r.endTime) ? `${r.startTime} às ${r.endTime}` : 'N/A';
        document.getElementById('view-record-range').value = timeRange;
        document.getElementById('view-record-desc').value = r.description;

        this.openModal('modal-view-record');
    }

    // ===================================
    // TAREFAS (Ações e Submits)
    // ===================================
    async handleTaskSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('task-id').value;
        const clientId = document.getElementById('task-client').value;
        const title = document.getElementById('task-title').value;
        const desc = document.getElementById('task-desc').value;
        const priority = document.getElementById('task-priority').value;
        const dueDate = document.getElementById('task-due-date').value;
        const estimated = document.getElementById('task-estimated').value;
        const status = document.getElementById('task-status').value;
        const attachmentsInput = document.getElementById('task-attachments');
        let attachments = [];

        if (attachmentsInput.files && attachmentsInput.files.length > 0) {
            for (let i = 0; i < attachmentsInput.files.length; i++) {
                attachments.push(attachmentsInput.files[i].name);
            }
        }

        const taskData = {
            clientId,
            title,
            description: desc,
            status,
            priority,
            dueDate,
            estimatedMinutes: estimated,
            attachments
        };

        const btn = e.target.querySelector('[type="submit"]');
        btn.disabled = true;

        try {
            if (id) {
                taskData.id = id;
                await store.updateTask(taskData);
            } else {
                await store.addTask(taskData);
            }
            this.closeModal('modal-task');
            await this.renderAll();
            Toast.show(id ? 'Tarefa atualizada.' : 'Tarefa criada.', 'success');
        } catch (err) {
            Toast.show('Erro ao salvar tarefa: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    async handleTaskTimeSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('time-task-id').value;
        const minutes = document.getElementById('time-task-minutes').value;

        if (id && minutes) {
            const btn = e.target.querySelector('[type="submit"]');
            btn.disabled = true;
            try {
                await store.addTaskTime(id, minutes);
                this.closeModal('modal-task-time');
                await this.renderAll();
                Toast.show('Tempo adicionado.', 'success');
            } catch (err) {
                Toast.show('Erro ao registrar tempo: ' + err.message, 'error');
            } finally {
                btn.disabled = false;
            }
        }
    }

    async handleEditTask(id) {
        const t = await store.getTask(id);
        if (!t) return;
        document.getElementById('modal-task-title').innerText = 'Editar Tarefa';
        document.getElementById('task-id').value = t.id;
        document.getElementById('task-client').value = t.clientId;
        document.getElementById('task-title').value = t.title;
        document.getElementById('task-desc').value = t.description;
        document.getElementById('task-priority').value = t.priority;
        document.getElementById('task-due-date').value = t.dueDate;
        document.getElementById('task-estimated').value = t.estimatedMinutes || '';
        document.getElementById('task-status').value = t.status;

        this.openModal('modal-task');
    }

    async handleDeleteTask(id) {
        if (confirm("Deseja realmente apagar esta tarefa?")) {
            try {
                await store.deleteTask(id);
                await this.renderAll();
                Toast.show('Tarefa excluída.', 'success');
            } catch (err) {
                Toast.show('Erro ao excluir tarefa: ' + err.message, 'error');
            }
        }
    }

    handleOpenTaskTime(id) {
        document.getElementById('time-task-id').value = id;
        this.openModal('modal-task-time');
    }

    // Drag and Drop Tarefas
    dragStart(e) {
        e.dataTransfer.setData('text/plain', e.currentTarget.dataset.id);
        setTimeout(() => e.target.classList.add('dragging'), 0);
    }

    dragEnd(e) {
        e.target.classList.remove('dragging');
        document.querySelectorAll('.kanban-dropzone').forEach(zone => {
            zone.classList.remove('drag-over');
        });
    }

    allowDrop(e) {
        e.preventDefault();
        if (e.currentTarget.classList.contains('kanban-dropzone')) {
            e.currentTarget.classList.add('drag-over');
        }
    }

    async dropTask(e) {
        e.preventDefault();
        const dropzone = e.currentTarget;
        dropzone.classList.remove('drag-over');

        const taskId = e.dataTransfer.getData('text/plain');
        const newStatus = dropzone.dataset.status;

        if (taskId && newStatus) {
            await store.updateTaskStatus(taskId, newStatus);
            await this.renderAll();
        }
    }

    // Chamado após login bem-sucedido
    async initAfterAuth() {
        this.checkLocalStorageMigration();
        const settings = await store.getUserSettings();
        if (settings && settings.googleClientId && settings.googleApiKey) {
            await calendarAPI.configure(settings.googleClientId, settings.googleApiKey);
        }
        await this.renderAll();
    }

    // ===================================
    // RENDERS
    // ===================================
    async renderAll() {
        await this.updateClientSelects();
        await Promise.all([
            this.renderDashboard(),
            this.renderClients(),
            this.renderRecords(),
            this.renderClientDashboard(),
            this.renderMonthRecords(),
            this.renderTasks(),
            this.renderAgenda()
        ]);
        lucide.createIcons();
    }

    async renderDashboard() {
        const container = document.getElementById('dashboard-container');
        container.innerHTML = spinnerHtml;

        let showActive = true;
        let showFinished = false;

        const filterActiveEl = document.getElementById('dash-filter-active');
        const filterFinishedEl = document.getElementById('dash-filter-finished');
        if (filterActiveEl) showActive = filterActiveEl.checked;
        if (filterFinishedEl) showFinished = filterFinishedEl.checked;

        const allClients = await store.getClients();
        const clients = allClients.filter(c => {
            const status = c.status || 'active';
            if (status === 'active' && showActive) return true;
            if (status === 'finished' && showFinished) return true;
            return false;
        });

        const today = new Date();
        const currentYearMonth = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, '0');
        let stats = await Promise.all(clients.map(c => store.getClientStats(c.id, currentYearMonth)));
        stats = stats.filter(s => s !== null);

        container.innerHTML = '';

        if (stats.length === 0) {
            container.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 40px;" class="glass">
                    <p class="text-muted">Nenhum cliente cadastrado ainda.</p>
                </div>
            `;
            return;
        }

        stats.forEach(stat => {
            const isCritical = stat.isOverLimit ? 'over-limit' : '';
            const statusColor = stat.isOverLimit ? 'var(--danger-color)' : 'var(--primary-color)';

            const card = document.createElement('div');
            card.className = 'stat-card glass';
            card.style.cursor = 'pointer';
            card.onclick = () => app.openClientDashboard(stat.client.id);

            card.innerHTML = `
                <div class="stat-header">
                    <span class="client-name">${escapeHtml(stat.client.name)}</span>
                    <span style="font-weight: 600; color: ${statusColor}">${stat.hoursUsed}h / ${stat.hoursTotal}h</span>
                </div>
                <div class="progress-container">
                    <div class="progress-bar ${isCritical}" style="width: ${stat.percentage}%;"></div>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-top: 8px;">
                    <span class="text-muted">${stat.percentage}% utilizado</span>
                    <span class="text-muted">${stat.hoursRemaining}h restantes</span>
                </div>
            `;
            container.appendChild(card);
        });
    }

    async renderClients() {
        const tbody = document.querySelector('#clients-table tbody');
        tbody.innerHTML = `<tr><td colspan="3">${spinnerHtml}</td></tr>`;
        const clients = await store.getClients();
        tbody.innerHTML = '';

        if (clients.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="text-muted" style="text-align: center;">Nenhum cliente encontrado.</td></tr>`;
            return;
        }

        for (const c of clients) {
            const tr = document.createElement('tr');
            const stat = await store.getClientStats(c.id);
            const overLimitBadge = stat && stat.isOverLimit ? `<span style="background: var(--danger-color); color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; margin-left: 8px;">Estourado</span>` : '';

            // Formatador de Moeda
            const formatMoney = (val) => {
                return (val && !isNaN(val)) ? `R$ ${parseFloat(val).toFixed(2).replace('.', ',')}` : 'R$ 0,00';
            };

            const clientPaysStr = formatMoney(c.clientPays);
            const consultantReceives = (c.clientPays && !isNaN(c.clientPays)) ? formatMoney(c.clientPays * 0.43) : 'R$ 0,00';
            const detailsHtml = `
                <div style="font-size: 0.85rem; margin-top: 4px; color: var(--text-muted)">
                    <span><strong>CS:</strong> ${escapeHtml(c.csName) || '-'}</span> |
                    <span><strong>Proj:</strong> ${escapeHtml(c.projectNum) || '-'}</span> <br>
                    <span><strong>Paga:</strong> ${clientPaysStr}</span> |
                    <span><strong>Recebe:</strong> ${consultantReceives}</span>
                    <div style="margin-top:2px; font-style:italic; font-size: 0.8rem">Obs: ${escapeHtml(c.notes) || '-'}</div>
                </div>
            `;

            tr.innerHTML = `
                <td>
                    <strong>${escapeHtml(c.name)}</strong> ${overLimitBadge}
                    ${detailsHtml}
                </td>
                <td style="vertical-align: top; padding-top: 20px;">${c.hoursTotal}h</td>
                <td style="vertical-align: top; padding-top: 16px;">
                    <div style="display: flex; gap: 8px;">
                        <button class="btn btn-secondary" onclick="app.openEditClientModal('${c.id}')" style="padding: 6px 12px; font-size: 0.8rem;">
                            <i data-lucide="edit-2" style="width: 16px; height: 16px;"></i> Editar
                        </button>
                        <button class="btn btn-danger" onclick="app.handleDeleteClient('${c.id}')" style="padding: 6px 12px; font-size: 0.8rem;">
                            <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i> Apagar
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        }
    }

    async openEditClientModal(id) {
        const client = await store.getClient(id);
        if (!client) return;

        document.getElementById('modal-client-title').innerText = 'Editar Cliente';
        document.getElementById('client-id').value = client.id;
        document.getElementById('client-name').value = client.name;
        document.getElementById('client-hours').value = client.hoursTotal;
        document.getElementById('client-project').value = client.projectNum || '';
        document.getElementById('client-cs').value = client.csName || '';
        document.getElementById('client-pays').value = client.clientPays || '';
        document.getElementById('client-notes').value = client.notes || '';
        document.getElementById('client-status').value = client.status || 'active';

        // Recalcular recebimento no modal ao abrir para edição
        this.calculateConsultantValue();

        this.openModal('modal-client');
    }

    async renderRecords() {
        const tbody = document.querySelector('#records-table tbody');
        tbody.innerHTML = `<tr><td colspan="5">${spinnerHtml}</td></tr>`;
        let records = (await store.getRecords()).sort((a, b) => new Date(b.date) - new Date(a.date));

        // APERFEIÇOAMENTO: Filtros da Interface
        const filterClient = document.getElementById('filter-client')?.value;
        const filterStart = document.getElementById('filter-date-start')?.value;
        const filterEnd = document.getElementById('filter-date-end')?.value;

        if (filterClient) {
            records = records.filter(r => r.clientId === filterClient);
        }
        if (filterStart) {
            records = records.filter(r => new Date(r.date) >= new Date(filterStart));
        }
        if (filterEnd) {
            records = records.filter(r => new Date(r.date) <= new Date(filterEnd));
        }

        tbody.innerHTML = '';

        if (records.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-muted" style="text-align: center;">Nenhum atendimento lançado.</td></tr>`;
            return;
        }

        const clientsMap = {};
        for (const r of records) {
            if (r.clientId && !clientsMap[r.clientId]) {
                clientsMap[r.clientId] = await store.getClient(r.clientId);
            }
        }

        records.forEach(r => {
            const client = clientsMap[r.clientId];
            const clientName = client ? escapeHtml(client.name) : '&lt;Deletado&gt;';
            const hoursStr = (r.minutes / 60).toFixed(2) + 'h';
            const timeRange = (r.startTime && r.endTime) ? `<br><small class="text-muted">${r.startTime} às ${r.endTime}</small>` : '';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${r.date.split('-').reverse().join('/')}${timeRange}</td>
                <td><strong>${clientName}</strong></td>
                <td>${escapeHtml(r.description)}</td>
                <td>${r.minutes} min <span class="text-muted">(${hoursStr})</span></td>
                <td>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn btn-secondary" onclick="app.handleViewRecord('${r.id}')" style="padding: 6px 10px; font-size: 0.8rem;" title="Visualizar">
                            <i data-lucide="eye" style="width: 16px; height: 16px;"></i>
                        </button>
                        <button class="btn btn-primary" onclick="app.handleEditRecord('${r.id}')" style="padding: 6px 10px; font-size: 0.8rem;" title="Editar">
                            <i data-lucide="pencil" style="width: 16px; height: 16px;"></i>
                        </button>
                        <button class="btn btn-danger" onclick="app.handleDeleteRecord('${r.id}')" style="padding: 6px 10px; font-size: 0.8rem;" title="Apagar">
                            <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    async updateClientSelects() {
        const selects = [
            document.getElementById('record-client'),
            document.getElementById('filter-client'),
            document.getElementById('task-client'),
            document.getElementById('filter-task-client'),
            document.getElementById('agenda-client')
        ];

        const clients = await store.getClients();

        selects.forEach(select => {
            if (!select) return;

            // SALVA O VALOR ATUAL ANTES DE LIMPAR O CONTEÚDO
            const currentValue = select.value;

            const isFilter = select.id === 'filter-client';
            select.innerHTML = isFilter
                ? '<option value="">Todos os Clientes</option>'
                : '<option value="" disabled selected>-- Escolha um cliente --</option>';

            clients.forEach(c => {
                const option = document.createElement('option');
                option.value = c.id;
                option.textContent = c.name;
                select.appendChild(option);
            });

            // RESTAURA O VALOR SALVO
            if (currentValue) {
                select.value = currentValue;
            }
        });
    }

    async clearFilters() {
        if (document.getElementById('filter-client')) document.getElementById('filter-client').value = '';
        if (document.getElementById('filter-date-start')) document.getElementById('filter-date-start').value = '';
        if (document.getElementById('filter-date-end')) document.getElementById('filter-date-end').value = '';
        await this.renderAll();
    }

    async exportFilteredToPDF() {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        let records = (await store.getRecords()).sort((a, b) => new Date(b.date) - new Date(a.date));

        const filterClient = document.getElementById('filter-client')?.value;
        const filterStart = document.getElementById('filter-date-start')?.value;
        const filterEnd = document.getElementById('filter-date-end')?.value;

        let clientNameHeader = "Todos os Clientes";

        if (filterClient) {
            records = records.filter(r => r.clientId === filterClient);
            const client = await store.getClient(filterClient);
            if (client) {
                clientNameHeader = client.name;
            }
        }
        if (filterStart) {
            records = records.filter(r => new Date(r.date) >= new Date(filterStart));
        }
        if (filterEnd) {
            records = records.filter(r => new Date(r.date) <= new Date(filterEnd));
        }

        if (records.length === 0) {
            Toast.show('Nenhum dado para exportar.', 'info');
            return;
        }

        doc.setFontSize(16);
        doc.text("Relatório de Atendimentos", 14, 20);

        doc.setFontSize(10);
        let subtitle = `Cliente(s): ${clientNameHeader}`;
        let period = "Período: ";
        if (filterStart || filterEnd) {
            period += `${filterStart ? filterStart.split('-').reverse().join('/') : 'Início'} até ${filterEnd ? filterEnd.split('-').reverse().join('/') : 'Atual'}`;
        } else {
            period += "Todo o período";
        }
        doc.text(subtitle, 14, 28);
        doc.text(period, 14, 34);

        const tableColumn = ["Data e Hora", "Cliente", "Descrição da Atividade", "Tempo Gasto"];
        const tableRows = [];

        const clientsMap = {};
        for (const r of records) {
            if (r.clientId && !clientsMap[r.clientId]) {
                clientsMap[r.clientId] = await store.getClient(r.clientId);
            }
        }

        records.forEach(r => {
            const client = clientsMap[r.clientId];
            const clientName = client ? client.name : '<Deletado>';
            const hoursStr = (r.minutes / 60).toFixed(2) + 'h';
            const timeRange = (r.startTime && r.endTime) ? `\n${r.startTime} às ${r.endTime}` : '';

            const dateText = `${r.date.split('-').reverse().join('/')}${timeRange}`;
            const timeText = `${r.minutes} min\n(${hoursStr})`;

            tableRows.push([
                dateText,
                clientName,
                r.description,
                timeText
            ]);
        });

        doc.autoTable({
            startY: 40,
            head: [tableColumn],
            body: tableRows,
            styles: { fontSize: 8 },
            headStyles: { fillColor: [79, 70, 229] },
        });

        const safeClientName = clientNameHeader.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        doc.save(`atendimentos_${safeClientName}_${new Date().getTime()}.pdf`);
    }

    // ===================================
    // CLIENT DASHBOARD (MONTHS)
    // ===================================
    openClientDashboard(clientId) {
        this.selectedClient = clientId;
        this.switchView('client-dashboard');
        // Remove class active de todos os nav-items porque é uma sub-view
        document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    }

    async renderClientDashboard() {
        if (this.currentView !== 'client-dashboard' || !this.selectedClient) return;

        const client = await store.getClient(this.selectedClient);
        if (!client) return;

        document.getElementById('client-dashboard-title').innerText = client.name;

        const container = document.getElementById('client-months-container');
        const monthlyStats = await store.getMonthlyStatsByClient(this.selectedClient);
        container.innerHTML = '';

        if (monthlyStats.length === 0) {
            container.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 40px;" class="glass">
                    <p class="text-muted">Nenhum atendimento lançado para este cliente.</p>
                </div>
            `;
            return;
        }

        monthlyStats.forEach(stat => {
            const hoursUsed = (stat.minutes / 60).toFixed(2);

            const card = document.createElement('div');
            card.className = 'stat-card glass';
            card.style.cursor = 'pointer';
            card.onclick = () => app.openMonthRecords(stat.yearMonth);

            card.innerHTML = `
                <div class="stat-header">
                    <span class="client-name">${escapeHtml(stat.monthName)}</span>
                    <span style="font-weight: 600; color: var(--primary-color)">${hoursUsed}h utilizadas</span>
                </div>
                <div style="margin-top: 12px; font-size: 0.9rem;">
                    <span class="text-muted">${stat.records.length} atendimento(s) neste mês</span>
                </div>
            `;
            container.appendChild(card);
        });
    }

    // ===================================
    // MONTH RECORDS
    // ===================================
    openMonthRecords(yearMonth) {
        this.selectedMonth = yearMonth;
        this.switchView('month-records');
        document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    }

    async renderMonthRecords() {
        if (this.currentView !== 'month-records' || !this.selectedClient || !this.selectedMonth) return;

        const client = await store.getClient(this.selectedClient);
        if (!client) return;

        const monthlyStats = await store.getMonthlyStatsByClient(this.selectedClient);
        const monthData = monthlyStats.find(m => m.yearMonth === this.selectedMonth);

        document.getElementById('month-records-title').innerText = monthData ? monthData.monthName : this.selectedMonth;
        document.getElementById('month-records-subtitle').innerText = `Atendimentos de ${client.name}`;

        const tbody = document.querySelector('#month-records-table tbody');
        tbody.innerHTML = '';

        if (!monthData || monthData.records.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="text-muted" style="text-align: center;">Nenhum atendimento encontrado.</td></tr>`;
            return;
        }

        const records = monthData.records.sort((a, b) => new Date(b.date) - new Date(a.date));

        records.forEach(r => {
            const hoursStr = (r.minutes / 60).toFixed(2) + 'h';
            const timeRange = (r.startTime && r.endTime) ? `<br><small class="text-muted">${r.startTime} às ${r.endTime}</small>` : '';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${r.date.split('-').reverse().join('/')}${timeRange}</td>
                <td>${escapeHtml(r.description)}</td>
                <td>${r.minutes} min <span class="text-muted">(${hoursStr})</span></td>
                <td>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn btn-secondary" onclick="app.handleViewRecord('${r.id}')" style="padding: 6px 10px; font-size: 0.8rem;" title="Visualizar">
                            <i data-lucide="eye" style="width: 16px; height: 16px;"></i>
                        </button>
                        <button class="btn btn-primary" onclick="app.handleEditRecord('${r.id}')" style="padding: 6px 10px; font-size: 0.8rem;" title="Editar">
                            <i data-lucide="pencil" style="width: 16px; height: 16px;"></i>
                        </button>
                        <button class="btn btn-danger" onclick="app.handleDeleteRecord('${r.id}')" style="padding: 6px 10px; font-size: 0.8rem;" title="Apagar">
                            <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    // ===================================
    // KANBAN & TASKS RENDER
    // ===================================
    async renderTasks() {
        if (this.currentView !== 'tasks') return;

        let tasks = await store.getTasks();

        // Filters
        const filterClient = document.getElementById('filter-task-client')?.value;
        const filterPriority = document.getElementById('filter-task-priority')?.value;

        if (filterClient) {
            tasks = tasks.filter(t => t.clientId === filterClient);
        }
        if (filterPriority) {
            tasks = tasks.filter(t => t.priority === filterPriority);
        }

        const cols = {
            new: document.getElementById('kb-col-new'),
            doing: document.getElementById('kb-col-doing'),
            done: document.getElementById('kb-col-done')
        };

        if (!cols.new || !cols.doing || !cols.done) return;

        Object.values(cols).forEach(col => col.innerHTML = spinnerHtml);

        const counts = { new: 0, doing: 0, done: 0 };

        const clientIds = [...new Set(tasks.map(t => t.clientId).filter(Boolean))];
        const clientsMap = {};
        await Promise.all(clientIds.map(async id => { clientsMap[id] = await store.getClient(id); }));

        Object.values(cols).forEach(col => col.innerHTML = '');

        tasks.forEach(task => {
            const client = clientsMap[task.clientId];
            const clientName = client ? escapeHtml(client.name) : '&lt;Desconhecido&gt;';

            const status = task.status || 'new';
            if (counts[status] !== undefined) counts[status]++;

            const card = document.createElement('div');
            card.className = 'task-card';
            card.draggable = true;
            card.dataset.id = task.id;

            card.addEventListener('dragstart', this.dragStart.bind(this));
            card.addEventListener('dragend', this.dragEnd.bind(this));

            let priorityClass = 'priority-low';
            if (task.priority === 'high') priorityClass = 'priority-high';
            if (task.priority === 'medium') priorityClass = 'priority-medium';

            let delayHtml = '';
            if (task.dueDate && task.status !== 'done') {
                const today = new Date().toISOString().split('T')[0];
                if (task.dueDate < today) {
                    delayHtml = `<span class="task-alert"><i data-lucide="alert-circle" style="width: 12px; height: 12px;"></i> Atrasada (${task.dueDate.split('-').reverse().join('/')})</span>`;
                } else {
                    delayHtml = `<span>Prazo: ${task.dueDate.split('-').reverse().join('/')}</span>`;
                }
            }

            const estMinutes = parseInt(task.estimatedMinutes) || 0;
            const spentMinutes = parseInt(task.spentMinutes) || 0;
            const timeInfo = (estMinutes > 0 || spentMinutes > 0) ? `<span><i data-lucide="clock" style="width: 12px; height: 12px;"></i> ${spentMinutes}m / ${estMinutes}m</span>` : '';

            let attachmentsHtml = '';
            if (task.attachments && task.attachments.length > 0) {
                attachmentsHtml = `<span><i data-lucide="paperclip" style="width: 12px; height: 12px;"></i> ${task.attachments.length} anexo(s)</span>`;
            }

            card.innerHTML = `
                <div class="task-priority-bar ${priorityClass}"></div>
                <div class="task-title">${escapeHtml(task.title)}</div>
                <div class="task-client-name">${clientName}</div>
                <div class="task-meta">
                    ${delayHtml ? `<div>${delayHtml}</div>` : ''}
                    ${timeInfo ? `<div>${timeInfo}</div>` : ''}
                    ${attachmentsHtml ? `<div>${attachmentsHtml}</div>` : ''}
                </div>
                <div class="task-actions" style="margin-top: 8px;">
                    <button type="button" onclick="app.handleEditTask('${task.id}')" title="Editar"><i data-lucide="pencil" style="width: 14px; height: 14px;"></i></button>
                    ${task.status !== 'done' ? `<button type="button" onclick="app.handleOpenTaskTime('${task.id}')" title="Adicionar Tempo"><i data-lucide="play" style="width: 14px; height: 14px;"></i></button>` : ''}
                    <button type="button" onclick="app.handleDeleteTask('${task.id}')" title="Excluir"><i data-lucide="trash-2" style="width: 14px; height: 14px;"></i></button>
                </div>
            `;

            if (cols[status]) cols[status].appendChild(card);
        });

        document.getElementById('kanban-count-new').innerText = counts.new;
        document.getElementById('kanban-count-doing').innerText = counts.doing;
        document.getElementById('kanban-count-done').innerText = counts.done;

        await this.renderTasksDashboard(tasks, filterClient);
        lucide.createIcons();
    }

    async renderTasksDashboard(tasks, filteredClientId) {
        const container = document.getElementById('tasks-dashboard-container');
        if (!container) return;

        const openTasks = tasks.filter(t => t.status !== 'done');
        let delayed = 0;
        let totalEst = 0;
        let totalSpent = 0;

        const today = new Date().toISOString().split('T')[0];

        openTasks.forEach(t => {
            if (t.dueDate && t.dueDate < today) delayed++;
            totalEst += parseInt(t.estimatedMinutes) || 0;
            totalSpent += parseInt(t.spentMinutes) || 0;
        });

        const stats = await store.getAllStats();
        const overLimitClients = stats.filter(s => s.isOverLimit);

        container.innerHTML = `
            <div class="stat-card glass" style="padding: 16px;">
                <div class="stat-header">
                    <span class="client-name">Abertas</span>
                    <span style="font-size: 1.5rem; color: var(--primary-color)">${openTasks.length}</span>
                </div>
            </div>
            <div class="stat-card glass" style="padding: 16px;">
                <div class="stat-header">
                    <span class="client-name">Atrasadas</span>
                    <span style="font-size: 1.5rem; color: ${delayed > 0 ? 'var(--danger-color)' : 'var(--success-color)'}">${delayed}</span>
                </div>
            </div>
            <div class="stat-card glass" style="padding: 16px;">
                <div class="stat-header">
                    <span class="client-name">Tempo (Gasto / Estimado)</span>
                    <span style="font-size: 1.2rem; color: var(--text-main)">${(totalSpent / 60).toFixed(1)}h / ${(totalEst / 60).toFixed(1)}h</span>
                </div>
            </div>
            ${!filteredClientId ? `
            <div class="stat-card glass" style="padding: 16px;">
                <div class="stat-header">
                    <span class="client-name" style="color: var(--danger-color)">Contratos Sobrecarregados</span>
                    <span style="font-size: 1.2rem;">${overLimitClients.length}</span>
                </div>
            </div>` : ''}
        `;
    }

    // ===================================
    // AGENDA
    // ===================================
    async switchAgendaMode(mode) {
        this.agendaViewMode = mode;
        document.getElementById('btn-agenda-weekly').classList.toggle('active-mode', mode === 'weekly');
        document.getElementById('btn-agenda-daily').classList.toggle('active-mode', mode === 'daily');
        await this.renderAgenda();
    }

    async prevAgendaDate() {
        if (this.agendaViewMode === 'daily') {
            this.agendaCurrentDate.setDate(this.agendaCurrentDate.getDate() - 1);
        } else {
            this.agendaCurrentDate.setDate(this.agendaCurrentDate.getDate() - 7);
        }
        await this.renderAgenda();
    }

    async nextAgendaDate() {
        if (this.agendaViewMode === 'daily') {
            this.agendaCurrentDate.setDate(this.agendaCurrentDate.getDate() + 1);
        } else {
            this.agendaCurrentDate.setDate(this.agendaCurrentDate.getDate() + 7);
        }
        await this.renderAgenda();
    }

    async updateAgendaTaskSelect() {
        const select = document.getElementById('agenda-task');
        if (!select) return;
        select.innerHTML = '<option value="">-- Nenhuma tarefa vinculada --</option>';
        const tasks = (await store.getTasks()).filter(t => t.status !== 'done');
        tasks.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.title;
            select.appendChild(opt);
        });
    }

    async handleAgendaSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('agenda-id').value;
        const btn = e.submitter || document.querySelector('#form-agenda-event button[type="submit"]');
        const originalText = btn.innerText;

        const eventData = {
            title: document.getElementById('agenda-title').value,
            description: document.getElementById('agenda-desc').value,
            type: document.getElementById('agenda-type').value,
            clientId: document.getElementById('agenda-client').value || null,
            relatedTaskId: document.getElementById('agenda-task').value || null,
            date: document.getElementById('agenda-date').value,
            startTime: document.getElementById('agenda-start').value,
            endTime: document.getElementById('agenda-end').value,
            location: document.getElementById('agenda-location').value
        };

        const syncGoogle = document.getElementById('agenda-sync-google').checked;

        btn.innerText = "Salvando...";
        btn.disabled = true;

        if (syncGoogle) {
            if (!calendarAPI.isAuthenticated) {
                const success = await calendarAPI.authenticateGoogle();
                if (!success) {
                    Toast.show('Falha na autenticação do Google.', 'error');
                    btn.innerText = originalText;
                    btn.disabled = false;
                    return;
                }
            }
        }

        try {
            if (id) {
                eventData.id = id;
                const updated = await store.updateAgendaEvent(eventData);
                if (syncGoogle && updated && updated.calendarEventId) {
                    await calendarAPI.updateGoogleEvent(updated.calendarEventId, eventData);
                }
            } else {
                if (syncGoogle) {
                    const gCalId = await calendarAPI.createGoogleEvent(eventData);
                    if (gCalId) eventData.calendarEventId = gCalId;
                }
                await store.addAgendaEvent(eventData);
            }
            this.closeModal('modal-agenda-event');
            await this.renderAgenda();
            Toast.show(id ? 'Agendamento atualizado.' : 'Agendamento criado.', 'success');
        } catch (err) {
            Toast.show('Erro ao salvar agendamento: ' + err.message, 'error');
        } finally {
            btn.innerText = originalText;
            btn.disabled = false;
        }
    }

    async editAgendaEvent(id) {
        const ev = await store.getAgendaEvent(id);
        if (!ev) return;

        document.getElementById('modal-agenda-title').innerText = 'Editar Agendamento';
        document.getElementById('agenda-id').value = ev.id;
        document.getElementById('agenda-title').value = ev.title;
        document.getElementById('agenda-desc').value = ev.description;
        document.getElementById('agenda-type').value = ev.type;
        document.getElementById('agenda-client').value = ev.clientId || '';
        this.updateAgendaTaskSelect();
        document.getElementById('agenda-task').value = ev.relatedTaskId || '';
        document.getElementById('agenda-date').value = ev.date;
        document.getElementById('agenda-start').value = ev.startTime;
        document.getElementById('agenda-end').value = ev.endTime;
        document.getElementById('agenda-location').value = ev.location;

        this.openModal('modal-agenda-event');
    }

    async deleteAgendaEvent(id, eventRoot) {
        if (eventRoot) {
            eventRoot.stopPropagation();
        }
        if (confirm("Deseja deletar este agendamento?")) {
            try {
                const ev = await store.getAgendaEvent(id);
                if (ev && ev.calendarEventId && calendarAPI.isAuthenticated) {
                    await calendarAPI.deleteGoogleEvent(ev.calendarEventId);
                }
                await store.deleteAgendaEvent(id);
                await this.renderAgenda();
                Toast.show('Agendamento excluído.', 'success');
            } catch (err) {
                Toast.show('Erro ao excluir agendamento: ' + err.message, 'error');
            }
        }
    }

    async renderAgenda() {
        if (this.currentView !== 'agenda') return;

        const container = document.getElementById('agenda-container');
        if (!container) return;

        container.innerHTML = spinnerHtml;

        // Atualizar estado do botão de sync superior
        const syncBtn = document.getElementById('btn-agenda-sync');
        if (syncBtn) {
            if (calendarAPI && calendarAPI.isAuthenticated) {
                syncBtn.classList.remove('btn-secondary');
                syncBtn.classList.add('btn-primary');
                syncBtn.innerHTML = '<i data-lucide="refresh-cw"></i> Sincronizando...';
                syncBtn.innerHTML = '<i data-lucide="refresh-cw"></i> Sincronizar Google';
            }
        }

        if (this.agendaViewMode === 'daily') {
            await this.renderAgendaDaily(container);
        } else {
            await this.renderAgendaWeekly(container);
        }
        lucide.createIcons();
    }

    getTopPositionForTime(timeStr) {
        // Assume agenda starts at 08:00
        const [h, m] = timeStr.split(':').map(Number);
        const startHour = 8;
        const totalMinutes = ((h - startHour) * 60) + m;
        // 1 hour = 60px height
        return Math.max(0, totalMinutes);
    }

    getHeightForTimeRange(startStr, endStr) {
        const [sH, sM] = startStr.split(':').map(Number);
        const [eH, eM] = endStr.split(':').map(Number);
        let diffMins = (eH * 60 + eM) - (sH * 60 + sM);
        if (diffMins < 0) diffMins += 24 * 60;
        return Math.max(30, diffMins); // min 30px height = 30min
    }

    generateTimeSlots() {
        let html = '';
        for (let i = 8; i <= 20; i++) {
            html += `<div class="agenda-time-slot">${String(i).padStart(2, '0')}:00</div>`;
        }
        return html;
    }

    formatDateBR(dateObj) {
        return dateObj.toLocaleDateString('pt-BR');
    }

    getMonday(d) {
        const date = new Date(d);
        const day = date.getDay();
        const diff = date.getDate() - day + (day === 0 ? -6 : 1);
        return new Date(date.setDate(diff));
    }

    async renderAgendaDaily(container) {
        document.getElementById('agenda-current-date-label').innerText = this.formatDateBR(this.agendaCurrentDate);

        const isoDate = this.agendaCurrentDate.toISOString().split('T')[0];
        const events = await store.getEventsByDate(isoDate);

        const clientIds = [...new Set(events.map(e => e.clientId).filter(Boolean))];
        const clientsMap = {};
        await Promise.all(clientIds.map(async id => { clientsMap[id] = await store.getClient(id); }));

        let eventsHtml = '';
        events.forEach(ev => {
            eventsHtml += this.createEventBlockHtml(ev, '100%', clientsMap);
        });

        container.innerHTML = `
            <div class="agenda-grid">
                <div class="agenda-time-column">
                    ${this.generateTimeSlots()}
                </div>
                <div class="agenda-content-column">
                    <div class="agenda-days-row" style="grid-template-columns: 1fr;">
                        <div class="agenda-day-header active">${this.formatDateBR(this.agendaCurrentDate)}</div>
                    </div>
                    <div class="events-container">
                        <div class="agenda-grid-lines"></div>
                        ${eventsHtml}
                    </div>
                </div>
            </div>
        `;
    }

    async renderAgendaWeekly(container) {
        const monday = this.getMonday(this.agendaCurrentDate);
        const friday = new Date(monday);
        friday.setDate(friday.getDate() + 4);

        const isoStart = monday.toISOString().split('T')[0];
        const isoEnd = friday.toISOString().split('T')[0];

        document.getElementById('agenda-current-date-label').innerText =
            `${this.formatDateBR(monday)} - ${this.formatDateBR(friday)}`;

        const events = await store.getEventsByWeek(isoStart, isoEnd);

        const clientIds = [...new Set(events.map(e => e.clientId).filter(Boolean))];
        const clientsMap = {};
        await Promise.all(clientIds.map(async id => { clientsMap[id] = await store.getClient(id); }));

        const days = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];
        let headersHtml = '';
        let columnsHtml = '';

        for (let i = 0; i < 5; i++) {
            const currentDay = new Date(monday);
            currentDay.setDate(monday.getDate() + i);
            const isoCurrentDay = currentDay.toISOString().split('T')[0];
            const isToday = isoCurrentDay === new Date().toISOString().split('T')[0];

            headersHtml += `<div class="agenda-day-header ${isToday ? 'active' : ''}">${days[i]}<br><small>${currentDay.getDate()}/${currentDay.getMonth() + 1}</small></div>`;

            // Filter events for this day
            const dayEvents = events.filter(e => e.date === isoCurrentDay);
            let dayEventsHtml = '';
            dayEvents.forEach(ev => {
                dayEventsHtml += this.createEventBlockHtml(ev, 'calc(100% - 8px)', clientsMap);
            });

            columnsHtml += `
                <div style="position: relative; height: 100%;">
                    ${dayEventsHtml}
                </div>
            `;
        }

        container.innerHTML = `
            <div class="agenda-grid">
                <div class="agenda-time-column">
                    ${this.generateTimeSlots()}
                </div>
                <div class="agenda-content-column">
                    <div class="agenda-days-row">
                        ${headersHtml}
                    </div>
                    <div class="events-container" style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px;">
                        <div class="agenda-grid-lines"></div>
                        ${columnsHtml}
                    </div>
                </div>
            </div>
        `;
    }

    createEventBlockHtml(ev, width, clientsMap = {}) {
        const top = this.getTopPositionForTime(ev.startTime);
        const height = this.getHeightForTimeRange(ev.startTime, ev.endTime);
        const typeClass = 'type-' + ev.type;

        let clientName = '';
        if (ev.clientId) {
            const client = clientsMap[ev.clientId];
            if (client) clientName = `<div style="display:flex; align-items:center; gap:4px;"><i data-lucide="user" style="width:10px; height:10px;"></i> ${escapeHtml(client.name)}</div>`;
        }

        return `
            <div class="event-block ${typeClass}"
                 style="top: ${top}px; height: ${height}px; width: ${width};"
                 onclick="app.editAgendaEvent('${ev.id}')">

                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div class="event-title">${escapeHtml(ev.title)}</div>
                    <button class="btn btn-danger" style="padding: 2px 4px; font-size: 0.6rem; border-radius: 4px; background: rgba(0,0,0,0.3); border:none; color:white;"
                            onclick="app.deleteAgendaEvent('${ev.id}', event)">
                        <i data-lucide="x" style="width: 12px; height: 12px;"></i>
                    </button>
                </div>
                <div class="event-meta">
                    <div style="display:flex; align-items:center; gap:4px;">
                       <i data-lucide="clock" style="width:10px; height:10px;"></i> 
                       ${ev.startTime} - ${ev.endTime}
                       ${ev.calendarEventId ? '<i data-lucide="calendar" style="width:10px; height:10px; margin-left:4px; color:#60a5fa;" title="Sincronizado via Google"></i>' : ''}
                    </div>
                    ${clientName}
                </div>
            </div>
        `;
    }

    async onCalendarAuthenticated() {
        console.log("App ciente que Calendar está autenticado");
        await this.renderAgenda();
    }

    async promptGoogleSync() {
        const btn = document.getElementById('btn-agenda-sync');
        if (!btn) return;

        if (!calendarAPI.isAuthenticated) {
            const success = await calendarAPI.authenticateGoogle();
            if (!success) {
                Toast.show('Falha na autenticação do Google.', 'error');
                return;
            }
        }

        btn.innerHTML = '<i data-lucide="loader" class="spin"></i> Buscando...';
        btn.disabled = true;

        try {
            await this.executeBiDirectionalSync();
            Toast.show('Sincronização concluída com sucesso!', 'success');
        } catch (error) {
            console.error("Erro no sync", error);
            Toast.show('Erro durante a sincronização.', 'error');
        } finally {
            btn.innerHTML = '<i data-lucide="refresh-cw"></i> Sincronizar Google';
            btn.disabled = false;
            this.renderAgenda();
        }
    }

    async executeBiDirectionalSync() {
        // Fetch do google (ultimos 30 dias até proximos 30)
        const googleEvents = await calendarAPI.syncEventsFromGoogle(30);
        if (!googleEvents) return;

        const localEvents = await store.getAgendaEvents();

        // 1. O que tem no Google que não temos (ou foi atualizado lá)
        for (const gEv of googleEvents) {
            if (gEv.status === 'cancelled') continue;

            // Procura localmente pelo ID do google
            let match = localEvents.find(le => le.calendarEventId === gEv.id);

            let evDate = '';
            let evStart = '08:00';
            let evEnd = '09:00';

            // Google lida com dateTime e date (allDay)
            if (gEv.start.dateTime) {
                const startObj = new Date(gEv.start.dateTime);
                const endObj = new Date(gEv.end.dateTime);

                // Formata local YYYY-MM-DD
                evDate = startObj.getFullYear() + "-" + String(startObj.getMonth() + 1).padStart(2, '0') + "-" + String(startObj.getDate()).padStart(2, '0');
                evStart = String(startObj.getHours()).padStart(2, '0') + ":" + String(startObj.getMinutes()).padStart(2, '0');
                evEnd = String(endObj.getHours()).padStart(2, '0') + ":" + String(endObj.getMinutes()).padStart(2, '0');
            } else if (gEv.start.date) {
                evDate = gEv.start.date; // YYYY-MM-DD already
            }

            if (!evDate) continue; // Pula se n conseguir extrair data

            const mappedData = {
                title: gEv.summary || 'Sem Título',
                description: gEv.description || '',
                type: 'meeting',
                location: gEv.location || '',
                date: evDate,
                startTime: evStart,
                endTime: evEnd,
                calendarEventId: gEv.id
            };

            if (match) {
                mappedData.id = match.id;
                mappedData.type = match.type; // Preserva o tipo customizado do TSP
                mappedData.clientId = match.clientId;
                mappedData.relatedTaskId = match.relatedTaskId;
                await store.updateAgendaEvent(mappedData);
            } else {
                await store.addAgendaEvent(mappedData);
            }
        }

        // 2. Idealmente tb empurra o que criamos offline com a flag de sync mas
        // para essa versão dependemos do modal "Sincronizar [x]" fazer o PUSH unitario.
        // Se deletaram no google, poderiamos deletar aqui também cruzando IDs
        // Simplificado: Assumimos GAPI sync unilateral PULL e local edits dão PUSH
    }

    // ===================================
    // IMPORTAÇÃO DE PDF (ATA)
    // ===================================
    setupPdfImport() {
        const btnImportPdf = document.getElementById('btn-import-pdf');
        const fileImportPdf = document.getElementById('file-import-pdf');

        if (!btnImportPdf || !fileImportPdf) return;

        btnImportPdf.addEventListener('click', () => {
            fileImportPdf.click();
        });

        fileImportPdf.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const originalHtml = btnImportPdf.innerHTML;
            const setBtn = (html) => { btnImportPdf.innerHTML = html; };
            const spinner = `<div class="spinner" style="width:14px;height:14px;border-width:2px;flex-shrink:0;"></div>`;
            btnImportPdf.disabled = true;

            try {
                pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

                setBtn(`<span style="display:inline-flex;align-items:center;gap:8px;">${spinner}Carregando PDF...</span>`);
                const arrayBuffer = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;

                let fullText = '';
                for (let i = 1; i <= pdf.numPages; i++) {
                    setBtn(`<span style="display:inline-flex;align-items:center;gap:8px;">${spinner}Lendo página ${i} de ${pdf.numPages}...</span>`);
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map(item => item.str).join(' ');
                    fullText += pageText + '\n';
                }

                setBtn(`<span style="display:inline-flex;align-items:center;gap:8px;">${spinner}Identificando projetos...</span>`);
                const records = this.parsePdfText(fullText);

                if (records && records.length > 0) {
                    setBtn(`<span style="display:inline-flex;align-items:center;gap:8px;">${spinner}Identificando clientes...</span>`);
                    this.pendingPdfRecords = records;
                    await this.openPdfConfirmationModal();
                } else if (records) {
                    Toast.show('Nenhum atendimento válido encontrado no PDF.', 'info');
                }

            } catch (err) {
                console.error(err);
                Toast.show('Erro ao ler o PDF: ' + err.message, 'error');
            } finally {
                btnImportPdf.disabled = false;
                btnImportPdf.innerHTML = originalHtml;
                lucide.createIcons();
                e.target.value = '';
            }
        });
    }

    // Remove textos de cabeçalhos da ATA que podem aparecer em páginas seguintes
    cleanupPageHeaders(text) {
        return text
            // Remove cabeçalhos de tabela de horas
            .replace(/Hora\s+Inicial\s+Hora\s+Final\s+Horas\s+Aplicadas\s*(no\s+Dia)?\s*Analista/gi, '')
            .replace(/Hora\s+Inicial\s+Hora\s+Final\s+Horas\s+Aplicadas/gi, '')
            // Remove cabeçalhos de colunas da tabela principal da ata
            .replace(/DATA\s+E\s+HORA\s+CLIENTE/gi, '')
            .replace(/Descri..o\s+do\s+Atendimento/gi, '')
            .replace(/Horas\s+Aplicadas\s+no\s+Dia\s+\d{2}\/\d{2}\/\d{4}/gi, '')
            // Remove referências a Projeto/número que aparecem no cabeçalho repetido
            .replace(/Projeto[:.\s]*\d{4,6}/gi, '')
            .replace(/\d{4,6}\s*Projeto/gi, '')
            // Remove total de horas
            .replace(/Total\s+Horas[:\s]*\d{2}:\d{2}/gi, '')
            // Remove responsável
            .replace(/Respons.vel[:\s]*/gi, '')
            // Normaliza múltiplos espaços/newlines
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    parsePdfText(text) {
        this._lastPdfText = text;

        // Extrai mapa projectNum → clientName
        // Suporta dois formatos da ATA:
        //   Formato A: "Projeto.: 22851   17 - Nome Empresa Horas contratadas"
        //   Formato B: "22851 Projeto.:   17 - Nome Empresa Horas contratadas"
        // Requer formato SAP "NN - NOME" para evitar capturar analistas ou descrições
        this._projectClientNames = new Map();
        const nameTerminator = `(?=\\s*(?:Horas\\s+contratadas|Horas\\s+executadas))`;
        const sapNamePattern = `(\\d{1,3}\\s*[-–]\\s*.+?)`;
        const nameRegexes = [
            new RegExp(`Projeto[:.\\.\\s]*(\\d{4,6})\\s+${sapNamePattern}${nameTerminator}`, 'ig'),
            new RegExp(`(?:^|[\\s\\n])(\\d{4,6})\\s+Projeto[:.\\.\\s]*${sapNamePattern}${nameTerminator}`, 'ig'),
        ];
        let pnMatch;
        for (const rx of nameRegexes) {
            while ((pnMatch = rx.exec(text)) !== null) {
                const num = pnMatch[1].trim();
                const name = pnMatch[2].trim();
                if (name && name.length >= 5 && !this._projectClientNames.has(num)) {
                    this._projectClientNames.set(num, name);
                }
            }
        }

        // Encontra todos os projetos no documento e salva o index em que apareceram
        // Ajustado para capturar apenas números com 4 a 6 dígitos (evitando pegar dias de data como "03")
        const projectRegex = /Projeto[:.\s]*(\d{4,6})/ig;
        let projectMatches = [];
        let pMatch;
        while ((pMatch = projectRegex.exec(text)) !== null) {
            projectMatches.push({ index: pMatch.index, projectNum: pMatch[1].trim() });
        }

        // Caso a pessoa digite "(Projeto 22901)"
        const projParenthesisRgx = /\(\s*Projeto\s+(\d{4,6})\s*\)/ig;
        while ((pMatch = projParenthesisRgx.exec(text)) !== null) {
            projectMatches.push({ index: pMatch.index, projectNum: pMatch[1].trim() });
        }

        // PDFs com layout de colunas: PDF.js extrai "22851 Projeto.:" (número antes do rótulo)
        // Requer que o número apareça no início de um "token" — precedido por espaço ou início do texto
        const projBeforeRgx = /(?:^|[\s\n])(\d{4,6})\s+Projeto[.:]/ig;
        while ((pMatch = projBeforeRgx.exec(text)) !== null) {
            projectMatches.push({ index: pMatch.index, projectNum: pMatch[1].trim() });
        }

        projectMatches.sort((a, b) => a.index - b.index);

        // Deduplica: remove entradas com mesmo projectNum e índice muito próximo (< 50 chars)
        const seen = new Map();
        const deduped = [];
        for (const pm of projectMatches) {
            const key = pm.projectNum;
            const prev = seen.get(key);
            if (!prev || Math.abs(prev.index - pm.index) > 50) {
                deduped.push(pm);
                seen.set(key, pm);
            }
        }
        projectMatches.length = 0;
        projectMatches.push(...deduped);

        // EXTRAIR DESCRIÇÕES GLOBAIS "Descrição do Atendimento"
        // Usa Regex para ignorar problemas de encoding acentuação vindos do PDF.js
        const descMatches = [];
        const descRegex = /Descri..o do Atendimento/ig;
        const horasRegex = /Horas Aplicadas no Dia/ig;

        let dMatch;
        while ((dMatch = descRegex.exec(text)) !== null) {
            const startIdx = dMatch.index + dMatch[0].length;

            // Procura a próxima ocorrência de "Horas Aplicadas no Dia" a partir daqui
            horasRegex.lastIndex = startIdx;
            const hMatch = horasRegex.exec(text);

            let rawDesc;
            if (hMatch) {
                rawDesc = text.substring(startIdx, hMatch.index).trim();
            } else {
                rawDesc = text.substring(startIdx, startIdx + 500).trim();
            }

            // Limpa cabeçalhos que possam ter caído dentro desta descrição
            rawDesc = this.cleanupPageHeaders(rawDesc);

            if (rawDesc) {
                descMatches.push({ index: dMatch.index, text: rawDesc });
            }
        }

        let records = [];

        // Encontrar todas as datas de "Horas Aplicadas no Dia XX/XX/XXXX"
        const dateRegex = /Horas Aplicadas no Dia (\d{2}\/\d{2}\/\d{4})/g;
        let match;
        let dateBlocks = [];

        while ((match = dateRegex.exec(text)) !== null) {
            dateBlocks.push({ index: match.index, date: match[1] });
        }

        dateBlocks.forEach((block, i) => {
            const nextIndex = i + 1 < dateBlocks.length ? dateBlocks[i + 1].index : text.length;
            const blockText = text.substring(block.index, nextIndex);

            // Descobrir o projeto mais recente antes deste bloco de data
            let currentProjectNum = '';
            for (let j = projectMatches.length - 1; j >= 0; j--) {
                if (projectMatches[j].index < block.index) {
                    currentProjectNum = projectMatches[j].projectNum;
                    break;
                }
            }

            // Fallback se ele encontrou o projeto logo após a primeira data
            if (!currentProjectNum && projectMatches.length > 0) {
                currentProjectNum = projectMatches[0].projectNum;
            }

            // Descobrir a descrição global mais recente antes deste bloco de data
            let currentGlobalDesc = '';
            for (let j = descMatches.length - 1; j >= 0; j--) {
                if (descMatches[j].index < block.index) {
                    currentGlobalDesc = descMatches[j].text;
                    break;
                }
            }

            // Fallback para descrição
            if (!currentGlobalDesc && descMatches.length > 0) {
                currentGlobalDesc = descMatches[0].text;
            }

            // Limpeza adicional da descrição global para remover cabeçalhos colados
            if (currentGlobalDesc) {
                currentGlobalDesc = currentGlobalDesc
                    .replace(/.*?Horas executadas:\s*/i, '') // Remove cabeçalho anterior
                    .replace(/Hora Inicial.*?Analista\s*/i, '') // Remove tabela de horas
                    .trim();
            }

            // Regex para extrair horários e a descrição específica da linha
            // Formato da tabela: HoraInicial HoraFinal HorasAplicadas [Analista/texto]
            // Grupos: [1]=HoraInicial, [2]=HoraFinal, [3]=HorasAplicadas, [4]=restante
            const timeRegex = /(\d{2}:\d{2})\s+(\d{2}:\d{2})\s+(\d{2}:\d{2})\s*(.*?)(?=(?:\d{2}:\d{2}\s+\d{2}:\d{2})|Total\s+Horas|Responsável|$)/gs;

            let timeMatch;
            while ((timeMatch = timeRegex.exec(blockText)) !== null) {
                const startTime = timeMatch[1];
                const endTime = timeMatch[2];
                // timeMatch[3] = horas aplicadas (não usamos, calculamos a partir de start/end)

                // Calcular diferença REAL de minutos entre hora inicial e hora final
                const [sH, sM] = startTime.split(':').map(Number);
                const [eH, eM] = endTime.split(':').map(Number);
                let diffMins = (eH * 60 + eM) - (sH * 60 + sM);
                if (diffMins < 0) diffMins += 24 * 60;

                // Deve haver pelo menos 1 minuto de diferença para ser um registro válido
                if (diffMins <= 0) continue;

                // FIX 1: Usar apenas a descrição global — não concatenar "Tarefa da Linha"
                // A linha específica pode ter analista ou texto irrelevante do PDF
                let finalDesc = currentGlobalDesc;

                // Somente usa o texto da linha como fallback se não houver descrição global
                if (!finalDesc) {
                    let lineDesc = (timeMatch[4] || '').trim();
                    // Limpa cabeçalhos da página que possam ter caído no texto da linha
                    lineDesc = this.cleanupPageHeaders(lineDesc);
                    finalDesc = lineDesc;
                }

                if (!finalDesc || finalDesc === '') finalDesc = "Importado via Ata PDF";
                if (finalDesc.length > 800) finalDesc = finalDesc.substring(0, 800);

                const [d, m, y] = block.date.split('/');
                const isoDate = `${y}-${m}-${d}`;

                records.push({
                    clientProjectPdf: currentProjectNum,
                    dateStrBrazil: block.date,
                    date: isoDate,
                    startTime,
                    endTime,
                    minutes: diffMins,
                    description: finalDesc
                });
            }
        });

        return records;
    }

    async openPdfConfirmationModal() {
        const clients = await store.getClients();
        let allMatched = true;
        let unMatchedProjects = new Set();
        let statusInput = document.getElementById('pdf-client-name');

        // Mapear cada record para o seu ClientID correspondente
        this.pendingPdfRecords.forEach(r => {
            let matchedClient = null;
            if (r.clientProjectPdf) {
                // Ensure the search number only contains digits
                const searchNum = r.clientProjectPdf.replace(/\D/g, '');
                matchedClient = clients.find(c => {
                    if (!c.projectNum) return false;
                    // Split the client's project field by any non-digit character (comma, space, dash, slash, etc.)
                    const cProjects = c.projectNum.split(/\D+/).filter(Boolean);
                    return cProjects.includes(searchNum);
                });
            }

            if (matchedClient) {
                r.matchedClientId = matchedClient.id;
                r.matchedClientName = matchedClient.name;
            } else {
                allMatched = false;
                if (r.clientProjectPdf) unMatchedProjects.add(r.clientProjectPdf);
            }
        });

        if (!allMatched) {
            const sessionCreated = new Map(); // projectNum → client (evita criar o mesmo 2x na mesma rodada)
            let createdCount = 0;

            for (const projectNum of unMatchedProjects) {
                const searchNum = projectNum.replace(/\D/g, '');

                // Verifica se já existe no banco (importação anterior) ou foi criado nesta rodada
                const existing = clients.find(c => {
                    if (!c.projectNum) return false;
                    return c.projectNum.split(/\D+/).filter(Boolean).includes(searchNum);
                }) || sessionCreated.get(searchNum);

                let targetClient = existing;
                if (!targetClient) {
                    const clientName = this._extractClientNameForProject(projectNum) || `Projeto ${projectNum}`;
                    targetClient = await store.addClient(
                        clientName, 0, '', projectNum, 0,
                        'Cliente criado automaticamente via importação de Ata PDF. Cadastro incompleto — por favor, complete os dados.',
                        'active'
                    );
                    sessionCreated.set(searchNum, targetClient);
                    createdCount++;
                }

                this.pendingPdfRecords.forEach(r => {
                    if (r.clientProjectPdf.replace(/\D/g, '') === searchNum && !r.matchedClientId) {
                        r.matchedClientId = targetClient.id;
                        r.matchedClientName = targetClient.name;
                        r.autoCreated = !existing;
                    }
                });
            }

            if (createdCount > 0) {
                Toast.show(`${createdCount} cliente(s) criado(s) automaticamente. Verifique e complete os dados após a importação.`, 'info', 5000);
            }
        }

        const uniqueClientIds = new Set(this.pendingPdfRecords.map(r => r.matchedClientId));
        if (uniqueClientIds.size === 1) {
            statusInput.value = `${this.pendingPdfRecords[0].matchedClientName} (Padrão Único)`;
        } else {
            statusInput.value = `Múltiplos Clientes Identificados (${uniqueClientIds.size})`;
        }

        document.getElementById('modal-import-pdf').classList.add('active');

        const tbody = document.querySelector('#pdf-records-table tbody');
        tbody.innerHTML = '';

        this.pendingPdfRecords.forEach((r, idx) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-size: 0.9rem;">${r.dateStrBrazil}</td>
                <td style="font-size: 0.9rem; font-weight: 500; color: var(--primary-color);">${r.matchedClientName}${r.autoCreated ? ' <span style="font-size:0.75rem;background:var(--primary-color);color:#fff;border-radius:4px;padding:1px 5px;">Novo</span>' : ''}</td>
                <td style="font-size: 0.9rem;">${r.startTime} - ${r.endTime}</td>
                <td style="font-size: 0.9rem;">${r.minutes}</td>
                <td><textarea class="form-control" id="pdf-desc-${idx}" style="font-size: 0.85rem; padding: 4px; width: 100%; min-width: 250px; resize: vertical;" rows="3">${r.description}</textarea></td>
                <td style="text-align: center;"><input type="checkbox" id="pdf-check-${idx}" checked style="width: 18px; height: 18px; cursor: pointer;"></td>
            `;
            tbody.appendChild(tr);
        });
    }

    async confirmPdfImport() {
        const confirmBtn = document.getElementById('btn-confirm-pdf-import');
        const cancelBtn = document.getElementById('btn-cancel-pdf-import');
        const closeBtn = document.querySelector('#modal-import-pdf .close-modal');

        const toImport = this.pendingPdfRecords.filter((r, idx) => {
            const cb = document.getElementById(`pdf-check-${idx}`);
            return cb && cb.checked && r.matchedClientId;
        });
        const total = toImport.length;

        // Bloqueia controles para evitar cliques duplos
        confirmBtn.disabled = true;
        cancelBtn.disabled = true;
        if (closeBtn) closeBtn.disabled = true;

        let importedCount = 0;
        const setProgress = (n) => {
            confirmBtn.innerHTML = `<span style="display:inline-flex;align-items:center;gap:8px;"><div class="spinner" style="width:14px;height:14px;border-width:2px;flex-shrink:0;"></div>Importando ${n} de ${total}...</span>`;
        };
        setProgress(0);

        for (const [idx, r] of this.pendingPdfRecords.entries()) {
            const isChecked = document.getElementById(`pdf-check-${idx}`).checked;
            if (isChecked && r.matchedClientId) {
                const desc = document.getElementById(`pdf-desc-${idx}`).value;
                await store.addRecord(r.matchedClientId, r.date, r.startTime, r.endTime, r.minutes, desc);
                importedCount++;
                setProgress(importedCount);
            }
        }

        Toast.show(`${importedCount} atendimento(s) importado(s) com sucesso!`, 'success');
        this.closeModal('modal-import-pdf');
        this.pendingPdfRecords = [];

        // Restaura botão para uso futuro
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
        if (closeBtn) closeBtn.disabled = false;
        confirmBtn.textContent = 'Confirmar e Salvar';

        await this.renderAll();
    }

    _extractClientNameForProject(projectNum) {
        const searchNum = projectNum.replace(/\D/g, '');

        // Prioridade 1: mapa extraído durante o parse (formato "Projeto.: XXXXX Nome Cliente")
        if (this._projectClientNames && this._projectClientNames.has(searchNum)) {
            return this._projectClientNames.get(searchNum);
        }

        // Prioridade 2: busca contextual no texto bruto
        const text = this._lastPdfText || '';
        if (!text) return '';

        const projIdx = text.search(new RegExp(`\\b${searchNum}\\b`));
        if (projIdx === -1) return '';

        const context = text.substring(Math.max(0, projIdx - 600), projIdx + 300);

        const clienteMatch = context.match(/CLIENTE[:\s]+([^\n\r]{3,80}?)(?=\s*[\n\r]|\s*Projeto|\s*\d{4,6}|$)/i);
        if (clienteMatch) return clienteMatch[1].trim();

        const nomeMatch = context.match(/(?:Nome|Raz.o\s+Social)[:\s]+([^\n\r]{3,80}?)(?=\s*[\n\r]|$)/i);
        if (nomeMatch) return nomeMatch[1].trim();

        return '';
    }

    // ===================================
    // MIGRAÇÃO localStorage → Supabase
    // ===================================

    _detectLocalStorageData() {
        const found = { clients: [], records: [], tasks: [], agendaEvents: [] };

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            try {
                const val = JSON.parse(localStorage.getItem(key));
                if (!Array.isArray(val) || val.length === 0) continue;
                const first = val[0];

                if (first.hoursTotal !== undefined || first.hours_total !== undefined) {
                    found.clients = val;
                } else if (first.minutes !== undefined && (first.clientId !== undefined || first.client_id !== undefined)) {
                    found.records = val;
                } else if (first.title !== undefined && first.status !== undefined &&
                    ['new', 'doing', 'done'].includes(first.status)) {
                    found.tasks = val;
                } else if (first.type !== undefined && first.date !== undefined &&
                    ['meeting', 'consulting', 'task', 'reminder'].includes(first.type)) {
                    found.agendaEvents = val;
                }
            } catch (e) { /* chave não é JSON válido */ }
        }

        // Fallback: procura objeto único com todas as entidades (formato de backup)
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            try {
                const val = JSON.parse(localStorage.getItem(key));
                if (val && typeof val === 'object' && !Array.isArray(val)) {
                    if (Array.isArray(val.clients) && val.clients.length > 0) found.clients = val.clients;
                    if (Array.isArray(val.records) && val.records.length > 0) found.records = val.records;
                    if (Array.isArray(val.tasks) && val.tasks.length > 0) found.tasks = val.tasks;
                    if (Array.isArray(val.agendaEvents) && val.agendaEvents.length > 0) found.agendaEvents = val.agendaEvents;
                }
            } catch (e) {}
        }

        return found;
    }

    checkLocalStorageMigration() {
        const data = this._detectLocalStorageData();
        const hasData = data.clients.length > 0 || data.records.length > 0 ||
                        data.tasks.length > 0 || data.agendaEvents.length > 0;
        const btn = document.getElementById('btn-migrate-local');
        if (btn) btn.style.display = hasData ? '' : 'none';
    }

    openMigrationModal() {
        const data = this._detectLocalStorageData();
        const summary = document.getElementById('migration-summary');

        const rows = [
            { label: 'Clientes', count: data.clients.length, icon: 'users' },
            { label: 'Atendimentos', count: data.records.length, icon: 'clock' },
            { label: 'Tarefas', count: data.tasks.length, icon: 'kanban' },
            { label: 'Eventos de Agenda', count: data.agendaEvents.length, icon: 'calendar' },
        ];

        summary.innerHTML = rows.map(r => `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:rgba(255,255,255,0.04); border-radius:8px;">
                <span style="display:flex; align-items:center; gap:8px;">
                    <i data-lucide="${r.icon}" style="width:16px;height:16px;color:var(--primary-color);"></i>
                    ${r.label}
                </span>
                <span style="font-weight:600; color:${r.count > 0 ? 'var(--success-color)' : 'var(--text-muted)'}">
                    ${r.count} registro(s)
                </span>
            </div>
        `).join('');

        document.getElementById('migration-progress').style.display = 'none';
        document.getElementById('btn-confirm-migration').disabled = false;
        document.getElementById('modal-migration').classList.add('active');
        lucide.createIcons();
    }

    async executeMigration() {
        const data = this._detectLocalStorageData();
        const total = data.clients.length + data.records.length + data.tasks.length + data.agendaEvents.length;

        if (total === 0) {
            Toast.show('Nenhum dado local encontrado para migrar.', 'info');
            this.closeModal('modal-migration');
            return;
        }

        const progressBar = document.getElementById('migration-progress-bar');
        const statusText = document.getElementById('migration-status-text');
        const progressWrap = document.getElementById('migration-progress');
        const btn = document.getElementById('btn-confirm-migration');

        progressWrap.style.display = 'block';
        btn.disabled = true;

        let done = 0;
        const setProgress = (label) => {
            done++;
            progressBar.style.width = `${Math.round((done / total) * 100)}%`;
            statusText.textContent = label;
        };

        try {
            const idMap = {};

            for (const c of data.clients) {
                const created = await store.addClient(
                    c.name, c.hoursTotal ?? c.hours_total,
                    c.csName ?? c.cs_name, c.projectNum ?? c.project_num,
                    c.clientPays ?? c.client_pays, c.notes, c.status
                );
                idMap[c.id] = created.id;
                setProgress(`Migrando clientes... ${c.name}`);
            }

            for (const r of data.records) {
                const mappedClientId = idMap[r.clientId ?? r.client_id];
                if (mappedClientId) {
                    await store.addRecord(
                        mappedClientId, r.date,
                        r.startTime ?? r.start_time, r.endTime ?? r.end_time,
                        r.minutes, r.description
                    );
                }
                setProgress(`Migrando atendimentos...`);
            }

            for (const t of data.tasks) {
                await store.addTask({
                    ...t,
                    clientId: idMap[t.clientId ?? t.client_id] || null
                });
                setProgress(`Migrando tarefas... ${t.title}`);
            }

            for (const ev of data.agendaEvents) {
                await store.addAgendaEvent({
                    ...ev,
                    clientId: idMap[ev.clientId ?? ev.client_id] || null
                });
                setProgress(`Migrando agenda...`);
            }

            progressBar.style.width = '100%';
            statusText.textContent = 'Migração concluída!';

            Toast.show(`${total} registros migrados com sucesso!`, 'success');

            // Oferece limpeza do localStorage
            setTimeout(() => {
                if (confirm('Migração concluída! Deseja apagar os dados locais agora? (Recomendado, pois já estão na nuvem)')) {
                    localStorage.clear();
                    document.getElementById('btn-migrate-local').style.display = 'none';
                    Toast.show('Dados locais removidos.', 'info');
                }
                this.closeModal('modal-migration');
            }, 800);

            await this.renderAll();

        } catch (err) {
            Toast.show('Erro durante a migração: ' + err.message, 'error');
            btn.disabled = false;
        }
    }

    // ===================================
    // CONFIGURAÇÕES DO GOOGLE CALENDAR
    // ===================================
    async openCalendarSettings() {
        this.openModal('modal-calendar-settings');

        const statusEl = document.getElementById('calendar-settings-status');
        statusEl.innerHTML = '<div class="spinner-wrap" style="padding:8px 0;"><div class="spinner"></div></div>';

        try {
            const settings = await store.getUserSettings();
            const clientIdInput = document.getElementById('settings-client-id');
            const apiKeyInput = document.getElementById('settings-api-key');

            if (settings) {
                clientIdInput.value = settings.googleClientId || '';
                apiKeyInput.value = settings.googleApiKey || '';
            }

            const configured = settings && settings.googleClientId && settings.googleApiKey;
            statusEl.innerHTML = configured
                ? `<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);border-radius:8px;font-size:0.875rem;">
                     <i data-lucide="check-circle" style="width:16px;height:16px;color:#22c55e;flex-shrink:0;"></i>
                     <span style="color:#22c55e;">Integração configurada</span>
                   </div>`
                : `<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(234,179,8,0.1);border:1px solid rgba(234,179,8,0.3);border-radius:8px;font-size:0.875rem;">
                     <i data-lucide="alert-triangle" style="width:16px;height:16px;color:#eab308;flex-shrink:0;"></i>
                     <span style="color:#eab308;">Integração não configurada</span>
                   </div>`;
            lucide.createIcons();
        } catch (err) {
            statusEl.innerHTML = '';
            Toast.show('Erro ao carregar configurações: ' + err.message, 'error');
        }
    }

    async handleCalendarSettingsSave(e) {
        e.preventDefault();
        const clientId = document.getElementById('settings-client-id').value.trim();
        const apiKey = document.getElementById('settings-api-key').value.trim();
        const btn = e.submitter || e.target.querySelector('button[type="submit"]');

        btn.disabled = true;
        btn.innerHTML = '<i data-lucide="loader" class="spin"></i> Salvando...';
        lucide.createIcons();

        try {
            await store.saveUserSettings({ googleClientId: clientId, googleApiKey: apiKey });
            await calendarAPI.configure(clientId, apiKey);
            Toast.show('Configurações salvas com sucesso!', 'success');
            this.closeModal('modal-calendar-settings');
            await this.renderAgenda();
        } catch (err) {
            Toast.show('Erro ao salvar: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i data-lucide="save"></i> Salvar Configurações';
            lucide.createIcons();
        }
    }
}

// Iniciar a aplicação quando DOM estiver pronto
document.addEventListener('DOMContentLoaded', async () => {
    Auth.init();

    const user = await Auth.getSession();

    window.app = new AppController();

    if (!user) {
        Auth.showAuthScreen();
    } else {
        Auth.hideAuthScreen();
        window.app.initAfterAuth();
    }

    document.getElementById('btn-logout').addEventListener('click', async () => {
        // Limpa estado da instância antes do logout para evitar vazamento entre sessões
        if (window.app) {
            window.app.selectedClient = null;
            window.app.selectedMonth = null;
            window.app.currentView = 'dashboard';
            window.app.agendaCurrentDate = new Date();
            window.app.pendingPdfRecords = [];
        }
        await Auth.signOut();
    });
});
