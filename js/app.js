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
        this.trainingAttachments = []; // [{name, data}] — imagens do modal de treinamento
        this.trainingLinks = []; // [{label, url, urlType}] — links externos do modal de treinamento
        // Estado do modal de tarefa
        this._modalTaskId    = null;
        this._modalStatus    = 'new';
        this._modalLabels    = [];
        this._modalChecklist = [];
        this._modalCoverColor  = null;
        this._modalCompleted   = false;
        this._modalCompletedAt = null;
        this._modalComments  = [];
        // Colunas Kanban do cliente atual
        this._currentColumns     = [];
        // Estado do modal Gerenciar Colunas
        this._manageCols         = [];
        this._manageColsOriginal = [];
        // Estado do drag-and-drop Kanban
        this._draggedCard      = null;
        this._dragPlaceholder  = null;
        this._draggingFromStatus = null;
        this._lastAddedTaskId  = null;
        // Agendamento automático
        this._pendingPreviewEvents = [];
        this._pendingPreviewRuleId = null;
        this._pendingPreviewRule = null;
        this._pendingPreviewClient = null;
        this._pendingPreviewConflictSet = new Set();
        this._pendingPreviewExistingDates = new Set();
        this._pendingPreviewExistingByDate = new Map();
        // Mini-calendário do preview de agendamento
        this._miniCalYear     = new Date().getFullYear();
        this._miniCalMonth    = new Date().getMonth();
        this._miniCalSelected = null;
        // Sync Google Calendar automático
        this._lastGoogleSync = 0;
        this._googleSyncInterval = null;
        // Relatório de agenda
        this._reportEvents = [];
        this._reportClient = null;
        // Navegação de mês no Dashboard
        this._dashboardMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
        // Tarefas vinculadas ao agendamento atual (multi-select)
        this._agendaRelatedTaskIds = [];  // confirmadas
        this._agendaTaskPanelTempIds = []; // seleção temporária enquanto painel está aberto
        this._agendaAllTasks = [];
        // Guard para evitar renderAll() concorrente
        this._renderAllRunning = false;
        this._renderAllPending = false;
        // OTOBO
        this._otoboConfig = null;
        this._currentTicket = null;
        this._cachedChamadosTickets = null;
        this._cachedChamadosClients = null;
        this._chamadoFiltersAttached = false;
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
        document.getElementById('form-scheduling-rule').addEventListener('submit', this.handleSchedulingRuleSubmit.bind(this));
        document.getElementById('form-task-time').addEventListener('submit', this.handleTaskTimeSubmit.bind(this));
        document.getElementById('form-agenda-event').addEventListener('submit', this.handleAgendaSubmit.bind(this));

        // V5 — shake em campos obrigatórios inválidos ao tentar submeter
        document.querySelectorAll('form').forEach(form => {
            form.addEventListener('submit', () => {
                form.querySelectorAll(':invalid').forEach(el => {
                    el.classList.remove('input-shake');
                    void el.offsetWidth;
                    el.classList.add('input-shake');
                    el.addEventListener('animationend', () => el.classList.remove('input-shake'), { once: true });
                });
            }, true);
        });

        // Links clicáveis na descrição do agendamento + auto-resize
        document.getElementById('agenda-desc').addEventListener('input', (e) => {
            this._updateDescLinks(e.target.value);
            this._autoResizeTextarea(e.target);
        });

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
        document.getElementById('form-training')
            ?.addEventListener('submit', (e) => this.handleTrainingSubmit(e));

        document.getElementById('form-ai-config')
            ?.addEventListener('submit', (e) => this.handleAIConfigSubmit(e));
        ['apt-start', 'apt-end'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', () => this.updateAptDuration());
        });

        // Comentários de tarefas
        document.getElementById('btn-add-task-comment')?.addEventListener('click', () => this.handleAddTaskComment());
        document.getElementById('task-comment-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); this.handleAddTaskComment(); }
        });

        // Paste de imagens nos modais de tarefa, implementação e treinamento
        document.addEventListener('paste', (e) => {
            const taskActive     = document.getElementById('modal-task')?.classList.contains('active');
            const implActive     = document.getElementById('modal-implementation')?.classList.contains('active');
            const trainingActive = document.getElementById('modal-training')?.classList.contains('active');
            if (!taskActive && !implActive && !trainingActive) return;
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
                    } else if (trainingActive) {
                        compressImageFile(file).then(data => {
                            this.trainingAttachments.push({ name, data });
                            this._renderTrainingAttachmentPreviews();
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

        // Seleção de arquivos via input — tarefa (imagens comprimidas; outros tipos lidos como base64)
        document.getElementById('task-attachments')?.addEventListener('change', async (e) => {
            for (const file of e.target.files) {
                let data;
                if (file.type.startsWith('image/')) {
                    data = await compressImageFile(file);
                } else {
                    data = await new Promise(res => {
                        const r = new FileReader();
                        r.onload = ev => res(ev.target.result);
                        r.readAsDataURL(file);
                    });
                }
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

        // Seleção de arquivos de imagem via input — treinamento
        document.getElementById('training-attachments')?.addEventListener('change', async (e) => {
            for (const file of e.target.files) {
                const data = await compressImageFile(file);
                this.trainingAttachments.push({ name: file.name, data });
            }
            e.target.value = '';
            this._renderTrainingAttachmentPreviews();
        });

    }

    // ===================================
    // NAVEGAÇÃO / ROTEAMENTO
    // ===================================
    switchView(viewName) {
        const prevView = this.currentView;
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

        // Auto-sync Google Calendar ao entrar na view agenda
        if (viewName === 'agenda' && prevView !== 'agenda' && calendarAPI.isAuthenticated) {
            this._autoSyncGoogle().catch(() => {});
        }
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
        if (modalId === 'modal-record') {
            if (!document.getElementById('record-id').value) {
                document.getElementById('record-date').valueAsDate = new Date();
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
            this.switchClientModalTab('dados');
        }
        if (modalId === 'modal-scheduling-rule') {
            document.getElementById('form-scheduling-rule').reset();
            document.getElementById('rule-id').value = '';
            document.getElementById('btn-delete-scheduling-rule').style.display = 'none';
        }
        if (modalId === 'modal-task') {
            this._modalTaskId    = null;
            this._modalStatus    = 'new';
            this._modalLabels    = [];
            this._modalChecklist = [];
            this._modalCoverColor  = null;
            this._modalCompleted   = false;
            this._modalCompletedAt = null;
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
            const suggestPanel = document.getElementById('ai-task-suggestions');
            if (suggestPanel) { suggestPanel.style.display = 'none'; suggestPanel.innerHTML = ''; }
            const suggestBtnClose = document.getElementById('btn-ai-suggest-steps');
            if (suggestBtnClose) suggestBtnClose.style.display = 'none';
            this.taskAttachments = [];
            this._renderTaskAttachmentPreviews();
        }
        if (modalId === 'modal-implementation') {
            this.implAttachments = [];
            this._renderImplAttachmentPreviews();
        }
        if (modalId === 'modal-training') {
            this.trainingAttachments = [];
            this.trainingLinks = [];
        }
        if (modalId === 'modal-record') {
            document.getElementById('form-record').reset();
            document.getElementById('record-id').value = '';
            document.getElementById('record-date').valueAsDate = new Date();
            document.getElementById('record-calculated').value = '';
            document.getElementById('record-calculated').dataset.minutes = 0;
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
            this._updateDescLinks('');
            this._agendaRelatedTaskIds = [];
            this._agendaTaskPanelTempIds = [];
            const agendaPanel = document.getElementById('agenda-task-panel');
            if (agendaPanel) agendaPanel.style.display = 'none';
            this._renderAgendaTaskChips();
            this._updateAgendaLinkBtn();
        }
        if (modalId === 'modal-manage-columns') {
            this._manageCols = [];
            this._manageColsOriginal = [];
        }
        if (modalId === 'modal-chamado') {
            this._currentTicket = null;
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
        const otoboCustomerId = document.getElementById('client-otobo-id').value.trim();
        const initialBalanceH = document.getElementById('client-initial-balance').value;
        const balanceStartDate = document.getElementById('client-balance-start').value;
        const btn = e.target.querySelector('[type="submit"]');

        // Saldo inicial preenchido exige data de início
        if (initialBalanceH !== '' && !balanceStartDate) {
            Toast.show('Informe a data de início do controle para usar saldo inicial.', 'error');
            return;
        }

        const initialBalanceMinutes = initialBalanceH !== ''
            ? Math.round(parseFloat(initialBalanceH) * 60)
            : 0;

        this._btnPending(btn);
        try {
            if (id) {
                await store.updateClient(id, name, hours, csName, projectNum, clientPays, consultantBonus, notes, status, initialBalanceMinutes, balanceStartDate || null, otoboCustomerId || null);
            } else {
                await store.addClient(name, hours, csName, projectNum, clientPays, consultantBonus, notes, status, initialBalanceMinutes, balanceStartDate || null, otoboCustomerId || null);
            }
            await this._btnSuccess(btn);
            e.target.reset();
            document.getElementById('client-id').value = '';
            this.closeModal('modal-client');
            await this.renderAll();
            Toast.show(id ? 'Cliente atualizado.' : 'Cliente cadastrado.', 'success');
        } catch (err) {
            this._btnError(btn);
            Toast.show('Erro ao salvar cliente: ' + err.message, 'error');
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
        this._btnPending(btn);

        try {
            if (recordId) {
                await store.updateRecord(recordId, clientId, date, startTime, endTime, minutes, desc);
            } else {
                await store.addRecord(clientId, date, startTime, endTime, minutes, desc);
            }
            await this._btnSuccess(btn);
            e.target.reset();
            document.getElementById('record-id').value = '';
            document.getElementById('record-calculated').dataset.minutes = 0;
            document.getElementById('record-date').valueAsDate = new Date();
            this.closeModal('modal-record');
            await this.renderAll();
            Toast.show(recordId ? 'Atendimento atualizado.' : 'Atendimento lançado.', 'success');
        } catch (err) {
            this._btnError(btn);
            Toast.show('Erro ao salvar atendimento: ' + err.message, 'error');
        }
    }

    handleDeleteClient(id, btn) {
        this._twostepDelete(btn, async () => {
            const row = btn?.closest('tr');
            if (row) { row.classList.add('row-deleting'); await new Promise(r => setTimeout(r, 400)); }
            try {
                await store.deleteClient(id);
                await this.renderAll();
                Toast.show('Cliente excluído.', 'success');
            } catch (err) {
                if (row) row.classList.remove('row-deleting');
                Toast.show('Erro ao excluir cliente: ' + err.message, 'error');
            }
        });
    }

    async handleDeleteRecord(id, btn) {
        const row = btn?.closest('tr');
        if (row) { row.classList.add('row-deleting'); await new Promise(r => setTimeout(r, 400)); }
        try {
            await store.deleteRecord(id);
            await this.renderAll();
            Toast.show('Atendimento excluído.', 'success');
        } catch (err) {
            if (row) row.classList.remove('row-deleting');
            Toast.show('Erro ao excluir atendimento: ' + err.message, 'error');
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
        // Exibe botão IA se já há descrição e IA configurada
        setTimeout(() => this.onRecordDescInput(), 50);
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
        const clientId = document.getElementById('task-client').value;
        if (!clientId) { Toast.show('Selecione um cliente para a tarefa.', 'error'); return; }

        const taskData = {
            clientId,
            title,
            description: document.getElementById('task-description').value,
            status: this._modalStatus || 'new',
            priority: document.getElementById('task-priority').value,
            dueDate: document.getElementById('task-due-date').value,
            estimatedMinutes: document.getElementById('task-estimated-minutes').value,
            labels: this._modalLabels || [],
            checklist: this._modalChecklist || [],
            coverColor: this._modalCoverColor || null,
            attachments: this.taskAttachments,
            completed: this._modalCompleted || false,
            completedAt: this._modalCompletedAt || null
        };

        const btn = document.querySelector('#form-task [type="submit"]');
        if (btn) this._btnPending(btn);

        try {
            if (id) {
                taskData.id = id;
                await store.updateTask(taskData);
            } else {
                await store.addTask(taskData);
            }
            if (btn) await this._btnSuccess(btn);
            this.closeModal('modal-task');
            await this.renderAll();
            Toast.show(id ? 'Tarefa atualizada.' : 'Tarefa criada.', 'success');
        } catch (err) {
            if (btn) this._btnError(btn);
            Toast.show('Erro ao salvar tarefa: ' + err.message, 'error');
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

        // Garante colunas carregadas para o cliente desta tarefa
        if (t.clientId && !this._currentColumns.find(c => c.clientId === t.clientId)) {
            this._currentColumns = await store.ensureDefaultColumns(t.clientId).catch(() => []);
        }

        // Estado modal
        this._modalTaskId    = t.id;
        this._modalStatus    = t.status || this._currentColumns[0]?.id || 'new';
        this._modalLabels    = t.labels ? [...t.labels] : [];
        this._modalChecklist = t.checklist ? [...t.checklist] : [];
        this._modalCoverColor  = t.coverColor || null;
        this._modalCompleted   = t.completed || false;
        this._modalCompletedAt = t.completedAt || null;

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
        const suggestBtn = document.getElementById('btn-ai-suggest-steps');
        if (suggestBtn) suggestBtn.style.display = aiClient.isConfigured ? 'inline-flex' : 'none';

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
        container.innerHTML = this.taskAttachments.map((att, i) => {
            const isImage = att.data && att.data.startsWith('data:image/');
            if (isImage) {
                return `<div class="attach-thumb">
                    <img src="${att.data}" alt="${escapeHtml(att.name)}" onclick="app._openAttachmentLightbox(${i})" title="${escapeHtml(att.name)}">
                    <button type="button" class="attach-remove" onclick="app.removeTaskAttachment(${i})" title="Remover">×</button>
                </div>`;
            }
            return `<div class="attach-thumb attach-thumb-file" onclick="app._openAttachmentLightbox(${i})" title="${escapeHtml(att.name)}">
                <i data-lucide="file-text" style="width:26px;height:26px;opacity:.75;pointer-events:none;"></i>
                <span class="attach-thumb-fname">${escapeHtml(att.name)}</span>
                <button type="button" class="attach-remove" onclick="event.stopPropagation();app.removeTaskAttachment(${i})" title="Remover">×</button>
            </div>`;
        }).join('');
        lucide.createIcons();
    }

    _renderTaskComments() {
        const list = document.getElementById('modal-task-comments-list');
        if (!list) return;
        const LEGACY_LABELS = { new: 'Novas', doing: 'Em Execução', done: 'Finalizadas' };
        const getColName = (id) => {
            if (!id) return '?';
            const col = this._currentColumns.find(c => c.id === id);
            return col?.name || LEGACY_LABELS[id] || id;
        };
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
                const from = getColName(entry.activityData?.from);
                const to   = getColName(entry.activityData?.to);
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
            } else if (entry.type === 'completed') {
                return `<div class="task-activity-item task-activity-completed">
                    <i data-lucide="check-circle-2" style="width:13px;height:13px;flex-shrink:0"></i>
                    <span>Tarefa concluída</span>
                    <span style="margin-left:auto;white-space:nowrap">${dateStr}</span>
                </div>`;
            } else if (entry.type === 'uncompleted') {
                return `<div class="task-activity-item">
                    <i data-lucide="circle" style="width:13px;height:13px;flex-shrink:0"></i>
                    <span>Marcada como incompleta</span>
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
        if (!att.data.startsWith('data:image/')) {
            const a = document.createElement('a');
            a.href = att.data;
            a.download = att.name;
            a.click();
            return;
        }
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

    handleDeleteTask(id, btn) {
        this._twostepDelete(btn, async () => {
            const card = btn?.closest('.kb-card');
            if (card) { card.classList.add('row-deleting'); await new Promise(r => setTimeout(r, 400)); }
            try {
                await store.deleteTask(id);
                await this.renderAll();
                Toast.show('Tarefa excluída.', 'success');
            } catch (err) {
                if (card) card.classList.remove('row-deleting');
                Toast.show('Erro ao excluir tarefa: ' + err.message, 'error');
            }
        });
    }

    async toggleTaskComplete(id, completed) {
        try {
            const { completedAt } = await store.toggleTaskComplete(id, completed);
            if (completed) {
                await store.logTaskActivity(id, 'completed', { completedAt });
            } else {
                await store.removeCompletionActivity(id);
            }
            await this.renderAll();
        } catch (err) {
            Toast.show('Erro ao atualizar tarefa: ' + err.message, 'error');
        }
    }

    handleDeleteTaskFromModal() {
        const id = document.getElementById('task-id').value;
        if (!id) return;
        const btn = document.getElementById('btn-delete-task');
        this._twostepDelete(btn, async () => {
            try {
                await store.deleteTask(id);
                this.closeModal('modal-task');
                await this.renderAll();
                Toast.show('Tarefa excluída.', 'success');
            } catch (err) {
                Toast.show('Erro ao excluir tarefa: ' + err.message, 'error');
            }
        });
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

        // Bounce no card após o drop
        const droppedCard = document.querySelector(`.kb-card[data-id="${draggedId}"]`);
        if (droppedCard) {
            droppedCard.classList.add('kb-card-dropped');
            droppedCard.addEventListener('animationend', () => droppedCard.classList.remove('kb-card-dropped'), { once: true });
        }
    }

    // ===================================
    // KANBAN — Quick-add
    // ===================================
    openQuickAdd(colId) {
        const qa = document.getElementById(`kb-quick-add-${colId}`);
        const btn = document.getElementById(`kb-add-btn-${colId}`);
        if (!qa) return;
        qa.style.display = 'block';
        if (btn) btn.style.display = 'none';
        const input = document.getElementById(`kb-quick-input-${colId}`);
        if (input) { input.value = ''; setTimeout(() => input.focus(), 50); }
    }

    closeQuickAdd(colId) {
        const qa = document.getElementById(`kb-quick-add-${colId}`);
        const btn = document.getElementById(`kb-add-btn-${colId}`);
        if (qa) qa.style.display = 'none';
        if (btn) btn.style.display = 'flex';
    }

    async submitQuickAdd(colId) {
        const input = document.getElementById(`kb-quick-input-${colId}`);
        const title = input?.value.trim();
        if (!title) { this.closeQuickAdd(colId); return; }
        const clientId = document.getElementById('filter-task-client')?.value || null;
        try {
            const newTask = await store.addTask({ title, status: colId, clientId, priority: 'medium' });
            this._lastAddedTaskId = newTask?.id || null;
            this.closeQuickAdd(colId);
            await this.renderAll();
            this._lastAddedTaskId = null;
        } catch (err) {
            Toast.show('Erro ao criar tarefa: ' + err.message, 'error');
        }
    }

    handleQuickAddKey(e, colId) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.submitQuickAdd(colId); }
        if (e.key === 'Escape') this.closeQuickAdd(colId);
    }

    // ===================================
    // KANBAN — Modal helpers
    // ===================================
    _openNewTaskModal(colId) {
        this._modalTaskId    = null;
        this._modalStatus    = colId || this._currentColumns[0]?.id || 'new';
        this._modalLabels    = [];
        this._modalChecklist = [];
        this._modalCoverColor = null;
        document.getElementById('task-id').value = '';
        document.getElementById('task-title').value = '';
        document.getElementById('task-description').value = '';
        // Pre-seleciona o cliente filtrado, se houver
        const filteredClient = document.getElementById('filter-task-client')?.value || '';
        document.getElementById('task-client').value = filteredClient;
        document.getElementById('task-priority').value = 'medium';
        document.getElementById('task-due-date').value = '';
        document.getElementById('task-estimated-minutes').value = '';
        document.getElementById('btn-delete-task').style.display = 'none';
        document.getElementById('btn-add-time-task').style.display = 'none';
        const suggestBtnNew = document.getElementById('btn-ai-suggest-steps');
        if (suggestBtnNew) suggestBtnNew.style.display = 'none';
        this.taskAttachments = [];
        this._syncModalColumnButtons();
        this._syncModalCover();
        this._renderModalLabels();
        this._renderChecklist();
        this._renderTaskAttachmentPreviews();
        this.openModal('modal-task');
    }

    moveTaskToColumn(colId) {
        const oldStatus = this._modalStatus;
        this._modalStatus = colId;
        this._syncModalColumnButtons();
        if (this._modalTaskId && oldStatus !== colId) {
            store.logTaskActivity(this._modalTaskId, 'status_change', { from: oldStatus, to: colId })
                .then(() => store.getTask(this._modalTaskId))
                .then(t => { if (t) { this._modalComments = t.comments; this._renderTaskComments(); } })
                .catch(() => {});
        }
    }

    _syncModalColumnButtons() {
        const container = document.getElementById('modal-sidebar-col-buttons');
        if (!container) return;
        const LEGACY = { new: { name: 'Novas', color: '#4a9eff' }, doing: { name: 'Em Execução', color: '#ff922b' }, done: { name: 'Finalizadas', color: '#51cf66' } };
        const cols = this._currentColumns.length > 0 ? this._currentColumns
            : Object.entries(LEGACY).map(([id, v]) => ({ id, name: v.name, color: v.color }));
        container.innerHTML = cols.map(col => `
            <button type="button" class="kb-col-btn${this._modalStatus === col.id ? ' active' : ''}"
                    data-status="${col.id}" onclick="app.moveTaskToColumn('${col.id}')">
                <span class="kb-column-dot" style="background:${escapeHtml(col.color)}"></span>
                ${escapeHtml(col.name)}
            </button>`).join('');
        const labelEl = document.getElementById('modal-task-column-label');
        if (labelEl) {
            const col = cols.find(c => c.id === this._modalStatus);
            labelEl.textContent = col?.name || LEGACY[this._modalStatus]?.name || '';
        }
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
    // KANBAN — Gerenciar Colunas
    // ===================================
    openManageColumns() {
        const clientId = document.getElementById('filter-task-client')?.value;
        if (!clientId) { Toast.show('Selecione um cliente para gerenciar colunas.', 'error'); return; }
        this._manageCols = this._currentColumns.map(c => ({ ...c }));
        this._manageColsOriginal = this._currentColumns.map(c => ({ ...c }));
        this._renderManageColumnsList();
        this.openModal('modal-manage-columns');
    }

    _renderManageColumnsList() {
        const container = document.getElementById('mc-columns-list');
        if (!container) return;
        const COLORS = ['#4a9eff','#ff922b','#51cf66','#ffd43b','#ff6b6b','#cc5de8','#22d3ee','#a3e635','#94a3b8'];
        if (this._manageCols.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:var(--text-secondary);font-size:13px;padding:16px 0">Nenhuma coluna. Adicione uma abaixo.</p>';
            return;
        }
        container.innerHTML = this._manageCols.map((col, idx) => `
            <div class="mc-row">
                <div class="mc-order-btns">
                    <button type="button" class="mc-order-btn" onclick="app._mcMoveUp(${idx})" ${idx===0?'disabled':''} title="Subir">▲</button>
                    <button type="button" class="mc-order-btn" onclick="app._mcMoveDown(${idx})" ${idx===this._manageCols.length-1?'disabled':''} title="Descer">▼</button>
                </div>
                <div class="mc-color-area">
                    <button type="button" class="mc-color-dot" style="background:${col.color}"
                            onclick="app._mcToggleColorPicker(${idx})" title="Cor da coluna"></button>
                    <div class="mc-color-palette" id="mc-palette-${idx}" style="display:none">
                        ${COLORS.map(c => `<button type="button" class="mc-swatch${col.color===c?' active':''}"
                            style="background:${c}" onclick="app._mcPickColor(${idx},'${c}')"></button>`).join('')}
                    </div>
                </div>
                <input type="text" class="mc-name-input form-control" value="${escapeHtml(col.name)}"
                       placeholder="Nome da coluna"
                       oninput="app._mcSetName(${idx}, this.value)">
                <label class="mc-done-check" title="Tarefas nesta coluna contam como concluídas">
                    <input type="checkbox" ${col.isDone?'checked':''} onchange="app._mcToggleDone(${idx}, this.checked)">
                    <span>Finalizada</span>
                </label>
                <button type="button" class="mc-delete-btn" onclick="app._mcDelete(${idx})" title="Excluir coluna">
                    <i data-lucide="trash-2" style="width:14px;height:14px"></i>
                </button>
            </div>
        `).join('');
        lucide.createIcons();
    }

    _mcMoveUp(idx) {
        if (idx === 0) return;
        [this._manageCols[idx - 1], this._manageCols[idx]] = [this._manageCols[idx], this._manageCols[idx - 1]];
        this._renderManageColumnsList();
    }

    _mcMoveDown(idx) {
        if (idx >= this._manageCols.length - 1) return;
        [this._manageCols[idx], this._manageCols[idx + 1]] = [this._manageCols[idx + 1], this._manageCols[idx]];
        this._renderManageColumnsList();
    }

    async _mcDelete(idx) {
        const col = this._manageCols[idx];
        if (!col.id) {
            // Coluna nova ainda não salva: remove direto
            this._manageCols.splice(idx, 1);
            this._renderManageColumnsList();
            return;
        }
        // Verifica tasks na coluna
        const clientId = document.getElementById('filter-task-client')?.value;
        const tasks = await store.getTasks();
        const count = tasks.filter(t => t.status === col.id && t.clientId === clientId).length;
        if (count > 0) {
            Toast.show(`"${col.name}" possui ${count} tarefa(s). Mova-as antes de excluir.`, 'error', 4000);
            return;
        }
        this._manageCols.splice(idx, 1);
        this._renderManageColumnsList();
    }

    _mcAdd() {
        this._manageCols.push({ id: null, name: 'Nova Coluna', color: '#94a3b8', isDone: false, clientId: null });
        this._renderManageColumnsList();
        // Foca no input da nova linha
        const inputs = document.querySelectorAll('.mc-name-input');
        const last = inputs[inputs.length - 1];
        if (last) { last.focus(); last.select(); }
    }

    _mcSetName(idx, val) { if (this._manageCols[idx]) this._manageCols[idx].name = val; }

    _mcToggleDone(idx, val) {
        if (this._manageCols[idx]) { this._manageCols[idx].isDone = val; }
    }

    _mcPickColor(idx, color) {
        if (this._manageCols[idx]) { this._manageCols[idx].color = color; }
        this._renderManageColumnsList();
    }

    _mcToggleColorPicker(idx) {
        const palette = document.getElementById(`mc-palette-${idx}`);
        if (!palette) return;
        const visible = palette.style.display !== 'none';
        // Fecha todos os palettes
        document.querySelectorAll('.mc-color-palette').forEach(p => p.style.display = 'none');
        if (!visible) palette.style.display = 'flex';
    }

    async saveManageColumns() {
        const clientId = document.getElementById('filter-task-client')?.value;
        if (!clientId) return;

        // Valida nomes
        for (const col of this._manageCols) {
            if (!col.name?.trim()) { Toast.show('Todas as colunas precisam ter um nome.', 'error'); return; }
        }

        // Colunas removidas (estavam no original mas não estão mais em _manageCols)
        const currentIds = new Set(this._manageCols.map(c => c.id).filter(Boolean));
        const deletedIds = this._manageColsOriginal.map(c => c.id).filter(id => id && !currentIds.has(id));

        // Verifica tasks em colunas a deletar
        const tasks = await store.getTasks();
        for (const id of deletedIds) {
            const count = tasks.filter(t => t.status === id && t.clientId === clientId).length;
            if (count > 0) {
                const col = this._manageColsOriginal.find(c => c.id === id);
                Toast.show(`"${col?.name}" possui tarefas. Mova-as antes de excluir.`, 'error');
                return;
            }
        }

        try {
            // Deleta colunas removidas
            await Promise.all(deletedIds.map(id => store.deleteColumn(id)));

            // Cria/atualiza colunas e coleta IDs finais com posições
            const posUpdates = [];
            for (let i = 0; i < this._manageCols.length; i++) {
                const col = this._manageCols[i];
                if (col.id) {
                    await store.updateColumn(col.id, { name: col.name.trim(), color: col.color, isDone: col.isDone });
                    posUpdates.push({ id: col.id, position: i });
                } else {
                    const created = await store.addColumn(clientId, col.name.trim(), col.color, col.isDone);
                    posUpdates.push({ id: created.id, position: i });
                }
            }

            // Reordena
            await store.reorderColumns(posUpdates);

            Toast.show('Colunas salvas!', 'success');
            this.closeModal('modal-manage-columns');
            // Recarrega e re-renderiza
            sessionStorage.removeItem('kbMigrated'); // permite re-checagem se necessário
            await this.renderAll();
        } catch (err) {
            Toast.show('Erro ao salvar colunas: ' + err.message, 'error');
        }
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
        // Carrega config de IA em background (não bloqueia o render)
        aiClient.loadConfig().then(() => this._updateAIStatusBadge());
        await this.renderAll();
    }

    // ===================================
    // RENDERS
    // ===================================
    async renderAll() {
        if (this._renderAllRunning) {
            this._renderAllPending = true;
            return;
        }
        this._renderAllRunning = true;
        this._renderAllPending = false;
        try {
            // Pre-busca tudo em 4 queries (antes: 4×N queries por ciclo)
            const batchStats = await store.getBatchStats();
            const clients = batchStats.map(s => s.client);
            await this.updateClientSelects(clients);
            await Promise.all([
                this.renderDashboard(clients, batchStats),
                this.renderClients(clients, batchStats),
                this.renderRecords(clients),
                this.renderClientDashboard(),
                this.renderMonthRecords(),
                this.renderTasks(),
                this.renderAgenda(),
                this.renderApontamentos(),
                this.renderImplementations(),
                this.renderTrainings(),
                this.renderChamados()
            ]);
            lucide.createIcons();
        } finally {
            this._renderAllRunning = false;
            if (this._renderAllPending) {
                this._renderAllPending = false;
                await this.renderAll();
            }
        }
    }

    _formatDashboardMonth(yyyyMM) {
        const [y, m] = yyyyMM.split('-').map(Number);
        const names = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
        return `${names[m - 1]}/${y}`;
    }

    dashNavMonth(delta) {
        const [y, m] = this._dashboardMonth.split('-').map(Number);
        const d = new Date(y, m - 1 + delta, 1);
        const newMonth = d.toISOString().slice(0, 7);
        const currentMonth = new Date().toISOString().slice(0, 7);
        if (newMonth > currentMonth) return;
        this._dashboardMonth = newMonth;
        this.renderDashboard();
    }

    dashGoToCurrentMonth() {
        this._dashboardMonth = new Date().toISOString().slice(0, 7);
        this.renderDashboard();
    }

    async renderDashboard(preloadedClients, batchStats) {
        const container = document.getElementById('dashboard-container');
        this._skDashboard(container);

        const currentMonth = new Date().toISOString().slice(0, 7);
        const isCurrentMonth = this._dashboardMonth === currentMonth;

        // Atualiza controles de navegação de mês
        const monthLabel = document.getElementById('dash-month-label');
        const btnNext = document.getElementById('btn-dash-next-month');
        const btnCurrentMonth = document.getElementById('btn-dash-current-month');
        const subtitle = document.getElementById('dash-subtitle');
        if (monthLabel) monthLabel.textContent = this._formatDashboardMonth(this._dashboardMonth);
        if (btnNext) btnNext.disabled = isCurrentMonth;
        if (btnCurrentMonth) btnCurrentMonth.style.display = isCurrentMonth ? 'none' : '';

        let showActive = true;
        let showFinished = false;
        let showTotal = false;

        const filterActiveEl = document.getElementById('dash-filter-active');
        const filterFinishedEl = document.getElementById('dash-filter-finished');
        const filterTotalEl = document.getElementById('dash-filter-total');
        if (filterActiveEl) showActive = filterActiveEl.checked;
        if (filterFinishedEl) showFinished = filterFinishedEl.checked;
        if (filterTotalEl) showTotal = filterTotalEl.checked;

        // Ocultar/exibir navegação de mês no modo totalizar; atualizar subtitle
        const monthNav = document.getElementById('dash-month-nav');
        if (monthNav) monthNav.style.display = showTotal ? 'none' : '';
        if (subtitle) subtitle.textContent = showTotal
            ? 'Totalização de horas acumuladas desde o início do controle.'
            : (isCurrentMonth
                ? 'Acompanhe o consumo de horas dos seus contratos.'
                : `Histórico — ${this._formatDashboardMonth(this._dashboardMonth)}`);

        const filterStats = (allStats) => allStats.filter(s => {
            const status = s.client.status || 'active';
            if (status === 'active' && showActive) return true;
            if (status === 'finished' && showFinished) return true;
            return false;
        });

        // ── Modo Totalizar Horas ──────────────────────────────────────────
        if (showTotal) {
            let allBatchStats;
            if (batchStats && isCurrentMonth) {
                allBatchStats = batchStats;
            } else {
                allBatchStats = await store.getBatchStats(this._dashboardMonth);
            }
            const filteredStats = filterStats(allBatchStats).filter(s => s !== null);

            container.innerHTML = '';
            if (filteredStats.length === 0) {
                container.innerHTML = `
                    <div style="grid-column: 1 / -1; text-align: center; padding: 40px;" class="glass">
                        <p class="text-muted">Nenhum cliente cadastrado ainda.</p>
                    </div>
                `;
                return;
            }

            const allRecords = await store.getRecords();

            filteredStats.forEach(stat => {
                const client = stat.client;
                const b = this._calcClientBalance(client, allRecords);

                const card = document.createElement('div');
                card.className = 'stat-card glass';
                card.style.cursor = 'pointer';
                if (client.projectNum) card.title = `Projeto: ${client.projectNum}`;
                card.onclick = () => app.openClientDashboard(client.id);

                if (b.hasTracking) {
                    const balanceColor = b.balanceH >= 0 ? '#4ade80' : '#f87171';
                    const balanceSign = b.balanceH >= 0 ? '+' : '';
                    const pct = b.totalContractedH > 0
                        ? Math.min(100, Math.round((b.totalAppliedH / b.totalContractedH) * 100))
                        : 0;
                    const isCritical = b.totalAppliedH > b.totalContractedH ? 'over-limit' : '';
                    const startLabel = new Date(client.balanceStartDate + 'T00:00:00')
                        .toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric' });
                    card.innerHTML = `
                        <div class="stat-header">
                            <span class="client-name">${escapeHtml(client.name)}</span>
                            <span style="font-weight: 700; color: ${balanceColor}; font-size: 1.05rem;">${balanceSign}${b.balanceH.toFixed(1)}h</span>
                        </div>
                        <div class="progress-container">
                            <div class="progress-bar ${isCritical}" style="width: ${pct}%; background: linear-gradient(90deg, #a855f7, #7c3aed);"></div>
                        </div>
                        <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-top: 8px;">
                            <span class="text-muted">${b.totalAppliedH.toFixed(1)}h aplicadas</span>
                            <span class="text-muted">${client.hoursTotal}h mensais contratadas</span>
                        </div>
                        <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 4px;">Controle na plataforma desde ${startLabel} · ${b.monthsCount} ${b.monthsCount === 1 ? 'mês' : 'meses'}</div>
                    `;
                } else {
                    // Sem balanceStartDate: exibe total histórico sem cálculo de saldo
                    const totalApplied = allRecords
                        .filter(r => r.clientId === client.id)
                        .reduce((s, r) => s + r.minutes, 0) / 60;
                    card.innerHTML = `
                        <div class="stat-header">
                            <span class="client-name">${escapeHtml(client.name)}</span>
                            <span class="text-muted" style="font-size: 0.82rem;">sem controle</span>
                        </div>
                        <div style="border-top: 1px solid rgba(255,255,255,0.06); margin: 10px 0;"></div>
                        <div style="font-size: 0.85rem; color: var(--text-muted);">${totalApplied.toFixed(1)}h aplicadas (total histórico)</div>
                    `;
                }
                container.appendChild(card);
            });
            return;
        }

        // ── Modo normal (mês) ─────────────────────────────────────────────
        let stats;
        if (batchStats && isCurrentMonth) {
            stats = filterStats(batchStats);
        } else {
            const allBatchStats = await store.getBatchStats(this._dashboardMonth);
            stats = filterStats(allBatchStats);
        }
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

        stats.forEach((stat, idx) => {
            const isCritical = stat.isOverLimit ? 'over-limit' : '';
            const statusColor = stat.isOverLimit ? 'var(--danger-color)' : 'var(--primary-color)';

            const card = document.createElement('div');
            card.className = 'stat-card glass stat-card-animate' + (stat.isOverLimit ? ' over-limit' : '');
            card.style.cursor = 'pointer';
            card.style.animationDelay = `${idx * 0.07}s`;
            // D5: glow color vaza da cor da barra
            if (stat.isOverLimit) {
                card.style.setProperty('--card-glow-color', 'rgba(239,68,68,0.4)');
                card.style.setProperty('--card-glow-shadow', 'rgba(239,68,68,0.2)');
            } else if (stat.percentage >= 80) {
                card.style.setProperty('--card-glow-color', 'rgba(245,158,11,0.4)');
                card.style.setProperty('--card-glow-shadow', 'rgba(245,158,11,0.18)');
            }
            if (stat.client.projectNum) card.title = `Projeto: ${stat.client.projectNum}`;
            card.onclick = () => app.openClientDashboard(stat.client.id);

            card.innerHTML = `
                <div class="stat-header">
                    <span class="client-name">${escapeHtml(stat.client.name)}</span>
                    <span style="font-weight: 600; color: ${statusColor}" class="dash-hours-value" data-target="${stat.hoursUsed}" data-total="${stat.hoursTotal}">0h / ${stat.hoursTotal}h</span>
                </div>
                <div class="progress-container">
                    <div class="progress-bar ${isCritical}" style="width: 0%;"></div>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-top: 8px;">
                    <span class="text-muted">${stat.percentage}% utilizado</span>
                    <span class="text-muted">${stat.hoursRemaining}h restantes</span>
                </div>
            `;
            container.appendChild(card);

            // Anima barra de progresso: 0% → valor real (double rAF para ativar transition)
            const bar = card.querySelector('.progress-bar');
            requestAnimationFrame(() => requestAnimationFrame(() => {
                bar.style.width = `${stat.percentage}%`;
            }));

            // Anima contador de horas com delay escalonado
            const hoursEl = card.querySelector('.dash-hours-value');
            this._animateCounter(hoursEl, stat.hoursUsed, stat.hoursTotal, idx * 70);
        });
    }

    // ── Skeleton helpers ─────────────────────────────────────────────────

    _skDashboard(container, count = 6) {
        container.innerHTML = Array.from({ length: count }, (_, i) => `
            <div class="sk-stat-card" style="animation-delay:${i * 50}ms">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
                    <div>
                        <div class="sk" style="width:140px;height:14px;margin-bottom:8px"></div>
                        <div class="sk" style="width:80px;height:11px"></div>
                    </div>
                    <div class="sk" style="width:48px;height:22px;border-radius:11px"></div>
                </div>
                <div style="display:flex;align-items:flex-end;gap:16px;margin-bottom:14px">
                    <div>
                        <div class="sk" style="width:100px;height:28px;margin-bottom:6px"></div>
                        <div class="sk" style="width:72px;height:11px"></div>
                    </div>
                    <div class="sk" style="width:64px;height:32px;border-radius:4px;margin-left:auto;flex-shrink:0"></div>
                </div>
                <div class="sk" style="height:5px;width:100%;margin-bottom:12px;border-radius:3px"></div>
                <div style="display:flex;justify-content:space-between">
                    <div class="sk" style="width:36px;height:13px"></div>
                    <div class="sk" style="width:72px;height:13px"></div>
                </div>
            </div>
        `).join('');
    }

    _skTable(tbody, cols = 5, rows = 6) {
        const widths = [55, 70, 100, 45, 60, 40];
        tbody.innerHTML = Array.from({ length: rows }, (_, r) => `
            <tr class="sk-row" style="animation-delay:${r * 35}ms">
                ${Array.from({ length: cols }, (_, c) =>
                    `<td><div class="sk" style="height:13px;width:${widths[c] || 60}px"></div></td>`
                ).join('')}
            </tr>
        `).join('');
    }

    _skKanban(board, numCols = 3) {
        const cardCounts = [3, 2, 4];
        board.innerHTML = Array.from({ length: numCols }, (_, ci) => `
            <div class="sk-kb-col" style="animation-delay:${ci * 70}ms">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
                    <div class="sk" style="width:10px;height:10px;border-radius:50%;flex-shrink:0"></div>
                    <div class="sk" style="width:100px;height:14px"></div>
                    <div class="sk" style="width:22px;height:18px;border-radius:9px;margin-left:auto"></div>
                </div>
                ${Array.from({ length: cardCounts[ci] ?? 2 }, (_, ki) => `
                    <div class="sk-kb-card" style="animation-delay:${(ci * 70) + (ki * 40)}ms">
                        <div class="sk" style="height:5px;width:100%;border-radius:3px;margin-bottom:12px"></div>
                        <div class="sk" style="width:85%;height:13px;margin-bottom:8px"></div>
                        <div class="sk" style="width:60%;height:13px;margin-bottom:12px"></div>
                        <div style="display:flex;gap:6px">
                            <div class="sk" style="width:60px;height:20px;border-radius:10px"></div>
                            <div class="sk" style="width:48px;height:20px;border-radius:10px"></div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `).join('');
    }

    // ─────────────────────────────────────────────────────────────────────
    // Button state helpers — loading / success / error

    _btnPending(btn) {
        if (!btn) return;
        btn._origHtml = btn.innerHTML;
        btn._origDisabled = btn.disabled;
        btn.disabled = true;
        btn.classList.add('btn-loading');
        btn.innerHTML = `<span class="btn-spinner"></span>${btn._origHtml}`;
    }

    _btnSuccess(btn) {
        if (!btn) return;
        btn.classList.remove('btn-loading');
        btn.classList.add('btn-success');
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:5px"><polyline points="20 6 9 17 4 12"/></svg>Salvo!`;
        return new Promise(resolve => setTimeout(() => {
            btn.classList.remove('btn-success');
            btn.innerHTML = btn._origHtml || btn.innerHTML;
            btn.disabled = btn._origDisabled || false;
            resolve();
        }, 550));
    }

    _btnError(btn) {
        if (!btn) return;
        btn.disabled = false;
        btn.classList.remove('btn-loading');
        btn.classList.add('btn-error');
        if (btn._origHtml) btn.innerHTML = btn._origHtml;
        setTimeout(() => btn.classList.remove('btn-error'), 800);
    }

    _twostepDelete(btn, onConfirm) {
        if (!btn) return;
        if (!btn._confirmDelete) {
            btn._confirmDelete = true;
            btn._origDeleteHtml = btn.innerHTML;
            btn.innerHTML = '<i data-lucide="alert-triangle" style="width:14px;height:14px;margin-right:4px;vertical-align:middle;"></i>Confirmar?';
            btn.style.setProperty('background', 'linear-gradient(135deg,#ef4444,#dc2626)', 'important');
            btn.style.setProperty('border-color', 'transparent', 'important');
            lucide.createIcons();
            btn._confirmTimer = setTimeout(() => {
                if (btn._confirmDelete) {
                    btn._confirmDelete = false;
                    btn.innerHTML = btn._origDeleteHtml;
                    btn.style.removeProperty('background');
                    btn.style.removeProperty('border-color');
                    lucide.createIcons();
                }
            }, 3000);
            return;
        }
        clearTimeout(btn._confirmTimer);
        btn._confirmDelete = false;
        onConfirm();
    }

    // ─────────────────────────────────────────────────────────────────────

    _animateCounter(el, target, hoursTotal, delay = 0) {
        if (!el || target <= 0) { if (el) el.textContent = `${target}h / ${hoursTotal}h`; return; }
        const duration = 800;
        const startTime = performance.now() + delay;
        const tick = (now) => {
            if (now < startTime) { requestAnimationFrame(tick); return; }
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            el.textContent = `${(eased * target).toFixed(1)}h / ${hoursTotal}h`;
            if (progress < 1) requestAnimationFrame(tick);
            else el.textContent = `${target}h / ${hoursTotal}h`;
        };
        requestAnimationFrame(tick);
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

    async renderClients(preloadedClients, batchStats) {
        const tbody = document.querySelector('#clients-table tbody');
        tbody.innerHTML = `<tr><td colspan="3">${spinnerHtml}</td></tr>`;

        const clients = preloadedClients || await store.getClients();
        const stats = batchStats || await Promise.all(clients.map(c => store.getClientStats(c.id)));

        // A partir daqui tudo é síncrono — sem yields, sem race condition possível
        tbody.innerHTML = '';

        if (clients.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="text-muted" style="text-align: center;">Nenhum cliente encontrado.</td></tr>`;
            return;
        }

        const formatMoney = (val) => {
            return (val && !isNaN(val)) ? `R$ ${parseFloat(val).toFixed(2).replace('.', ',')}` : 'R$ 0,00';
        };

        clients.forEach((c, i) => {
            const stat = stats[i];
            const overLimitBadge = stat && stat.isOverLimit ? `<span class="badge-danger-pulse" style="background: var(--danger-color); color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; margin-left: 8px;">Estourado</span>` : '';

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

            const tr = document.createElement('tr');
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
                        <button class="btn btn-danger" onclick="app.handleDeleteClient('${c.id}', this)" style="padding: 6px 12px; font-size: 0.8rem;">
                            <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i> Apagar
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
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
        document.getElementById('client-otobo-id').value = client.otoboCustomerId || '';
        document.getElementById('client-initial-balance').value =
            client.initialBalanceMinutes ? (client.initialBalanceMinutes / 60) : '';
        document.getElementById('client-balance-start').value = client.balanceStartDate || '';

        this.calculateConsultantValue();
        this.openModal('modal-client');
    }

    // ── SALDO DE HORAS ────────────────────────────────────────────

    _calcClientBalance(client, allRecords) {
        const clientRecords = allRecords.filter(r => r.clientId === client.id);
        const now = new Date();
        const nowYear = now.getFullYear();
        const nowMonth = now.getMonth(); // 0-indexed
        const yearMonthStr = `${nowYear}-${String(nowMonth + 1).padStart(2, '0')}`;

        // Horas aplicadas no mês atual
        const thisMonthMinutes = clientRecords
            .filter(r => r.date.startsWith(yearMonthStr))
            .reduce((s, r) => s + r.minutes, 0);

        if (!client.balanceStartDate) {
            // Sem controle configurado — só exibe mês atual
            return {
                hasTracking: false,
                thisMonthApplied: thisMonthMinutes / 60,
                contracted: client.hoursTotal,
                thisMonthDelta: thisMonthMinutes / 60 - client.hoursTotal,
                balanceH: null
            };
        }

        // Meses desde balance_start_date até o mês atual (inclusive)
        const start = new Date(client.balanceStartDate + 'T00:00:00');
        const startYear = start.getFullYear();
        const startMonth = start.getMonth();
        const monthsCount = Math.max(1, (nowYear - startYear) * 12 + (nowMonth - startMonth) + 1);

        // Só meses já completos são "cobrados" — o mês corrente ainda está em andamento
        const completedMonths = Math.max(0, monthsCount - 1);
        const totalContractedMinutes = completedMonths * client.hoursTotal * 60;
        const totalAppliedMinutes = clientRecords
            .filter(r => r.date >= client.balanceStartDate)
            .reduce((s, r) => s + r.minutes, 0);

        const balanceMinutes = client.initialBalanceMinutes + totalAppliedMinutes - totalContractedMinutes;

        return {
            hasTracking: true,
            monthsCount,
            totalContractedH: totalContractedMinutes / 60,
            totalAppliedH: totalAppliedMinutes / 60,
            balanceH: balanceMinutes / 60,
            thisMonthApplied: thisMonthMinutes / 60,
            contracted: client.hoursTotal
        };
    }

    async openSaldoPanel() {
        const content = document.getElementById('saldo-content');
        const subtitle = document.getElementById('saldo-subtitle');
        content.innerHTML = `<div style="text-align:center; padding: 24px;">${spinnerHtml}</div>`;
        this.openModal('modal-saldo');

        try {
            const [clients, allRecords] = await Promise.all([
                store.getClients(),
                store.getRecords()
            ]);

            const now = new Date();
            const monthName = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
            subtitle.textContent = `Posição acumulada até ${monthName}`;

            const activeClients = clients.filter(c => c.status === 'active');
            if (activeClients.length === 0) {
                content.innerHTML = `<p class="text-muted" style="text-align:center; padding: 24px;">Nenhum cliente ativo.</p>`;
                return;
            }

            const rows = activeClients.map(c => {
                const b = this._calcClientBalance(c, allRecords);
                const fmtH = h => {
                    const sign = h > 0 ? '+' : '';
                    return `${sign}${h.toFixed(1)}h`;
                };

                let balanceCell = '';
                if (b.hasTracking) {
                    const color = b.balanceH >= 0 ? '#4ade80' : '#f87171';
                    balanceCell = `<span style="color:${color}; font-weight:600;">${fmtH(b.balanceH)}</span>`;
                } else {
                    balanceCell = `<span class="text-muted" style="font-size:0.8rem;">sem controle</span>`;
                }

                const deltaColor = b.thisMonthDelta >= 0 ? '#4ade80' : '#f87171';
                const monthCell = `${b.thisMonthApplied.toFixed(1)}h
                    <span style="color:${deltaColor}; font-size:0.8rem; margin-left:4px;">(${fmtH(b.thisMonthDelta)})</span>`;

                const proj = c.projectNum ? `<span style="color:var(--text-muted); font-size:0.8rem;">#${escapeHtml(c.projectNum)}</span> ` : '';

                return `<tr>
                    <td>${proj}<strong>${escapeHtml(c.name)}</strong></td>
                    <td style="text-align:center;">${c.hoursTotal}h</td>
                    <td style="text-align:center;">${monthCell}</td>
                    <td style="text-align:center;">${balanceCell}</td>
                </tr>`;
            }).join('');

            content.innerHTML = `
                <table class="data-table" style="margin: 0;">
                    <thead>
                        <tr>
                            <th>Cliente</th>
                            <th style="text-align:center;">Cota/mês</th>
                            <th style="text-align:center;">Mês atual</th>
                            <th style="text-align:center;">Saldo acumulado</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
                <p class="text-muted" style="font-size:0.75rem; padding: 12px 0 0; margin:0;">
                    Saldo = aplicado − contratado acumulado desde o início do controle. Positivo = você entregou mais que o contratado.
                </p>`;
            lucide.createIcons();
        } catch (err) {
            content.innerHTML = `<p style="color:var(--danger-color); padding:16px;">Erro ao carregar saldo: ${err.message}</p>`;
        }
    }

    async renderRecords(preloadedClients) {
        const tbody = document.querySelector('#records-table tbody');
        this._skTable(tbody, 5, 6);
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

        const btnNewRecord = document.getElementById('btn-new-record');
        if (records.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-muted" style="text-align: center;">Nenhum atendimento lançado.</td></tr>`;
            if (btnNewRecord) btnNewRecord.classList.add('btn-pulse-empty');
            return;
        }
        if (btnNewRecord) btnNewRecord.classList.remove('btn-pulse-empty');

        const clientsList = preloadedClients || await store.getClients();
        const clientsMap = {};
        clientsList.forEach(c => { clientsMap[c.id] = c; });

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
                        <button class="btn btn-danger" onclick="app.handleDeleteRecord('${r.id}', this)" style="padding: 6px 10px; font-size: 0.8rem;" title="Apagar">
                            <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    async updateClientSelects(clients) {
        const selects = [
            document.getElementById('record-client'),
            document.getElementById('filter-client'),
            document.getElementById('task-client'),
            document.getElementById('filter-task-client'),
            document.getElementById('agenda-client')
        ];

        if (!clients) clients = await store.getClients();

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

        const allClients = await store.getClients();
        const clientsMap = {};
        allClients.forEach(c => { clientsMap[c.id] = c; });

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
                        <button class="btn btn-danger" onclick="app.handleDeleteRecord('${r.id}', this)" style="padding: 6px 10px; font-size: 0.8rem;" title="Apagar">
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

        // Migração única por sessão: status antigos ('new','doing','done') → UUIDs
        if (!sessionStorage.getItem('kbMigrated')) {
            await this._migrateOldStatuses();
            sessionStorage.setItem('kbMigrated', '1');
        }

        const filterClient   = document.getElementById('filter-task-client')?.value;
        const filterPriority = document.getElementById('filter-task-priority')?.value;
        const filterLabel    = document.getElementById('filter-task-label')?.value;

        const allTasks = await store.getTasks();
        this._populateLabelFilter(allTasks);

        const board = document.getElementById('kanban-board');
        if (!board) return;

        // Botão Gerenciar Colunas — só visível com cliente selecionado
        const btnManage = document.getElementById('btn-manage-columns');

        if (!filterClient) {
            // Sem cliente: placeholder
            this._currentColumns = [];
            if (btnManage) btnManage.style.display = 'none';
            board.innerHTML = `
                <div class="kb-empty-state">
                    <i data-lucide="columns" style="width:48px;height:48px;opacity:0.25"></i>
                    <p>Selecione um cliente nos filtros para visualizar o Kanban</p>
                </div>`;
            await this.renderTasksDashboard(allTasks, '');
            lucide.createIcons();
            return;
        }

        if (btnManage) btnManage.style.display = 'flex';

        // Carrega (ou cria) colunas do cliente selecionado
        try {
            this._currentColumns = await store.ensureDefaultColumns(filterClient);
        } catch (err) {
            console.error('Erro ao carregar colunas:', err);
            this._currentColumns = [];
            Toast.show('Erro ao carregar colunas. Execute o SQL de migração no Supabase.', 'error', 5000);
        }

        // Filtra tasks do cliente
        let tasks = allTasks.filter(t => t.clientId === filterClient);
        if (filterPriority) tasks = tasks.filter(t => t.priority === filterPriority);
        if (filterLabel)    tasks = tasks.filter(t => (t.labels || []).some(l => l.color === filterLabel));

        this._skKanban(board, this._currentColumns.length || 3);

        const clientIds = [...new Set(tasks.map(t => t.clientId).filter(Boolean))];
        const clientsMap = {};
        await Promise.all(clientIds.map(async id => { clientsMap[id] = await store.getClient(id); }));

        this._renderKanbanBoard(this._currentColumns, tasks, clientsMap);
        await this.renderTasksDashboard(tasks, filterClient);
        lucide.createIcons();

        const btnNewTask = document.getElementById('btn-new-task');
        if (btnNewTask) {
            if (tasks.length === 0) btnNewTask.classList.add('btn-pulse-empty');
            else btnNewTask.classList.remove('btn-pulse-empty');
        }
    }

    async _migrateOldStatuses() {
        const OLD = ['new', 'doing', 'done'];
        let tasks;
        try { tasks = await store.getTasks(); } catch (_) { return; }
        const toMigrate = tasks.filter(t => OLD.includes(t.status));
        if (toMigrate.length === 0) return;

        // Agrupa por clientId
        const groups = {};
        toMigrate.forEach(t => {
            const key = t.clientId || '__global__';
            if (!groups[key]) groups[key] = [];
            groups[key].push(t);
        });

        for (const [key, group] of Object.entries(groups)) {
            const clientId = key === '__global__' ? null : key;
            let cols;
            try { cols = await store.ensureDefaultColumns(clientId); } catch (_) { continue; }
            // cols[0]=Novas, cols[1]=Em Execução, cols[2]=Finalizadas
            const map = { new: cols[0]?.id, doing: cols[1]?.id, done: cols[2]?.id };
            await Promise.all(group.map(t => {
                const newId = map[t.status];
                return newId ? store.updateTaskStatus(t.id, newId) : Promise.resolve();
            }));
        }
    }

    _renderKanbanBoard(columns, tasks, clientsMap) {
        const board = document.getElementById('kanban-board');
        if (!board) return;
        board.innerHTML = '';

        if (columns.length === 0) {
            board.innerHTML = `<div class="kb-empty-state"><i data-lucide="columns" style="width:48px;height:48px;opacity:0.25"></i><p>Nenhuma coluna configurada.</p></div>`;
            return;
        }

        columns.forEach((col, colIdx) => {
            const colTasks = tasks.filter(t => t.status === col.id);
            const colId = col.id;
            const colEl = document.createElement('div');
            colEl.className = 'kb-column kb-column-cascade';
            colEl.style.animationDelay = `${colIdx * 0.07}s`;
            colEl.dataset.status = colId;

            colEl.innerHTML = `
                <div class="kb-column-header">
                    <div class="kb-column-title">
                        <span class="kb-column-dot" style="background:${escapeHtml(col.color)}"></span>
                        <h3>${escapeHtml(col.name)}</h3>
                        ${col.isDone ? '<span class="kb-done-badge" title="Finalizada">✓</span>' : ''}
                        <span class="kb-count" id="kb-count-${colId}">${colTasks.length}</span>
                    </div>
                    <button class="kb-header-add" onclick="app.openQuickAdd('${colId}')" title="Adicionar card">
                        <i data-lucide="plus"></i>
                    </button>
                </div>
                <div class="kb-dropzone" id="kb-col-${colId}" data-status="${colId}"
                     ondragover="app.allowDrop(event)" ondrop="app.dropTask(event)"></div>
                <div class="kb-quick-add" id="kb-quick-add-${colId}" style="display:none">
                    <textarea class="kb-quick-add-input" id="kb-quick-input-${colId}" rows="3"
                              placeholder="Título do card..." spellcheck="true"
                              onkeydown="app.handleQuickAddKey(event,'${colId}')"></textarea>
                    <div class="kb-quick-add-actions">
                        <button class="btn btn-primary" onclick="app.submitQuickAdd('${colId}')">Adicionar</button>
                        <button class="btn btn-ghost" onclick="app.closeQuickAdd('${colId}')"><i data-lucide="x"></i></button>
                    </div>
                </div>
                <button class="kb-add-card-btn" id="kb-add-btn-${colId}" onclick="app.openQuickAdd('${colId}')">
                    <i data-lucide="plus"></i> Adicionar card
                </button>
            `;

            const dropzone = colEl.querySelector('.kb-dropzone');
            colTasks.forEach(task => dropzone.appendChild(this.createKanbanCard(task, clientsMap)));

            board.appendChild(colEl);
        });
    }

    createKanbanCard(task, clientsMap) {
        const card = document.createElement('div');
        card.className = 'kb-card' + (task.id === this._lastAddedTaskId ? ' kb-card-new' : '');
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
        if (task.completed) {
            badgesHtml += `<span class="kb-badge kb-badge-completed"><i data-lucide="check-circle" style="width:10px;height:10px"></i> Concluída</span>`;
        }

        const completeTitle = task.completed ? 'Marcar como incompleta' : 'Marcar como concluída';
        const completeIcon = task.completed ? 'check-circle-2' : 'circle';

        card.innerHTML = `
            ${coverHtml}
            ${labelsHtml}
            <p class="kb-card-title">${escapeHtml(task.title)}</p>
            <div class="kb-card-badges">${badgesHtml}</div>
            <div class="kb-card-footer">
                <span class="kb-card-client">${clientName}</span>
                <div class="kb-card-actions">
                    <button type="button" class="kb-action-btn kb-complete-btn${task.completed ? ' kb-complete-btn--done' : ''}"
                        onclick="event.stopPropagation();app.toggleTaskComplete('${task.id}', ${!task.completed})"
                        title="${completeTitle}">
                        <i data-lucide="${completeIcon}" style="width:12px;height:12px"></i>
                    </button>
                    <button type="button" class="kb-action-btn" onclick="event.stopPropagation();app.handleEditTask('${task.id}')" title="Editar">
                        <i data-lucide="pencil" style="width:12px;height:12px"></i>
                    </button>
                    <button type="button" class="kb-action-btn kb-action-danger" onclick="event.stopPropagation();app.handleDeleteTask('${task.id}', this)" title="Excluir">
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

        const doneIds = new Set(this._currentColumns.filter(c => c.isDone).map(c => c.id));
        doneIds.add('done'); // suporte legado
        const openTasks = tasks.filter(t => !doneIds.has(t.status));
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
        // Reseta multi-select de tarefas
        this._agendaRelatedTaskIds = [];
        this._agendaTaskPanelTempIds = [];
        this._renderAgendaTaskChips();
        this._updateAgendaLinkBtn();
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
        const allCols = await store.getAllColumns().catch(() => []);
        const doneIds = new Set(allCols.filter(c => c.isDone).map(c => c.id));
        doneIds.add('done');
        this._agendaAllTasks = (await store.getTasks()).filter(t => !doneIds.has(t.status));
    }

    openAgendaTaskPanel() {
        const panel = document.getElementById('agenda-task-panel');
        if (!panel) return;
        // Copia confirmadas para temporárias
        this._agendaTaskPanelTempIds = [...this._agendaRelatedTaskIds];
        this._renderAgendaTaskPanel();
        panel.style.display = 'block';
        lucide.createIcons();
    }

    cancelAgendaTaskPanel() {
        const panel = document.getElementById('agenda-task-panel');
        if (panel) panel.style.display = 'none';
        this._agendaTaskPanelTempIds = [];
    }

    confirmAgendaTaskPanel() {
        this._agendaRelatedTaskIds = [...this._agendaTaskPanelTempIds];
        this._agendaTaskPanelTempIds = [];
        const panel = document.getElementById('agenda-task-panel');
        if (panel) panel.style.display = 'none';
        this._renderAgendaTaskChips();
        this._updateAgendaLinkBtn();
        this._updateDescriptionWithTasks();
    }

    toggleAgendaTaskTemp(taskId) {
        const idx = this._agendaTaskPanelTempIds.indexOf(taskId);
        if (idx === -1) this._agendaTaskPanelTempIds.push(taskId);
        else this._agendaTaskPanelTempIds.splice(idx, 1);
        const item = document.querySelector(`.agenda-task-panel-item[data-id="${taskId}"]`);
        if (item) {
            const checked = this._agendaTaskPanelTempIds.includes(taskId);
            item.classList.toggle('checked', checked);
            item.querySelector('input').checked = checked;
        }
    }

    removeAgendaTask(taskId) {
        this._agendaRelatedTaskIds = this._agendaRelatedTaskIds.filter(id => id !== taskId);
        this._renderAgendaTaskChips();
        this._updateAgendaLinkBtn();
        this._updateDescriptionWithTasks();
    }

    _renderAgendaTaskPanel() {
        const list = document.getElementById('agenda-task-panel-list');
        if (!list) return;
        const clientId = document.getElementById('agenda-client')?.value || '';
        const tasks = clientId
            ? this._agendaAllTasks.filter(t => t.clientId === clientId)
            : this._agendaAllTasks;
        const tempSet = new Set(this._agendaTaskPanelTempIds);
        if (!tasks.length) { list.innerHTML = ''; return; }
        list.innerHTML = tasks.map(t => {
            const checked = tempSet.has(t.id);
            const safe = t.title.replace(/</g, '&lt;').replace(/"/g, '&quot;');
            return `<label class="agenda-task-panel-item${checked ? ' checked' : ''}" data-id="${t.id}">
                <input type="checkbox" ${checked ? 'checked' : ''} onchange="app.toggleAgendaTaskTemp('${t.id}')">
                <span class="agenda-task-panel-item-label" title="${safe}">${safe}</span>
            </label>`;
        }).join('');
    }

    _renderAgendaTaskChips() {
        const container = document.getElementById('agenda-task-chips');
        if (!container) return;
        const taskMap = new Map(this._agendaAllTasks.map(t => [t.id, t.title]));
        container.innerHTML = this._agendaRelatedTaskIds.map(id => {
            const title = taskMap.get(id) || id;
            const safe = title.replace(/</g, '&lt;').replace(/"/g, '&quot;');
            return `<span class="agenda-task-chip" title="${safe}">
                <span class="agenda-task-chip-name">${safe}</span>
                <button type="button" class="agenda-task-chip-remove" onclick="app.removeAgendaTask('${id}')" title="Remover">×</button>
            </span>`;
        }).join('');
    }

    _updateAgendaLinkBtn() {
        const badge = document.getElementById('agenda-task-count-badge');
        if (!badge) return;
        const count = this._agendaRelatedTaskIds.length;
        badge.textContent = count;
        badge.style.display = count > 0 ? 'inline-block' : 'none';
    }

    _updateDescriptionWithTasks() {
        const textarea = document.getElementById('agenda-desc');
        if (!textarea) return;
        const SENTINEL = '\n\nTarefas executadas:\n';
        const full = textarea.value;
        const sentinelIdx = full.indexOf(SENTINEL);
        const userText = sentinelIdx !== -1 ? full.slice(0, sentinelIdx) : full;
        if (this._agendaRelatedTaskIds.length === 0) {
            textarea.value = userText;
            return;
        }
        const taskMap = new Map(this._agendaAllTasks.map(t => [t.id, t.title]));
        const lines = this._agendaRelatedTaskIds
            .map(id => `- ${taskMap.get(id) || id}`)
            .join('\n');
        textarea.value = userText + SENTINEL + lines;
    }

    async handleAgendaSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('agenda-id').value;
        const btn = e.submitter || document.querySelector('#form-agenda-event button[type="submit"]');

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
            relatedTaskId: this._agendaRelatedTaskIds[0] || null,
            relatedTaskIds: [...this._agendaRelatedTaskIds],
            date: startDate,
            dateEnd: endDate < startDate ? startDate : endDate,
            startTime: allDay ? '' : document.getElementById('agenda-start').value,
            endTime: allDay ? '' : document.getElementById('agenda-end').value,
            location: document.getElementById('agenda-location').value,
            attendees: document.getElementById('agenda-attendees').value.trim(),
            generateMeet,
            meetLink: existingMeetLink
        };

        this._btnPending(btn);

        // Força sync se: (a) usuário marcou o checkbox, OU (b) evento já estava no Google
        const existingCalId = id ? (document.getElementById('agenda-calendar-event-id').value || null) : null;
        const needsGoogleSync = (syncGoogle || !!existingCalId) && calendarAPI.isEnabled;

        if (needsGoogleSync) {
            if (!calendarAPI.isAuthenticated) {
                const success = await calendarAPI.authenticateGoogle();
                if (!success) {
                    Toast.show('Falha na autenticação do Google.', 'error');
                    this._btnError(btn);
                    return;
                }
            }
        }

        try {
            if (id) {
                eventData.id = id;
                eventData.calendarEventId = existingCalId;
                if (needsGoogleSync && calendarAPI.isAuthenticated) {
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
                if (syncGoogle && calendarAPI.isAuthenticated) {
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
                btn.classList.remove('btn-loading');
                btn.classList.add('btn-success');
                btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:5px"><polyline points="20 6 9 17 4 12"/></svg>Salvo!`;
                btn.disabled = true;
                this.renderAgenda();
                return;
            } else {
                await this._btnSuccess(btn);
                this.closeModal('modal-agenda-event');
                await this.renderAgenda();
                Toast.show(id ? 'Agendamento atualizado.' : 'Agendamento criado.', 'success');
            }
        } catch (err) {
            this._btnError(btn);
            Toast.show('Erro ao salvar agendamento: ' + err.message, 'error');
        }
    }

    async editAgendaEvent(id) {
        const ev = await store.getAgendaEvent(id);
        if (!ev) return;

        document.getElementById('modal-agenda-title').innerText = 'Editar Agendamento';
        document.getElementById('agenda-id').value = ev.id;
        document.getElementById('agenda-title').value = ev.title;
        const agendaDescEl = document.getElementById('agenda-desc');
        agendaDescEl.value = ev.description;
        this._updateDescLinks(ev.description);
        setTimeout(() => this._autoResizeTextarea(agendaDescEl), 0);
        document.getElementById('agenda-type').value = ev.type;
        document.getElementById('agenda-client').value = ev.clientId || '';
        this._agendaRelatedTaskIds = Array.isArray(ev.relatedTaskIds) ? [...ev.relatedTaskIds] : [];
        this._agendaTaskPanelTempIds = [];
        await this.updateAgendaTaskSelect();
        this._renderAgendaTaskChips();
        this._updateAgendaLinkBtn();
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

    async deleteAgendaEvent(id, btn) {
        const block = btn?.closest?.('.event-block') || btn?.closest?.('.event-allday-banner');
        if (block) { block.classList.add('row-deleting'); await new Promise(r => setTimeout(r, 400)); }
        try {
            const ev = await store.getAgendaEvent(id);
            if (ev && ev.calendarEventId && calendarAPI.isAuthenticated) {
                await calendarAPI.deleteGoogleEvent(ev.calendarEventId);
            }
            await store.deleteAgendaEvent(id);
            await this.renderAgenda();
            Toast.show('Agendamento excluído.', 'success');
        } catch (err) {
            if (block) block.classList.remove('row-deleting');
            Toast.show('Erro ao excluir agendamento: ' + err.message, 'error');
        }
    }

    deleteAgendaEventFromModal() {
        const id = document.getElementById('agenda-id').value;
        if (!id) return;
        const btn = document.getElementById('btn-delete-agenda-event');
        this._twostepDelete(btn, async () => {
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
        });
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

        // Flat 2-column CSS grid: each pair of siblings forms a row whose height
        // is equalized by the browser, so time slots align with event blocks.
        container.innerHTML = `
            <div class="agenda-week-grid">
                <div class="agenda-week-header-spacer"></div>
                <div class="agenda-days-row" style="grid-template-columns: repeat(7, 1fr);">
                    ${headersHtml}
                </div>
                ${hasAnyAllDay ? `
                    <div class="agenda-allday-time-slot">DIA INTEIRO</div>
                    <div class="agenda-allday-week-grid" style="grid-template-columns: repeat(7, 1fr);">${allDayRowHtml}</div>
                ` : ''}
                <div class="agenda-time-column">
                    ${this.generateTimeSlots()}
                </div>
                <div class="events-container" style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px;">
                    <div class="agenda-grid-lines"></div>
                    ${columnsHtml}
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
            const dayEvents = events
                .filter(e => e.date <= iso && (e.dateEnd || e.date) >= iso)
                .sort((a, b) => {
                    if (!a.startTime && !b.startTime) return 0;
                    if (!a.startTime) return -1;
                    if (!b.startTime) return 1;
                    return a.startTime.localeCompare(b.startTime);
                });

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
                            onclick="event.stopPropagation();app.deleteAgendaEvent('${ev.id}', this)">
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
        // Inicia sync periódico a cada 5 minutos
        if (this._googleSyncInterval) clearInterval(this._googleSyncInterval);
        this._googleSyncInterval = setInterval(() => {
            if (calendarAPI.isAuthenticated && this.currentView === 'agenda') {
                this._autoSyncGoogle().catch(() => {});
            }
        }, 5 * 60 * 1000);
        await this.renderAgenda();
    }

    async _autoSyncGoogle() {
        const COOLDOWN_MS = 120_000; // 2 minutos
        const now = Date.now();
        if (now - this._lastGoogleSync < COOLDOWN_MS) return;
        this._lastGoogleSync = now;
        try {
            await this.executeBiDirectionalSync();
            if (this.currentView === 'agenda') await this.renderAgenda();
        } catch (err) {
            console.warn('Auto-sync Google Calendar falhou:', err);
        }
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

        btn.classList.add('syncing');
        btn.disabled = true;

        try {
            await this.executeBiDirectionalSync();
            Toast.show('Sincronização concluída com sucesso!', 'success');
        } catch (error) {
            console.error("Erro no sync", error);
            const msg = error.message && error.message.includes('falharam')
                ? error.message
                : 'Erro durante a sincronização.';
            Toast.show(msg, 'warning');
        } finally {
            btn.classList.remove('syncing');
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
        // Rastreia eventos locais resolvidos no Passo 1 (por ID exato ou fuzzy match).
        // Impede que o Passo 2 empurre de volta ao Google eventos já tratados.
        const processedLocalIds = new Set();
        // Rastreia combinações título+data+hora já resolvidas no Passo 1.
        // Impede que eventos duplicados no Google (mesmo título/data/hora, IDs diferentes —
        // criados pelo bug antigo) sejam importados como novos eventos locais sem clientId.
        const resolvedGoogleKeys = new Set();

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

                // Chave de identidade para detectar duplicatas do Google (mesmo evento, IDs diferentes)
                const googleKey = `${mappedData.title}|${mappedData.date}|${mappedData.startTime}`;

                // Pula se outro evento do Google com mesma chave já foi resolvido neste sync.
                // Isso descarta duplicatas históricas no Google criadas pelo bug antigo,
                // evitando que virem eventos locais órfãos sem clientId.
                if (!match && resolvedGoogleKeys.has(googleKey)) continue;

                // Fallback: se não achou por calendarEventId, tenta por título+data+hora
                // para evitar criar duplicatas sem clientId quando o ID perdeu sincronismo
                const fuzzyMatch = !match
                    ? localEvents.find(le =>
                        !le.calendarEventId &&
                        le.title === mappedData.title &&
                        le.date === mappedData.date &&
                        le.startTime === mappedData.startTime)
                    : null;
                const effective = match || fuzzyMatch;

                if (effective) {
                    mappedData.id = effective.id;
                    mappedData.type = effective.type; // Preserva o tipo customizado do TSP
                    mappedData.clientId = effective.clientId;
                    mappedData.relatedTaskId = effective.relatedTaskId;
                    mappedData.relatedTaskIds = effective.relatedTaskIds || [];
                    if (!mappedData.meetLink) mappedData.meetLink = effective.meetLink || '';
                    processedLocalIds.add(effective.id); // Marca como processado — evita duplicata no Passo 2
                    resolvedGoogleKeys.add(googleKey);   // Marca chave como resolvida — descarta Google duplicatas
                    await store.updateAgendaEvent(mappedData);
                } else {
                    resolvedGoogleKeys.add(googleKey); // Mesmo sem match local, marca chave para não reimportar
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
            if (processedLocalIds.has(le.id)) continue; // Já resolvido via fuzzy match no Passo 1
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

        // 3. Remove eventos locais que foram deletados no Google (dentro da janela de ±30 dias)
        const googleIdSet = new Set(googleEvents.map(g => g.id));
        const syncWindowStart = new Date();
        syncWindowStart.setDate(syncWindowStart.getDate() - 30);
        const syncWindowEnd = new Date();
        syncWindowEnd.setDate(syncWindowEnd.getDate() + 30);
        const windowStartStr = syncWindowStart.toISOString().split('T')[0];
        const windowEndStr = syncWindowEnd.toISOString().split('T')[0];

        for (const le of localEvents) {
            if (!le.calendarEventId) continue; // Nunca foi ao Google, não apagar
            if (le.date < windowStartStr || le.date > windowEndStr) continue; // Fora da janela, não tocar
            if (googleIdSet.has(le.calendarEventId)) continue; // Ainda existe no Google, ok
            // Evento foi deletado no Google — remover localmente
            try {
                await store.deleteAgendaEvent(le.id);
            } catch (err) {
                console.error('Erro ao remover evento deletado no Google:', le.title, err);
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
            let pendingCount = 0;

            for (const projectNum of unMatchedProjects) {
                const searchNum = projectNum.replace(/\D/g, '');

                // Verifica se já existe no banco (importação anterior)
                const existing = clients.find(c => {
                    if (!c.projectNum) return false;
                    return c.projectNum.split(/\D+/).filter(Boolean).includes(searchNum);
                });

                if (existing) {
                    // Já existe — associa diretamente
                    this.pendingPdfRecords.forEach(r => {
                        if (r.clientProjectPdf.replace(/\D/g, '') === searchNum && !r.matchedClientId) {
                            r.matchedClientId = existing.id;
                            r.matchedClientName = existing.name;
                            r.autoCreated = false;
                        }
                    });
                } else {
                    // Não existe — marca para criação apenas quando o usuário confirmar
                    const clientName = this.pendingPdfRecords.find(r =>
                        r.clientProjectPdf.replace(/\D/g, '') === searchNum && r.clientNamePdf
                    )?.clientNamePdf || `Projeto ${projectNum}`;
                    this.pendingPdfRecords.forEach(r => {
                        if (r.clientProjectPdf.replace(/\D/g, '') === searchNum && !r.matchedClientId) {
                            r.matchedClientId = null;
                            r.matchedClientName = clientName;
                            r.autoCreated = true;
                            r.pendingCreate = { name: clientName, projectNum };
                        }
                    });
                    pendingCount++;
                }
            }

            if (pendingCount > 0) {
                Toast.show(`${pendingCount} cliente(s) novo(s) serão criados ao confirmar a importação.`, 'info', 5000);
            }
        }

        const uniqueClientIds = new Set(this.pendingPdfRecords.map(r => r.matchedClientId));
        if (uniqueClientIds.size === 1) {
            statusInput.value = `${this.pendingPdfRecords[0].matchedClientName} (Padrão Único)`;
        } else {
            statusInput.value = `Múltiplos Clientes Identificados (${uniqueClientIds.size})`;
        }

        // Detecta duplicatas via query bulk por intervalo de datas
        const resolvedDates = this.pendingPdfRecords.map(r => r.date).filter(Boolean).sort();
        const resolvedClientIds = [...new Set(
            this.pendingPdfRecords.map(r => r.matchedClientId).filter(Boolean)
        )];
        let existingSet = new Set();
        if (resolvedDates.length > 0 && resolvedClientIds.length > 0) {
            try {
                const existingRecords = await store.getRecordsByDateRange(
                    resolvedDates[0], resolvedDates[resolvedDates.length - 1], resolvedClientIds
                );
                existingSet = new Set(
                    existingRecords.map(r => `${r.clientId}|${r.date}|${r.startTime}|${r.endTime}`)
                );
            } catch(e) { /* falha silenciosa — segue sem detecção */ }
        }
        for (const r of this.pendingPdfRecords) {
            const key = `${r.matchedClientId}|${r.date}|${r.startTime}|${r.endTime}`;
            r._isDuplicate = !!(r.matchedClientId && existingSet.has(key));
        }
        const dupCount = this.pendingPdfRecords.filter(r => r._isDuplicate).length;

        const warningsEl = document.getElementById('pdf-warnings');
        const warnings = this.pendingPdfWarnings || [];
        if (warnings.length > 0) {
            warningsEl.innerHTML = `<strong>⚠ Divergência de horas detectada em ${warnings.length} página(s):</strong><ul style="margin:6px 0 0 16px;padding:0;">${warnings.map(w => `<li>${w}</li>`).join('')}</ul>`;
            warningsEl.style.display = 'block';
        } else {
            warningsEl.style.display = 'none';
            warningsEl.innerHTML = '';
        }

        let dupWarningsEl = document.getElementById('pdf-dup-warnings');
        if (!dupWarningsEl) {
            dupWarningsEl = document.createElement('div');
            dupWarningsEl.id = 'pdf-dup-warnings';
            dupWarningsEl.style.cssText = 'margin-top:10px; padding:10px 14px; border-radius:8px; background:rgba(234,179,8,0.1); border:1px solid rgba(234,179,8,0.35); color:var(--warning-color,#eab308); font-size:0.85rem; line-height:1.5;';
            warningsEl.insertAdjacentElement('afterend', dupWarningsEl);
        }
        if (dupCount > 0) {
            const dupList = this.pendingPdfRecords
                .filter(r => r._isDuplicate)
                .map(r => `<li>${r.dateStrBrazil} — ${r.matchedClientName} (${r.startTime}–${r.endTime})</li>`)
                .join('');
            dupWarningsEl.innerHTML = `<strong>⚠ ${dupCount} registro(s) já foram lançados anteriormente e serão ignorados:</strong><ul style="margin:6px 0 0 16px;padding:0;">${dupList}</ul>`;
            dupWarningsEl.style.display = 'block';
        } else {
            dupWarningsEl.style.display = 'none';
            dupWarningsEl.innerHTML = '';
        }

        document.getElementById('modal-import-pdf').classList.add('active');

        const tbody = document.querySelector('#pdf-records-table tbody');
        tbody.innerHTML = '';

        this.pendingPdfRecords.forEach((r, idx) => {
            const tr = document.createElement('tr');
            const warnIcon = r._warningMsg
                ? `<span title="${r._warningMsg.replace(/"/g, '&quot;')}" style="margin-left:4px;color:var(--warning-color,#f59e0b);cursor:help;">⚠</span>`
                : '';
            if (r._isDuplicate) {
                tr.className = 'pdf-row-duplicate';
                tr.innerHTML = `
                    <td style="font-size: 0.9rem;">${r.dateStrBrazil}</td>
                    <td style="font-size: 0.9rem;">${r.matchedClientName} <span class="pdf-dup-badge">Já lançado</span></td>
                    <td style="font-size: 0.9rem;">${r.startTime} - ${r.endTime}</td>
                    <td style="font-size: 0.9rem;">${Math.floor(r.minutes / 60)}h${String(r.minutes % 60).padStart(2,'0')}min</td>
                    <td style="font-size:0.85rem;color:var(--text-muted);">${r.description}</td>
                    <td style="text-align: center;"><input type="checkbox" id="pdf-check-${idx}" disabled style="width: 18px; height: 18px; opacity: 0.4; cursor: not-allowed;"></td>
                `;
            } else {
                tr.innerHTML = `
                    <td style="font-size: 0.9rem;">${r.dateStrBrazil}</td>
                    <td style="font-size: 0.9rem; font-weight: 500; color: var(--primary-color);">${r.matchedClientName}${r.autoCreated ? ' <span style="font-size:0.75rem;background:var(--primary-color);color:#fff;border-radius:4px;padding:1px 5px;">Novo</span>' : ''}</td>
                    <td style="font-size: 0.9rem;">${r.startTime} - ${r.endTime}</td>
                    <td style="font-size: 0.9rem;">${Math.floor(r.minutes / 60)}h${String(r.minutes % 60).padStart(2,'0')}min${warnIcon}</td>
                    <td><textarea class="form-control" id="pdf-desc-${idx}" style="font-size: 0.85rem; padding: 4px; width: 100%; min-width: 250px; resize: vertical;" rows="3" spellcheck="true">${r.description}</textarea></td>
                    <td style="text-align: center;"><input type="checkbox" id="pdf-check-${idx}" checked style="width: 18px; height: 18px; cursor: pointer;"></td>
                `;
            }
            tbody.appendChild(tr);
        });
    }

    async confirmPdfImport() {
        const confirmBtn = document.getElementById('btn-confirm-pdf-import');
        const cancelBtn = document.getElementById('btn-cancel-pdf-import');
        const closeBtn = document.querySelector('#modal-import-pdf .close-modal');

        const toImport = this.pendingPdfRecords.filter((r, idx) => {
            const cb = document.getElementById(`pdf-check-${idx}`);
            return cb && cb.checked && (r.matchedClientId || r.pendingCreate);
        });
        const total = toImport.length;

        // Bloqueia controles para evitar cliques duplos
        confirmBtn.disabled = true;
        cancelBtn.disabled = true;
        if (closeBtn) closeBtn.disabled = true;

        // Cria clientes pendentes com verificação fresca do banco (evita duplicatas)
        const sessionCreated = new Map(); // searchNum → clientId
        const freshClients = await store.getClients();
        for (const r of toImport) {
            if (!r.matchedClientId && r.pendingCreate) {
                const searchNum = r.pendingCreate.projectNum.replace(/\D/g, '');
                if (sessionCreated.has(searchNum)) {
                    r.matchedClientId = sessionCreated.get(searchNum);
                    continue;
                }
                const existing = freshClients.find(c => {
                    if (!c.projectNum) return false;
                    return c.projectNum.split(/\D+/).filter(Boolean).includes(searchNum);
                });
                if (existing) {
                    r.matchedClientId = existing.id;
                    sessionCreated.set(searchNum, existing.id);
                } else {
                    const created = await store.addClient(
                        r.pendingCreate.name, 0, '', r.pendingCreate.projectNum, 0, 0,
                        'Cliente criado automaticamente via importação de Ata PDF. Cadastro incompleto — por favor, complete os dados.',
                        'active'
                    );
                    r.matchedClientId = created.id;
                    sessionCreated.set(searchNum, created.id);
                    freshClients.push(created); // evita recriar em iterações seguintes
                }
            }
        }
        // Propaga matchedClientId para todos os records com o mesmo projeto (não só os do toImport)
        for (const [searchNum, clientId] of sessionCreated) {
            this.pendingPdfRecords.forEach(r => {
                if (r.pendingCreate && r.pendingCreate.projectNum.replace(/\D/g, '') === searchNum) {
                    r.matchedClientId = clientId;
                }
            });
        }

        let importedCount = 0;
        let skippedCount = 0;
        const setProgress = (n) => {
            confirmBtn.innerHTML = `<span style="display:inline-flex;align-items:center;gap:8px;"><div class="spinner" style="width:14px;height:14px;border-width:2px;flex-shrink:0;"></div>Importando ${n} de ${total}...</span>`;
        };
        setProgress(0);

        for (const [idx, r] of this.pendingPdfRecords.entries()) {
            if (r._isDuplicate) {
                skippedCount++;
                continue;
            }
            const isChecked = document.getElementById(`pdf-check-${idx}`).checked;
            if (isChecked && r.matchedClientId) {
                const desc = document.getElementById(`pdf-desc-${idx}`).value;
                await store.addRecord(r.matchedClientId, r.date, r.startTime, r.endTime, r.minutes, desc);
                importedCount++;
                setProgress(importedCount);
            }
        }

        const skipMsg = skippedCount > 0 ? ` ${skippedCount} já existiam e foram ignorados.` : '';
        Toast.show(`${importedCount} atendimento(s) importado(s) com sucesso!${skipMsg}`, 'success', skippedCount > 0 ? 6000 : 3000);
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

    _autoResizeTextarea(el) {
        el.style.height = 'auto';
        const maxH = parseInt(el.style.maxHeight) || 340;
        el.style.height = Math.min(maxH, Math.max(120, el.scrollHeight)) + 'px';
    }

    _updateDescLinks(text) {
        const linksDiv = document.getElementById('agenda-desc-links');
        const linksList = document.getElementById('agenda-desc-links-list');
        if (!linksDiv || !linksList) return;
        const urls = [...new Set((text || '').match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/g) || [])];
        if (urls.length === 0) { linksDiv.style.display = 'none'; return; }
        linksDiv.style.display = 'block';
        linksList.innerHTML = urls.map(url => {
            const display = url.length > 70 ? url.substring(0, 67) + '…' : url;
            return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="agenda-desc-link">${escapeHtml(display)}</a>`;
        }).join('');
        lucide.createIcons();
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
            const [items, clients] = await Promise.all([
                store.getApontamentos(this.aptCurrentDate),
                store.getClients()
            ]);
            const projToClient = {};
            clients.forEach(c => { if (c.projectNum) projToClient[c.projectNum.trim()] = c.name; });
            container.innerHTML = '';

            if (items.length === 0) {
                container.innerHTML = `
                    <div class="glass empty-state" style="text-align:center;padding:40px;display:flex;flex-direction:column;align-items:center;gap:16px;">
                        <i data-lucide="clipboard-list" style="width:32px;height:32px;opacity:.4"></i>
                        <p class="text-muted">Nenhum apontamento para este dia.</p>
                        <button class="btn btn-primary" onclick="app.openNewApontamento()">
                            + Novo Apontamento
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
                    <span class="apt-proj" title="${escapeHtml(projToClient[item.projectNum?.trim()] || '')}">${escapeHtml(item.projectNum)}${projToClient[item.projectNum?.trim()] ? `<span class="apt-proj-name">${escapeHtml(projToClient[item.projectNum.trim()])}</span>` : ''}</span>
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
                        <button class="btn-icon-sm btn-danger-sm" title="Excluir" onclick="app.deleteApontamento('${item.id}', this)">
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
        setTimeout(() => this.onAptDescInput(), 50);
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
        setTimeout(() => this.onAptDescInput(), 50);
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

    async deleteApontamento(id, btn) {
        const row = btn?.closest('.apt-row');
        if (row) { row.classList.add('row-deleting'); await new Promise(r => setTimeout(r, 400)); }
        try {
            await store.deleteApontamento(id);
            await this.renderApontamentos();
            Toast.show('Apontamento excluído.', 'success');
        } catch (err) {
            if (row) row.classList.remove('row-deleting');
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
                const extraClass = s === 'active' ? ' badge-ativo' : '';
                return `<span class="${extraClass.trim()}" style="font-size:.7rem;padding:2px 8px;border-radius:20px;background:${color}22;color:${color};font-weight:600;">${label}</span>`;
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
        setTimeout(() => this.onImplDescInput(), 50);
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

    handleDeleteImplementation() {
        const id = document.getElementById('impl-id').value;
        if (!id) return;
        const btn = document.getElementById('btn-delete-implementation');
        this._twostepDelete(btn, async () => {
            try {
                await store.deleteImplementation(id);
                this.closeModal('modal-implementation');
                await this.renderImplementations();
                Toast.show('Implementação excluída.', 'success');
            } catch (err) {
                Toast.show('Erro ao excluir: ' + err.message, 'error');
            }
        });
    }

    clearImplFilters() {
        const els = ['impl-filter-type', 'impl-filter-status', 'impl-filter-client'];
        els.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        this.renderImplementations();
    }

    // ===================================
    // TREINAMENTOS
    // ===================================

    async renderTrainings() {
        if (this.currentView !== 'trainings') return;
        const container = document.getElementById('trainings-container');
        if (!container) return;
        container.innerHTML = spinnerHtml;

        try {
            const [trainings, clients] = await Promise.all([
                store.getTrainingsWithClients(),
                store.getClients()
            ]);

            const filterCategory = document.getElementById('training-filter-category')?.value || '';
            const filterStatus   = document.getElementById('training-filter-status')?.value || '';
            const filterClient   = document.getElementById('training-filter-client')?.value || '';

            const clientSelect = document.getElementById('training-filter-client');
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

            let filtered = trainings;
            if (filterCategory) filtered = filtered.filter(t => t.category === filterCategory);
            if (filterStatus)   filtered = filtered.filter(t => t.status === filterStatus);
            if (filterClient)   filtered = filtered.filter(t => t.clientIds.includes(filterClient));

            if (filtered.length === 0) {
                container.innerHTML = `<div class="glass" style="padding:40px; text-align:center; color:var(--text-muted);">
                    <i data-lucide="graduation-cap" style="width:48px;height:48px;opacity:.3;margin-bottom:12px;"></i>
                    <p>Nenhum treinamento encontrado.</p></div>`;
                lucide.createIcons();
                return;
            }

            const categoryLabels = { geral: 'Geral', sap: 'SAP', sistema: 'Sistema', processo: 'Processo', ferramenta: 'Ferramenta' };
            const categoryIcons  = { geral: 'graduation-cap', sap: 'layers', sistema: 'monitor', processo: 'workflow', ferramenta: 'wrench' };

            const groups = {};
            filtered.forEach(t => {
                if (!groups[t.category]) groups[t.category] = [];
                groups[t.category].push(t);
            });

            const statusBadge = (s) => {
                const map = { active: ['Ativo', 'var(--success-color)'], archived: ['Arquivado', 'var(--text-muted)'] };
                const [label, color] = map[s] || ['—', 'var(--text-muted)'];
                const extraClass = s === 'active' ? ' badge-ativo' : '';
                return `<span class="${extraClass.trim()}" style="font-size:.7rem;padding:2px 8px;border-radius:20px;background:${color}22;color:${color};font-weight:600;">${label}</span>`;
            };

            let html = '';
            for (const [cat, items] of Object.entries(groups)) {
                const icon = categoryIcons[cat] || 'graduation-cap';
                html += `<div style="margin-bottom:28px;">
                    <h3 style="display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:1rem;color:var(--primary);">
                        <i data-lucide="${icon}" style="width:18px;height:18px;"></i>${categoryLabels[cat] || cat}
                        <span style="font-size:.75rem;color:var(--text-muted);font-weight:400;">(${items.length})</span>
                    </h3>
                    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;">`;

                items.forEach(t => {
                    const linkedClients = t.clientIds.map(id => clientsMap[id]?.name).filter(Boolean);
                    const maxChips = 3;
                    const chipsHtml = linkedClients.slice(0, maxChips).map(n =>
                        `<span style="font-size:.7rem;padding:2px 8px;border-radius:12px;background:var(--bg-glass);border:1px solid var(--border-color);">${escapeHtml(n)}</span>`
                    ).join('');
                    const extraChip = linkedClients.length > maxChips
                        ? `<span style="font-size:.7rem;padding:2px 8px;border-radius:12px;background:var(--bg-glass);color:var(--text-muted);">+${linkedClients.length - maxChips}</span>` : '';

                    const links  = (t.attachments || []).filter(a => a.type === 'link');
                    const images = (t.attachments || []).filter(a => a.type === 'image');
                    const metaParts = [];
                    if (links.length)  metaParts.push(`<i data-lucide="link" style="width:12px;height:12px;vertical-align:middle;"></i> ${links.length} link${links.length > 1 ? 's' : ''}`);
                    if (images.length) metaParts.push(`<i data-lucide="image" style="width:12px;height:12px;vertical-align:middle;"></i> ${images.length}`);
                    const metaHtml = metaParts.length ? `<div style="font-size:.75rem;color:var(--text-muted);margin-bottom:8px;">${metaParts.join(' · ')}</div>` : '';

                    html += `<div class="glass training-card" data-id="${t.id}" style="padding:16px;cursor:pointer;transition:border-color .2s;" onclick="app.openEditTraining('${t.id}')">
                        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px;">
                            <span style="font-weight:600;flex:1;">${escapeHtml(t.title)}</span>
                            ${statusBadge(t.status)}
                        </div>
                        ${t.description ? `<p style="font-size:.8rem;color:var(--text-secondary);margin-bottom:8px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${escapeHtml(t.description)}</p>` : ''}
                        ${metaHtml}
                        <div style="display:flex;flex-wrap:wrap;gap:4px;">${chipsHtml}${extraChip}</div>
                    </div>`;
                });

                html += `</div></div>`;
            }

            container.innerHTML = html;
            lucide.createIcons();
        } catch (err) {
            container.innerHTML = `<p class="text-muted">Erro ao carregar treinamentos: ${escapeHtml(err.message)}</p>`;
        }
    }

    async _populateTrainingClientCheckboxes(selectedIds = []) {
        const wrap = document.getElementById('training-clients-checkboxes');
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

    _detectUrlType(url) {
        if (/youtube\.com|youtu\.be/i.test(url)) return 'video';
        if (/drive\.google\.com/i.test(url))     return 'drive';
        if (/\.pdf(\?|$)/i.test(url))            return 'pdf';
        return 'generic';
    }

    addTrainingLink() {
        const labelEl = document.getElementById('training-link-label');
        const urlEl   = document.getElementById('training-link-url');
        const label = labelEl?.value.trim();
        const url   = urlEl?.value.trim();
        if (!url) { Toast.show('Informe a URL do link.', 'error'); return; }
        const urlType = this._detectUrlType(url);
        this.trainingLinks.push({ label: label || url, url, urlType });
        if (labelEl) labelEl.value = '';
        if (urlEl)   urlEl.value   = '';
        this._renderTrainingLinks();
    }

    removeTrainingLink(index) {
        this.trainingLinks.splice(index, 1);
        this._renderTrainingLinks();
    }

    _renderTrainingLinks() {
        const container = document.getElementById('training-links-list');
        if (!container) return;
        if (this.trainingLinks.length === 0) { container.innerHTML = ''; return; }
        const iconMap = { video: 'play-circle', drive: 'hard-drive', pdf: 'file-text', generic: 'link' };
        container.innerHTML = this.trainingLinks.map((l, i) => `
            <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-glass);border-radius:6px;border:1px solid var(--border-color);">
                <i data-lucide="${iconMap[l.urlType] || 'link'}" style="width:14px;height:14px;flex-shrink:0;color:var(--primary);"></i>
                <span style="flex:1;font-size:.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(l.url)}">${escapeHtml(l.label)}</span>
                <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer" style="color:var(--text-muted);flex-shrink:0;" title="Abrir link" onclick="event.stopPropagation()">
                    <i data-lucide="external-link" style="width:13px;height:13px;"></i>
                </a>
                <button type="button" onclick="app.removeTrainingLink(${i})" style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:0;flex-shrink:0;" title="Remover">
                    <i data-lucide="x" style="width:14px;height:14px;"></i>
                </button>
            </div>`).join('');
        lucide.createIcons();
    }

    _renderTrainingAttachmentPreviews() {
        const container = document.getElementById('training-attach-previews');
        const hint = document.getElementById('training-attach-hint');
        if (!container) return;
        if (hint) hint.style.display = this.trainingAttachments.length ? 'none' : '';
        container.innerHTML = this.trainingAttachments.map((att, i) => `
            <div class="attach-thumb">
                <img src="${att.data}" alt="${escapeHtml(att.name)}" onclick="app._openTrainingAttachmentLightbox(${i})" title="${escapeHtml(att.name)}">
                <button type="button" class="attach-remove" onclick="app.removeTrainingAttachment(${i})" title="Remover">×</button>
            </div>
        `).join('');
    }

    _openTrainingAttachmentLightbox(index) {
        const att = this.trainingAttachments[index];
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

    removeTrainingAttachment(index) {
        this.trainingAttachments.splice(index, 1);
        this._renderTrainingAttachmentPreviews();
    }

    async openNewTraining() {
        document.getElementById('modal-training-title').textContent = 'Novo Treinamento';
        document.getElementById('training-id').value = '';
        document.getElementById('training-title').value = '';
        document.getElementById('training-category').value = 'geral';
        document.getElementById('training-status').value = 'active';
        document.getElementById('training-description').value = '';
        document.getElementById('btn-delete-training').style.display = 'none';
        this.trainingAttachments = [];
        this.trainingLinks = [];
        this._renderTrainingAttachmentPreviews();
        this._renderTrainingLinks();
        await this._populateTrainingClientCheckboxes([]);
        this.openModal('modal-training');
    }

    async openEditTraining(id) {
        const trainings = await store.getTrainingsWithClients();
        const t = trainings.find(x => x.id === id);
        if (!t) return;

        document.getElementById('modal-training-title').textContent = 'Editar Treinamento';
        document.getElementById('training-id').value = t.id;
        document.getElementById('training-title').value = t.title;
        document.getElementById('training-category').value = t.category;
        document.getElementById('training-status').value = t.status;
        document.getElementById('training-description').value = t.description;
        document.getElementById('btn-delete-training').style.display = 'flex';

        const allAttachments = t.attachments || [];
        this.trainingAttachments = allAttachments.filter(a => a.type === 'image');
        this.trainingLinks = allAttachments.filter(a => a.type === 'link');
        this._renderTrainingAttachmentPreviews();
        this._renderTrainingLinks();
        await this._populateTrainingClientCheckboxes(t.clientIds);
        this.openModal('modal-training');
    }

    async handleTrainingSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('training-id').value;

        const selectedClientIds = Array.from(
            document.querySelectorAll('#training-clients-checkboxes input[type="checkbox"]:checked')
        ).map(cb => cb.value);

        if (selectedClientIds.length === 0) {
            Toast.show('Selecione pelo menos um cliente.', 'error');
            return;
        }

        const attachments = [
            ...this.trainingLinks.map(l => ({ type: 'link', label: l.label, url: l.url, urlType: l.urlType })),
            ...this.trainingAttachments.map(a => ({ type: 'image', name: a.name, data: a.data })),
        ];

        const payload = {
            title:       document.getElementById('training-title').value.trim(),
            category:    document.getElementById('training-category').value,
            status:      document.getElementById('training-status').value,
            description: document.getElementById('training-description').value.trim(),
            attachments,
        };

        const btn = e.target.querySelector('[type="submit"]');
        btn.disabled = true;
        try {
            let savedId;
            if (id) {
                await store.updateTraining(id, payload);
                savedId = id;
            } else {
                const created = await store.addTraining(payload);
                savedId = created.id;
            }
            await store.setTrainingClients(savedId, selectedClientIds);
            this.closeModal('modal-training');
            await this.renderTrainings();
            Toast.show(id ? 'Treinamento atualizado.' : 'Treinamento criado.', 'success');
        } catch (err) {
            Toast.show('Erro ao salvar: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    handleDeleteTraining() {
        const id = document.getElementById('training-id').value;
        if (!id) return;
        const btn = document.getElementById('btn-delete-training');
        this._twostepDelete(btn, async () => {
            try {
                await store.deleteTraining(id);
                this.closeModal('modal-training');
                await this.renderTrainings();
                Toast.show('Treinamento excluído.', 'success');
            } catch (err) {
                Toast.show('Erro ao excluir: ' + err.message, 'error');
            }
        });
    }

    clearTrainingFilters() {
        const els = ['training-filter-category', 'training-filter-status', 'training-filter-client'];
        els.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        this.renderTrainings();
    }

    // ===================================
    // AGENDAMENTO AUTOMÁTICO (Fase 25)
    // ===================================

    switchClientModalTab(tab) {
        const dados = document.getElementById('tab-client-dados');
        const sched = document.getElementById('tab-client-scheduling');
        const rep   = document.getElementById('tab-client-report');
        const btnDados = document.getElementById('tab-btn-dados');
        const btnSched = document.getElementById('tab-btn-scheduling');
        const btnRep   = document.getElementById('tab-btn-report');
        if (!dados || !sched) return;

        dados.style.display = 'none';
        sched.style.display = 'none';
        if (rep) rep.style.display = 'none';
        [btnDados, btnSched, btnRep].forEach(b => b && b.classList.remove('active'));

        if (tab === 'scheduling') {
            sched.style.display = 'block';
            btnSched.classList.add('active');
            const clientId = document.getElementById('client-id').value;
            if (clientId) this._renderClientSchedulingTab(clientId);
            else {
                document.getElementById('client-scheduling-rules-list').innerHTML =
                    '<p class="text-muted" style="text-align:center;padding:20px 0;">Salve o cliente primeiro para gerenciar regras de agendamento.</p>';
            }
        } else if (tab === 'report') {
            if (rep) rep.style.display = 'block';
            if (btnRep) btnRep.classList.add('active');
            const clientId = document.getElementById('client-id').value;
            if (clientId) {
                // Pré-preenche período com o mês corrente
                const today = new Date();
                const first = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
                const last  = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];
                const startEl = document.getElementById('report-date-start-inline');
                const endEl   = document.getElementById('report-date-end-inline');
                if (startEl && !startEl.value) startEl.value = first;
                if (endEl   && !endEl.value)   endEl.value   = last;
                this._reportInlineClientId = clientId;
            }
        } else {
            dados.style.display = '';
            btnDados.classList.add('active');
        }
        lucide.createIcons();
    }

    async _renderClientSchedulingTab(clientId) {
        const container = document.getElementById('client-scheduling-rules-list');
        container.innerHTML = `<div style="padding:16px 0;">${spinnerHtml}</div>`;
        try {
            const rules = await store.getSchedulingRules(clientId);
            if (rules.length === 0) {
                container.innerHTML = '<p class="text-muted" style="text-align:center;padding:20px 0;">Nenhuma regra cadastrada. Clique em "Nova Regra" para começar.</p>';
                return;
            }
            const freqLabel = { weekly: 'Semanal', biweekly: 'Quinzenal', monthly_date: 'Mensal (data)', monthly_weekday: 'Mensal (semana)' };
            const dayNames = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
            container.innerHTML = rules.map(r => {
                const days = (r.daysOfWeek || []).map(d => dayNames[d]).join(', ') || '—';
                const period = `${r.periodStart} → ${r.periodEnd}`;
                const genLabel = r.lastGeneratedUntil ? `Gerado até ${r.lastGeneratedUntil}` : 'Não gerado ainda';
                const timeLabel = r.startTime === '' ? 'Dia inteiro' : `${r.startTime}–${r.endTime}`;
                const typeLabels = { meeting: 'Reunião', consulting: 'Consultoria', task: 'Tarefa', reminder: 'Lembrete' };
                const metaLine = [typeLabels[r.eventType] || r.eventType, days, timeLabel].filter(Boolean).join(' · ');
                return `<div class="scheduling-rule-card">
                    <div class="sr-card-info">
                        <strong>${escapeHtml(r.title)}</strong>
                        ${r.description ? `<span class="text-muted" style="font-size:0.8rem;">${escapeHtml(r.description)}</span>` : ''}
                        <span class="text-muted" style="font-size:0.8rem;">${metaLine}</span>
                        <span class="text-muted" style="font-size:0.8rem;">${freqLabel[r.frequency] || r.frequency} · ${period}</span>
                        <span style="font-size:0.75rem; color: var(--primary-color);">${genLabel}</span>
                    </div>
                    <div class="sr-card-actions">
                        <button class="btn btn-secondary" onclick='app._openEditSchedulingRule(${JSON.stringify(r)})' style="padding:5px 10px;font-size:0.8rem;">
                            <i data-lucide="edit-2" style="width:14px;height:14px;"></i>
                        </button>
                        <button class="btn btn-primary" onclick='app.generateSchedulingRule("${r.id}")' style="padding:5px 10px;font-size:0.8rem;" title="Gerar eventos na agenda">
                            <i data-lucide="zap" style="width:14px;height:14px;"></i>
                        </button>
                    </div>
                </div>`;
            }).join('');
        } catch (err) {
            container.innerHTML = `<p class="text-muted" style="color:var(--danger-color);padding:12px 0;">Erro ao carregar regras: ${escapeHtml(err.message)}</p>`;
        }
        lucide.createIcons();
    }

    openNewSchedulingRule() {
        const clientId = document.getElementById('client-id').value;
        if (!clientId) { Toast.show('Salve o cliente antes de criar regras.', 'error'); return; }
        document.getElementById('modal-rule-title').textContent = 'Nova Regra de Agendamento';
        document.getElementById('rule-id').value = '';
        document.getElementById('rule-client-id').value = clientId;
        document.getElementById('rule-title').value = '';
        document.getElementById('rule-event-type').value = 'meeting';
        document.getElementById('rule-description').value = '';
        document.getElementById('btn-delete-scheduling-rule').style.display = 'none';
        document.querySelectorAll('input[name="rule-dow"]').forEach(cb => cb.checked = false);
        document.getElementById('rule-period-start').valueAsDate = new Date();
        document.getElementById('rule-period-end').value = '';
        document.getElementById('rule-location').value = '';
        document.getElementById('rule-attendees').value = '';
        document.getElementById('rule-generate-meet').checked = false;
        this.toggleAllDayRule(false);
        this.openModal('modal-scheduling-rule');
    }

    toggleAllDayRule(isAllDay) {
        const timeFields = document.getElementById('rule-time-fields');
        const startInput = document.getElementById('rule-start-time');
        const endInput = document.getElementById('rule-end-time');
        document.getElementById('rule-all-day').checked = isAllDay;
        timeFields.style.display = isAllDay ? 'none' : 'flex';
        startInput.required = !isAllDay;
        endInput.required = !isAllDay;
        if (isAllDay) {
            startInput.value = '';
            endInput.value = '';
        }
    }

    _openEditSchedulingRule(rule) {
        document.getElementById('modal-rule-title').textContent = 'Editar Regra de Agendamento';
        document.getElementById('rule-id').value = rule.id;
        document.getElementById('rule-client-id').value = rule.clientId;
        document.getElementById('rule-title').value = rule.title;
        document.getElementById('rule-event-type').value = rule.eventType;
        document.getElementById('rule-description').value = rule.description || '';
        document.getElementById('rule-frequency').value = rule.frequency;
        document.getElementById('rule-period-start').value = rule.periodStart;
        document.getElementById('rule-period-end').value = rule.periodEnd;
        document.getElementById('rule-location').value = rule.location;
        document.getElementById('rule-attendees').value = rule.attendees;
        document.getElementById('rule-generate-meet').checked = rule.generateMeet;
        document.querySelectorAll('input[name="rule-dow"]').forEach(cb => {
            cb.checked = rule.daysOfWeek.includes(parseInt(cb.value));
        });
        const isAllDay = rule.startTime === '';
        this.toggleAllDayRule(isAllDay);
        if (!isAllDay) {
            document.getElementById('rule-start-time').value = rule.startTime;
            document.getElementById('rule-end-time').value = rule.endTime;
        }
        document.getElementById('btn-delete-scheduling-rule').style.display = 'flex';
        this.openModal('modal-scheduling-rule');
    }

    async handleSchedulingRuleSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('rule-id').value;
        const clientId = document.getElementById('rule-client-id').value;
        const daysOfWeek = Array.from(document.querySelectorAll('input[name="rule-dow"]:checked'))
            .map(cb => parseInt(cb.value));
        if (daysOfWeek.length === 0) {
            Toast.show('Selecione pelo menos um dia da semana.', 'error');
            return;
        }
        const isAllDay = document.getElementById('rule-all-day').checked;
        const ruleData = {
            clientId,
            title: document.getElementById('rule-title').value,
            eventType: document.getElementById('rule-event-type').value,
            description: document.getElementById('rule-description').value.trim(),
            daysOfWeek,
            startTime: isAllDay ? '' : document.getElementById('rule-start-time').value,
            endTime: isAllDay ? '' : document.getElementById('rule-end-time').value,
            frequency: document.getElementById('rule-frequency').value,
            periodStart: document.getElementById('rule-period-start').value,
            periodEnd: document.getElementById('rule-period-end').value,
            location: document.getElementById('rule-location').value,
            attendees: document.getElementById('rule-attendees').value,
            generateMeet: document.getElementById('rule-generate-meet').checked,
        };
        if (ruleData.periodEnd < ruleData.periodStart) {
            Toast.show('A data fim deve ser após a data início.', 'error');
            return;
        }
        const btn = e.target.querySelector('[type="submit"]');
        btn.disabled = true;
        try {
            if (id) await store.updateSchedulingRule(id, ruleData);
            else await store.addSchedulingRule(ruleData);
            this.closeModal('modal-scheduling-rule');
            await this._renderClientSchedulingTab(clientId);
            Toast.show(id ? 'Regra atualizada.' : 'Regra criada.', 'success');
        } catch (err) {
            Toast.show('Erro ao salvar regra: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    handleDeleteSchedulingRule() {
        const id = document.getElementById('rule-id').value;
        const clientId = document.getElementById('rule-client-id').value;
        if (!id) return;
        const btn = document.getElementById('btn-delete-scheduling-rule');
        this._twostepDelete(btn, async () => {
            try {
                await store.deleteSchedulingRule(id);
                this.closeModal('modal-scheduling-rule');
                await this._renderClientSchedulingTab(clientId);
                Toast.show('Regra excluída.', 'success');
            } catch (err) {
                Toast.show('Erro ao excluir: ' + err.message, 'error');
            }
        });
    }

    // Calcula todas as ocorrências de uma regra no período
    _calcOccurrences(rule) {
        const occurrences = [];
        const start = new Date(rule.periodStart + 'T00:00:00');
        const end   = new Date(rule.periodEnd   + 'T00:00:00');
        const fromDate = rule.lastGeneratedUntil
            ? new Date(new Date(rule.lastGeneratedUntil + 'T00:00:00').getTime() + 86400000) // dia seguinte
            : start;

        if (fromDate > end) return occurrences; // já gerado tudo

        const dows = new Set(rule.daysOfWeek);
        const cur = new Date(fromDate);

        // Para monthly_weekday: descobrir qual semana do mês cada dia pertence
        const getWeekOfMonth = (d) => Math.ceil(d.getDate() / 7);

        // Para monthly_date: os dias do mês (ex: [1, 15])
        // Para biweekly: controlar paridade de semana a partir do início
        const getWeekNum = (d) => {
            const oneJan = new Date(d.getFullYear(), 0, 1);
            return Math.ceil(((d - oneJan) / 86400000 + oneJan.getDay() + 1) / 7);
        };
        const startWeekNum = getWeekNum(start);

        while (cur <= end) {
            const dow = cur.getDay(); // 0=Dom…6=Sáb
            const iso = cur.toISOString().split('T')[0];

            if (dows.has(dow)) {
                let include = false;
                if (rule.frequency === 'weekly') {
                    include = true;
                } else if (rule.frequency === 'biweekly') {
                    const diff = getWeekNum(cur) - startWeekNum;
                    include = diff % 2 === 0;
                } else if (rule.frequency === 'monthly_date') {
                    // Ocorre somente na primeira semana do mês (compatível com days_of_week)
                    include = getWeekOfMonth(cur) === 1;
                } else if (rule.frequency === 'monthly_weekday') {
                    // Ocorre somente na segunda semana do mês
                    include = getWeekOfMonth(cur) === 2;
                }
                if (include) occurrences.push(iso);
            }
            cur.setDate(cur.getDate() + 1);
        }
        return occurrences;
    }

    async generateSchedulingRule(ruleId) {
        const clientId = document.getElementById('client-id').value;
        let rule, client, clients;
        try {
            const [rules, fetchedClients] = await Promise.all([
                store.getSchedulingRules(clientId),
                store.getClients(),
            ]);
            clients = fetchedClients;
            rule = rules.find(r => r.id === ruleId);
            client = clients.find(c => c.id === clientId);
        } catch (err) {
            Toast.show('Erro ao carregar regra: ' + err.message, 'error');
            return;
        }
        if (!rule) { Toast.show('Regra não encontrada.', 'error'); return; }

        const occurrences = this._calcOccurrences(rule);
        if (occurrences.length === 0) {
            Toast.show('Nenhuma ocorrência nova para gerar neste período.', 'info');
            return;
        }

        let existingEvents = [];
        try { existingEvents = await store.getAgendaEvents(); } catch (_) {}
        const conflictSet = new Set(
            existingEvents
                .filter(ev => {
                    if (ev.date < rule.periodStart || ev.date > rule.periodEnd) return false;
                    if (rule.startTime === '') return true;
                    if (ev.startTime === '') return true;
                    return ev.startTime < rule.endTime && ev.endTime > rule.startTime;
                })
                .map(ev => ev.date)
        );

        this._pendingPreviewRule = rule;
        this._pendingPreviewClient = client || null;
        this._pendingPreviewConflictSet = conflictSet;
        this._pendingPreviewExistingDates = new Set(
            existingEvents
                .filter(ev => ev.date >= rule.periodStart && ev.date <= rule.periodEnd)
                .map(ev => ev.date)
        );
        const clientNameMap = new Map(clients.map(c => [c.id, c.name]));
        const existingByDate = new Map();
        existingEvents.forEach(ev => {
            if (!existingByDate.has(ev.date)) existingByDate.set(ev.date, []);
            existingByDate.get(ev.date).push({
                title: ev.title,
                startTime: ev.startTime,
                endTime: ev.endTime,
                clientName: clientNameMap.get(ev.clientId) || '',
            });
        });
        this._pendingPreviewExistingByDate = existingByDate;
        this._pendingPreviewRuleId = ruleId;
        const [py, pm] = rule.periodStart.split('-').map(Number);
        this._miniCalYear     = py;
        this._miniCalMonth    = pm - 1;
        this._miniCalSelected = null;
        this._pendingPreviewEvents = occurrences.map(date => ({
            date,
            startTime: rule.startTime,
            endTime: rule.endTime,
            title: rule.title,
            type: rule.eventType,
            description: rule.description || '',
            clientId: rule.clientId,
            location: rule.location,
            attendees: rule.attendees,
            generateMeet: rule.generateMeet,
            hasConflict: conflictSet.has(date),
        }));

        this._renderPreviewContent();
        this.openModal('modal-schedule-preview');
    }

    _renderPreviewContent() {
        const rule   = this._pendingPreviewRule;
        const client = this._pendingPreviewClient;
        const events = this._pendingPreviewEvents;

        const total     = events.length;
        const conflicts = events.filter(e => e.hasConflict).length;
        document.getElementById('preview-subtitle').textContent =
            `${total} evento(s) a criar${conflicts > 0 ? ` · ⚠ ${conflicts} com conflito (serão criados mesmo assim)` : ''}`;
        document.getElementById('btn-confirm-label').textContent = `Confirmar (${total})`;

        const dayNames = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
        const fmtDate  = (iso) => {
            const [y,m,d] = iso.split('-');
            const dt = new Date(parseInt(y), parseInt(m)-1, parseInt(d));
            return `${dayNames[dt.getDay()]}, ${d}/${m}/${y}`;
        };
        const fmtH = (min) => {
            const h = Math.floor(min / 60), m = min % 60;
            return m > 0 ? `${h}h${String(m).padStart(2,'0')}` : `${h}h`;
        };

        // ── Painel de horas ──────────────────────────────────────────
        const isAllDay        = rule.startTime === '';
        const sessionMinutes  = isAllDay ? 0 : this.calcDuration(rule.startTime, rule.endTime).minutes;
        const targetMonthlyMin = (client?.hoursTotal || 0) * 60;
        let hoursPanel = '';

        if (isAllDay) {
            hoursPanel = `<div class="preview-hours-panel preview-hours-allday">
                <i data-lucide="info" style="width:13px;height:13px;flex-shrink:0;"></i>
                Eventos dia inteiro — cálculo de horas não aplicável
            </div>`;
        } else if (targetMonthlyMin <= 0) {
            hoursPanel = `<div class="preview-hours-panel preview-hours-allday">
                <i data-lucide="info" style="width:13px;height:13px;flex-shrink:0;"></i>
                Cliente sem cota mensal configurada — configure "Horas contratadas" no cadastro do cliente
            </div>`;
        } else {
            const byMonth = {};
            for (const ev of events) {
                const ym = ev.date.slice(0, 7);
                byMonth[ym] = (byMonth[ym] || 0) + 1;
            }
            const months = Object.keys(byMonth).sort();
            const mNames = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
            const [sy, sm_] = rule.periodStart.split('-').map(Number);
            const [ey, em_] = rule.periodEnd.split('-').map(Number);
            const monthsInPeriod = Math.max(1, (ey - sy) * 12 + (em_ - sm_) + 1);
            const totalTargetMin   = targetMonthlyMin * monthsInPeriod;
            const totalScheduledMin = events.length * sessionMinutes;
            const totalDelta       = totalScheduledMin - totalTargetMin;

            const badgeClass = (d) => d === 0 ? 'preview-badge-ok' : d < 0 ? 'preview-badge-under' : 'preview-badge-over';
            const deltaLabel = (d) => {
                if (Math.abs(d) < 1) return '✓ meta atingida';
                return (d > 0 ? '+' : '−') + fmtH(Math.abs(d)) + (d < 0 ? ' faltando' : ' a mais');
            };

            let tableHtml = '';
            if (months.length > 1) {
                const rows = months.map(ym => {
                    const [y, m] = ym.split('-').map(Number);
                    const cnt = byMonth[ym];
                    const sched = cnt * sessionMinutes;
                    const delta = sched - targetMonthlyMin;
                    return `<tr>
                        <td>${mNames[m-1]}/${y}</td>
                        <td style="text-align:center;">${cnt}</td>
                        <td style="text-align:center;">${fmtH(sched)}</td>
                        <td style="text-align:center;">${fmtH(targetMonthlyMin)}</td>
                        <td><span class="preview-badge ${badgeClass(delta)}">${deltaLabel(delta)}</span></td>
                    </tr>`;
                }).join('');
                tableHtml = `<table class="preview-hours-table">
                    <thead><tr><th>Mês</th><th>Sessões</th><th>Agendado</th><th>Meta</th><th>Status</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>`;
            }

            hoursPanel = `<div class="preview-hours-panel">
                <div class="preview-hours-header">
                    <i data-lucide="bar-chart-2" style="width:13px;height:13px;flex-shrink:0;"></i>
                    <strong style="font-size:0.85rem;">Resumo de Horas</strong>
                    <span style="margin-left:auto; display:flex; align-items:center; gap:6px; font-size:0.82rem;">
                        <span style="color:var(--text-muted);">${fmtH(totalScheduledMin)} / ${fmtH(totalTargetMin)}</span>
                        <span class="preview-badge ${badgeClass(totalDelta)}">${deltaLabel(totalDelta)}</span>
                    </span>
                </div>
                ${tableHtml}
            </div>`;
        }

        // ── Lista de eventos ─────────────────────────────────────────
        const eventsList = `<div style="margin: 4px 0; display:flex; flex-direction:column; gap:4px;">
            ${events.map((ev, idx) => `
                <div class="preview-event-row ${ev.hasConflict ? 'preview-event-conflict' : ''} ${ev.isExtra ? 'preview-event-extra' : ''}" data-preview-idx="${idx}">
                    <i data-lucide="${ev.hasConflict ? 'alert-triangle' : ev.isExtra ? 'plus-circle' : 'check'}" style="width:13px;height:13px;flex-shrink:0;"></i>
                    <span class="preview-date-text" style="flex:1;">${fmtDate(ev.date)}</span>
                    <span class="text-muted" style="font-size:0.78rem;">${ev.startTime === '' ? 'Dia inteiro' : `${ev.startTime}–${ev.endTime}`}</span>
                    ${ev.hasConflict ? '<span style="font-size:0.72rem;color:var(--warning-color);">conflito</span>' : ''}
                    ${ev.isExtra ? '<span style="font-size:0.7rem;color:var(--primary);opacity:0.85;">extra</span>' : ''}
                    <button type="button" class="preview-edit-date-btn" onclick="app._previewStartEditDate(${idx})" title="Alterar data">
                        <i data-lucide="pencil" style="width:11px;height:11px;"></i>
                    </button>
                    <button type="button" class="preview-remove-btn" onclick="app._previewRemoveEvent(${idx})" title="Remover este evento">
                        <i data-lucide="x" style="width:11px;height:11px;"></i>
                    </button>
                </div>
            `).join('')}
        </div>`;

        // ── Ações: sugestão automática + adição manual ───────────────
        let suggestBtn = '';
        if (!isAllDay && sessionMinutes > 0 && targetMonthlyMin > 0) {
            const [sy2, sm2] = rule.periodStart.split('-').map(Number);
            const [ey2, em2] = rule.periodEnd.split('-').map(Number);
            const mip = Math.max(1, (ey2 - sy2) * 12 + (em2 - sm2) + 1);
            const deficit = targetMonthlyMin * mip - events.length * sessionMinutes;
            if (deficit > 0) {
                const needed = Math.ceil(deficit / sessionMinutes);
                suggestBtn = `<button type="button" class="btn btn-secondary preview-suggest-btn" onclick="app._previewSuggestExtras()">
                    <i data-lucide="wand-2" style="width:14px;height:14px;"></i>
                    Sugerir ${needed} sessão(ões) extra(s) para atingir a meta
                </button>`;
            }
        }

        const manualTimeFields = (!isAllDay) ? `
            <input type="time" id="preview-manual-start" class="form-control" value="${rule.startTime}" style="width:88px;font-size:0.82rem;padding:5px 7px;">
            <span style="color:var(--text-muted);font-size:0.82rem;">–</span>
            <input type="time" id="preview-manual-end" class="form-control" value="${rule.endTime}" style="width:88px;font-size:0.82rem;padding:5px 7px;">` : '';

        const actionsHtml = `<div class="preview-actions">
            ${suggestBtn}
            <div class="preview-manual-add">
                <span class="preview-manual-label">+ Adicionar data específica</span>
                <input type="hidden" id="preview-manual-date">
                <div id="preview-mini-cal-container"></div>
                <div style="display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap;">
                    ${manualTimeFields}
                    <button type="button" class="btn btn-primary" style="padding:5px 14px;font-size:0.82rem;margin-left:auto;" onclick="app._previewAddManual()">Adicionar</button>
                </div>
            </div>
        </div>`;

        document.getElementById('preview-content').innerHTML = hoursPanel + eventsList + actionsHtml;
        lucide.createIcons();
        this._renderMiniCal();
    }

    _renderMiniCal() {
        const container = document.getElementById('preview-mini-cal-container');
        if (!container) return;

        const year  = this._miniCalYear;
        const month = this._miniCalMonth;
        const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                            'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

        const pendingSet      = new Set(this._pendingPreviewEvents.map(e => e.date));
        const conflictSet     = this._pendingPreviewConflictSet;
        const existingDates   = this._pendingPreviewExistingDates;
        const existingByDate  = this._pendingPreviewExistingByDate || new Map();
        const todayIso    = new Date().toISOString().split('T')[0];
        const selected    = this._miniCalSelected;

        // Primeiro dia do mês e início do grid (domingo anterior ou o próprio domingo)
        const firstDay  = new Date(year, month, 1);
        const startGrid = new Date(firstDay);
        startGrid.setDate(startGrid.getDate() - firstDay.getDay());

        // Último dia do mês e fim do grid
        const lastDay  = new Date(year, month + 1, 0);
        const endGrid  = new Date(lastDay);
        const dowLast  = endGrid.getDay();
        if (dowLast !== 6) endGrid.setDate(endGrid.getDate() + (6 - dowLast));

        const dowHeaders = ['D','S','T','Q','Q','S','S'];
        const headerHtml = dowHeaders.map(d =>
            `<div class="pmc-dow">${d}</div>`
        ).join('');

        let cellsHtml = '';
        const cursor = new Date(startGrid);
        while (cursor <= endGrid) {
            const iso         = cursor.toISOString().split('T')[0];
            const isThisMonth = cursor.getMonth() === month;
            const isToday     = iso === todayIso;
            const isSelected  = iso === selected;
            const isPending   = pendingSet.has(iso);
            const isConflict  = conflictSet.has(iso);

            const classes = [
                'pmc-cell',
                !isThisMonth  ? 'pmc-other-month' : '',
                isToday       ? 'pmc-today'        : '',
                isSelected    ? 'pmc-selected'     : '',
            ].filter(Boolean).join(' ');

            let dots = '';
            if (!isSelected) {
                const hasExisting = existingByDate.has(iso);
                if (isPending && isConflict) dots += `<span class="pmc-dot pmc-dot-conflict"></span>`;
                else if (isPending)          dots += `<span class="pmc-dot pmc-dot-pending"></span>`;
                if (hasExisting)             dots += `<span class="pmc-dot pmc-dot-existing"></span>`;
            }

            const dayEvs = existingByDate.get(iso) || [];
            let cellTitle = iso;
            if (dayEvs.length > 0) {
                cellTitle = dayEvs.map(ev => {
                    const time = ev.startTime === '' ? 'Dia inteiro' : `${ev.startTime}–${ev.endTime}`;
                    const client = ev.clientName || ev.title;
                    return `${time} · ${client}`;
                }).join('\n');
            }
            cellsHtml += `<div class="${classes}" onclick="app._miniCalSelectDate('${iso}')" title="${cellTitle.replace(/"/g, '&quot;')}">${cursor.getDate()}${dots}</div>`;
            cursor.setDate(cursor.getDate() + 1);
        }

        const selectedLabel = selected
            ? (() => {
                const [y,m,d] = selected.split('-');
                const dt = new Date(parseInt(y), parseInt(m)-1, parseInt(d));
                const dn = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
                return `<span class="pmc-selected-label">${dn[dt.getDay()]}, ${d}/${m}/${y}</span>`;
              })()
            : `<span class="pmc-selected-label pmc-selected-empty">Nenhuma data selecionada</span>`;

        const legendHtml = `<div class="preview-mini-cal-legend">
            <span><span class="pmc-dot pmc-dot-existing" style="position:static;display:inline-block;vertical-align:middle;margin-right:3px;"></span>Compromisso</span>
            <span><span class="pmc-dot pmc-dot-pending" style="position:static;display:inline-block;vertical-align:middle;margin-right:3px;"></span>Novo</span>
            <span><span class="pmc-dot pmc-dot-conflict" style="position:static;display:inline-block;vertical-align:middle;margin-right:3px;"></span>Conflito</span>
        </div>`;

        container.innerHTML = `<div class="preview-mini-cal">
            <div class="preview-mini-cal-header">
                <button type="button" class="preview-mini-cal-nav" onclick="app._miniCalNav(-1)">
                    <i data-lucide="chevron-left" style="width:13px;height:13px;"></i>
                </button>
                <span class="preview-mini-cal-month-label">${monthNames[month]} ${year}</span>
                <button type="button" class="preview-mini-cal-nav" onclick="app._miniCalNav(1)">
                    <i data-lucide="chevron-right" style="width:13px;height:13px;"></i>
                </button>
            </div>
            <div class="preview-mini-cal-grid">${headerHtml}${cellsHtml}</div>
            <div class="preview-mini-cal-footer">${selectedLabel}${legendHtml}</div>
        </div>`;
        lucide.createIcons();
    }

    _miniCalNav(delta) {
        this._miniCalMonth += delta;
        if (this._miniCalMonth > 11) { this._miniCalMonth = 0; this._miniCalYear++; }
        if (this._miniCalMonth < 0)  { this._miniCalMonth = 11; this._miniCalYear--; }
        this._renderMiniCal();
    }

    _miniCalSelectDate(dateStr) {
        this._miniCalSelected = (this._miniCalSelected === dateStr) ? null : dateStr;
        const input = document.getElementById('preview-manual-date');
        if (input) input.value = this._miniCalSelected || '';
        this._renderMiniCal();
    }

    _previewRemoveEvent(idx) {
        this._pendingPreviewEvents.splice(idx, 1);
        this._renderPreviewContent();
    }

    _previewStartEditDate(idx) {
        const row = document.querySelector(`[data-preview-idx="${idx}"]`);
        if (!row) return;
        const dateSpan = row.querySelector('.preview-date-text');
        const editBtn  = row.querySelector('.preview-edit-date-btn');
        const ev = this._pendingPreviewEvents[idx];

        const input = document.createElement('input');
        input.type = 'date';
        input.value = ev.date;
        input.className = 'form-control';
        input.style.cssText = 'width:140px;font-size:0.82rem;padding:3px 6px;flex:1;';

        let changed = false;
        input.addEventListener('change', () => {
            changed = true;
            this._previewEditEventDate(idx, input.value);
        });
        input.addEventListener('blur', () => {
            if (!changed) this._renderPreviewContent();
        });

        dateSpan.replaceWith(input);
        editBtn?.remove();
        input.focus();
    }

    _previewEditEventDate(idx, newDate) {
        if (!newDate) return;
        const ev = this._pendingPreviewEvents[idx];
        ev.date = newDate;
        ev.hasConflict = this._pendingPreviewConflictSet.has(newDate);
        this._pendingPreviewEvents.sort((a, b) => a.date.localeCompare(b.date));
        this._renderPreviewContent();
    }

    _previewSuggestExtras() {
        const rule   = this._pendingPreviewRule;
        const client = this._pendingPreviewClient;
        const events = this._pendingPreviewEvents;

        const sessionMinutes   = this.calcDuration(rule.startTime, rule.endTime).minutes;
        const targetMonthlyMin = (client?.hoursTotal || 0) * 60;
        if (sessionMinutes <= 0 || targetMonthlyMin <= 0) return;

        const [sy, sm_] = rule.periodStart.split('-').map(Number);
        const [ey, em_] = rule.periodEnd.split('-').map(Number);
        const mip       = Math.max(1, (ey - sy) * 12 + (em_ - sm_) + 1);
        const deficit   = targetMonthlyMin * mip - events.length * sessionMinutes;
        if (deficit <= 0) { Toast.show('Meta já atingida!', 'success'); return; }

        const needed    = Math.ceil(deficit / sessionMinutes);
        const existing  = new Set(events.map(e => e.date));
        const conflicts = this._pendingPreviewConflictSet;
        const dows      = new Set(rule.daysOfWeek);

        // Começa do dia seguinte ao último evento já previsto (ou do periodStart)
        const lastDate = events.length > 0
            ? events.reduce((max, e) => e.date > max ? e.date : max, events[0].date)
            : rule.periodStart;
        const cur = new Date(lastDate + 'T00:00:00');
        cur.setDate(cur.getDate() + 1);

        const suggestions = [];
        let guard = 400;
        while (suggestions.length < needed && guard-- > 0) {
            const iso = cur.toISOString().split('T')[0];
            const dow = cur.getDay();
            if ((dows.size === 0 || dows.has(dow)) && !existing.has(iso)) {
                suggestions.push(iso);
                existing.add(iso);
            }
            cur.setDate(cur.getDate() + 1);
        }

        for (const date of suggestions) {
            this._pendingPreviewEvents.push({
                date,
                startTime: rule.startTime,
                endTime: rule.endTime,
                title: rule.title,
                type: rule.eventType,
                description: rule.description || '',
                clientId: rule.clientId,
                location: rule.location,
                attendees: rule.attendees,
                generateMeet: rule.generateMeet,
                hasConflict: conflicts.has(date),
                isExtra: true,
            });
        }

        this._pendingPreviewEvents.sort((a, b) => a.date.localeCompare(b.date));
        this._renderPreviewContent();
    }

    _previewAddManual() {
        const rule      = this._pendingPreviewRule;
        const dateInput = document.getElementById('preview-manual-date');
        const date      = dateInput?.value;
        if (!date) { Toast.show('Selecione uma data.', 'error'); return; }

        const isAllDay   = rule.startTime === '';
        const startTime  = isAllDay ? '' : (document.getElementById('preview-manual-start')?.value || rule.startTime);
        const endTime    = isAllDay ? '' : (document.getElementById('preview-manual-end')?.value || rule.endTime);

        if (this._pendingPreviewEvents.some(e => e.date === date && e.startTime === startTime)) {
            Toast.show('Já existe um evento nesta data e horário.', 'error');
            return;
        }

        this._pendingPreviewEvents.push({
            date,
            startTime,
            endTime,
            title: rule.title,
            type: rule.eventType,
            description: rule.description || '',
            clientId: rule.clientId,
            location: rule.location,
            attendees: rule.attendees,
            generateMeet: rule.generateMeet,
            hasConflict: this._pendingPreviewConflictSet.has(date),
            isExtra: true,
        });

        this._pendingPreviewEvents.sort((a, b) => a.date.localeCompare(b.date));
        this._miniCalSelected = null;
        this._renderPreviewContent();
    }

    async confirmScheduleGeneration() {
        const btn = document.getElementById('btn-confirm-schedule');
        btn.disabled = true;
        const events = this._pendingPreviewEvents;
        const ruleId = this._pendingPreviewRuleId;

        // Garantir autenticação Google antes de gerar eventos
        const googleAvailable = typeof calendarAPI !== 'undefined' && calendarAPI.isEnabled;
        let googleReady = googleAvailable && calendarAPI.isAuthenticated;
        if (googleAvailable && !googleReady) {
            Toast.show('Conectando ao Google Calendar...', 'info');
            googleReady = await calendarAPI.authenticateGoogle();
            if (!googleReady) {
                Toast.show('Sem acesso ao Google Calendar — eventos serão criados só na plataforma.', 'info');
            }
        }

        let created = 0, failed = 0;
        try {
            for (const ev of events) {
                try {
                    const savedEvent = await store.addAgendaEvent({
                        clientId: ev.clientId,
                        title: ev.title,
                        type: ev.type,
                        date: ev.date,
                        dateEnd: ev.date,
                        startTime: ev.startTime,
                        endTime: ev.endTime,
                        location: ev.location,
                        attendees: ev.attendees,
                        description: ev.description || '',
                    });
                    if (googleReady) {
                        try {
                            const result = await calendarAPI.createGoogleEvent({ ...savedEvent, generateMeet: ev.generateMeet });
                            if (result) {
                                await store.updateAgendaEvent({
                                    ...savedEvent,
                                    calendarEventId: result.id,
                                    meetLink: result.meetLink || '',
                                });
                            }
                        } catch (_) {} // Falha no Google não bloqueia
                    }
                    created++;
                } catch (_) { failed++; }
            }
            // Atualizar last_generated_until
            const lastDate = events[events.length - 1].date;
            await store.updateRuleLastGenerated(ruleId, lastDate);

            this.closeModal('modal-schedule-preview');
            const clientId = document.getElementById('client-id').value;
            await this._renderClientSchedulingTab(clientId);
            const msg = failed > 0
                ? `${created} evento(s) criado(s), ${failed} falha(s).`
                : `${created} evento(s) criado(s) com sucesso!`;
            Toast.show(msg, failed > 0 ? 'info' : 'success');
        } catch (err) {
            Toast.show('Erro ao gerar agenda: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            this._pendingPreviewEvents = [];
            this._pendingPreviewRuleId = null;
        }
    }

    // ===================================
    // RELATÓRIO DE AGENDA (Fase 27)
    // ===================================

    async openAgendaReportModal(clientId) {
        const today = new Date();
        const first = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
        const last  = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];

        document.getElementById('report-date-start').value = first;
        document.getElementById('report-date-end').value   = last;
        document.getElementById('btn-report-pdf-modal').style.display   = 'none';
        document.getElementById('btn-report-copy-modal').style.display  = 'none';
        document.getElementById('report-preview-modal').innerHTML =
            '<p class="text-muted" style="text-align:center;padding:32px 0;">Selecione o cliente e o período, depois clique em Buscar.</p>';

        // Popula o select de clientes
        const sel = document.getElementById('report-client-select');
        sel.innerHTML = '<option value="">— Selecione um cliente —</option>';
        try {
            const clients = (await store.getClients()).filter(c => c.status === 'active');
            clients.sort((a, b) => a.name.localeCompare(b.name));
            clients.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.name + (c.projectNum ? ` (${c.projectNum})` : '');
                sel.appendChild(opt);
            });
        } catch (_) {}

        if (clientId) {
            sel.value = clientId;
            this._onReportClientChange();
        }

        this._reportEvents = [];
        this._reportClient = null;
        this.openModal('modal-agenda-report');
    }

    _onReportClientChange() {
        const sel = document.getElementById('report-client-select');
        const label = document.getElementById('report-client-label');
        const opt = sel.options[sel.selectedIndex];
        label.textContent = opt && opt.value ? opt.textContent : '';
        document.getElementById('btn-report-pdf-modal').style.display  = 'none';
        document.getElementById('btn-report-copy-modal').style.display = 'none';
        const aiBtnReset = document.getElementById('btn-report-ai-modal');
        const aiPanelReset = document.getElementById('report-ai-panel-modal');
        if (aiBtnReset) aiBtnReset.style.display = 'none';
        if (aiPanelReset) { aiPanelReset.style.display = 'none'; const ta = document.getElementById('report-ai-text-modal'); if (ta) ta.value = ''; }
        document.getElementById('report-preview-modal').innerHTML =
            '<p class="text-muted" style="text-align:center;padding:32px 0;">Clique em Buscar para carregar os eventos.</p>';
        this._reportEvents = [];
        this._reportClient = null;
    }

    _reportGetContext(source) {
        if (source === 'inline') {
            return {
                clientId:    this._reportInlineClientId || '',
                startDate:   document.getElementById('report-date-start-inline')?.value || '',
                endDate:     document.getElementById('report-date-end-inline')?.value || '',
                preview:     document.getElementById('report-preview-inline'),
                pdfBtn:      document.getElementById('btn-report-pdf-inline'),
                copyBtn:     document.getElementById('btn-report-copy-inline'),
                aiBtn:       document.getElementById('btn-report-ai-inline'),
                aiPanel:     document.getElementById('report-ai-panel-inline'),
                aiTextarea:  document.getElementById('report-ai-text-inline'),
            };
        }
        return {
            clientId:    document.getElementById('report-client-select')?.value || '',
            startDate:   document.getElementById('report-date-start')?.value || '',
            endDate:     document.getElementById('report-date-end')?.value || '',
            preview:     document.getElementById('report-preview-modal'),
            pdfBtn:      document.getElementById('btn-report-pdf-modal'),
            copyBtn:     document.getElementById('btn-report-copy-modal'),
            aiBtn:       document.getElementById('btn-report-ai-modal'),
            aiPanel:     document.getElementById('report-ai-panel-modal'),
            aiTextarea:  document.getElementById('report-ai-text-modal'),
        };
    }

    async fetchAgendaReportEvents(source) {
        const ctx = this._reportGetContext(source);
        if (!ctx.clientId)  { Toast.show('Selecione um cliente.', 'error'); return; }
        if (!ctx.startDate || !ctx.endDate) { Toast.show('Selecione o período completo.', 'error'); return; }
        if (ctx.startDate > ctx.endDate)    { Toast.show('Data início deve ser anterior à data fim.', 'error'); return; }

        ctx.preview.innerHTML = `<div style="padding:24px 0;">${spinnerHtml}</div>`;
        if (ctx.pdfBtn)   ctx.pdfBtn.style.display   = 'none';
        if (ctx.copyBtn)  ctx.copyBtn.style.display   = 'none';
        if (ctx.aiBtn)    ctx.aiBtn.style.display     = 'none';
        if (ctx.aiPanel)  { ctx.aiPanel.style.display = 'none'; if (ctx.aiTextarea) ctx.aiTextarea.value = ''; }

        try {
            const [events, client] = await Promise.all([
                store.getAgendaEventsByClientAndRange(ctx.clientId, ctx.startDate, ctx.endDate),
                store.getClient(ctx.clientId)
            ]);

            this._reportEvents = events;
            this._reportClient = client;

            if (source === 'modal') {
                const label = document.getElementById('report-client-label');
                if (label && client) label.textContent = client.name + (client.projectNum ? ` · Proj. ${client.projectNum}` : '');
            }

            if (events.length === 0) {
                ctx.preview.innerHTML = '<p class="text-muted" style="text-align:center;padding:32px 0;">Nenhum evento encontrado neste período.</p>';
                return;
            }

            ctx.preview.innerHTML = this._buildReportPreviewHtml(events);
            lucide.createIcons();
            if (ctx.pdfBtn)  ctx.pdfBtn.style.display  = 'inline-flex';
            if (ctx.copyBtn) ctx.copyBtn.style.display  = 'inline-flex';
            if (ctx.aiBtn && aiClient.isConfigured) ctx.aiBtn.style.display = 'inline-flex';
        } catch (err) {
            ctx.preview.innerHTML = '<p class="text-muted" style="text-align:center;padding:24px 0;">Erro ao buscar eventos.</p>';
            Toast.show('Erro ao buscar agenda: ' + err.message, 'error');
        }
    }

    _buildReportPreviewHtml(events) {
        const typeLabels = { meeting: 'Reunião', consulting: 'Consultoria', task: 'Tarefa', reminder: 'Lembrete' };
        const dayNames   = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
        let totalMinutes = 0;

        const rows = events.map(ev => {
            const [y, m, d] = ev.date.split('-');
            const dateObj = new Date(ev.date + 'T12:00:00');
            const dateStr = `${d}/${m}/${y}`;
            const dayStr  = dayNames[dateObj.getDay()];
            const allDay  = !ev.startTime;
            const timeStr = allDay ? 'Dia inteiro' : `${ev.startTime} – ${ev.endTime || '...'}`;
            let dur = '';
            if (!allDay && ev.startTime && ev.endTime) {
                const [sh, sm] = ev.startTime.split(':').map(Number);
                const [eh, em] = ev.endTime.split(':').map(Number);
                const mins = (eh * 60 + em) - (sh * 60 + sm);
                if (mins > 0) {
                    totalMinutes += mins;
                    dur = mins >= 60
                        ? `${Math.floor(mins/60)}h${mins % 60 > 0 ? (mins%60)+'min' : ''}`
                        : `${mins}min`;
                }
            }
            const type = typeLabels[ev.type] || ev.type;
            const meetHtml = ev.meetLink
                ? `<a href="${ev.meetLink}" target="_blank" class="report-meet-link"><i data-lucide="video" style="width:12px;height:12px;"></i> Meet</a>`
                : '';
            const locHtml = ev.location
                ? `<span class="report-location"><i data-lucide="map-pin" style="width:11px;height:11px;"></i> ${escapeHtml(ev.location)}</span>`
                : '';
            return `<div class="report-event-row">
                <div class="report-event-date">${dateStr} <span class="report-day-name">${dayStr}</span></div>
                <div class="report-event-time">${escapeHtml(timeStr)}</div>
                <div class="report-event-info">
                    <span class="report-event-title">${escapeHtml(ev.title)}</span>
                    <span class="report-event-type">${type}</span>
                    ${meetHtml}${locHtml}
                </div>
                <div class="report-event-dur">${dur}</div>
            </div>`;
        }).join('');

        const totalH = Math.floor(totalMinutes / 60);
        const totalM = totalMinutes % 60;
        const totalStr = totalMinutes > 0
            ? ` · ${totalH > 0 ? totalH+'h' : ''}${totalM > 0 ? totalM+'min' : ''}`
            : '';

        return `<div class="report-summary">${events.length} evento${events.length !== 1 ? 's' : ''}${totalStr}</div>
                <div class="report-events-list">${rows}</div>`;
    }

    generateAgendaReportPdf(source) {
        const events = this._reportEvents;
        const client = this._reportClient;
        const ctx    = this._reportGetContext(source);
        if (!events || events.length === 0) { Toast.show('Nenhum dado para exportar.', 'info'); return; }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const fmtDate = d => d ? d.split('-').reverse().join('/') : '';
        const typeLabels = { meeting: 'Reunião', consulting: 'Consultoria', task: 'Tarefa', reminder: 'Lembrete' };
        const dayNames   = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

        doc.setFontSize(16);
        doc.text('Relatório de Agenda', 14, 18);
        doc.setFontSize(10);
        doc.text(`Cliente: ${client?.name || ''}${client?.projectNum ? ' · Proj. ' + client.projectNum : ''}`, 14, 26);
        doc.text(`Período: ${fmtDate(ctx.startDate)} a ${fmtDate(ctx.endDate)}`, 14, 32);

        let totalMinutes = 0;
        const rows = events.map(ev => {
            const [y, m, d] = ev.date.split('-');
            const dateObj = new Date(ev.date + 'T12:00:00');
            const dateStr = `${d}/${m}/${y} ${dayNames[dateObj.getDay()]}`;
            const allDay  = !ev.startTime;
            const timeStr = allDay ? 'Dia inteiro' : `${ev.startTime} – ${ev.endTime || '...'}`;
            let dur = '';
            if (!allDay && ev.startTime && ev.endTime) {
                const [sh, sm] = ev.startTime.split(':').map(Number);
                const [eh, em] = ev.endTime.split(':').map(Number);
                const mins = (eh * 60 + em) - (sh * 60 + sm);
                if (mins > 0) {
                    totalMinutes += mins;
                    dur = mins >= 60
                        ? `${Math.floor(mins/60)}h${mins%60 > 0 ? (mins%60)+'min' : ''}`
                        : `${mins}min`;
                }
            }
            return [dateStr, timeStr, ev.title, typeLabels[ev.type] || ev.type, ev.location || '', dur];
        });

        doc.autoTable({
            startY: 38,
            head: [['Data', 'Horário', 'Título', 'Tipo', 'Local', 'Duração']],
            body: rows,
            styles: { fontSize: 8 },
            headStyles: { fillColor: [79, 70, 229] },
            columnStyles: { 2: { cellWidth: 45 } },
        });

        const finalY = doc.lastAutoTable.finalY || 100;
        const totalH = Math.floor(totalMinutes / 60);
        const totalM = totalMinutes % 60;
        if (totalMinutes > 0) {
            doc.setFontSize(9);
            doc.text(
                `Total: ${events.length} evento${events.length !== 1 ? 's' : ''} · ${totalH > 0 ? totalH+'h' : ''}${totalM > 0 ? totalM+'min' : ''}`,
                14, finalY + 8
            );
        }

        const safeName = (client?.name || 'agenda').replace(/[^a-z0-9]/gi, '_').toLowerCase();
        doc.save(`agenda_${safeName}_${ctx.startDate}_${ctx.endDate}.pdf`);
    }

    generateAgendaReportText(source) {
        const events = this._reportEvents;
        const client = this._reportClient;
        const ctx    = this._reportGetContext(source);
        if (!events || events.length === 0) { Toast.show('Nenhum dado para copiar.', 'info'); return; }

        const fmtDate    = d => d ? d.split('-').reverse().join('/') : '';
        const dayNames   = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
        const typeLabels = { meeting: 'Reunião', consulting: 'Consultoria', task: 'Tarefa', reminder: 'Lembrete' };

        let totalMinutes = 0;
        const lines = [
            `Agenda — ${client?.name || ''}${client?.projectNum ? ' (Proj. ' + client.projectNum + ')' : ''}`,
            `Período: ${fmtDate(ctx.startDate)} a ${fmtDate(ctx.endDate)}`,
            '',
        ];

        events.forEach(ev => {
            const [y, m, d] = ev.date.split('-');
            const dateObj = new Date(ev.date + 'T12:00:00');
            const dateStr = `${d}/${m} (${dayNames[dateObj.getDay()]})`;
            const allDay  = !ev.startTime;
            const timeStr = allDay ? 'Dia inteiro' : `${ev.startTime} às ${ev.endTime || '...'}`;
            let durPart = '';
            if (!allDay && ev.startTime && ev.endTime) {
                const [sh, sm] = ev.startTime.split(':').map(Number);
                const [eh, em] = ev.endTime.split(':').map(Number);
                const mins = (eh * 60 + em) - (sh * 60 + sm);
                if (mins > 0) {
                    totalMinutes += mins;
                    durPart = ` — ${mins >= 60 ? Math.floor(mins/60)+'h'+(mins%60>0?(mins%60)+'min':'') : mins+'min'}`;
                }
            }
            lines.push(`• ${dateStr} — ${timeStr} — ${ev.title} (${typeLabels[ev.type] || ev.type})${durPart}`);
            if (ev.meetLink)  lines.push(`  Link Meet: ${ev.meetLink}`);
            if (ev.location)  lines.push(`  Local: ${ev.location}`);
        });

        if (totalMinutes > 0) {
            const totalH = Math.floor(totalMinutes / 60);
            const totalM = totalMinutes % 60;
            lines.push('', `Total: ${events.length} evento${events.length!==1?'s':''} | ${totalH>0?totalH+'h':''}${totalM>0?totalM+'min':''}`);
        }

        navigator.clipboard.writeText(lines.join('\n'))
            .then(() => Toast.show('Texto copiado para a área de transferência!', 'success'))
            .catch(() => Toast.show('Erro ao copiar texto.', 'error'));
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

    // ===================================
    // CONFIGURAÇÕES DE IA
    // ===================================

    async openAIConfig() {
        const config = await store.getAIConfig().catch(() => null);
        const provider = config?.provider || 'openai';
        document.getElementById('ai-provider').value = provider;
        document.getElementById('ai-api-key').value = config?.apiKey ? '••••••••••••••••' : '';
        this.onAIProviderChange(provider);
        if (config?.model) document.getElementById('ai-model').value = config.model;

        const removeBtn = document.getElementById('btn-ai-remove');
        removeBtn.style.display = config?.apiKey ? 'inline-flex' : 'none';

        const statusEl = document.getElementById('ai-config-status');
        if (config?.apiKey) {
            statusEl.style.display = 'flex';
            statusEl.style.background = 'rgba(16,185,129,0.12)';
            statusEl.style.border = '1px solid rgba(16,185,129,0.3)';
            statusEl.innerHTML = `<i data-lucide="check-circle" style="width:16px;height:16px;color:var(--success-color);flex-shrink:0;"></i> IA configurada com <strong>${provider === 'openai' ? 'OpenAI' : 'Anthropic (Claude)'}</strong>`;
        } else {
            statusEl.style.display = 'none';
        }
        this.openModal('modal-ai-config');
        lucide.createIcons();
    }

    onAIProviderChange(provider) {
        const sel = provider || document.getElementById('ai-provider').value;
        const modelSelect = document.getElementById('ai-model');
        const hint = document.getElementById('ai-key-hint');
        const currentModel = modelSelect.value;

        const openaiModels = [
            { value: 'gpt-4o-mini', label: 'GPT-4o Mini (rápido e econômico)' },
            { value: 'gpt-4o', label: 'GPT-4o (mais capaz)' },
            { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
        ];
        const anthropicModels = [
            { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku (rápido e econômico)' },
            { value: 'claude-sonnet-4-6', label: 'Claude Sonnet (equilibrado)' },
            { value: 'claude-opus-4-8', label: 'Claude Opus (mais capaz)' },
        ];

        const models = sel === 'anthropic' ? anthropicModels : openaiModels;
        modelSelect.innerHTML = models.map(m => `<option value="${m.value}">${m.label}</option>`).join('');
        if (models.find(m => m.value === currentModel)) modelSelect.value = currentModel;

        if (sel === 'anthropic') {
            hint.innerHTML = 'Sua chave Anthropic começa com <code>sk-ant-</code>. Encontre em console.anthropic.com → API Keys.';
        } else {
            hint.innerHTML = 'Sua chave OpenAI começa com <code>sk-</code>. Encontre em platform.openai.com → API Keys.';
        }
    }

    toggleAIKeyVisibility() {
        const input = document.getElementById('ai-api-key');
        const icon = document.getElementById('icon-ai-key-toggle');
        if (input.type === 'password') {
            input.type = 'text';
            icon.setAttribute('data-lucide', 'eye-off');
        } else {
            input.type = 'password';
            icon.setAttribute('data-lucide', 'eye');
        }
        lucide.createIcons();
    }

    async handleAIConfigSubmit(e) {
        e.preventDefault();
        const provider = document.getElementById('ai-provider').value;
        const apiKey = document.getElementById('ai-api-key').value.trim();
        const model = document.getElementById('ai-model').value;

        if (!apiKey || apiKey.startsWith('•')) {
            Toast.show('Insira uma API key válida.', 'error');
            return;
        }

        const btn = e.target.querySelector('button[type="submit"]');
        const orig = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner" style="width:16px;height:16px;"></div> Salvando...';

        try {
            await store.saveAIConfig(provider, apiKey, model);
            await aiClient.loadConfig();
            this._updateAIStatusBadge();
            Toast.show('Configuração de IA salva com sucesso!', 'success');
            this.closeModal('modal-ai-config');
        } catch (err) {
            Toast.show('Erro ao salvar: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = orig;
        }
    }

    async testAIConnection() {
        const provider = document.getElementById('ai-provider').value;
        const apiKey = document.getElementById('ai-api-key').value.trim();
        const model = document.getElementById('ai-model').value;

        if (!apiKey || apiKey.startsWith('•')) {
            Toast.show('Salve a configuração antes de testar.', 'error');
            return;
        }

        const btn = document.getElementById('btn-ai-test');
        const orig = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;"></div> Testando...';

        try {
            // Salva temporariamente para testar via proxy
            await store.saveAIConfig(provider, apiKey, model);
            await aiClient.loadConfig();
            const resp = await aiClient.testConnection();
            if (resp) {
                Toast.show('Conexão OK! IA respondeu com sucesso.', 'success');
            }
        } catch (err) {
            Toast.show('Falha no teste: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = orig;
        }
    }

    async removeAIConfig() {
        if (!confirm('Remover configuração de IA? Os recursos de IA ficarão indisponíveis.')) return;
        try {
            await store.deleteAIConfig();
            aiClient.reset();
            this._updateAIStatusBadge();
            Toast.show('Configuração de IA removida.', 'info');
            this.closeModal('modal-ai-config');
        } catch (err) {
            Toast.show('Erro ao remover: ' + err.message, 'error');
        }
    }

    _updateAIStatusBadge() {
        const btn = document.getElementById('btn-ai-config');
        if (!btn) return;
        if (aiClient.isConfigured) {
            btn.style.borderColor = 'rgba(139,92,246,0.5)';
            btn.style.color = 'var(--primary-color)';
        } else {
            btn.style.borderColor = '';
            btn.style.color = '';
        }
    }

    // ===================================
    // FEATURES DE IA
    // ===================================

    onRecordDescInput() {
        const btn = document.getElementById('btn-ai-improve-record');
        if (!btn) return;
        const hasText = document.getElementById('record-desc').value.trim().length > 10;
        btn.style.display = (aiClient.isConfigured && hasText) ? 'inline-flex' : 'none';
    }

    async improveRecordDescription() {
        const descEl = document.getElementById('record-desc');
        const raw = descEl.value.trim();
        if (!raw) return;
        if (!aiClient.isConfigured) { Toast.show('Configure a IA primeiro (botão ✨ na sidebar).', 'error'); return; }

        const btn = document.getElementById('btn-ai-improve-record');
        const origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner" style="width:12px;height:12px;"></div> Melhorando...';

        try {
            const clientId = document.getElementById('record-client').value;
            const clients = await store.getClients().catch(() => []);
            const client = clients.find(c => c.id === clientId);
            const clientName = client?.name || '';
            const projectNum = client?.projectNum || '';
            const durationLabel = document.getElementById('record-calculated').value || '';

            const improved = await aiClient.improveAtendimentoDescription(raw, clientName, projectNum, durationLabel);
            descEl.value = improved;
            descEl.style.transition = 'background 0.4s';
            descEl.style.background = 'rgba(139,92,246,0.08)';
            setTimeout(() => { descEl.style.background = ''; }, 1200);
            Toast.show('Descrição melhorada!', 'success', 2500);
        } catch (err) {
            Toast.show('Erro na IA: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = origHtml;
        }
    }

    async suggestTaskAINextSteps() {
        if (!aiClient.isConfigured) { Toast.show('Configure a IA primeiro (botão ✨ na sidebar).', 'error'); return; }

        const btn = document.getElementById('btn-ai-suggest-steps');
        const panel = document.getElementById('ai-task-suggestions');
        if (!btn || !panel) return;

        const origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner" style="width:12px;height:12px;"></div> Pensando...';
        panel.style.display = 'none';

        try {
            const title = document.getElementById('task-title').value.trim();
            const description = document.getElementById('task-description').value.trim();
            const checklist = this._modalChecklist || [];
            const comments = (this._modalComments || []).slice(0, 8);

            const suggestions = await aiClient.suggestTaskNextSteps(title, description, checklist, comments);
            if (!suggestions || suggestions.length === 0) {
                Toast.show('A IA não retornou sugestões. Tente adicionar mais detalhes à tarefa.', 'error'); return;
            }

            this._aiTaskSuggestions = suggestions;
            panel.innerHTML = `
                <div style="margin-top:8px;padding:10px;border-radius:8px;background:rgba(139,92,246,0.06);border:1px solid rgba(139,92,246,0.2);">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                        <span style="font-size:11px;font-weight:600;color:#a78bfa;text-transform:uppercase;letter-spacing:.5px;">
                            <i data-lucide="sparkles" style="width:11px;height:11px;display:inline-block;vertical-align:middle;margin-right:3px;"></i>
                            Sugestões da IA
                        </span>
                        <button type="button" class="btn btn-ghost btn-sm" style="font-size:11px;padding:2px 8px;color:#a78bfa;border-color:rgba(167,139,250,0.3);"
                            onclick="app._addAllAISuggestions()">Adicionar todos</button>
                    </div>
                    <div id="ai-suggestions-list">
                        ${suggestions.map((s, i) => `
                            <div id="ai-sug-${i}" style="display:flex;align-items:flex-start;gap:6px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                                <span style="flex:1;font-size:12px;color:var(--text-secondary);line-height:1.4;">${escapeHtml(s)}</span>
                                <button type="button" class="btn btn-ghost btn-sm" style="flex-shrink:0;padding:2px 6px;font-size:11px;color:#a78bfa;"
                                    onclick="app._addAISuggestion(${i})">
                                    <i data-lucide="plus" style="width:11px;height:11px;"></i>
                                </button>
                            </div>
                        `).join('')}
                    </div>
                </div>`;
            panel.style.display = 'block';
            lucide.createIcons();
        } catch (err) {
            Toast.show('Erro na IA: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = origHtml;
            lucide.createIcons();
        }
    }

    _addAISuggestion(idx) {
        const text = this._aiTaskSuggestions?.[idx];
        if (!text) return;
        this._modalChecklist.push({ id: 'cl-' + Date.now() + '-' + idx, text, done: false });
        this._renderChecklist();
        // Risca a sugestão para indicar que foi adicionada
        const row = document.getElementById('ai-sug-' + idx);
        if (row) {
            row.style.opacity = '0.4';
            row.querySelector('button').disabled = true;
        }
        Toast.show('Item adicionado ao checklist!', 'success', 1800);
    }

    _addAllAISuggestions() {
        const suggestions = this._aiTaskSuggestions || [];
        if (suggestions.length === 0) return;
        suggestions.forEach((text, idx) => {
            this._modalChecklist.push({ id: 'cl-' + Date.now() + '-' + idx, text, done: false });
        });
        this._renderChecklist();
        const panel = document.getElementById('ai-task-suggestions');
        if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
        Toast.show(`${suggestions.length} itens adicionados ao checklist!`, 'success');
    }

    async generateDashboardInsights() {
        if (!aiClient.isConfigured) { Toast.show('Configure a IA primeiro (botão ✨ na sidebar).', 'error'); return; }

        const btn = document.getElementById('btn-dash-insights');
        const panel = document.getElementById('dashboard-ai-insights');
        const content = document.getElementById('dashboard-ai-insights-content');
        const title = document.getElementById('dash-insights-title');
        if (!btn || !panel || !content) return;

        const origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;"></div> Analisando...';

        // Mostra painel com spinner enquanto carrega
        content.innerHTML = `<div style="padding:8px 0;">${spinnerHtml}</div>`;
        panel.style.display = 'block';

        try {
            const allStats = await store.getBatchStats(this._dashboardMonth);
            const showActive   = document.getElementById('dash-filter-active')?.checked ?? true;
            const showFinished = document.getElementById('dash-filter-finished')?.checked ?? false;
            const stats = allStats.filter(s => {
                const status = s.client.status || 'active';
                return (status === 'active' && showActive) || (status === 'finished' && showFinished);
            }).filter(Boolean);

            if (stats.length === 0) {
                content.textContent = 'Nenhum cliente visível para analisar. Ative os filtros de status acima.';
                return;
            }

            const monthLabel = this._formatDashboardMonth(this._dashboardMonth);
            if (title) title.textContent = `Análise Inteligente — ${monthLabel}`;

            const narrative = await aiClient.generateDashboardInsights(stats, monthLabel);
            content.textContent = narrative;
            lucide.createIcons();
            Toast.show('Insights gerados!', 'success', 2000);
        } catch (err) {
            content.textContent = 'Erro ao gerar análise: ' + err.message;
            Toast.show('Erro na IA: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = origHtml;
            lucide.createIcons();
        }
    }

    toggleAgendaAssistant() {
        const panel = document.getElementById('agenda-ai-assistant');
        if (!panel) return;
        if (!aiClient.isConfigured) {
            Toast.show('Configure a IA primeiro (botão ✨ na sidebar).', 'error');
            return;
        }
        const visible = panel.style.display !== 'none';
        panel.style.display = visible ? 'none' : 'block';
        if (!visible) {
            lucide.createIcons();
            setTimeout(() => document.getElementById('agenda-ai-input')?.focus(), 100);
        }
    }

    async interpretAgendaEvent() {
        if (!aiClient.isConfigured) { Toast.show('Configure a IA primeiro.', 'error'); return; }
        const input = document.getElementById('agenda-ai-input');
        const text = input?.value.trim();
        if (!text) { Toast.show('Digite a descrição do evento.', 'error'); return; }

        const btn = document.getElementById('btn-interpret-agenda');
        const origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;"></div> Interpretando...';

        try {
            const today = new Date().toISOString().split('T')[0];
            const ev = await aiClient.parseAgendaNaturalLanguage(text, today);

            const date = ev.date || today;
            this.openNewAgendaEvent(date);

            // Pre-fill todos os campos retornados pela IA
            if (ev.title)       document.getElementById('agenda-title').value = ev.title;
            if (ev.type)        document.getElementById('agenda-type').value = ev.type;
            if (ev.dateEnd)     document.getElementById('agenda-date-end').value = ev.dateEnd;
            if (ev.description) document.getElementById('agenda-desc').value = ev.description;
            if (ev.location)    document.getElementById('agenda-location').value = ev.location;

            if (ev.allDay) {
                this.toggleAllDayAgenda(true);
            } else {
                this.toggleAllDayAgenda(false);
                if (ev.startTime) document.getElementById('agenda-start').value = ev.startTime;
                if (ev.endTime)   document.getElementById('agenda-end').value   = ev.endTime;
            }

            // Oculta o painel após interpretar com sucesso
            document.getElementById('agenda-ai-assistant').style.display = 'none';
            input.value = '';

            Toast.show('Formulário pré-preenchido! Revise e salve.', 'success', 3000);
        } catch (err) {
            Toast.show('Erro ao interpretar: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = origHtml;
            lucide.createIcons();
        }
    }

    async generateAgendaReportNarrative(source) {
        if (!aiClient.isConfigured) { Toast.show('Configure a IA primeiro (botão ✨ na sidebar).', 'error'); return; }
        const events = this._reportEvents;
        const client = this._reportClient;
        if (!events || events.length === 0) { Toast.show('Busque os eventos primeiro.', 'info'); return; }

        const ctx = this._reportGetContext(source);
        const btn = ctx.aiBtn;
        if (!btn) return;

        const origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner" style="width:12px;height:12px;"></div> Gerando...';
        if (ctx.aiPanel) ctx.aiPanel.style.display = 'none';

        try {
            const narrative = await aiClient.generateAgendaReportNarrative(
                client?.name || '',
                events,
                ctx.startDate,
                ctx.endDate
            );

            if (ctx.aiTextarea) {
                ctx.aiTextarea.value = narrative;
                ctx.aiPanel.style.display = 'block';
                ctx.aiTextarea.focus();
                ctx.aiTextarea.select();
                lucide.createIcons();
            }
            Toast.show('Narrativa gerada! Revise e copie o texto.', 'success', 3000);
        } catch (err) {
            Toast.show('Erro na IA: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = origHtml;
            lucide.createIcons();
        }
    }

    async _copyReportNarrative(source) {
        const id = source === 'inline' ? 'report-ai-text-inline' : 'report-ai-text-modal';
        const text = document.getElementById(id)?.value?.trim();
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            Toast.show('Narrativa copiada!', 'success', 2000);
        } catch {
            Toast.show('Selecione o texto manualmente e use Ctrl+C.', 'info');
        }
    }

    onImplDescInput() {
        const btn = document.getElementById('btn-ai-improve-impl');
        if (!btn) return;
        const hasText = document.getElementById('impl-description').value.trim().length > 10;
        btn.style.display = (aiClient.isConfigured && hasText) ? 'inline-flex' : 'none';
    }

    async improveImplDescription() {
        const descEl = document.getElementById('impl-description');
        const raw = descEl.value.trim();
        if (!raw) return;
        if (!aiClient.isConfigured) { Toast.show('Configure a IA primeiro (botão ✨ na sidebar).', 'error'); return; }

        const btn = document.getElementById('btn-ai-improve-impl');
        const origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner" style="width:12px;height:12px;"></div> Melhorando...';

        try {
            const title = document.getElementById('impl-name').value.trim();
            const type = document.getElementById('impl-type').value;
            const codeSnippet = document.getElementById('impl-code').value.trim();

            const improved = await aiClient.improveImplementationDescription(title, type, raw, codeSnippet);
            descEl.value = improved;
            descEl.style.transition = 'background 0.4s';
            descEl.style.background = 'rgba(139,92,246,0.08)';
            setTimeout(() => { descEl.style.background = ''; }, 1200);
            Toast.show('Descrição melhorada!', 'success', 2500);
        } catch (err) {
            Toast.show('Erro na IA: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = origHtml;
            lucide.createIcons();
        }
    }

    onAptDescInput() {
        const btn = document.getElementById('btn-ai-improve-apt');
        if (!btn) return;
        const hasText = document.getElementById('apt-description').value.trim().length > 10;
        btn.style.display = (aiClient.isConfigured && hasText) ? 'inline-flex' : 'none';
    }

    async improveAptDescription() {
        const descEl = document.getElementById('apt-description');
        const raw = descEl.value.trim();
        if (!raw) return;
        if (!aiClient.isConfigured) { Toast.show('Configure a IA primeiro (botão ✨ na sidebar).', 'error'); return; }

        const btn = document.getElementById('btn-ai-improve-apt');
        const origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner" style="width:12px;height:12px;"></div> Melhorando...';

        try {
            const projectNum = document.getElementById('apt-project').value.trim();
            const durationLabel = document.getElementById('apt-duration').textContent || '';

            // Tenta encontrar o nome do cliente pelo número do projeto
            const clients = await store.getClients().catch(() => []);
            const client = clients.find(c => c.projectNum === projectNum);
            const clientName = client?.name || '';

            const improved = await aiClient.improveAtendimentoDescription(raw, clientName, projectNum, durationLabel);
            descEl.value = improved;
            descEl.style.transition = 'background 0.4s';
            descEl.style.background = 'rgba(139,92,246,0.08)';
            setTimeout(() => { descEl.style.background = ''; }, 1200);
            Toast.show('Descrição melhorada!', 'success', 2500);
        } catch (err) {
            Toast.show('Erro na IA: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = origHtml;
        }
    }

    // ===================================
    // CHAMADOS (OTOBO)
    // ===================================

    async renderChamados() {
        if (this.currentView !== 'chamados') return;
        const content = document.getElementById('chamados-content');
        if (!content) return;
        content.innerHTML = spinnerHtml;

        if (!this._otoboConfig) {
            this._otoboConfig = await store.getOtoboConfig().catch(() => null);
        }
        if (!this._otoboConfig || !this._otoboConfig.url) {
            document.getElementById('chamados-filters').style.display = 'none';
            content.innerHTML = `
                <div class="empty-state">
                    <i data-lucide="headphones" style="width:48px;height:48px;color:var(--text-muted);"></i>
                    <h3>OTOBO não configurado</h3>
                    <p>Configure as credenciais do OTOBO para visualizar seus chamados.</p>
                    <button class="btn btn-primary" onclick="app.openOtoboConfigModal()">Configurar OTOBO</button>
                </div>`;
            lucide.createIcons();
            return;
        }

        document.getElementById('btn-sync-chamados').style.display = '';

        try {
            const [tickets, clients] = await Promise.all([store.getTickets(), store.getClients()]);
            this._cachedChamadosTickets = tickets;
            this._cachedChamadosClients = clients;

            if (tickets.length === 0) {
                document.getElementById('chamados-filters').style.display = 'none';
                content.innerHTML = `
                    <div class="empty-state">
                        <i data-lucide="inbox" style="width:48px;height:48px;color:var(--text-muted);"></i>
                        <h3>Nenhum chamado em aberto</h3>
                        <p>Clique em Sincronizar para buscar os chamados do OTOBO.</p>
                    </div>`;
                lucide.createIcons();
                return;
            }

            document.getElementById('chamados-filters').style.display = '';
            this._populateChamadoFilterDropdowns(tickets, clients);
            this._attachChamadoFilterListeners();

            const filtered = this._applyTicketFilters(tickets, clients);
            if (filtered.length === 0) {
                content.innerHTML = `<div class="empty-state"><p>Nenhum chamado corresponde aos filtros selecionados.</p></div>`;
            } else {
                this._renderChamadosCards(filtered, clients, content);
            }
        } catch (err) {
            content.innerHTML = `<div class="empty-state"><p>Erro ao carregar chamados: ${escapeHtml(err.message)}</p></div>`;
        }
        lucide.createIcons();
    }

    _attachChamadoFilterListeners() {
        if (this._chamadoFiltersAttached) return;
        this._chamadoFiltersAttached = true;
        let searchTimer;
        const searchEl = document.getElementById('filter-chamado-search');
        if (searchEl) {
            searchEl.addEventListener('input', () => {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => this._rerenderChamadosWithFilters(), 300);
            });
        }
        document.addEventListener('click', e => {
            if (!e.target.closest('.mf-wrap')) {
                document.querySelectorAll('.mf-dropdown.mf-drop-open').forEach(d => d.classList.remove('mf-drop-open'));
                document.querySelectorAll('.mf-wrap.mf-open').forEach(w => w.classList.remove('mf-open'));
            }
        });
    }

    _toggleMf(wrapId) {
        const wrap = document.getElementById(wrapId);
        const drop = wrap?.querySelector('.mf-dropdown');
        if (!drop) return;
        const isOpen = drop.classList.contains('mf-drop-open');
        document.querySelectorAll('.mf-dropdown.mf-drop-open').forEach(d => d.classList.remove('mf-drop-open'));
        document.querySelectorAll('.mf-wrap.mf-open').forEach(w => w.classList.remove('mf-open'));
        if (!isOpen) {
            drop.classList.add('mf-drop-open');
            wrap.classList.add('mf-open');
        }
    }

    _getMfValues(wrapId) {
        const wrap = document.getElementById(wrapId);
        if (!wrap) return [];
        return [...wrap.querySelectorAll('.mf-dropdown input:checked')].map(cb => cb.value);
    }

    _updateMfLabel(wrapId) {
        const wrap = document.getElementById(wrapId);
        if (!wrap) return;
        const placeholder = wrap.dataset.placeholder || '';
        const selected = this._getMfValues(wrapId);
        const label = wrap.querySelector('.mf-label');
        if (!label) return;
        if (selected.length === 0) {
            label.textContent = placeholder;
            wrap.classList.remove('mf-active');
        } else if (selected.length === 1) {
            const cb = wrap.querySelector(`.mf-dropdown input[value="${selected[0].replace(/"/g, '\\"')}"]`);
            label.textContent = cb?.nextElementSibling?.textContent || selected[0];
            wrap.classList.add('mf-active');
        } else {
            label.textContent = `${selected.length} selecionados`;
            wrap.classList.add('mf-active');
        }
    }

    _buildMfOptions(wrapId, items) {
        const wrap = document.getElementById(wrapId);
        if (!wrap) return;
        const drop = wrap.querySelector('.mf-dropdown');
        if (!drop) return;
        const prevSelected = this._getMfValues(wrapId);
        drop.innerHTML = '';
        for (const item of items) {
            const val = typeof item === 'string' ? item : item.value;
            const lbl = typeof item === 'string' ? item : item.label;
            const safeId = `${wrapId}-cb-${val.replace(/[^a-zA-Z0-9]/g, '_')}`;
            const div = document.createElement('div');
            div.className = 'mf-item';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = val;
            cb.id = safeId;
            if (prevSelected.includes(val)) cb.checked = true;
            cb.addEventListener('change', () => {
                this._updateMfLabel(wrapId);
                this._rerenderChamadosWithFilters();
            });
            const lbEl = document.createElement('label');
            lbEl.htmlFor = safeId;
            lbEl.textContent = lbl;
            div.appendChild(cb);
            div.appendChild(lbEl);
            drop.appendChild(div);
        }
        this._updateMfLabel(wrapId);
    }

    _clearMf(wrapId) {
        const wrap = document.getElementById(wrapId);
        if (!wrap) return;
        wrap.querySelectorAll('.mf-dropdown input').forEach(cb => { cb.checked = false; });
        this._updateMfLabel(wrapId);
    }

    _rerenderChamadosWithFilters() {
        if (!this._cachedChamadosTickets || !this._cachedChamadosClients) return;
        const content = document.getElementById('chamados-content');
        if (!content) return;
        const filtered = this._applyTicketFilters(this._cachedChamadosTickets, this._cachedChamadosClients);
        if (filtered.length === 0) {
            content.innerHTML = `<div class="empty-state"><p>Nenhum chamado corresponde aos filtros selecionados.</p></div>`;
        } else {
            this._renderChamadosCards(filtered, this._cachedChamadosClients, content);
        }
        lucide.createIcons();
    }

    _applyTicketFilters(tickets, clients) {
        const search = (document.getElementById('filter-chamado-search')?.value || '').toLowerCase().trim();
        const filterStatus   = this._getMfValues('mf-status');
        const filterPriority = this._getMfValues('mf-priority');
        const filterQueue    = this._getMfValues('mf-queue');
        const filterOwner    = this._getMfValues('mf-owner');
        const filterType     = this._getMfValues('mf-type');
        const filterClient   = this._getMfValues('mf-client');

        return tickets.filter(t => {
            if (search) {
                const num = (t.ticketNumber || t.ticketId || '').toLowerCase();
                const title = (t.title || '').toLowerCase();
                if (!num.includes(search) && !title.includes(search)) return false;
            }
            if (filterStatus.length   && !filterStatus.includes(t.status))     return false;
            if (filterPriority.length && !filterPriority.includes(t.priority)) return false;
            if (filterQueue.length    && !filterQueue.includes(t.queue))       return false;
            if (filterOwner.length    && !filterOwner.includes(t.owner))       return false;
            if (filterType.length     && !filterType.includes(t.ticketType))   return false;
            if (filterClient.length) {
                const hasUnlinked = filterClient.includes('__unlinked__');
                const specificIds = filterClient.filter(v => v !== '__unlinked__');
                if (hasUnlinked && specificIds.length) {
                    if (t.linkedClientId && !specificIds.includes(t.linkedClientId)) return false;
                } else if (hasUnlinked) {
                    if (t.linkedClientId) return false;
                } else {
                    if (!specificIds.includes(t.linkedClientId)) return false;
                }
            }
            return true;
        });
    }

    _populateChamadoFilterDropdowns(tickets, clients) {
        const unique = key => [...new Set(tickets.map(t => t[key]).filter(Boolean))].sort();
        this._buildMfOptions('mf-status',   unique('status'));
        this._buildMfOptions('mf-priority', unique('priority'));
        this._buildMfOptions('mf-queue',    unique('queue'));
        this._buildMfOptions('mf-owner',    unique('owner'));
        this._buildMfOptions('mf-type',     unique('ticketType'));

        const linkedIds = new Set(tickets.map(t => t.linkedClientId).filter(Boolean));
        const clientItems = [
            { value: '__unlinked__', label: 'Sem cliente vinculado' },
            ...clients.filter(c => linkedIds.has(c.id)).map(c => ({ value: c.id, label: c.name }))
        ];
        this._buildMfOptions('mf-client', clientItems);
    }

    clearChamadoFilters() {
        ['mf-status','mf-priority','mf-queue','mf-owner','mf-type','mf-client'].forEach(id => this._clearMf(id));
        const search = document.getElementById('filter-chamado-search');
        if (search) search.value = '';
        this._rerenderChamadosWithFilters();
    }

    switchOtoboTab(tab) {
        const tabMap = { conexao: 'otobo-tab-conexao', sync: 'otobo-tab-sync' };
        for (const [key, id] of Object.entries(tabMap)) {
            const el = document.getElementById(id);
            if (el) el.style.display = key === tab ? 'flex' : 'none';
        }
        document.querySelectorAll('#modal-otobo-config .modal-tab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabMap[tab]);
        });
    }

    _renderChamadosCards(tickets, clients, container) {
        const clientMap = new Map(clients.map(c => [c.id, c]));

        // Agrupar por cliente vinculado
        const byClient = new Map();
        const unlinked = [];
        for (const t of tickets) {
            if (t.linkedClientId && clientMap.has(t.linkedClientId)) {
                if (!byClient.has(t.linkedClientId)) byClient.set(t.linkedClientId, []);
                byClient.get(t.linkedClientId).push(t);
            } else {
                unlinked.push(t);
            }
        }

        let html = '';
        for (const [cid, cts] of byClient) {
            const client = clientMap.get(cid);
            html += `<div class="ticket-client-section">
                <h3>${escapeHtml(client.name)}</h3>
                <div class="ticket-grid">${cts.map(t => this._ticketCardHtml(t)).join('')}</div>
            </div>`;
        }
        if (unlinked.length > 0) {
            html += `<div class="ticket-client-section">
                <h3>Sem cliente vinculado</h3>
                <div class="ticket-grid">${unlinked.map(t => this._ticketCardHtml(t)).join('')}</div>
            </div>`;
        }
        container.innerHTML = html;

        container.querySelectorAll('.ticket-card').forEach(card => {
            card.addEventListener('click', () => {
                const ticket = tickets.find(t => t.ticketId === card.dataset.ticketId);
                if (ticket) this.openChamadoModal(ticket);
            });
        });
    }

    _ticketCardHtml(t) {
        const statusClass = this._ticketStatusClass(t.status);
        const priorityClass = this._ticketPriorityClass(t.priority);
        const updatedAgo = this._relativeDate(t.updatedAtOtobo);
        const typeHtml = t.ticketType ? `<span class="ticket-badge ticket-type-badge">${escapeHtml(t.ticketType)}</span>` : '';
        const queueHtml = t.queue ? `<span class="ticket-meta-item"><i data-lucide="layers" style="width:11px;height:11px;"></i>${escapeHtml(t.queue)}</span>` : '';
        const ownerHtml = t.owner ? `<span class="ticket-meta-item"><i data-lucide="user" style="width:11px;height:11px;"></i>${escapeHtml(t.owner)}</span>` : '';
        return `<div class="ticket-card" data-ticket-id="${escapeHtml(t.ticketId)}">
            <div class="ticket-card-header">
                <span class="ticket-number">#${escapeHtml(t.ticketNumber || t.ticketId)}</span>
            </div>
            <div class="ticket-card-title">${escapeHtml(t.title)}</div>
            <div class="ticket-card-badges">
                <span class="ticket-badge ${statusClass}">${escapeHtml(t.status)}</span>
                <span class="ticket-badge ${priorityClass}">${escapeHtml(t.priority)}</span>
                ${typeHtml}
            </div>
            <div class="ticket-card-meta">
                ${queueHtml}
                ${ownerHtml}
                ${updatedAgo ? `<span class="ticket-meta-item"><i data-lucide="clock" style="width:11px;height:11px;"></i>${updatedAgo}</span>` : ''}
            </div>
        </div>`;
    }

    _ticketStatusClass(status) {
        const s = (status || '').toLowerCase();
        if (s === 'new' || s === 'novo') return 'ticket-status-new';
        if (s === 'open' || s === 'aberto' || s === 'in treatment' || s === 'em atendimento') return 'ticket-status-open';
        if (s.includes('pending') || s.includes('aguardando')) return 'ticket-status-pending';
        return 'ticket-status-other';
    }

    _ticketPriorityClass(priority) {
        const p = (priority || '').toLowerCase().replace(/\s+/g, '-');
        if (p.includes('5') || p.includes('urgent') || p.includes('very-high')) return 'ticket-priority-5-urgent';
        if (p.includes('4') || p.includes('high') || p.includes('alta')) return 'ticket-priority-4-high';
        if (p.includes('3') || p.includes('normal') || p.includes('média') || p.includes('media')) return 'ticket-priority-3-normal';
        if (p.includes('2') || p.includes('low') || p.includes('baixa')) return 'ticket-priority-2-low';
        if (p.includes('1') || p.includes('very-low') || p.includes('muito-baixa')) return 'ticket-priority-1-very-low';
        return 'ticket-priority-3-normal';
    }

    _relativeDate(isoStr) {
        if (!isoStr) return '';
        const d = new Date(isoStr);
        if (isNaN(d)) return '';
        const diffMs = Date.now() - d.getTime();
        const diffDays = Math.floor(diffMs / 86400000);
        if (diffDays === 0) return 'hoje';
        if (diffDays === 1) return 'ontem';
        if (diffDays < 30) return `há ${diffDays} dias`;
        const diffMonths = Math.floor(diffDays / 30);
        return `há ${diffMonths} ${diffMonths === 1 ? 'mês' : 'meses'}`;
    }

    async syncChamados() {
        const btn = document.getElementById('btn-sync-chamados');
        if (btn) btn.disabled = true;
        Toast.show('Sincronizando com OTOBO...', 'info', 2000);
        try {
            const config = this._otoboConfig;
            const { tickets: otoboTickets, foundIds, denied } = await this._fetchTicketsFromOtobo(config);
            const clients = await store.getClients();
            const rows = this._mapTicketsToRows(otoboTickets, clients);
            const ticketIds = rows.map(r => r.ticket_id);
            await store.upsertTickets(rows);
            // Quando filtrando por proprietário, não deletar o cache — o sync traz apenas
            // uma janela recente (500 mais modificados) e tickets antigos do usuário que
            // não caíram nessa janela devem permanecer no banco.
            // Sem filtro de owner: deletar normalmente tickets que saíram do OTOBO.
            const ownerFilter = (this._otoboConfig?.syncFilters?.ownerLogin || '').trim();
            if (!ownerFilter) {
                await store.deleteTicketsNotIn(ticketIds);
            }
            const now = new Date().toLocaleString('pt-BR');
            const info = document.getElementById('chamados-sync-info');
            if (info) { info.textContent = `Última sync: ${now}`; info.style.display = ''; }
            this._cachedChamadosTickets = null;
            await this.renderChamados();
            let msg = `${rows.length} chamado(s) sincronizado(s)!`;
            if (denied > 0) msg += ` (${foundIds} encontrados no OTOBO, ${denied} sem acesso)`;
            else if (foundIds > rows.length) msg += ` (${foundIds} encontrados no OTOBO)`;
            Toast.show(msg, 'success', denied > 0 ? 8000 : 4000);
        } catch (err) {
            Toast.show(`Erro na sincronização: ${err.message}`, 'error', 6000);
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async _otoboProxyFetch(action, params = {}) {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session) throw new Error('Sessão expirada. Faça login novamente.');
        const res = await fetch(
            'https://klimkamnydfnzqetqlqm.supabase.co/functions/v1/otobo-proxy',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify({
                    action,
                    otoboUrl: this._otoboConfig.url,
                    username: this._otoboConfig.username,
                    password: this._otoboConfig.password,
                    ...params
                })
            }
        );
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `Proxy retornou ${res.status}`);
        }
        return res.json();
    }

    async _fetchTicketsFromOtobo(config) {
        const syncFilters = this._otoboConfig?.syncFilters || {};
        const searchData = await this._otoboProxyFetch('search', { syncFilters });
        const ticketIds = Array.isArray(searchData.TicketID)
            ? searchData.TicketID
            : (searchData.TicketID ? [searchData.TicketID] : []);
        console.log(`[OTOBO] Busca retornou ${ticketIds.length} ID(s)`);
        if (ticketIds.length === 0) return { tickets: [], foundIds: 0, denied: 0 };

        // TicketGet em lotes de 10
        const results = [];
        let totalDenied = 0;
        for (let i = 0; i < ticketIds.length; i += 10) {
            const batch = ticketIds.slice(i, i + 10);
            try {
                const d = await this._otoboProxyFetch('get', { ticketIds: batch });
                results.push(...(d.Ticket || []));
                totalDenied += d._denied || 0;
                console.log(`[OTOBO] Lote ${Math.floor(i/10)+1}: ${(d.Ticket||[]).length} buscado(s), ${d._denied||0} negado(s)`);
            } catch (e) {
                console.warn(`[OTOBO] Lote ${Math.floor(i/10)+1} falhou:`, e.message);
            }
        }
        console.log(`[OTOBO] Total: ${results.length} ticket(s) obtido(s), ${totalDenied} negado(s)`);

        // Filtragem local por proprietário: garante que só os tickets do usuário configurado
        // são salvos, mesmo que o OTOBO ignore o filtro OwnerLogin/Owners na busca.
        // Compara Owner e Responsible do OTOBO contra ownerLogin configurado (case-insensitive).
        // Usa includes bilateral para cobrir: login "jorge.henrique" vs "Jorge.Henrique" vs
        // nome completo "Jorge Henrique Correia" (substitui ponto por espaço para comparação).
        const ownerFilter = (syncFilters.ownerLogin || '').toLowerCase().trim();
        if (ownerFilter) {
            const ownerFilterNorm = ownerFilter.replace(/\./g, ' ');
            const matchOwner = (field) => {
                if (!field) return false;
                const f = field.toLowerCase().trim();
                const fNorm = f.replace(/\./g, ' ');
                return f === ownerFilter || fNorm === ownerFilterNorm ||
                       f.includes(ownerFilter) || ownerFilter.includes(f) ||
                       fNorm.includes(ownerFilterNorm) || ownerFilterNorm.includes(fNorm);
            };
            const antes = results.length;
            const filtered = results.filter(t => matchOwner(t.Owner) || matchOwner(t.Responsible));
            console.log(`[OTOBO] Filtro de proprietário "${ownerFilter}": ${antes} → ${filtered.length} ticket(s)`);
            if (filtered.length === 0 && antes > 0) {
                // Amostrar owners únicos para diagnóstico
                const owners = [...new Set(results.slice(0, 20).map(t => t.Owner || t.Responsible || '(vazio)'))];
                console.warn(`[OTOBO] Nenhum ticket correspondeu ao filtro. Owners encontrados:`, owners);
            }
            return { tickets: filtered, foundIds: ticketIds.length, denied: totalDenied };
        }

        return { tickets: results, foundIds: ticketIds.length, denied: totalDenied };
    }

    _mapTicketsToRows(otoboTickets, clients) {
        const normalize = s => (s || '').toLowerCase().trim();
        return otoboTickets.map(t => {
            const customerId = normalize(t.CustomerID || '');
            const customerUserNorm = normalize(t.CustomerUserID || t.CustomerID || '');
            // Prioridade 1: match exato por otobo_customer_id (suporta múltiplos separados por vírgula)
            let linked = customerId
                ? clients.find(c => {
                    if (!c.otoboCustomerId) return false;
                    return c.otoboCustomerId.split(',').map(s => normalize(s)).includes(customerId);
                })
                : null;
            // Prioridade 2: fallback fuzzy por nome
            if (!linked) {
                linked = customerUserNorm ? clients.find(c => {
                    const cn = normalize(c.name);
                    return cn === customerUserNorm || cn.includes(customerUserNorm) || customerUserNorm.includes(cn);
                }) : null;
            }
            return {
                user_id: store.userId,
                ticket_id: String(t.TicketID),
                ticket_number: t.TicketNumber || '',
                title: t.Title || '',
                status: t.State || '',
                priority: t.Priority || '',
                queue: t.Queue || '',
                ticket_type: t.Type || '',
                customer_name: t.CustomerUserID || t.CustomerID || '',
                owner: t.Owner || t.Responsible || '',
                created_at_otobo: t.Created || null,
                updated_at_otobo: t.Changed || null,
                raw_data: t,
                linked_client_id: linked ? linked.id : null,
                synced_at: new Date().toISOString()
            };
        });
    }

    openOtoboConfigModal() {
        const cfg = this._otoboConfig;
        document.getElementById('otobo-url').value = cfg?.url || '';
        document.getElementById('otobo-username').value = cfg?.username || '';
        document.getElementById('otobo-password').value = cfg?.password || '';
        const sf = cfg?.syncFilters || {};
        document.getElementById('sync-filter-queues').value  = (sf.queues  || []).join('\n');
        document.getElementById('sync-filter-states').value  = (sf.states  || []).join('\n');
        document.getElementById('sync-filter-types').value   = (sf.types   || []).join('\n');
        document.getElementById('sync-filter-owner').value   = sf.ownerLogin || '';
        document.getElementById('sync-filter-limit').value   = sf.limit || 100;
        this.switchOtoboTab('conexao');
        this.openModal('modal-otobo-config');
    }

    async saveOtoboConfig() {
        const url = document.getElementById('otobo-url').value.trim();
        const username = document.getElementById('otobo-username').value.trim();
        const password = document.getElementById('otobo-password').value;
        if (!url || !username || !password) {
            Toast.show('Preencha todos os campos na aba Conexão.', 'error');
            this.switchOtoboTab('conexao');
            return;
        }
        const parseLines = id => document.getElementById(id).value
            .split('\n').map(s => s.trim()).filter(Boolean);
        const syncFilters = {
            queues:     parseLines('sync-filter-queues'),
            states:     parseLines('sync-filter-states'),
            types:      parseLines('sync-filter-types'),
            ownerLogin: document.getElementById('sync-filter-owner').value.trim(),
            limit:      parseInt(document.getElementById('sync-filter-limit').value) || 100
        };
        try {
            await store.saveOtoboConfig(url, username, password, syncFilters);
            this._otoboConfig = { url, username, password, syncFilters };
            Toast.show('Configurações salvas!', 'success');
            this.closeModal('modal-otobo-config');
            await this.renderChamados();
        } catch (err) {
            Toast.show('Erro ao salvar: ' + err.message, 'error');
        }
    }

    // ─── WhatsApp Bot ───────────────────────────────────────────────────────

    async openWhatsappConfig() {
        try {
            const profile = await store.getWhatsappProfile();
            document.getElementById('whatsapp-number').value = profile?.whatsappNumber || '';
        } catch (_) {
            document.getElementById('whatsapp-number').value = '';
        }
        this.openModal('modal-whatsapp-config');
    }

    async saveWhatsappConfig() {
        const number = document.getElementById('whatsapp-number').value.replace(/\D/g, '');
        if (number && (number.length < 10 || number.length > 15)) {
            Toast.show('Número inválido. Use formato internacional (ex: 5541999887766)', 'error');
            return;
        }
        try {
            await store.saveWhatsappProfile(number);
            Toast.show('Número salvo com sucesso!', 'success');
            this.closeModal('modal-whatsapp-config');
            if (number) {
                try {
                    const session = await window.supabaseClient.auth.getSession();
                    const token = session?.data?.session?.access_token;
                    if (token) {
                        const supabaseUrl = window.TSP_CONFIG?.SUPABASE_URL || '';
                        await fetch(`${supabaseUrl}/functions/v1/whatsapp-bot`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                            body: JSON.stringify({ action: 'welcome' }),
                        });
                    }
                } catch (_) { /* silencioso — número já foi salvo */ }
            }
        } catch (err) {
            Toast.show('Erro ao salvar: ' + err.message, 'error');
        }
    }


    async openChamadoModal(ticket) {
        this._currentTicket = ticket;
        document.getElementById('chamado-modal-title').textContent = `#${ticket.ticketNumber || ticket.ticketId} — ${ticket.title}`;

        const linkEl = document.getElementById('chamado-otobo-link');
        if (this._otoboConfig?.url) {
            const base = this._otoboConfig.url.replace(/\/$/, '');
            linkEl.href = `${base}/otobo/index.pl?Action=AgentTicketZoom;TicketID=${ticket.ticketId}`;
            linkEl.style.display = '';
        } else {
            linkEl.style.display = 'none';
        }

        // Sidebar
        document.getElementById('chamado-sidebar-info').innerHTML = `
            <div class="chamado-sidebar-row">
                <span class="chamado-sidebar-label">Status</span>
                <span class="chamado-sidebar-value"><span class="ticket-badge ${this._ticketStatusClass(ticket.status)}">${escapeHtml(ticket.status)}</span></span>
            </div>
            <div class="chamado-sidebar-row">
                <span class="chamado-sidebar-label">Prioridade</span>
                <span class="chamado-sidebar-value"><span class="ticket-badge ${this._ticketPriorityClass(ticket.priority)}">${escapeHtml(ticket.priority)}</span></span>
            </div>
            <div class="chamado-sidebar-row">
                <span class="chamado-sidebar-label">Fila</span>
                <span class="chamado-sidebar-value">${escapeHtml(ticket.queue || '—')}</span>
            </div>
            <div class="chamado-sidebar-row">
                <span class="chamado-sidebar-label">Responsável</span>
                <span class="chamado-sidebar-value">${escapeHtml(ticket.owner || '—')}</span>
            </div>
            ${ticket.ticketType ? `
            <div class="chamado-sidebar-row">
                <span class="chamado-sidebar-label">Tipo</span>
                <span class="chamado-sidebar-value">${escapeHtml(ticket.ticketType)}</span>
            </div>` : ''}
            <div class="chamado-sidebar-row">
                <span class="chamado-sidebar-label">Cliente OTOBO</span>
                <span class="chamado-sidebar-value">${escapeHtml(ticket.customerName || '—')}</span>
            </div>
            <div class="chamado-sidebar-row">
                <span class="chamado-sidebar-label">Aberto em</span>
                <span class="chamado-sidebar-value">${ticket.createdAtOtobo ? new Date(ticket.createdAtOtobo).toLocaleString('pt-BR') : '—'}</span>
            </div>
            <div class="chamado-sidebar-row">
                <span class="chamado-sidebar-label">Atualizado</span>
                <span class="chamado-sidebar-value">${ticket.updatedAtOtobo ? new Date(ticket.updatedAtOtobo).toLocaleString('pt-BR') : '—'}</span>
            </div>
        `;
        lucide.createIcons();

        // Artigos (carregados on-demand)
        const artContainer = document.getElementById('chamado-articles-content');
        artContainer.innerHTML = spinnerHtml;
        this.openModal('modal-chamado');

        try {
            const articles = await this._fetchTicketArticles(ticket.ticketId);
            if (!articles.length) {
                artContainer.innerHTML = '<p class="text-muted" style="padding:16px 0;">Nenhuma mensagem encontrada.</p>';
                return;
            }
            artContainer.innerHTML = articles.map(a => `
                <div class="chamado-article">
                    <div class="chamado-article-header">
                        <span class="chamado-article-from">${escapeHtml(a.From || a.SenderType || '—')}</span>
                        <span class="chamado-article-date">${a.Created ? new Date(a.Created).toLocaleString('pt-BR') : ''}</span>
                    </div>
                    <div class="chamado-article-body">${escapeHtml(a.Body || '')}</div>
                </div>
            `).join('');
        } catch (err) {
            // Se falhar, mostra os dados do cache (raw_data pode ter artigos)
            artContainer.innerHTML = `<p class="text-muted" style="padding:16px 0;">Não foi possível carregar as mensagens: ${escapeHtml(err.message)}</p>`;
        }
    }

    async _fetchTicketArticles(ticketId) {
        if (!this._otoboConfig?.url) return [];
        const data = await this._otoboProxyFetch('articles', { ticketId });
        const ticket = (data.Ticket || [])[0];
        return ticket?.Article || [];
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
            window.app._dashboardMonth = new Date().toISOString().slice(0, 7);
            window.app.agendaCurrentDate = new Date();
            window.app.pendingPdfRecords = [];
            window.app.pendingPdfWarnings = [];
            if (window.app._googleSyncInterval) {
                clearInterval(window.app._googleSyncInterval);
                window.app._googleSyncInterval = null;
            }
            window.app._lastGoogleSync = 0;
            window.app._otoboConfig = null;
            window.app._currentTicket = null;
            window.app._cachedChamadosTickets = null;
            window.app._cachedChamadosClients = null;
            window.app._chamadoFiltersAttached = false;
            window.app._whatsappProfile = null;
        }
        if (window.aiClient) aiClient.reset();
        await Auth.signOut();
    });
});
