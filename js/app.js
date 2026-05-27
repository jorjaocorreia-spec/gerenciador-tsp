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

function compressImageFile(file, maxWidth = 1400) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const scale = Math.min(1, maxWidth / img.width);
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.75));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

class AppController {
    constructor() {
        this.currentView = 'dashboard';
        this.selectedClient = null;
        this.selectedMonth = null;
        this.pendingPdfRecords = [];
        this.pendingPdfWarnings = [];
        this.agendaCurrentDate = new Date();
        this.agendaViewMode = 'schedule'; // daily, weekly, monthly or schedule
        this.aptCurrentDate = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'
        this.taskAttachments = []; // [{name, data}] — imagens em base64 do modal de tarefa
        this.implAttachments = []; // [{name, data}] — imagens em base64 do modal de implementação
        // Estado do modal de tarefa
        this._modalTaskId    = null;
        this._modalStatus    = 'new';
        this._modalLabels    = [];
        this._modalChecklist = [];
        this._modalCoverColor = null;
        this._modalComments  = [];
        // Estado do drag-and-drop Kanban
        this._draggedCard      = null;
        this._dragPlaceholder  = null;
        this._draggingFromStatus = null;
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
        document.getElementById('form-task-time').addEventListener('submit', this.handleTaskTimeSubmit.bind(this));
        document.getElementById('form-agenda-event').addEventListener('submit', this.handleAgendaSubmit.bind(this));

        // Mostrar/ocultar opção de Meet conforme sync Google
        document.getElementById('agenda-sync-google').addEventListener('change', (e) => {
            const row = document.getElementById('agenda-generate-meet-row');
            const hasMeet = document.getElementById('agenda-meet-link').value;
            row.style.display = (e.target.checked && !hasMeet) ? 'flex' : 'none';
            if (!e.target.checked) document.getElementById('agenda-generate-meet').checked = false;
        });

        // Calculo de tempo automático
        document.getElementById('record-start').addEventListener('input', this.calculateTimeDiff.bind(this));
        document.getElementById('record-end').addEventListener('input', this.calculateTimeDiff.bind(this));
        document.getElementById('record-centesimal').addEventListener('change', this.onCentesimalToggle.bind(this));

        // Calculo valor do consultor automático
        document.getElementById('client-pays').addEventListener('input', this.calculateConsultantValue.bind(this));

        // Sets default date in record form to today
        document.getElementById('record-date').valueAsDate = new Date();

        // Configurar Importação de PDF
        this.setupPdfImport();

        // Apontamentos
        document.getElementById('btn-new-apontamento')
            ?.addEventListener('click', () => this.openNewApontamento());
        document.getElementById('btn-apt-prev')
            ?.addEventListener('click', () => this.aptNavigateDay(-1));
        document.getElementById('btn-apt-next')
            ?.addEventListener('click', () => this.aptNavigateDay(1));
        document.getElementById('btn-apt-today')
            ?.addEventListener('click', () => {
                this.aptCurrentDate = new Date().toISOString().split('T')[0];
                this.renderApontamentos();
            });
        document.getElementById('form-apontamento')
            ?.addEventListener('submit', (e) => this.handleApontamentoSubmit(e));

        document.getElementById('form-implementation')
            ?.addEventListener('submit', (e) => this.handleImplementationSubmit(e));
        ['apt-start', 'apt-end'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', () => this.updateAptDuration());
        });

        // Comentários de tarefas
        document.getElementById('btn-add-task-comment')?.addEventListener('click', () => this.handleAddTaskComment());
        document.getElementById('task-comment-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); this.handleAddTaskComment(); }
        });

        // Paste de imagens no modal de tarefa
        document.addEventListener('paste', (e) => {
            const taskActive = document.getElementById('modal-task')?.classList.contains('active');
            const implActive = document.getElementById('modal-implementation')?.classList.contains('active');
            if (!taskActive && !implActive) return;
            const items = e.clipboardData?.items;
            if (!items) return;
            for (const item of items) {
                if (item.type.startsWith('image/')) {
                    e.preventDefault();
                    const file = item.getAsFile();
                    const name = `print_${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
                    if (taskActive) {
                        compressImageFile(file).then(data => {
                            this.taskAttachments.push({ name, data });
                            this._renderTaskAttachmentPreviews();
                        });
                    } else {
                        compressImageFile(file).then(data => {
                            this.implAttachments.push({ name, data });
                            this._renderImplAttachmentPreviews();
                        });
                    }
                    break;
                }
            }
        });

        // Seleção de arquivos de imagem via input — tarefa
        document.getElementById('task-attachments')?.addEventListener('change', async (e) => {
            for (const file of e.target.files) {
                const data = await compressImageFile(file);
                this.taskAttachments.push({ name: file.name, data });
            }
            e.target.value = '';
            this._renderTaskAttachmentPreviews();
        });

        // Seleção de arquivos de imagem via input — implementação
        document.getElementById('impl-attachments')?.addEventListener('change', async (e) => {
            for (const file of e.target.files) {
                const data = await compressImageFile(file);
                this.implAttachments.push({ name: file.name, data });
            }
            e.target.value = '';
            this._renderImplAttachmentPreviews();
        });

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
                document.getElementById('task-priority').value = 'medium';
                this._syncModalColumnButtons();
                this._renderLabelPicker();
                this._renderCoverPicker();
                this._renderChecklist();
            }
        }
        if (modalId === 'modal-agenda-event') {
            this.updateAgendaTaskSelect();
            if (!document.getElementById('agenda-id').value) {
                const today = new Date().toISOString().split('T')[0];
                document.getElementById('agenda-date').value = today;
                document.getElementById('agenda-date-end').value = today;
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
            this._modalTaskId    = null;
            this._modalStatus    = 'new';
            this._modalLabels    = [];
            this._modalChecklist = [];
            this._modalCoverColor = null;
            this._modalComments  = [];
            document.getElementById('modal-task-comments-section').style.display = 'none';
            document.getElementById('modal-task-comments-list').innerHTML = '';
            document.getElementById('task-comment-input').value = '';
            document.getElementById('task-id').value = '';
            document.getElementById('task-title').value = '';
            document.getElementById('task-description').value = '';
            document.getElementById('task-due-date').value = '';
            document.getElementById('task-estimated-minutes').value = '';
            document.getElementById('task-priority').value = 'medium';
            document.getElementById('btn-delete-task').style.display = 'none';
            document.getElementById('btn-add-time-task').style.display = 'none';
            document.getElementById('modal-task-cover').style.display = 'none';
            this.taskAttachments = [];
            this._renderTaskAttachmentPreviews();
        }
        if (modalId === 'modal-implementation') {
            this.implAttachments = [];
            this._renderImplAttachmentPreviews();
        }
        if (modalId === 'modal-task-time') {
            document.getElementById('form-task-time').reset();
            document.getElementById('time-task-id').value = '';
        }
        if (modalId === 'modal-agenda-event') {
            document.getElementById('form-agenda-event').reset();
            document.getElementById('agenda-id').value = '';
            document.getElementById('agenda-calendar-event-id').value = '';
            document.getElementById('agenda-meet-link').value = '';
            document.getElementById('agenda-meet-link-block').style.display = 'none';
            document.getElementById('agenda-generate-meet-row').style.display = 'none';
            document.getElementById('agenda-generate-meet').checked = false;
            document.getElementById('modal-agenda-title').innerText = 'Novo Agendamento';
            document.getElementById('agenda-sync-google').checked = calendarAPI.isEnabled;
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
        const consultantBonus = document.getElementById('consultant-bonus').value;
        const notes = document.getElementById('client-notes').value;
        const status = document.getElementById('client-status').value;
        const btn = e.target.querySelector('[type="submit"]');
        btn.disabled = true;

        try {
            if (id) {
                await store.updateClient(id, name, hours, csName, projectNum, clientPays, consultantBonus, notes, status);
            } else {
                await store.addClient(name, hours, csName, projectNum, clientPays, consultantBonus, notes, status);
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
        const inputBonus = document.getElementById('consultant-bonus').value;
        const inputReceives = document.getElementById('consultant-receives');
        const inputTotal = document.getElementById('consultant-total');
        const fmt = v => `R$ ${v.toFixed(2).replace('.', ',')}`;
        if (inputPays && !isNaN(inputPays)) {
            const base = parseFloat(inputPays) * 0.43;
            const bonus = (inputBonus && !isNaN(inputBonus)) ? parseFloat(inputBonus) : 0;
            inputReceives.value = fmt(base);
            inputTotal.value = fmt(base + bonus);
        } else {
            inputReceives.value = '';
            inputTotal.value = '';
        }
    }

    onCentesimalToggle() {
        const isCentesimal = document.getElementById('record-centesimal').checked;
        const startInput = document.getElementById('record-start');
        const endInput = document.getElementById('record-end');
        if (isCentesimal) {
            startInput.type = 'text';
            startInput.placeholder = 'HH:CC (ex: 13:50)';
            endInput.type = 'text';
            endInput.placeholder = 'HH:CC (ex: 14:25)';
        } else {
            startInput.type = 'time';
            startInput.placeholder = '';
            endInput.type = 'time';
            endInput.placeholder = '';
        }
        this.calculateTimeDiff();
    }

    calculateTimeDiff() {
        const start = document.getElementById('record-start').value;
        const end = document.getElementById('record-end').value;
        const calcInput = document.getElementById('record-calculated');
        const isCentesimal = document.getElementById('record-centesimal').checked;

        if (start && end) {
            const [startH, startM] = start.split(':').map(Number);
            const [endH, endM] = end.split(':').map(Number);

            if (isNaN(startH) || isNaN(startM) || isNaN(endH) || isNaN(endM)) {
                calcInput.value = 'Formato inválido';
                calcInput.dataset.minutes = 0;
                return;
            }

            let diffMins;
            if (isCentesimal) {
                // Centesimal: HH:CC onde CC é centésimos de hora (0–99)
                const startTotal = Math.round((startH * 100 + startM) / 100 * 60);
                const endTotal = Math.round((endH * 100 + endM) / 100 * 60);
                diffMins = endTotal - startTotal;
            } else {
                diffMins = (endH * 60 + endM) - (startH * 60 + startM);
            }

            if (diffMins < 0) diffMins += 24 * 60;

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
        if (e) e.preventDefault();
        const id = document.getElementById('task-id').value;
        const title = document.getElementById('task-title').value.trim();
        if (!title) { Toast.show('Informe o título da tarefa.', 'error'); return; }

        const taskData = {
            clientId: document.getElementById('task-client').value,
            title,
            description: document.getElementById('task-description').value,
            status: this._modalStatus || 'new',
            priority: document.getElementById('task-priority').value,
            dueDate: document.getElementById('task-due-date').value,
            estimatedMinutes: document.getElementById('task-estimated-minutes').value,
            labels: this._modalLabels || [],
            checklist: this._modalChecklist || [],
            coverColor: this._modalCoverColor || null,
            attachments: this.taskAttachments
        };

        const btn = document.querySelector('#form-task [type="submit"]');
        if (btn) btn.disabled = true;

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
            if (btn) btn.disabled = false;
        }
    }

    async handleTaskTimeSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('time-task-id').value;
        const minutes = parseInt(document.getElementById('time-task-minutes').value) || 0;
        const description = document.getElementById('time-task-desc')?.value?.trim() || '';

        if (id && minutes) {
            const btn = e.target.querySelector('[type="submit"]');
            btn.disabled = true;
            try {
                await store.addTaskTime(id, minutes);
                await store.logTaskActivity(id, 'time_added', { minutes, description });
                if (this._modalTaskId === id) {
                    const t = await store.getTask(id);
                    if (t) { this._modalComments = t.comments; this._renderTaskComments(); }
                }
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

        // Estado modal
        this._modalTaskId    = t.id;
        this._modalStatus    = t.status || 'new';
        this._modalLabels    = t.labels ? [...t.labels] : [];
        this._modalChecklist = t.checklist ? [...t.checklist] : [];
        this._modalCoverColor = t.coverColor || null;

        document.getElementById('task-id').value = t.id;
        document.getElementById('task-title').value = t.title;
        document.getElementById('task-description').value = t.description;
        document.getElementById('task-client').value = t.clientId || '';
        document.getElementById('task-priority').value = t.priority;
        document.getElementById('task-due-date').value = t.dueDate || '';
        document.getElementById('task-estimated-minutes').value = t.estimatedMinutes || '';
        this.taskAttachments = t.attachments ? [...t.attachments] : [];
        this._modalComments  = t.comments ? [...t.comments] : [];

        // Botões de edição
        document.getElementById('btn-delete-task').style.display = 'flex';
        document.getElementById('btn-add-time-task').style.display = 'flex';
        document.getElementById('modal-task-comments-section').style.display = 'flex';

        this._syncModalColumnButtons();
        this._syncModalCover();
        this._renderModalLabels();
        this._renderChecklist();
        this._renderTaskAttachmentPreviews();
        this._renderTaskComments();

        this.openModal('modal-task');
    }

    _renderTaskAttachmentPreviews() {
        const container = document.getElementById('task-attach-previews');
        const hint = document.getElementById('task-attach-hint');
        if (!container) return;
        if (hint) hint.style.display = this.taskAttachments.length ? 'none' : '';
        container.innerHTML = this.taskAttachments.map((att, i) => `
            <div class="attach-thumb">
                <img src="${att.data}" alt="${escapeHtml(att.name)}" onclick="app._openAttachmentLightbox(${i})" title="${escapeHtml(att.name)}">
                <button type="button" class="attach-remove" onclick="app.removeTaskAttachment(${i})" title="Remover">×</button>
            </div>
        `).join('');
    }

    _renderTaskComments() {
        const list = document.getElementById('modal-task-comments-list');
        if (!list) return;
        const statusLabels = { new: 'Novas', doing: 'Em Execução', done: 'Finalizadas' };
        const sorted = [...this._modalComments].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        if (!sorted.length) { list.innerHTML = '<p style="font-size:12px;color:var(--text-secondary);margin:4px 0">Nenhum comentário ainda.</p>'; return; }
        list.innerHTML = sorted.map(entry => {
            const date = new Date(entry.createdAt);
            const dateStr = date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) + ', ' +
                date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            if (entry.type === 'comment') {
                return `<div class="task-comment-item">
                    <div class="task-comment-meta">
                        <span>${dateStr}</span>
                        <button type="button" class="task-comment-delete" onclick="app._deleteTaskComment('${entry.id}')" title="Excluir">×</button>
                    </div>
                    <div class="task-comment-text">${escapeHtml(entry.text)}</div>
                </div>`;
            } else if (entry.type === 'status_change') {
                const from = statusLabels[entry.activityData?.from] || entry.activityData?.from || '?';
                const to   = statusLabels[entry.activityData?.to]   || entry.activityData?.to   || '?';
                return `<div class="task-activity-item">
                    <i data-lucide="arrow-right" style="width:13px;height:13px;flex-shrink:0"></i>
                    <span>Movido de <strong>${escapeHtml(from)}</strong> para <strong>${escapeHtml(to)}</strong></span>
                    <span style="margin-left:auto;white-space:nowrap">${dateStr}</span>
                </div>`;
            } else if (entry.type === 'time_added') {
                const mins = entry.activityData?.minutes || 0;
                const h = Math.floor(mins / 60), m = mins % 60;
                const label = h ? `${h}h${m ? ' ' + m + 'min' : ''}` : `${m}min`;
                const desc = entry.activityData?.description ? ` — ${entry.activityData.description}` : '';
                return `<div class="task-activity-item">
                    <i data-lucide="timer" style="width:13px;height:13px;flex-shrink:0"></i>
                    <span>${escapeHtml(label)} registrados${escapeHtml(desc)}</span>
                    <span style="margin-left:auto;white-space:nowrap">${dateStr}</span>
                </div>`;
            }
            return '';
        }).join('');
        lucide.createIcons();
    }

    async handleAddTaskComment() {
        const input = document.getElementById('task-comment-input');
        const text = input?.value.trim();
        if (!text || !this._modalTaskId) return;
        try {
            this._modalComments = await store.addTaskComment(this._modalTaskId, text);
            input.value = '';
            this._renderTaskComments();
        } catch (err) {
            Toast.show('Erro ao salvar comentário: ' + err.message, 'error');
        }
    }

    async _deleteTaskComment(commentId) {
        this._modalComments = this._modalComments.filter(c => c.id !== commentId);
        try {
            await store.updateTask({ id: this._modalTaskId, comments: this._modalComments,
                title: document.getElementById('task-title').value,
                description: document.getElementById('task-description').value,
                status: this._modalStatus, priority: document.getElementById('task-priority').value,
                dueDate: document.getElementById('task-due-date').value,
                estimatedMinutes: document.getElementById('task-estimated-minutes').value,
                labels: this._modalLabels, checklist: this._modalChecklist,
                coverColor: this._modalCoverColor, attachments: this.taskAttachments });
            this._renderTaskComments();
        } catch (err) {
            Toast.show('Erro ao excluir comentário: ' + err.message, 'error');
        }
    }

    _openAttachmentLightbox(index) {
        const att = this.taskAttachments[index];
        if (!att) return;
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.88);display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
        const img = document.createElement('img');
        img.src = att.data;
        img.style.cssText = 'max-width:90vw;max-height:90vh;border-radius:8px;object-fit:contain;box-shadow:0 8px 40px rgba(0,0,0,0.6);cursor:default;';
        img.addEventListener('click', (e) => e.stopPropagation());
        overlay.appendChild(img);
        overlay.addEventListener('click', () => overlay.remove());
        document.addEventListener('keydown', function esc(e) {
            if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); }
        });
        document.body.appendChild(overlay);
    }

    removeTaskAttachment(index) {
        this.taskAttachments.splice(index, 1);
        this._renderTaskAttachmentPreviews();
    }

    _renderImplAttachmentPreviews() {
        const container = document.getElementById('impl-attach-previews');
        const hint = document.getElementById('impl-attach-hint');
        if (!container) return;
        if (hint) hint.style.display = this.implAttachments.length ? 'none' : '';
        container.innerHTML = this.implAttachments.map((att, i) => `
            <div class="attach-thumb">
                <img src="${att.data}" alt="${escapeHtml(att.name)}" onclick="app._openImplAttachmentLightbox(${i})" title="${escapeHtml(att.name)}">
                <button type="button" class="attach-remove" onclick="app.removeImplAttachment(${i})" title="Remover">×</button>
            </div>
        `).join('');
    }

    _openImplAttachmentLightbox(index) {
        const att = this.implAttachments[index];
        if (!att) return;
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.88);display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
        const img = document.createElement('img');
        img.src = att.data;
        img.style.cssText = 'max-width:90vw;max-height:90vh;border-radius:8px;object-fit:contain;box-shadow:0 8px 40px rgba(0,0,0,0.6);cursor:default;';
        img.addEventListener('click', (e) => e.stopPropagation());
        overlay.appendChild(img);
        overlay.addEventListener('click', () => overlay.remove());
        document.addEventListener('keydown', function esc(e) {
            if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); }
        });
        document.body.appendChild(overlay);
    }

    removeImplAttachment(index) {
        this.implAttachments.splice(index, 1);
        this._renderImplAttachmentPreviews();
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

    async handleDeleteTaskFromModal() {
        const id = document.getElementById('task-id').value;
        if (!id) return;
        if (confirm("Deseja realmente apagar esta tarefa?")) {
            try {
                await store.deleteTask(id);
                this.closeModal('modal-task');
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

    // ===================================
    // KANBAN — Drag and Drop
    // ===================================
    dragStart(e) {
        const card = e.currentTarget;
        e.dataTransfer.setData('text/plain', card.dataset.id);
        e.dataTransfer.effectAllowed = 'move';
        this._draggingFromStatus = card.closest('.kb-dropzone')?.dataset.status;
        this._draggedCard = card;

        const ph = document.createElement('div');
        ph.className = 'kb-drag-placeholder';
        ph.style.height = card.offsetHeight + 'px';
        // Impede que eventos no placeholder borbulhem até a dropzone (evita piscar)
        ph.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
        ph.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await this._handleDrop(e, ph.closest('.kb-dropzone'));
        });
        this._dragPlaceholder = ph;

        setTimeout(() => {
            card.classList.add('dragging');
            card.after(ph);
        }, 0);
    }

    dragEnd(e) {
        e.currentTarget.classList.remove('dragging');
        this._dragPlaceholder?.remove();
        this._dragPlaceholder = null;
        this._draggedCard = null;
        document.querySelectorAll('.kb-dropzone').forEach(z => z.classList.remove('drag-over'));
    }

    allowDrop(e) {
        e.preventDefault();
        if (!this._dragPlaceholder) return;
        // Só dispara quando o mouse está no espaço vazio da coluna (abaixo dos cards),
        // pois os cards chamam stopPropagation no seu próprio dragover.
        this._dragPlaceholder.remove();
        e.currentTarget.appendChild(this._dragPlaceholder);
    }

    async dropTask(e) {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');
        await this._handleDrop(e, e.currentTarget);
    }

    async _handleDrop(e, colEl) {
        const draggedId = e.dataTransfer.getData('text/plain');
        const newStatus = colEl?.dataset.status;
        if (!draggedId || !newStatus) return;

        // Lê a ordem do DOM: substitui o placeholder pelo id do card arrastado
        const elements = [...colEl.querySelectorAll('.kb-card:not(.dragging), .kb-drag-placeholder')];
        const ids = elements.map(el =>
            el.classList.contains('kb-drag-placeholder') ? draggedId : el.dataset.id
        ).filter(Boolean);

        // Garante que o card arrastado está na lista (coluna vazia)
        if (!ids.includes(draggedId)) ids.push(draggedId);

        const oldStatus = this._draggingFromStatus;
        if (oldStatus !== newStatus) {
            await store.updateTaskStatus(draggedId, newStatus);
            store.logTaskActivity(draggedId, 'status_change', { from: oldStatus, to: newStatus }).catch(() => {});
        }
        try {
            await store.reorderTasks(ids.map((id, pos) => ({ id, status: newStatus, position: pos })));
        } catch (err) {
            console.error('reorderTasks error:', err);
            Toast.show('Erro ao salvar ordem.', 'error');
        }
        await this.renderAll();
    }

    // ===================================
    // KANBAN — Quick-add
    // ===================================
    openQuickAdd(status) {
        document.getElementById(`kb-quick-add-${status}`).style.display = 'block';
        document.getElementById(`kb-add-btn-${status}`).style.display = 'none';
        const input = document.getElementById(`kb-quick-input-${status}`);
        input.value = '';
        setTimeout(() => input.focus(), 50);
    }

    closeQuickAdd(status) {
        document.getElementById(`kb-quick-add-${status}`).style.display = 'none';
        document.getElementById(`kb-add-btn-${status}`).style.display = 'flex';
    }

    async submitQuickAdd(status) {
        const input = document.getElementById(`kb-quick-input-${status}`);
        const title = input.value.trim();
        if (!title) { this.closeQuickAdd(status); return; }
        try {
            await store.addTask({ title, status, priority: 'medium' });
            this.closeQuickAdd(status);
            await this.renderAll();
        } catch (err) {
            Toast.show('Erro ao criar tarefa: ' + err.message, 'error');
        }
    }

    handleQuickAddKey(e, status) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.submitQuickAdd(status); }
        if (e.key === 'Escape') this.closeQuickAdd(status);
    }

    // ===================================
    // KANBAN — Modal helpers
    // ===================================
    _openNewTaskModal(status) {
        this._modalTaskId    = null;
        this._modalStatus    = status || 'new';
        this._modalLabels    = [];
        this._modalChecklist = [];
        this._modalCoverColor = null;
        document.getElementById('task-id').value = '';
        document.getElementById('task-title').value = '';
        document.getElementById('task-description').value = '';
        document.getElementById('task-client').value = '';
        document.getElementById('task-priority').value = 'medium';
        document.getElementById('task-due-date').value = '';
        document.getElementById('task-estimated-minutes').value = '';
        document.getElementById('btn-delete-task').style.display = 'none';
        document.getElementById('btn-add-time-task').style.display = 'none';
        this.taskAttachments = [];
        this._syncModalColumnButtons();
        this._syncModalCover();
        this._renderModalLabels();
        this._renderChecklist();
        this._renderTaskAttachmentPreviews();
        this.openModal('modal-task');
    }

    moveTaskToColumn(status) {
        const oldStatus = this._modalStatus;
        this._modalStatus = status;
        this._syncModalColumnButtons();
        const labels = { new: 'Novas', doing: 'Em Execução', done: 'Finalizadas' };
        document.getElementById('modal-task-column-label').textContent = labels[status] || '';
        if (this._modalTaskId && oldStatus !== status) {
            store.logTaskActivity(this._modalTaskId, 'status_change', { from: oldStatus, to: status })
                .then(() => store.getTask(this._modalTaskId))
                .then(t => { if (t) { this._modalComments = t.comments; this._renderTaskComments(); } })
                .catch(() => {});
        }
    }

    _syncModalColumnButtons() {
        const labels = { new: 'Novas', doing: 'Em Execução', done: 'Finalizadas' };
        document.querySelectorAll('.kb-col-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.status === this._modalStatus);
        });
        document.getElementById('modal-task-column-label').textContent = labels[this._modalStatus] || '';
    }

    _syncModalCover() {
        const cover = document.getElementById('modal-task-cover');
        if (this._modalCoverColor) {
            cover.style.background = this._modalCoverColor;
            cover.style.display = 'block';
        } else {
            cover.style.display = 'none';
        }
        this._renderCoverPicker();
    }

    setCoverColor(color) {
        this._modalCoverColor = color;
        this._syncModalCover();
    }

    _renderCoverPicker() {
        const picker = document.getElementById('kb-cover-picker');
        if (!picker) return;
        const colors = ['#4a9eff','#ff922b','#51cf66','#ffd43b','#cc5de8','#ff6b6b','#22d3ee','#f97316'];
        picker.innerHTML = `<button type="button" class="kb-cover-swatch kb-cover-none${!this._modalCoverColor ? ' active' : ''}"
            onclick="app.setCoverColor(null)" title="Sem cover"></button>` +
            colors.map(c => `<button type="button" class="kb-cover-swatch${this._modalCoverColor===c?' active':''}"
                style="background:${c}" onclick="app.setCoverColor('${c}')" title="${c}"></button>`).join('');
    }

    // ===================================
    // KANBAN — Labels
    // ===================================
    _renderLabelPicker() {
        const picker = document.getElementById('kb-label-picker');
        if (!picker) return;
        const colors = ['#4a9eff','#22d3ee','#51cf66','#a3e635','#ffd43b','#ff922b','#ff6b6b','#cc5de8'];
        picker.innerHTML = colors.map(c => {
            const active = this._modalLabels.some(l => l.color === c);
            return `<button type="button" class="kb-label-option${active?' selected':''}"
                style="background:${c}" onclick="app.toggleLabel('${c}')" title="${c}"></button>`;
        }).join('');
    }

    toggleLabel(color) {
        const idx = this._modalLabels.findIndex(l => l.color === color);
        if (idx >= 0) this._modalLabels.splice(idx, 1);
        else this._modalLabels.push({ color, text: '' });
        this._renderLabelPicker();
        this._renderModalLabels();
    }

    _renderModalLabels() {
        this._renderLabelPicker();
        const container = document.getElementById('kb-labels-applied');
        const section = document.getElementById('modal-labels-applied-section');
        if (!container || !section) return;
        if (this._modalLabels.length === 0) {
            section.style.display = 'none';
            container.innerHTML = '';
            return;
        }
        section.style.display = 'block';
        container.innerHTML = this._modalLabels.map(l =>
            `<span class="kb-label-applied-tag" style="background:${l.color}"
                onclick="app.toggleLabel('${l.color}')">${l.text || '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'}</span>`
        ).join('');
    }

    // ===================================
    // KANBAN — Checklist
    // ===================================
    _renderChecklist() {
        const container = document.getElementById('modal-checklist-items');
        const bar = document.getElementById('modal-checklist-bar-wrap');
        const fill = document.getElementById('modal-checklist-bar-fill');
        const progress = document.getElementById('modal-checklist-progress');
        if (!container) return;

        const list = this._modalChecklist;
        const done = list.filter(i => i.done).length;
        const total = list.length;
        const pct = total > 0 ? Math.round(done / total * 100) : 0;

        if (bar) bar.style.display = total > 0 ? 'block' : 'none';
        if (fill) fill.style.width = pct + '%';
        if (progress) progress.textContent = total > 0 ? `${done}/${total}` : '';

        container.innerHTML = list.map((item, idx) => `
            <div class="checklist-item">
                <input type="checkbox" ${item.done ? 'checked' : ''}
                       onchange="app.toggleChecklistItem(${idx})">
                <span class="checklist-item-text${item.done ? ' done' : ''}">${escapeHtml(item.text)}</span>
                <button type="button" class="checklist-item-delete"
                        onclick="app.deleteChecklistItem(${idx})" title="Remover">×</button>
            </div>
        `).join('');
    }

    addChecklistItem() {
        const input = document.getElementById('modal-checklist-new-item');
        const text = input.value.trim();
        if (!text) return;
        this._modalChecklist.push({ id: 'cl-' + Date.now(), text, done: false });
        input.value = '';
        this._renderChecklist();
    }

    handleChecklistItemKey(e) {
        if (e.key === 'Enter') { e.preventDefault(); this.addChecklistItem(); }
    }

    toggleChecklistItem(idx) {
        if (this._modalChecklist[idx]) {
            this._modalChecklist[idx].done = !this._modalChecklist[idx].done;
            this._renderChecklist();
        }
    }

    deleteChecklistItem(idx) {
        this._modalChecklist.splice(idx, 1);
        this._renderChecklist();
    }

    // ===================================
    // KANBAN — Filtros
    // ===================================
    clearKanbanFilters() {
        const fc = document.getElementById('filter-task-client');
        const fp = document.getElementById('filter-task-priority');
        const fl = document.getElementById('filter-task-label');
        if (fc) fc.value = '';
        if (fp) fp.value = '';
        if (fl) fl.value = '';
        this.renderTasks();
    }

    _populateLabelFilter(tasks) {
        const select = document.getElementById('filter-task-label');
        if (!select) return;
        const current = select.value;
        // Coletar cores únicas
        const colors = new Set();
        tasks.forEach(t => (t.labels || []).forEach(l => colors.add(l.color)));
        const extra = [...colors].map(c => `<option value="${c}" style="background:${c}">${c}</option>`).join('');
        select.innerHTML = `<option value="">Todas</option>${extra}`;
        if (current) select.value = current;
    }

    // Chamado após login bem-sucedido
    async initAfterAuth() {
        this.checkLocalStorageMigration();
        this.applySidebarState();
        this.applyMoneyVisibility();
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
            this.renderAgenda(),
            this.renderApontamentos(),
            this.renderImplementations()
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

        let stats = await Promise.all(clients.map(c => store.getClientStats(c.id)));
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
            if (stat.client.projectNum) card.title = `Projeto: ${stat.client.projectNum}`;
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

    toggleSidebar() {
        const collapsed = document.getElementById('sidebar').classList.toggle('collapsed');
        sessionStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
        const icon = document.getElementById('icon-sidebar-toggle');
        if (icon) {
            icon.setAttribute('data-lucide', collapsed ? 'chevron-right' : 'chevron-left');
            lucide.createIcons();
        }
        const toggle = document.getElementById('btn-sidebar-toggle');
        if (toggle) toggle.title = collapsed ? 'Expandir menu' : 'Recolher menu';
    }

    applySidebarState() {
        const stored = sessionStorage.getItem('sidebarCollapsed');
        const collapsed = stored === '1';
        document.getElementById('sidebar').classList.toggle('collapsed', collapsed);
        const icon = document.getElementById('icon-sidebar-toggle');
        if (icon) {
            icon.setAttribute('data-lucide', collapsed ? 'chevron-right' : 'chevron-left');
            lucide.createIcons();
        }
        const toggle = document.getElementById('btn-sidebar-toggle');
        if (toggle) toggle.title = collapsed ? 'Expandir menu' : 'Recolher menu';
    }

    toggleMoneyVisibility() {
        const hidden = document.body.classList.toggle('money-hidden');
        sessionStorage.setItem('moneyHidden', hidden ? '1' : '0');
        this._applyMoneyIcons(hidden);
    }

    applyMoneyVisibility() {
        const stored = sessionStorage.getItem('moneyHidden');
        const hidden = stored === null ? true : stored === '1';
        document.body.classList.toggle('money-hidden', hidden);
        this._applyMoneyIcons(hidden);
    }

    _applyMoneyIcons(hidden) {
        const lucideName = hidden ? 'eye-off' : 'eye';
        ['icon-toggle-money', 'icon-toggle-money-modal'].forEach(id => {
            const icon = document.getElementById(id);
            if (icon) icon.setAttribute('data-lucide', lucideName);
        });
        lucide.createIcons();
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
            const base43 = (c.clientPays && !isNaN(c.clientPays)) ? c.clientPays * 0.43 : 0;
            const bonus = c.consultantBonus || 0;
            const totalConsultant = base43 + bonus;
            const consultantReceives = formatMoney(totalConsultant);
            const detailsHtml = `
                <div style="font-size: 0.85rem; margin-top: 4px; color: var(--text-muted)">
                    <span><strong>CS:</strong> ${escapeHtml(c.csName) || '-'}</span> |
                    <span><strong>Proj:</strong> ${escapeHtml(c.projectNum) || '-'}</span> <br>
                    <span><strong>Paga:</strong> <span class="money-value">${clientPaysStr}</span></span> |
                    <span><strong>Recebe:</strong> <span class="money-value">${consultantReceives}</span></span>${bonus > 0 ? ` <span class="money-value" style="color: #4ade80; font-size:0.8rem">(+R$ ${bonus.toFixed(2).replace('.',',')} adicional)</span>` : ''}
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
        document.getElementById('consultant-bonus').value = client.consultantBonus || '';
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

            const isFilter = select.id === 'filter-client' || select.id === 'filter-task-client';
            const isTaskModal = select.id === 'task-client';
            select.innerHTML = isFilter
                ? '<option value="">Todos</option>'
                : (isTaskModal ? '<option value="">Sem cliente</option>' : '<option value="" disabled selected>-- Escolha um cliente --</option>');

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
        this._populateLabelFilter(tasks);

        const filterClient   = document.getElementById('filter-task-client')?.value;
        const filterPriority = document.getElementById('filter-task-priority')?.value;
        const filterLabel    = document.getElementById('filter-task-label')?.value;

        if (filterClient)   tasks = tasks.filter(t => t.clientId === filterClient);
        if (filterPriority) tasks = tasks.filter(t => t.priority === filterPriority);
        if (filterLabel)    tasks = tasks.filter(t => (t.labels || []).some(l => l.color === filterLabel));

        const cols = {
            new:   document.getElementById('kb-col-new'),
            doing: document.getElementById('kb-col-doing'),
            done:  document.getElementById('kb-col-done')
        };
        if (!cols.new) return;

        Object.values(cols).forEach(col => { if (col) col.innerHTML = spinnerHtml; });

        const clientIds = [...new Set(tasks.map(t => t.clientId).filter(Boolean))];
        const clientsMap = {};
        await Promise.all(clientIds.map(async id => { clientsMap[id] = await store.getClient(id); }));

        Object.values(cols).forEach(col => { if (col) col.innerHTML = ''; });
        const counts = { new: 0, doing: 0, done: 0 };

        tasks.forEach(task => {
            const status = task.status || 'new';
            if (counts[status] !== undefined) counts[status]++;
            const col = cols[status];
            if (!col) return;
            const card = this.createKanbanCard(task, clientsMap);
            col.appendChild(card);
        });

        document.getElementById('kb-count-new').textContent   = counts.new;
        document.getElementById('kb-count-doing').textContent = counts.doing;
        document.getElementById('kb-count-done').textContent  = counts.done;

        await this.renderTasksDashboard(tasks, filterClient);
        lucide.createIcons();
    }

    createKanbanCard(task, clientsMap) {
        const card = document.createElement('div');
        card.className = 'kb-card';
        card.draggable = true;
        card.dataset.id = task.id;

        card.addEventListener('dragstart', this.dragStart.bind(this));
        card.addEventListener('dragend', this.dragEnd.bind(this));
        card.addEventListener('click', (e) => {
            if (!e.target.closest('button')) this.handleEditTask(task.id);
        });
        card.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!this._dragPlaceholder || card === this._draggedCard) return;
            const rect = card.getBoundingClientRect();
            const mid = rect.top + rect.height / 2;
            if (e.clientY < mid) {
                card.parentNode.insertBefore(this._dragPlaceholder, card);
            } else {
                card.insertAdjacentElement('afterend', this._dragPlaceholder);
            }
        });
        card.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await this._handleDrop(e, card.closest('.kb-dropzone'));
        });

        const client = clientsMap[task.clientId];
        const clientName = client ? escapeHtml(client.name) : '';
        const today = new Date().toISOString().split('T')[0];

        // Cover
        const coverHtml = task.coverColor
            ? `<div class="kb-card-cover" style="background:${task.coverColor}"></div>` : '';

        // Labels
        const labelsHtml = (task.labels || []).length > 0
            ? `<div class="kb-card-labels">${task.labels.map(l =>
                `<span class="kb-label" style="background:${l.color}" title="${escapeHtml(l.text||'')}"></span>`
              ).join('')}</div>` : '';

        // Badges
        const priMap = { high: ['priority-high','Alta'], medium: ['priority-medium','Média'], low: ['priority-low','Baixa'] };
        const [priClass, priLabel] = priMap[task.priority] || priMap.medium;
        let badgesHtml = `<span class="kb-badge kb-badge-${priClass}">${priLabel}</span>`;

        if (task.dueDate && task.status !== 'done') {
            const overdue = task.dueDate < today;
            badgesHtml += `<span class="kb-badge${overdue ? ' kb-badge-due-overdue' : ''}">
                <i data-lucide="clock" style="width:10px;height:10px"></i> ${task.dueDate.split('-').reverse().join('/')}
            </span>`;
        }
        const cl = task.checklist || [];
        if (cl.length > 0) {
            const done = cl.filter(i => i.done).length;
            badgesHtml += `<span class="kb-badge"><i data-lucide="check-square" style="width:10px;height:10px"></i> ${done}/${cl.length}</span>`;
        }
        if ((task.attachments || []).length > 0) {
            badgesHtml += `<span class="kb-badge"><i data-lucide="paperclip" style="width:10px;height:10px"></i> ${task.attachments.length}</span>`;
        }
        if (task.estimatedMinutes > 0 || task.spentMinutes > 0) {
            badgesHtml += `<span class="kb-badge"><i data-lucide="clock-3" style="width:10px;height:10px"></i> ${task.spentMinutes}/${task.estimatedMinutes}m</span>`;
        }

        card.innerHTML = `
            ${coverHtml}
            ${labelsHtml}
            <p class="kb-card-title">${escapeHtml(task.title)}</p>
            <div class="kb-card-badges">${badgesHtml}</div>
            <div class="kb-card-footer">
                <span class="kb-card-client">${clientName}</span>
                <div class="kb-card-actions">
                    <button type="button" class="kb-action-btn" onclick="event.stopPropagation();app.handleEditTask('${task.id}')" title="Editar">
                        <i data-lucide="pencil" style="width:12px;height:12px"></i>
                    </button>
                    <button type="button" class="kb-action-btn kb-action-danger" onclick="event.stopPropagation();app.handleDeleteTask('${task.id}')" title="Excluir">
                        <i data-lucide="trash-2" style="width:12px;height:12px"></i>
                    </button>
                </div>
            </div>
        `;
        return card;
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
    openNewAgendaEvent(dateStr) {
        this.closeModal('modal-agenda-event');
        this.openModal('modal-agenda-event');
        document.getElementById('agenda-id').value = '';
        document.getElementById('agenda-date').value = dateStr;
        document.getElementById('agenda-date-end').value = dateStr;
        document.getElementById('btn-delete-agenda-event').style.display = 'none';
        this.toggleAllDayAgenda(false);
        // Reseta campos de Meet/participantes
        document.getElementById('agenda-meet-link').value = '';
        document.getElementById('agenda-attendees').value = '';
        document.getElementById('agenda-meet-link-block').style.display = 'none';
        document.getElementById('agenda-generate-meet').checked = false;
        // Mostra opção de Meet apenas se sync Google estiver ativo
        const syncChecked = document.getElementById('agenda-sync-google').checked;
        document.getElementById('agenda-generate-meet-row').style.display = syncChecked ? 'flex' : 'none';
    }

    toggleAllDayAgenda(isAllDay) {
        const cb = document.getElementById('agenda-all-day');
        const fields = document.getElementById('agenda-time-fields');
        const startInput = document.getElementById('agenda-start');
        const endInput = document.getElementById('agenda-end');
        if (cb) cb.checked = isAllDay;
        if (fields) fields.style.display = isAllDay ? 'none' : 'flex';
        if (startInput) startInput.required = !isAllDay;
        if (endInput) endInput.required = !isAllDay;
        if (isAllDay) {
            if (startInput) startInput.value = '';
            if (endInput) endInput.value = '';
        }
    }

    async switchAgendaMode(mode) {
        this.agendaViewMode = mode;
        document.getElementById('btn-agenda-schedule').classList.toggle('active-mode', mode === 'schedule');
        document.getElementById('btn-agenda-monthly').classList.toggle('active-mode', mode === 'monthly');
        document.getElementById('btn-agenda-weekly').classList.toggle('active-mode', mode === 'weekly');
        document.getElementById('btn-agenda-daily').classList.toggle('active-mode', mode === 'daily');
        await this.renderAgenda();
    }

    async prevAgendaDate() {
        if (this.agendaViewMode === 'daily') {
            this.agendaCurrentDate.setDate(this.agendaCurrentDate.getDate() - 1);
        } else if (this.agendaViewMode === 'monthly') {
            this.agendaCurrentDate.setMonth(this.agendaCurrentDate.getMonth() - 1);
        } else if (this.agendaViewMode === 'schedule') {
            this.agendaCurrentDate.setDate(this.agendaCurrentDate.getDate() - 30);
        } else {
            this.agendaCurrentDate.setDate(this.agendaCurrentDate.getDate() - 7);
        }
        await this.renderAgenda();
    }

    async nextAgendaDate() {
        if (this.agendaViewMode === 'daily') {
            this.agendaCurrentDate.setDate(this.agendaCurrentDate.getDate() + 1);
        } else if (this.agendaViewMode === 'monthly') {
            this.agendaCurrentDate.setMonth(this.agendaCurrentDate.getMonth() + 1);
        } else if (this.agendaViewMode === 'schedule') {
            this.agendaCurrentDate.setDate(this.agendaCurrentDate.getDate() + 30);
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

        const startDate = document.getElementById('agenda-date').value;
        const endDate = document.getElementById('agenda-date-end').value || startDate;
        const allDay = document.getElementById('agenda-all-day').checked;
        const syncGoogle = document.getElementById('agenda-sync-google').checked;
        const generateMeet = syncGoogle && document.getElementById('agenda-generate-meet').checked;
        const existingMeetLink = document.getElementById('agenda-meet-link').value || '';

        const eventData = {
            title: document.getElementById('agenda-title').value,
            description: document.getElementById('agenda-desc').value,
            type: document.getElementById('agenda-type').value,
            clientId: document.getElementById('agenda-client').value || null,
            relatedTaskId: document.getElementById('agenda-task').value || null,
            date: startDate,
            dateEnd: endDate < startDate ? startDate : endDate,
            startTime: allDay ? '' : document.getElementById('agenda-start').value,
            endTime: allDay ? '' : document.getElementById('agenda-end').value,
            location: document.getElementById('agenda-location').value,
            attendees: document.getElementById('agenda-attendees').value.trim(),
            generateMeet,
            meetLink: existingMeetLink
        };

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
                const existingCalId = document.getElementById('agenda-calendar-event-id').value || null;
                eventData.calendarEventId = existingCalId;
                if (syncGoogle) {
                    if (existingCalId) {
                        const upd = await calendarAPI.updateGoogleEvent(existingCalId, eventData);
                        if (upd && upd.meetLink) eventData.meetLink = upd.meetLink;
                    } else {
                        const result = await calendarAPI.createGoogleEvent(eventData);
                        if (result) {
                            eventData.calendarEventId = result.id;
                            if (result.meetLink) eventData.meetLink = result.meetLink;
                        }
                    }
                }
                await store.updateAgendaEvent(eventData);
            } else {
                if (syncGoogle) {
                    const result = await calendarAPI.createGoogleEvent(eventData);
                    if (result) {
                        eventData.calendarEventId = result.id;
                        if (result.meetLink) eventData.meetLink = result.meetLink;
                    }
                }
                const saved = await store.addAgendaEvent(eventData);
                if (saved) eventData.id = saved.id;
            }
            const newMeetGenerated = generateMeet && eventData.meetLink;
            if (newMeetGenerated) {
                // Mantém o modal aberto e exibe o link imediatamente
                document.getElementById('agenda-id').value = eventData.id || id;
                document.getElementById('agenda-calendar-event-id').value = eventData.calendarEventId || '';
                document.getElementById('agenda-meet-link').value = eventData.meetLink;
                document.getElementById('agenda-meet-link-display').href = eventData.meetLink;
                document.getElementById('agenda-meet-link-display').textContent = eventData.meetLink;
                document.getElementById('agenda-meet-link-block').style.display = 'flex';
                document.getElementById('agenda-generate-meet-row').style.display = 'none';
                document.getElementById('agenda-generate-meet').checked = false;
                document.getElementById('modal-agenda-title').innerText = id ? 'Agendamento atualizado' : 'Agendamento criado';
                navigator.clipboard.writeText(eventData.meetLink).catch(() => {});
                Toast.show('Agendamento salvo! Link Meet gerado e copiado.', 'success');
                this.renderAgenda();
            } else {
                this.closeModal('modal-agenda-event');
                await this.renderAgenda();
                Toast.show(id ? 'Agendamento atualizado.' : 'Agendamento criado.', 'success');
            }
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
        document.getElementById('agenda-date-end').value = ev.dateEnd || ev.date;
        const isAllDay = !ev.startTime;
        this.toggleAllDayAgenda(isAllDay);
        if (!isAllDay) {
            document.getElementById('agenda-start').value = ev.startTime;
            document.getElementById('agenda-end').value = ev.endTime;
        }
        document.getElementById('agenda-location').value = ev.location;
        document.getElementById('agenda-calendar-event-id').value = ev.calendarEventId || '';
        document.getElementById('agenda-sync-google').checked = calendarAPI.isEnabled;
        document.getElementById('btn-delete-agenda-event').style.display = 'flex';

        // Meet e participantes
        document.getElementById('agenda-meet-link').value = ev.meetLink || '';
        document.getElementById('agenda-attendees').value = ev.attendees || '';
        const meetBlock = document.getElementById('agenda-meet-link-block');
        if (ev.meetLink) {
            meetBlock.style.display = 'flex';
            document.getElementById('agenda-meet-link-display').href = ev.meetLink;
            document.getElementById('agenda-meet-link-display').textContent = ev.meetLink;
        } else {
            meetBlock.style.display = 'none';
        }
        // Se já tem Meet link, oculta a checkbox de gerar (já existe)
        const genMeetRow = document.getElementById('agenda-generate-meet-row');
        genMeetRow.style.display = ev.meetLink ? 'none' : 'flex';
        document.getElementById('agenda-generate-meet').checked = false;

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

    async deleteAgendaEventFromModal() {
        const id = document.getElementById('agenda-id').value;
        if (!id) return;
        if (confirm("Deseja deletar este agendamento?")) {
            try {
                const ev = await store.getAgendaEvent(id);
                if (ev && ev.calendarEventId && calendarAPI.isAuthenticated) {
                    await calendarAPI.deleteGoogleEvent(ev.calendarEventId);
                }
                await store.deleteAgendaEvent(id);
                this.closeModal('modal-agenda-event');
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
        } else if (this.agendaViewMode === 'monthly') {
            await this.renderAgendaMonthly(container);
        } else if (this.agendaViewMode === 'schedule') {
            await this.renderAgendaSchedule(container);
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

        const allDayEvents = events.filter(ev => !ev.startTime);
        const timedEvents = events.filter(ev => ev.startTime);

        let allDayHtml = allDayEvents.map(ev => this.createAllDayBannerHtml(ev, clientsMap)).join('');
        let eventsHtml = timedEvents.map(ev => this.createEventBlockHtml(ev, '100%', clientsMap)).join('');

        const allDaySection = allDayEvents.length > 0
            ? `<div class="agenda-allday-row"><div class="agenda-allday-label">Dia inteiro</div><div class="agenda-allday-events">${allDayHtml}</div></div>`
            : '';

        container.innerHTML = `
            <div class="agenda-grid">
                <div class="agenda-time-column">
                    ${this.generateTimeSlots()}
                </div>
                <div class="agenda-content-column">
                    <div class="agenda-days-row" style="grid-template-columns: 1fr;">
                        <div class="agenda-day-header active">${this.formatDateBR(this.agendaCurrentDate)}</div>
                    </div>
                    ${allDaySection}
                    <div class="events-container" style="cursor: pointer;"
                         onclick="app.openNewAgendaEvent('${isoDate}')">
                        <div class="agenda-grid-lines"></div>
                        ${eventsHtml}
                    </div>
                </div>
            </div>
        `;
    }

    async renderAgendaWeekly(container) {
        const monday = this.getMonday(this.agendaCurrentDate);
        const sunday = new Date(monday);
        sunday.setDate(sunday.getDate() + 6);

        const isoStart = monday.toISOString().split('T')[0];
        const isoEnd = sunday.toISOString().split('T')[0];

        document.getElementById('agenda-current-date-label').innerText =
            `${this.formatDateBR(monday)} - ${this.formatDateBR(sunday)}`;

        const events = await store.getEventsByWeek(isoStart, isoEnd);

        const clientIds = [...new Set(events.map(e => e.clientId).filter(Boolean))];
        const clientsMap = {};
        await Promise.all(clientIds.map(async id => { clientsMap[id] = await store.getClient(id); }));

        const days = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
        let headersHtml = '';
        let allDayRowHtml = '';
        let columnsHtml = '';
        let hasAnyAllDay = false;

        for (let i = 0; i < 7; i++) {
            const currentDay = new Date(monday);
            currentDay.setDate(monday.getDate() + i);
            const isoCurrentDay = currentDay.toISOString().split('T')[0];
            const isToday = isoCurrentDay === new Date().toISOString().split('T')[0];

            headersHtml += `<div class="agenda-day-header ${isToday ? 'active' : ''}">${days[i]}<br><small>${currentDay.getDate()}/${currentDay.getMonth() + 1}</small></div>`;

            const dayEvents = events.filter(e => e.date <= isoCurrentDay && (e.dateEnd || e.date) >= isoCurrentDay);
            const allDayDayEvents = dayEvents.filter(ev => !ev.startTime);
            const timedDayEvents = dayEvents.filter(ev => ev.startTime);

            if (allDayDayEvents.length > 0) hasAnyAllDay = true;
            allDayRowHtml += `<div class="agenda-allday-col">${allDayDayEvents.map(ev => this.createAllDayBannerHtml(ev, clientsMap)).join('')}</div>`;

            let dayEventsHtml = timedDayEvents.map(ev => this.createEventBlockHtml(ev, 'calc(100% - 8px)', clientsMap)).join('');
            columnsHtml += `
                <div style="position: relative; height: 100%; cursor: pointer;"
                     onclick="app.openNewAgendaEvent('${isoCurrentDay}')">
                    ${dayEventsHtml}
                </div>
            `;
        }

        const allDayWeekSection = hasAnyAllDay
            ? `<div class="agenda-allday-row agenda-allday-week"><div class="agenda-allday-label">Dia inteiro</div><div class="agenda-allday-events" style="display:grid; grid-template-columns: repeat(7, 1fr); gap:4px;">${allDayRowHtml}</div></div>`
            : '';

        container.innerHTML = `
            <div class="agenda-grid">
                <div class="agenda-time-column">
                    ${this.generateTimeSlots()}
                </div>
                <div class="agenda-content-column">
                    <div class="agenda-days-row" style="grid-template-columns: repeat(7, 1fr);">
                        ${headersHtml}
                    </div>
                    ${allDayWeekSection}
                    <div class="events-container" style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px;">
                        <div class="agenda-grid-lines"></div>
                        ${columnsHtml}
                    </div>
                </div>
            </div>
        `;
    }

    async renderAgendaMonthly(container) {
        const year = this.agendaCurrentDate.getFullYear();
        const month = this.agendaCurrentDate.getMonth();
        const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                            'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
        document.getElementById('agenda-current-date-label').innerText = `${monthNames[month]} ${year}`;

        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);

        // Start grid on the Monday on or before the 1st
        const startGrid = new Date(firstDay);
        const dowFirst = startGrid.getDay();
        startGrid.setDate(startGrid.getDate() - (dowFirst === 0 ? 6 : dowFirst - 1));

        // End grid on the Sunday on or after the last day
        const endGrid = new Date(lastDay);
        const dowLast = endGrid.getDay();
        if (dowLast !== 0) endGrid.setDate(endGrid.getDate() + (7 - dowLast));

        const isoStart = startGrid.toISOString().split('T')[0];
        const isoEnd = endGrid.toISOString().split('T')[0];

        const events = await store.getEventsByWeek(isoStart, isoEnd);

        const clientIds = [...new Set(events.map(e => e.clientId).filter(Boolean))];
        const clientsMap = {};
        await Promise.all(clientIds.map(async id => { clientsMap[id] = await store.getClient(id); }));

        const todayIso = new Date().toISOString().split('T')[0];
        const dayNames = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

        const headerHtml = dayNames.map(d => `<div class="agenda-month-col-header">${d}</div>`).join('');

        let cellsHtml = '';
        const cursor = new Date(startGrid);
        while (cursor <= endGrid) {
            const iso = cursor.toISOString().split('T')[0];
            const isCurrentMonth = cursor.getMonth() === month;
            const isToday = iso === todayIso;
            const dayEvents = events.filter(e => e.date <= iso && (e.dateEnd || e.date) >= iso);

            let eventsHtml = '';
            dayEvents.forEach(ev => {
                const timeLabel = ev.startTime ? `${ev.startTime} - ${ev.endTime}` : 'Dia inteiro';
                eventsHtml += `<div class="agenda-month-event type-${ev.type}"
                     onclick="event.stopPropagation(); app.editAgendaEvent('${ev.id}')"
                     title="${escapeHtml(ev.title)} (${timeLabel})">
                    ${escapeHtml(ev.title)}
                </div>`;
            });

            cellsHtml += `
                <div class="agenda-month-cell ${!isCurrentMonth ? 'other-month' : ''} ${isToday ? 'today' : ''}"
                     onclick="app.openNewAgendaEvent('${iso}')" style="cursor: pointer;">
                    <div class="agenda-month-day-num">${cursor.getDate()}</div>
                    <div class="agenda-month-events">${eventsHtml}</div>
                </div>`;

            cursor.setDate(cursor.getDate() + 1);
        }

        container.innerHTML = `
            <div class="agenda-monthly-calendar">
                <div class="agenda-month-header-row">${headerHtml}</div>
                <div class="agenda-month-grid">${cellsHtml}</div>
            </div>
        `;
    }

    async renderAgendaSchedule(container) {
        const monthNames = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        const dayNames = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

        const startDate = new Date(this.agendaCurrentDate);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 89);

        const isoStart = startDate.toISOString().split('T')[0];
        const isoEnd = endDate.toISOString().split('T')[0];

        const startLabel = `${monthNames[startDate.getMonth()]}. ${startDate.getFullYear()}`;
        const endLabel = `${monthNames[endDate.getMonth()]}. ${endDate.getFullYear()}`;
        document.getElementById('agenda-current-date-label').innerText =
            (startDate.getMonth() === endDate.getMonth() && startDate.getFullYear() === endDate.getFullYear())
                ? startLabel
                : `${startLabel} – ${endLabel}`;

        const events = await store.getEventsByWeek(isoStart, isoEnd);
        events.sort((a, b) => a.date !== b.date ? a.date.localeCompare(b.date) : a.startTime.localeCompare(b.startTime));

        const clientIds = [...new Set(events.map(e => e.clientId).filter(Boolean))];
        const clientsMap = {};
        await Promise.all(clientIds.map(async id => { clientsMap[id] = await store.getClient(id); }));

        const todayIso = new Date().toISOString().split('T')[0];

        const eventsByDate = {};
        events.forEach(ev => {
            if (!eventsByDate[ev.date]) eventsByDate[ev.date] = [];
            eventsByDate[ev.date].push(ev);
        });

        // Show days that have events + today if within range
        const datesToShow = new Set(Object.keys(eventsByDate));
        if (todayIso >= isoStart && todayIso <= isoEnd) datesToShow.add(todayIso);
        const sortedDates = [...datesToShow].sort();

        if (sortedDates.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding: 60px; color: var(--text-muted); font-size: 0.95rem;">Nenhum agendamento encontrado neste período.</div>`;
            return;
        }

        let html = '<div class="agenda-schedule-view">';
        let lastMonth = null;

        sortedDates.forEach(dateStr => {
            const dateObj = new Date(dateStr + 'T00:00:00');
            const monthKey = `${dateObj.getFullYear()}-${dateObj.getMonth()}`;
            const isToday = dateStr === todayIso;
            const dayEvents = eventsByDate[dateStr] || [];

            // Month separator
            if (monthKey !== lastMonth) {
                lastMonth = monthKey;
                html += `<div class="schedule-month-separator">${monthNames[dateObj.getMonth()]}. ${dateObj.getFullYear()}</div>`;
            }

            html += `<div class="schedule-day-row">
                <div class="schedule-date-label">
                    <div class="schedule-day-num ${isToday ? 'today' : ''}">${dateObj.getDate()}</div>
                    <div class="schedule-day-info">${monthNames[dateObj.getMonth()].toUpperCase()}., ${dayNames[dateObj.getDay()]}.</div>
                </div>
                <div class="schedule-events">`;

            if (dayEvents.length === 0) {
                html += `<div class="schedule-no-events">Sem agendamentos</div>`;
            } else {
                dayEvents.forEach(ev => {
                    const clientName = ev.clientId && clientsMap[ev.clientId]
                        ? `<span class="schedule-event-client">${escapeHtml(clientsMap[ev.clientId].name)}</span>`
                        : '';
                    const meetBadge = ev.meetLink
                        ? `<a href="${escapeHtml(ev.meetLink)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Entrar no Google Meet" style="color:#34d399; display:inline-flex; align-items:center; gap:3px; font-size:0.75rem; margin-left:6px;"><i data-lucide="video" style="width:12px; height:12px;"></i> Meet</a>`
                        : '';
                    html += `<div class="schedule-event" onclick="app.editAgendaEvent('${ev.id}')">
                        <div class="schedule-event-dot type-${ev.type}"></div>
                        <div class="schedule-event-time">${ev.startTime ? `${ev.startTime} – ${ev.endTime}` : '<span style="font-style:italic; opacity:0.8;">Dia inteiro</span>'}</div>
                        <div class="schedule-event-info">
                            <span class="schedule-event-title">${escapeHtml(ev.title)}</span>
                            ${clientName}${meetBadge}
                        </div>
                    </div>`;
                });
            }

            html += `</div></div>`;
        });

        html += '</div>';
        container.innerHTML = html;
    }

    createAllDayBannerHtml(ev, clientsMap = {}) {
        const typeClass = 'type-' + ev.type;
        const clientName = ev.clientId && clientsMap[ev.clientId]
            ? escapeHtml(clientsMap[ev.clientId].name) : '';
        return `<div class="allday-event-banner ${typeClass}"
                     onclick="event.stopPropagation(); app.editAgendaEvent('${ev.id}')"
                     title="${escapeHtml(ev.title)}${clientName ? ' · ' + clientName : ''}">
            <i data-lucide="sun" style="width:11px; height:11px; flex-shrink:0;"></i>
            <span>${escapeHtml(ev.title)}${clientName ? ' · ' + clientName : ''}</span>
        </div>`;
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
                 onclick="event.stopPropagation(); app.editAgendaEvent('${ev.id}')">

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
                       ${ev.meetLink ? `<a href="${escapeHtml(ev.meetLink)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Entrar no Google Meet" style="color:#34d399; display:flex; align-items:center;"><i data-lucide="video" style="width:11px; height:11px;"></i></a>` : ''}
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
            // Erros parciais (alguns eventos falharam mas outros foram salvos)
            const msg = error.message && error.message.includes('falharam')
                ? error.message
                : 'Erro durante a sincronização.';
            Toast.show(msg, 'warning');
        } finally {
            btn.innerHTML = '<i data-lucide="refresh-cw"></i> Sincronizar Google';
            btn.disabled = false;
            this.renderAgenda();
        }
    }

    async executeBiDirectionalSync() {
        // Fetch do google (ultimos 30 dias até proximos 30) — inclui todos os calendários
        const googleEvents = await calendarAPI.syncEventsFromGoogle(30);
        if (!googleEvents) return;

        const localEvents = await store.getAgendaEvents();
        let syncErrors = 0;

        // 1. O que tem no Google que não temos (ou foi atualizado lá)
        for (const gEv of googleEvents) {
            if (gEv.status === 'cancelled') continue;

            try {
                // Procura localmente pelo ID do google
                const match = localEvents.find(le => le.calendarEventId === gEv.id);

                let evDate = '';
                let evStart = '';
                let evEnd = '';
                let evDateEnd = '';

                // Google lida com dateTime e date (allDay)
                if (gEv.start && gEv.start.dateTime) {
                    const startObj = new Date(gEv.start.dateTime);
                    const endObj = new Date(gEv.end.dateTime);

                    // Formata local YYYY-MM-DD
                    evDate = startObj.getFullYear() + "-" + String(startObj.getMonth() + 1).padStart(2, '0') + "-" + String(startObj.getDate()).padStart(2, '0');
                    evStart = String(startObj.getHours()).padStart(2, '0') + ":" + String(startObj.getMinutes()).padStart(2, '0');
                    evEnd = String(endObj.getHours()).padStart(2, '0') + ":" + String(endObj.getMinutes()).padStart(2, '0');
                    evDateEnd = evDate;
                } else if (gEv.start && gEv.start.date) {
                    evDate = gEv.start.date;
                    // Google end date is exclusive for all-day events; subtract 1 day
                    if (gEv.end && gEv.end.date) {
                        const d = new Date(gEv.end.date + 'T12:00:00');
                        d.setDate(d.getDate() - 1);
                        evDateEnd = d.toISOString().split('T')[0];
                    } else {
                        evDateEnd = evDate;
                    }
                }

                if (!evDate) continue; // Pula se n conseguir extrair data

                const mappedData = {
                    title: gEv.summary || 'Sem Título',
                    description: gEv.description || '',
                    type: 'meeting',
                    location: gEv.location || '',
                    date: evDate,
                    dateEnd: evDateEnd || evDate,
                    startTime: evStart,
                    endTime: evEnd,
                    calendarEventId: gEv.id,
                    meetLink: gEv.hangoutLink || '',
                    attendees: (gEv.attendees || []).map(a => a.email).join(', ')
                };

                if (match) {
                    mappedData.id = match.id;
                    mappedData.type = match.type; // Preserva o tipo customizado do TSP
                    mappedData.clientId = match.clientId;
                    mappedData.relatedTaskId = match.relatedTaskId;
                    if (!mappedData.meetLink) mappedData.meetLink = match.meetLink || '';
                    await store.updateAgendaEvent(mappedData);
                } else {
                    await store.addAgendaEvent(mappedData);
                }
            } catch (err) {
                console.error('Erro ao sincronizar evento do Google:', gEv.summary, err);
                syncErrors++;
            }
        }

        // 2. Empurra eventos locais que NUNCA foram enviados ao Google (sem calendarEventId)
        for (const le of localEvents) {
            if (le.calendarEventId) continue; // Já existe no Google (mesmo que fora da janela atual)
            try {
                const result = await calendarAPI.createGoogleEvent(le);
                if (result) {
                    le.calendarEventId = result.id;
                    if (result.meetLink) le.meetLink = result.meetLink;
                    await store.updateAgendaEvent(le);
                }
            } catch (err) {
                console.error('Erro ao empurrar evento para o Google:', le.title, err);
                syncErrors++;
            }
        }

        if (syncErrors > 0) throw new Error(`${syncErrors} evento(s) falharam na sincronização`);
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

                const pageTexts = [];
                for (let i = 1; i <= pdf.numPages; i++) {
                    setBtn(`<span style="display:inline-flex;align-items:center;gap:8px;">${spinner}Lendo página ${i} de ${pdf.numPages}...</span>`);
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    pageTexts.push(textContent.items.map(item => item.str).join(' '));
                }

                const totalExtractedChars = pageTexts.reduce((sum, t) => sum + t.trim().length, 0);
                if (totalExtractedChars < 20) {
                    Toast.show(
                        'Este PDF parece ser baseado em imagem (escaneado) e não contém texto legível. ' +
                        'O sistema não consegue extrair os dados automaticamente. ' +
                        'Por favor, gere novamente a Ata no SAP com a opção de exportação em PDF com texto (não escaneado).',
                        'error',
                        10000
                    );
                    return;
                }

                setBtn(`<span style="display:inline-flex;align-items:center;gap:8px;">${spinner}Identificando projetos...</span>`);
                const { records, warnings: pdfWarnings } = this.parsePdfPages(pageTexts);

                if (records && records.length > 0) {
                    setBtn(`<span style="display:inline-flex;align-items:center;gap:8px;">${spinner}Identificando clientes...</span>`);
                    this.pendingPdfRecords = records;
                    this.pendingPdfWarnings = pdfWarnings;
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

    parsePdfPages(pageTexts) {
        const allRecords = [];
        const warnings = [];

        for (let i = 0; i < pageTexts.length; i++) {
            const result = this._parseSinglePage(pageTexts[i], i + 1);
            allRecords.push(...result.records);
            warnings.push(...result.warnings);
        }

        if (warnings.length > 0) {
            console.warn('[PDF Import] Avisos:', warnings.join(' | '));
        }

        return { records: allRecords, warnings };
    }

    _parseSinglePage(text, pageNum) {
        const records = [];
        const warnings = [];

        // === 1. NÚMERO DO PROJETO + NOME DO CLIENTE ===
        // SAP format: "Projeto.: 22851   17 - CASCAVEL MAQUINAS AGRICOLAS LTDA 001 CVEL"
        // PDF.js pode inverter: "22851 Projeto.:   17 - CASCAVEL..."
        // Abordagem linha-a-linha: encontra a linha com "Projeto.:" e extrai número + tudo que segue
        let projectNum = '';
        let clientNamePdf = '';

        // 1a. Captura o número do projeto, ancorado em "Projeto.:"
        // \s* antes de [.:] tolera PDF.js separando "Projeto " + ".:NNNNN" com espaço
        let projMatch = text.match(/Projeto\s*[.:]+\s*(\d{4,6})/i);
        if (!projMatch) {
            // PDF.js pode inverter: "22851 Projeto.:"
            projMatch = text.match(/(?:^|\s)(\d{4,6})\s+Projeto\s*[.:]+/i);
        }
        if (!projMatch) {
            // Tecinco: linha Ref "( Projeto 26581 )" quando header é col-by-col
            projMatch = text.match(/\(\s*Projeto\s+(\d{4,6})\s*\)/i);
        }
        if (projMatch) projectNum = projMatch[1].trim();

        if (!projectNum) return { records, warnings };

        // 1b. Busca o nome do cliente no texto inteiro da página.
        // PDF.js junta todos os items da página com espaço (sem \n) e pode reordenar visualmente,
        // então o nome pode não estar adjacente ao número do projeto.
        // Padrão: "NN - NOME EM CAIXA ALTA" — empresas SAP são sempre maiúsculas (CASCAVEL MAQUINAS AGRICOLAS LTDA).
        // O filtro de caixa alta evita falsos positivos como "WG001 - Exportação..." da descrição (tem minúsculas).
        const nameRegex = /(\d{1,5}\s*[-–]\s*[A-ZÀ-Ü][A-ZÀ-Ü0-9\s.,&/'()-]{2,}?)(?=\s+Data\s*[.:]+|\s+Horas\s+(?:contratadas|executadas)|\s+Descri[çc][ãa]o|\s+Tarefa\s+Executada|$)/;
        const nameMatch = text.match(nameRegex);
        if (nameMatch) {
            clientNamePdf = nameMatch[1].replace(/\s{2,}/g, ' ').trim();
        }

        // Limita tamanho do nome
        if (clientNamePdf.length > 120) clientNamePdf = clientNamePdf.substring(0, 120).trim();

        // === 2. DATA ===
        // Formato primário: "Data......: 09/04/2026" (\s* tolera espaço entre "Data" e os pontos)
        // Formato secundário: "Horas Aplicadas no Dia 09/04/2026"
        let dateStr = '';
        const dateA = text.match(/Data\s*[.:]+\s*(\d{2}\/\d{2}\/\d{4})/i);
        if (dateA) {
            dateStr = dateA[1];
        } else {
            const dateB = text.match(/Horas\s+Aplicadas\s+no\s+Dia\s+(\d{2}\/\d{2}\/\d{4})/i);
            if (dateB) dateStr = dateB[1];
        }

        if (!dateStr) {
            warnings.push(`Pág.${pageNum} (Proj.${projectNum}): data não encontrada — página ignorada`);
            return { records, warnings };
        }

        const [d, m, y] = dateStr.split('/');
        const isoDate = `${y}-${m}-${d}`;

        // === 3. DESCRIÇÃO GLOBAL DO ATENDIMENTO ===
        // Entre "Descrição do Atendimento" e "Horas Aplicadas no Dia DD/MM/YYYY"
        let description = '';
        const descLabelMatch = text.match(/Descri..o\s+do\s+Atendimento/i);
        if (descLabelMatch) {
            const afterLabel = descLabelMatch.index + descLabelMatch[0].length;
            const textAfterLabel = text.substring(afterLabel);
            // Termina em "Horas Aplicadas no Dia DD/MM/YYYY" ou "Hora Inicial"
            const endIdx = textAfterLabel.search(/Horas\s+Aplicadas\s+no\s+Dia\s+\d{2}\/\d{2}\/\d{4}|Hora\s+Inicial\s+Hora\s+Final/i);
            const rawDesc = endIdx !== -1
                ? textAfterLabel.substring(0, endIdx)
                : textAfterLabel.substring(0, 600);
            description = rawDesc
                // Remove "Horas contratadas/executadas" que o PDF.js injeta na descrição por inversão de colunas
                .replace(/[\d:]+\s+Horas\s+contratadas[.:]*\s*[\d:]*\s*Horas\s+executadas[.:]*\s*[\d:]*/gi, '')
                .replace(/Horas\s+(?:contratadas|executadas)[.:]*\s*[\d:]*/gi, '')
                .replace(/\s{2,}/g, ' ')
                .trim();
        }

        if (!description) description = 'Importado via Ata PDF';
        if (description.length > 800) description = description.substring(0, 800).trim();

        // === 4. LINHAS DA TABELA DE HORAS ===
        // Formato antigo: "Horas Aplicadas no Dia DD/MM" vem antes das colunas (Hora Inicial | Hora Final | Horas Aplicadas | Analista)
        // Formato novo:   colunas (Tarefa Executada | Analista | Hora Inicial | Hora Final | Total Horas) vêm antes de "Horas Aplicadas no Dia DD/MM"
        // Âncora primária: "Horas Aplicadas no Dia DD/MM/YYYY" — seção imediatamente antes das linhas de dados em ambos os formatos.
        // Fallback: "Hora Inicial Hora Final" (funciona quando PDF.js extrai linha-a-linha e os cabeçalhos ficam adjacentes).
        const totalHorasIdx = text.search(/Total\s+Horas\s+Dia/i);

        let tableAnchorIdx = text.search(/Horas\s+Aplicadas\s+no\s+Dia\s+\d{2}\/\d{2}\/\d{4}/i);
        if (tableAnchorIdx === -1) {
            tableAnchorIdx = text.search(/Hora\s+Inicial\s+Hora\s+Final/i);
        }

        let tableText = text;
        let anchorStart = -1;
        if (tableAnchorIdx !== -1) {
            // Avança ~35 chars para pular a linha âncora ("Horas Aplicadas no Dia DD/MM/YYYY")
            const afterAnchor = text.indexOf(' ', tableAnchorIdx + 30);
            anchorStart = afterAnchor !== -1 ? afterAnchor : tableAnchorIdx;
            tableText = text.substring(anchorStart);
        }
        if (totalHorasIdx !== -1 && anchorStart !== -1) {
            // tableEnd calculado a partir de anchorStart (não tableAnchorIdx) para não incluir
            // a linha "Total Horas Dia.: XX:XX" no tableText usado pelo fallback
            const tableEnd = totalHorasIdx - anchorStart;
            if (tableEnd > 0) tableText = tableText.substring(0, tableEnd);
        }

        const pad2 = n => String(n).padStart(2, '0');
        const processTimeTriplet = (startTime, endTime, horasAplicadas) => {
            const [sH, sM] = startTime.split(':').map(Number);
            const [eH, eM] = endTime.split(':').map(Number);
            // SAP às vezes usa notação centesimal também em Hora Inicial/Final (ex: 16:75 = 16h45m)
            const normStart = sM > 59
                ? `${pad2(sH)}:${pad2(Math.round(sM * 60 / 100))}`
                : startTime;
            const normEnd = eM > 59
                ? `${pad2(eH)}:${pad2(Math.round(eM * 60 / 100))}`
                : endTime;
            const [aH, aC] = horasAplicadas.split(':').map(Number);
            const diffMins = Math.round((aH * 100 + aC) / 100 * 60);
            if (diffMins <= 0) return;
            records.push({ clientProjectPdf: projectNum, clientNamePdf, dateStrBrazil: dateStr, date: isoDate, startTime: normStart, endTime: normEnd, minutes: diffMins, description });
        };

        // Estratégia primária: encontra triplas adjacentes HH:MM HH:MM HH:MM (linha por linha)
        const timeRegex = /(\d{2}:\d{2})\s+(\d{2}:\d{2})\s+(\d{2}:\d{2})/g;
        let timeMatch;
        while ((timeMatch = timeRegex.exec(tableText)) !== null) {
            processTimeTriplet(timeMatch[1], timeMatch[2], timeMatch[3]);
        }

        // Estratégia fallback: PDF.js extraiu o PDF coluna por coluna (ex: Tecinco/TCar).
        // Nesse caso os horários não são adjacentes: "14:00 Hora Final 18:00 Total Horas 04:00".
        // Extrai todos os HH:MM do tableText e agrupa em triplas (start, end, total).
        if (records.length === 0) {
            console.log(`[PDF Import] Pág.${pageNum}: regex primário falhou, tentando fallback coluna-por-coluna. tableText:`, tableText);
            // Filtra apenas tokens HH:MM onde HH é um número com 2 dígitos e não faz parte de um número maior
            const allTimes = [...tableText.matchAll(/(?<!\d)(\d{2}:\d{2})(?!\d)/g)].map(m => m[1]);
            if (allTimes.length >= 3 && allTimes.length % 3 === 0) {
                for (let i = 0; i < allTimes.length; i += 3) {
                    processTimeTriplet(allTimes[i], allTimes[i + 1], allTimes[i + 2]);
                }
            } else if (allTimes.length >= 3) {
                // Pode haver tempos extras (ex: "Total Horas Dia 04:00" incluído); tenta agrupar os primeiros 3N
                const usable = allTimes.slice(0, Math.floor(allTimes.length / 3) * 3);
                for (let i = 0; i < usable.length; i += 3) {
                    processTimeTriplet(usable[i], usable[i + 1], usable[i + 2]);
                }
            }
        }

        // === 5. VALIDAÇÃO: soma vs Total Horas Dia ===
        const totalMatch = text.match(/Total\s+Horas\s+Dia[.:]+\s*(\d{2}):(\d{2})/i);
        if (totalMatch && records.length > 0) {
            const tH = parseInt(totalMatch[1], 10);
            const tC = parseInt(totalMatch[2], 10);
            // Centesimal → minutos reais: (HH * 100 + CC) / 100 * 60
            const totalMinutes = Math.round((tH * 100 + tC) / 100 * 60);
            const sumMinutes = records.reduce((s, r) => s + r.minutes, 0);
            if (Math.abs(sumMinutes - totalMinutes) > 2) {
                const warnMsg = `Pág.${pageNum} (${dateStr}, Proj.${projectNum}): soma dos registros = ${sumMinutes}min ≠ Total Horas Dia = ${totalMinutes}min`;
                warnings.push(warnMsg);
                console.warn(`[PDF Import] Divergência de horas — Pág.${pageNum}: ${dateStr} Proj.${projectNum} soma=${sumMinutes}min total=${totalMinutes}min`);
                records.forEach(r => { r._warningMsg = warnMsg; });
            }
        }

        return { records, warnings };
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
                    const clientName = this.pendingPdfRecords.find(r =>
                        r.clientProjectPdf.replace(/\D/g, '') === searchNum && r.clientNamePdf
                    )?.clientNamePdf || `Projeto ${projectNum}`;
                    targetClient = await store.addClient(
                        clientName, 0, '', projectNum, 0,
                        0,
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

        const warningsEl = document.getElementById('pdf-warnings');
        const warnings = this.pendingPdfWarnings || [];
        if (warnings.length > 0) {
            warningsEl.innerHTML = `<strong>⚠ Divergência de horas detectada em ${warnings.length} página(s):</strong><ul style="margin:6px 0 0 16px;padding:0;">${warnings.map(w => `<li>${w}</li>`).join('')}</ul>`;
            warningsEl.style.display = 'block';
        } else {
            warningsEl.style.display = 'none';
            warningsEl.innerHTML = '';
        }

        document.getElementById('modal-import-pdf').classList.add('active');

        const tbody = document.querySelector('#pdf-records-table tbody');
        tbody.innerHTML = '';

        this.pendingPdfRecords.forEach((r, idx) => {
            const tr = document.createElement('tr');
            const warnIcon = r._warningMsg
                ? `<span title="${r._warningMsg.replace(/"/g, '&quot;')}" style="margin-left:4px;color:var(--warning-color,#f59e0b);cursor:help;">⚠</span>`
                : '';
            tr.innerHTML = `
                <td style="font-size: 0.9rem;">${r.dateStrBrazil}</td>
                <td style="font-size: 0.9rem; font-weight: 500; color: var(--primary-color);">${r.matchedClientName}${r.autoCreated ? ' <span style="font-size:0.75rem;background:var(--primary-color);color:#fff;border-radius:4px;padding:1px 5px;">Novo</span>' : ''}</td>
                <td style="font-size: 0.9rem;">${r.startTime} - ${r.endTime}</td>
                <td style="font-size: 0.9rem;">${Math.floor(r.minutes / 60)}h${String(r.minutes % 60).padStart(2,'0')}min${warnIcon}</td>
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
        this.pendingPdfWarnings = [];

        // Restaura botão para uso futuro
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
        if (closeBtn) closeBtn.disabled = false;
        confirmBtn.textContent = 'Confirmar e Salvar';

        await this.renderAll();
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

    openAgendaHelp() {
        this.openModal('modal-agenda-help');
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

    // ===================================
    // APONTAMENTOS
    // ===================================

    calcDuration(startTime, endTime) {
        if (!startTime || !endTime) return { minutes: 0, label: '--' };
        const [sh, sm] = startTime.split(':').map(Number);
        const [eh, em] = endTime.split(':').map(Number);
        let minutes = (eh * 60 + em) - (sh * 60 + sm);
        if (minutes < 0) minutes = 0;
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        const label = h > 0 ? `${h}h${m > 0 ? String(m).padStart(2, '0') : ''}` : `${m}min`;
        return { minutes, label };
    }

    updateAptDuration() {
        const start = document.getElementById('apt-start')?.value;
        const end = document.getElementById('apt-end')?.value;
        const el = document.getElementById('apt-duration');
        if (el) el.textContent = this.calcDuration(start, end).label;
    }

    aptNavigateDay(delta) {
        const d = new Date(this.aptCurrentDate + 'T12:00:00');
        d.setDate(d.getDate() + delta);
        this.aptCurrentDate = d.toISOString().split('T')[0];
        this.renderApontamentos();
    }

    async renderApontamentos() {
        if (this.currentView !== 'apontamentos') return;
        const container = document.getElementById('apontamentos-container');
        if (!container) return;
        container.innerHTML = spinnerHtml;

        const label = document.getElementById('apt-date-label');
        if (label) {
            const [y, m, d] = this.aptCurrentDate.split('-');
            const today = new Date().toISOString().split('T')[0];
            label.textContent = this.aptCurrentDate === today
                ? `Hoje — ${d}/${m}/${y}`
                : `${d}/${m}/${y}`;
        }

        try {
            const items = await store.getApontamentos(this.aptCurrentDate);
            container.innerHTML = '';

            if (items.length === 0) {
                container.innerHTML = `
                    <div class="glass empty-state" style="text-align:center;padding:40px;display:flex;flex-direction:column;align-items:center;gap:16px;">
                        <i data-lucide="clipboard-list" style="width:32px;height:32px;opacity:.4"></i>
                        <p class="text-muted">Nenhum apontamento para este dia.</p>
                        <button class="btn btn-primary" onclick="app.openNewApontamento()">
                            <i data-lucide="plus"></i> Novo Apontamento
                        </button>
                    </div>`;
                lucide.createIcons();
                return;
            }

            let totalMinutes = 0;
            const table = document.createElement('div');
            table.className = 'apt-table glass';
            table.innerHTML = `
                <div class="apt-table-header">
                    <span>Horário</span><span>Proj.</span><span>Descrição</span><span>Dur.</span><span></span>
                </div>`;

            items.forEach(item => {
                const dur = this.calcDuration(item.startTime, item.endTime);
                totalMinutes += dur.minutes;
                const row = document.createElement('div');
                row.className = 'apt-row';
                row.innerHTML = `
                    <span class="apt-horario">${escapeHtml(item.startTime)} – ${escapeHtml(item.endTime)}</span>
                    <span class="apt-proj">${escapeHtml(item.projectNum)}</span>
                    <span class="apt-desc">${escapeHtml(item.description)}</span>
                    <span class="apt-dur">${dur.label}</span>
                    <span class="apt-actions">
                        <button class="btn-icon-sm apt-copy-proj-btn" title="Copiar nº projeto" data-value="${escapeHtml(item.projectNum)}">
                            <i data-lucide="hash"></i>
                        </button>
                        <button class="btn-icon-sm apt-copy-desc-btn" title="Copiar descrição" data-value="${escapeHtml(item.description)}">
                            <i data-lucide="clipboard"></i>
                        </button>
                        <button class="btn-icon-sm" title="Editar" onclick="app.openEditApontamento('${item.id}')">
                            <i data-lucide="pencil"></i>
                        </button>
                        <button class="btn-icon-sm btn-danger-sm" title="Excluir" onclick="app.deleteApontamento('${item.id}')">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </span>`;
                table.appendChild(row);
            });

            const h = Math.floor(totalMinutes / 60);
            const m = totalMinutes % 60;
            const footer = document.createElement('div');
            footer.className = 'apt-table-footer';
            footer.innerHTML = `<span>Total do dia: <strong>${h}h${m > 0 ? String(m).padStart(2, '0') + 'min' : ''}</strong></span>`;
            table.appendChild(footer);

            container.appendChild(table);
            lucide.createIcons();
            table.querySelectorAll('.apt-copy-proj-btn, .apt-copy-desc-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const value = btn.classList.contains('apt-copy-proj-btn')
                        ? btn.dataset.value.slice(0, -1)
                        : btn.dataset.value;
                    this.copyApontamento(value);
                });
            });
        } catch (err) {
            container.innerHTML = `<div class="glass" style="padding:24px;"><p class="text-muted">Erro ao carregar: ${err.message}</p></div>`;
        }
    }

    async populateAptProjectList() {
        const clients = await store.getClients();
        const list = document.getElementById('apt-project-list');
        if (!list) return;
        list.innerHTML = clients
            .filter(c => c.projectNum)
            .map(c => `<option value="${escapeHtml(c.projectNum)}" label="${escapeHtml(c.name)}">`)
            .join('');
    }

    async openNewApontamento() {
        document.getElementById('apt-id').value = '';
        document.getElementById('modal-apontamento-title').textContent = 'Novo Apontamento';
        document.getElementById('apt-date').value = this.aptCurrentDate;
        document.getElementById('apt-start').value = '';
        document.getElementById('apt-end').value = '';
        document.getElementById('apt-project').value = '';
        document.getElementById('apt-description').value = '';
        document.getElementById('apt-duration').textContent = '--';
        await this.populateAptProjectList();
        this.openModal('modal-apontamento');
    }

    async openEditApontamento(id) {
        const items = await store.getApontamentos(this.aptCurrentDate);
        const item = items.find(i => i.id === id);
        if (!item) return;
        document.getElementById('apt-id').value = item.id;
        document.getElementById('modal-apontamento-title').textContent = 'Editar Apontamento';
        document.getElementById('apt-date').value = item.date;
        document.getElementById('apt-start').value = item.startTime;
        document.getElementById('apt-end').value = item.endTime;
        document.getElementById('apt-project').value = item.projectNum;
        document.getElementById('apt-description').value = item.description;
        document.getElementById('apt-duration').textContent = this.calcDuration(item.startTime, item.endTime).label;
        await this.populateAptProjectList();
        this.openModal('modal-apontamento');
    }

    async handleApontamentoSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('apt-id').value;
        const date = document.getElementById('apt-date').value;
        const startTime = document.getElementById('apt-start').value;
        const endTime = document.getElementById('apt-end').value;
        const projectNum = document.getElementById('apt-project').value.trim();
        const description = document.getElementById('apt-description').value.trim();

        if (!date || !startTime || !endTime || !projectNum) {
            Toast.show('Preencha todos os campos obrigatórios.', 'error');
            return;
        }

        const btn = e.target.querySelector('[type="submit"]');
        btn.disabled = true;
        try {
            if (id) {
                await store.updateApontamento(id, date, startTime, endTime, projectNum, description);
            } else {
                await store.addApontamento(date, startTime, endTime, projectNum, description);
            }
            this.closeModal('modal-apontamento');
            await this.renderApontamentos();
            Toast.show(id ? 'Apontamento atualizado.' : 'Apontamento salvo.', 'success');
        } catch (err) {
            Toast.show('Erro ao salvar: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    copyApontamento(value) {
        navigator.clipboard.writeText(value).then(() => {
            Toast.show('Copiado!', 'success');
        }).catch(() => {
            Toast.show('Não foi possível copiar.', 'error');
        });
    }

    async deleteApontamento(id) {
        if (!confirm('Excluir este apontamento?')) return;
        try {
            await store.deleteApontamento(id);
            await this.renderApontamentos();
            Toast.show('Apontamento excluído.', 'success');
        } catch (err) {
            Toast.show('Erro ao excluir: ' + err.message, 'error');
        }
    }

    // ===================================
    // IMPLEMENTAÇÕES
    // ===================================

    async renderImplementations() {
        if (this.currentView !== 'implementations') return;
        const container = document.getElementById('implementations-container');
        if (!container) return;
        container.innerHTML = spinnerHtml;

        try {
            const [impls, clients] = await Promise.all([
                store.getImplementationsWithClients(),
                store.getClients()
            ]);

            const filterType   = document.getElementById('impl-filter-type')?.value || '';
            const filterStatus = document.getElementById('impl-filter-status')?.value || '';
            const filterClient = document.getElementById('impl-filter-client')?.value || '';

            // Popular select de clientes do filtro (apenas na primeira chamada)
            const clientSelect = document.getElementById('impl-filter-client');
            if (clientSelect && clientSelect.options.length <= 1) {
                clients.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c.id;
                    opt.textContent = c.name;
                    clientSelect.appendChild(opt);
                });
            }

            const clientsMap = {};
            clients.forEach(c => { clientsMap[c.id] = c; });

            let filtered = impls;
            if (filterType)   filtered = filtered.filter(i => i.type === filterType);
            if (filterStatus) filtered = filtered.filter(i => i.status === filterStatus);
            if (filterClient) filtered = filtered.filter(i => i.clientIds.includes(filterClient));

            if (filtered.length === 0) {
                container.innerHTML = `<div class="glass" style="padding:40px; text-align:center; color:var(--text-muted);">
                    <i data-lucide="code-2" style="width:48px;height:48px;opacity:.3;margin-bottom:12px;"></i>
                    <p>Nenhuma implementação encontrada.</p></div>`;
                lucide.createIcons();
                return;
            }

            // Agrupar por tipo
            const typeLabels = { trigger: 'Trigger', procedure: 'Procedure / Função', feature: 'Funcionalidade', customization: 'Customização', integration: 'Integração', report: 'Relatório Customizado' };
            const typeIcons  = { trigger: 'zap', procedure: 'function-square', feature: 'sparkles', customization: 'settings-2', integration: 'plug-2', report: 'file-bar-chart-2' };
            const groups = {};
            filtered.forEach(impl => {
                if (!groups[impl.type]) groups[impl.type] = [];
                groups[impl.type].push(impl);
            });

            const statusBadge = (s) => {
                const map = { active: ['Ativo', 'var(--success-color)'], testing: ['Em Teste', 'var(--warning-color)'], discontinued: ['Descontinuado', 'var(--danger-color)'] };
                const [label, color] = map[s] || ['—', 'var(--text-muted)'];
                return `<span style="font-size:.7rem;padding:2px 8px;border-radius:20px;background:${color}22;color:${color};font-weight:600;">${label}</span>`;
            };

            let html = '';
            for (const [type, items] of Object.entries(groups)) {
                const icon = typeIcons[type] || 'code-2';
                html += `<div style="margin-bottom:28px;">
                    <h3 style="display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:1rem;color:var(--primary);">
                        <i data-lucide="${icon}" style="width:18px;height:18px;"></i>${typeLabels[type] || type}
                        <span style="font-size:.75rem;color:var(--text-muted);font-weight:400;">(${items.length})</span>
                    </h3>
                    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;">`;

                items.forEach(impl => {
                    const linkedClients = impl.clientIds.map(id => clientsMap[id]?.name).filter(Boolean);
                    const maxChips = 3;
                    const chipsHtml = linkedClients.slice(0, maxChips).map(n =>
                        `<span style="font-size:.7rem;padding:2px 8px;border-radius:12px;background:var(--bg-glass);border:1px solid var(--border-color);">${escapeHtml(n)}</span>`
                    ).join('');
                    const extraChip = linkedClients.length > maxChips
                        ? `<span style="font-size:.7rem;padding:2px 8px;border-radius:12px;background:var(--bg-glass);color:var(--text-muted);">+${linkedClients.length - maxChips}</span>` : '';
                    const noClients = linkedClients.length === 0
                        ? `<span style="font-size:.7rem;color:var(--text-muted);">Sem clientes vinculados</span>` : '';
                    const versionHtml = impl.version ? `<span style="font-size:.7rem;color:var(--text-muted);"> · v${escapeHtml(impl.version)}</span>` : '';
                    const dateHtml = impl.implementationDate ? `<span style="font-size:.7rem;color:var(--text-muted);"> · ${new Date(impl.implementationDate + 'T12:00').toLocaleDateString('pt-BR')}</span>` : '';
                    const hasCode = impl.codeScript && impl.codeScript.trim().length > 0;
                    const attachCount = impl.attachments ? impl.attachments.length : 0;

                    html += `<div class="glass" style="padding:16px;cursor:pointer;transition:border-color .2s;" onclick="app.openEditImplementation('${impl.id}')">
                        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px;">
                            <span style="font-weight:600;flex:1;">${escapeHtml(impl.name)}</span>
                            ${statusBadge(impl.status)}
                        </div>
                        <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:8px;">${versionHtml}${dateHtml}${hasCode ? ' · <i data-lucide="file-code-2" style="width:12px;height:12px;vertical-align:middle;"></i> código' : ''}${attachCount ? ` · <i data-lucide="paperclip" style="width:12px;height:12px;vertical-align:middle;"></i> ${attachCount}` : ''}</div>
                        ${impl.description ? `<p style="font-size:.8rem;color:var(--text-secondary);margin-bottom:10px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${escapeHtml(impl.description)}</p>` : ''}
                        <div style="display:flex;flex-wrap:wrap;gap:4px;">${chipsHtml}${extraChip}${noClients}</div>
                    </div>`;
                });

                html += `</div></div>`;
            }

            container.innerHTML = html;
            lucide.createIcons();
        } catch (err) {
            container.innerHTML = `<p class="text-muted">Erro ao carregar implementações: ${escapeHtml(err.message)}</p>`;
        }
    }

    async _populateImplClientCheckboxes(selectedIds = []) {
        const wrap = document.getElementById('impl-clients-checkboxes');
        if (!wrap) return;
        const clients = await store.getClients();
        if (clients.length === 0) {
            wrap.innerHTML = '<span style="font-size:.8rem;color:var(--text-muted);">Nenhum cliente cadastrado.</span>';
            return;
        }
        wrap.innerHTML = clients.map(c => `
            <label style="display:flex;align-items:center;gap:6px;font-size:.85rem;cursor:pointer;padding:4px 8px;border-radius:6px;background:var(--bg-primary);">
                <input type="checkbox" value="${c.id}" ${selectedIds.includes(c.id) ? 'checked' : ''} style="cursor:pointer;">
                ${escapeHtml(c.name)}
            </label>`).join('');
    }

    async openNewImplementation() {
        document.getElementById('modal-implementation-title').textContent = 'Nova Implementação';
        document.getElementById('impl-id').value = '';
        document.getElementById('impl-name').value = '';
        document.getElementById('impl-type').value = 'feature';
        document.getElementById('impl-status').value = 'active';
        document.getElementById('impl-version').value = '';
        document.getElementById('impl-date').value = '';
        document.getElementById('impl-description').value = '';
        document.getElementById('impl-code').value = '';
        document.getElementById('impl-notes').value = '';
        document.getElementById('btn-delete-implementation').style.display = 'none';
        this.implAttachments = [];
        this._renderImplAttachmentPreviews();
        await this._populateImplClientCheckboxes([]);
        this.openModal('modal-implementation');
    }

    async openEditImplementation(id) {
        const impls = await store.getImplementationsWithClients();
        const impl = impls.find(i => i.id === id);
        if (!impl) return;

        document.getElementById('modal-implementation-title').textContent = 'Editar Implementação';
        document.getElementById('impl-id').value = impl.id;
        document.getElementById('impl-name').value = impl.name;
        document.getElementById('impl-type').value = impl.type;
        document.getElementById('impl-status').value = impl.status;
        document.getElementById('impl-version').value = impl.version;
        document.getElementById('impl-date').value = impl.implementationDate;
        document.getElementById('impl-description').value = impl.description;
        document.getElementById('impl-code').value = impl.codeScript;
        document.getElementById('impl-notes').value = impl.notes;
        document.getElementById('btn-delete-implementation').style.display = 'flex';
        this.implAttachments = impl.attachments ? [...impl.attachments] : [];
        this._renderImplAttachmentPreviews();
        await this._populateImplClientCheckboxes(impl.clientIds);
        this.openModal('modal-implementation');
    }

    async handleImplementationSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('impl-id').value;
        const payload = {
            name: document.getElementById('impl-name').value.trim(),
            type: document.getElementById('impl-type').value,
            status: document.getElementById('impl-status').value,
            version: document.getElementById('impl-version').value.trim(),
            implementationDate: document.getElementById('impl-date').value || null,
            description: document.getElementById('impl-description').value.trim(),
            codeScript: document.getElementById('impl-code').value.trim(),
            notes: document.getElementById('impl-notes').value.trim(),
            attachments: this.implAttachments,
        };

        const selectedClientIds = Array.from(
            document.querySelectorAll('#impl-clients-checkboxes input[type="checkbox"]:checked')
        ).map(cb => cb.value);

        const btn = e.target.querySelector('[type="submit"]');
        btn.disabled = true;
        try {
            let savedId;
            if (id) {
                await store.updateImplementation(id, payload);
                savedId = id;
            } else {
                const created = await store.addImplementation(payload);
                savedId = created.id;
            }
            await store.setImplementationClients(savedId, selectedClientIds);
            this.closeModal('modal-implementation');
            await this.renderImplementations();
            Toast.show(id ? 'Implementação atualizada.' : 'Implementação criada.', 'success');
        } catch (err) {
            Toast.show('Erro ao salvar: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    async handleDeleteImplementation() {
        const id = document.getElementById('impl-id').value;
        if (!id) return;
        if (!confirm('Excluir esta implementação? Os vínculos com clientes também serão removidos.')) return;
        try {
            await store.deleteImplementation(id);
            this.closeModal('modal-implementation');
            await this.renderImplementations();
            Toast.show('Implementação excluída.', 'success');
        } catch (err) {
            Toast.show('Erro ao excluir: ' + err.message, 'error');
        }
    }

    clearImplFilters() {
        const els = ['impl-filter-type', 'impl-filter-status', 'impl-filter-client'];
        els.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        this.renderImplementations();
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
            window.app.pendingPdfWarnings = [];
        }
        await Auth.signOut();
    });
});
