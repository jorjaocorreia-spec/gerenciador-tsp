# FASE 2 — Arquitetura: Kanban Trello-like

**Data:** 2026-05-26  
**Baseado em:** FASE1-reverse-engineering.md  
**Escopo:** SQL migrations, store.js, HTML, CSS tokens, componentes vanilla JS  
**Princípio:** Melhorar a UX do Kanban existente sem mudar o stack (vanilla JS + Supabase)

---

## 1. Decisões de Arquitetura

### O que mudar vs. preservar

| Aspecto | Decisão | Justificativa |
|---------|---------|---------------|
| 3 colunas fixas (new/doing/done) | **Manter** | Alinhado ao fluxo de trabalho do negócio |
| Campo `status` como discriminador de coluna | **Manter** | Sem nova tabela `kanban_columns` — menos complexity |
| Native HTML5 DnD | **Melhorar** | Adicionar `position` para ordenação persistente correta |
| Modal único 600px | **Redesenhar** | Dois painéis: conteúdo à esquerda, ações à direita |
| store.js async/await pattern | **Manter** | Consistente com o projeto todo |
| Filtros existentes (cliente, prioridade) | **Manter e expandir** | Adicionar filtro de label |

### Novas funcionalidades priorizadas

| Feature | Prioridade | Complexidade | Valor |
|---------|-----------|-------------|-------|
| Ordenação persistente por posição | CRÍTICA | Média | Alto — DnD funciona corretamente |
| Quick-add inline por coluna | ALTA | Baixa | Alto — fluxo mais rápido |
| Modal dois painéis | ALTA | Média | Alto — melhor acesso a metadados |
| Labels coloridas | ALTA | Baixa | Alto — identificação visual |
| Checklist (subtarefas) | MÉDIA | Média | Alto — funcionalidade mais pedida |
| Cover color | BAIXA | Baixa | Médio — visual atrativo |

---

## 2. SQL Migrations

### 2.1 Alterações na tabela `tasks`

```sql
-- Executar no Supabase SQL Editor
-- Migration: Kanban Fase 2 — campos extras para UX Trello-like

ALTER TABLE tasks 
  ADD COLUMN IF NOT EXISTS position INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS labels JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS checklist JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS cover_color TEXT DEFAULT NULL;

-- Índice para ordenação eficiente por coluna
CREATE INDEX IF NOT EXISTS idx_tasks_user_status_position 
  ON tasks (user_id, status, position);

-- Inicializar position com base em created_at para tasks existentes
-- (dentro de cada status, mais antigo = menor position)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY user_id, status ORDER BY created_at) - 1 AS new_pos
  FROM tasks
)
UPDATE tasks SET position = ranked.new_pos
FROM ranked
WHERE tasks.id = ranked.id;
```

### 2.2 Estrutura dos campos JSONB

**`labels`** — array de objetos com cor e texto opcional:
```json
[
  { "color": "#4a9eff", "text": "Frontend" },
  { "color": "#ff6b6b", "text": "Urgente" },
  { "color": "#51cf66", "text": "" }
]
```

**`checklist`** — array de itens com UUID local:
```json
[
  { "id": "cl-1", "text": "Levantar requisitos", "done": true },
  { "id": "cl-2", "text": "Implementar tela", "done": false },
  { "id": "cl-3", "text": "Validar com cliente", "done": false }
]
```

**`cover_color`** — string de cor hex ou null:
```
"#4a9eff" | "#ff6b6b" | "#51cf66" | "#ffd43b" | "#cc5de8" | null
```

### 2.3 RLS — sem alteração necessária

A policy existente `auth.uid() = user_id` cobre os novos campos automaticamente. As colunas novas ficam isoladas por usuário sem mudança nas policies.

---

## 3. Atualização do store.js

### 3.1 Mapper `_task()` — atualizado

```javascript
_task(r) {
    return {
        id: r.id,
        clientId: r.client_id,
        title: r.title,
        description: r.description || '',
        status: r.status || 'new',
        priority: r.priority || 'medium',
        position: parseInt(r.position) || 0,
        labels: Array.isArray(r.labels) ? r.labels : [],
        checklist: Array.isArray(r.checklist) ? r.checklist : [],
        coverColor: r.cover_color || null,
        dueDate: r.due_date || '',
        estimatedMinutes: parseInt(r.estimated_minutes) || 0,
        spentMinutes: parseInt(r.spent_minutes) || 0,
        attachments: Array.isArray(r.attachments) ? r.attachments : [],
        createdAt: r.created_at,
        updatedAt: r.updated_at
    };
}
```

### 3.2 `getTasks()` — ordenação por posição

```javascript
async getTasks() {
    const { data, error } = await this.db.from('tasks').select('*')
        .eq('user_id', this.userId)
        .order('status')
        .order('position');
    if (error) throw error;
    return data.map(r => this._task(r));
}
```

### 3.3 `addTask()` — com position automática

```javascript
async addTask(taskData) {
    // Calcula a próxima position para o status alvo
    const { data: existing } = await this.db.from('tasks')
        .select('position')
        .eq('user_id', this.userId)
        .eq('status', taskData.status || 'new')
        .order('position', { ascending: false })
        .limit(1);
    const nextPosition = existing && existing.length > 0 
        ? (existing[0].position + 1) 
        : 0;

    const { data, error } = await this.db.from('tasks').insert({
        user_id: this.userId,
        client_id: taskData.clientId || null,
        title: taskData.title,
        description: taskData.description || '',
        status: taskData.status || 'new',
        priority: taskData.priority || 'medium',
        position: nextPosition,
        labels: taskData.labels || [],
        checklist: taskData.checklist || [],
        cover_color: taskData.coverColor || null,
        due_date: taskData.dueDate || null,
        estimated_minutes: parseInt(taskData.estimatedMinutes) || 0,
        spent_minutes: 0,
        attachments: taskData.attachments || []
    }).select().single();
    if (error) throw error;
    return this._task(data);
}
```

### 3.4 `updateTask()` — inclui novos campos

```javascript
async updateTask(taskData) {
    const { data, error } = await this.db.from('tasks').update({
        client_id: taskData.clientId || null,
        title: taskData.title,
        description: taskData.description || '',
        status: taskData.status,
        priority: taskData.priority,
        position: taskData.position,
        labels: taskData.labels || [],
        checklist: taskData.checklist || [],
        cover_color: taskData.coverColor || null,
        due_date: taskData.dueDate || null,
        estimated_minutes: parseInt(taskData.estimatedMinutes) || 0,
        updated_at: new Date().toISOString(),
        attachments: taskData.attachments || []
    }).eq('id', taskData.id).eq('user_id', this.userId).select().single();
    if (error) throw error;
    return this._task(data);
}
```

### 3.5 `reorderTasks()` — NOVO método para DnD

Atualiza posições e status em lote após um drop. Usa `upsert` para eficiência.

```javascript
async reorderTasks(updates) {
    // updates: [{id, status, position}]
    const rows = updates.map(u => ({
        id: u.id,
        user_id: this.userId,
        status: u.status,
        position: u.position,
        updated_at: new Date().toISOString()
    }));
    const { error } = await this.db.from('tasks')
        .upsert(rows, { onConflict: 'id', ignoreDuplicates: false });
    if (error) throw error;
}
```

### 3.6 `updateTaskChecklist()` — NOVO método

```javascript
async updateTaskChecklist(id, checklist) {
    const { data, error } = await this.db.from('tasks').update({
        checklist,
        updated_at: new Date().toISOString()
    }).eq('id', id).eq('user_id', this.userId).select().single();
    if (error) throw error;
    return this._task(data);
}
```

---

## 4. Estrutura HTML — Board

### 4.1 Filtros expandidos

```html
<!-- Área de Filtros Kanban — substituir o div existente -->
<div class="kanban-filters glass">
    <div class="form-group">
        <label>Cliente</label>
        <select id="filter-task-client" class="form-control" onchange="app.renderTasks()">
            <option value="">Todos</option>
        </select>
    </div>
    <div class="form-group">
        <label>Prioridade</label>
        <select id="filter-task-priority" class="form-control" onchange="app.renderTasks()">
            <option value="">Todas</option>
            <option value="high">Alta</option>
            <option value="medium">Média</option>
            <option value="low">Baixa</option>
        </select>
    </div>
    <div class="form-group">
        <label>Label</label>
        <select id="filter-task-label" class="form-control" onchange="app.renderTasks()">
            <option value="">Todas</option>
        </select>
    </div>
    <div class="kanban-filters-actions">
        <button class="btn btn-sm btn-ghost" onclick="app.clearKanbanFilters()">
            <i data-lucide="x"></i> Limpar
        </button>
    </div>
</div>
```

### 4.2 Board com 3 colunas — estrutura nova

```html
<!-- KANBAN BOARD — substituir o div.kanban-board existente -->
<div class="kanban-board" id="kanban-board">

    <!-- Coluna Novas -->
    <div class="kb-column" data-status="new">
        <div class="kb-column-header">
            <div class="kb-column-title">
                <span class="kb-column-dot" style="background: var(--kb-color-new)"></span>
                <h3>Novas</h3>
                <span class="kb-count" id="kb-count-new">0</span>
            </div>
            <button class="kb-header-add" onclick="app.openQuickAdd('new')" title="Adicionar card">
                <i data-lucide="plus"></i>
            </button>
        </div>
        <div class="kb-dropzone" id="kb-col-new" data-status="new"
             ondragover="app.allowDrop(event)" ondrop="app.dropTask(event)">
            <!-- Cards inseridos via JS -->
        </div>
        <!-- Quick-add form (oculto por padrão) -->
        <div class="kb-quick-add" id="kb-quick-add-new" style="display:none">
            <textarea class="kb-quick-add-input" placeholder="Título do card..."
                      onkeydown="app.handleQuickAddKey(event, 'new')"></textarea>
            <div class="kb-quick-add-actions">
                <button class="btn btn-sm btn-primary" onclick="app.submitQuickAdd('new')">Adicionar</button>
                <button class="btn btn-sm btn-ghost" onclick="app.closeQuickAdd('new')">
                    <i data-lucide="x"></i>
                </button>
            </div>
        </div>
        <button class="kb-add-card-btn" id="kb-add-btn-new" onclick="app.openQuickAdd('new')">
            <i data-lucide="plus"></i> Adicionar card
        </button>
    </div>

    <!-- Coluna Em Execução -->
    <div class="kb-column" data-status="doing">
        <div class="kb-column-header">
            <div class="kb-column-title">
                <span class="kb-column-dot" style="background: var(--kb-color-doing)"></span>
                <h3>Em Execução</h3>
                <span class="kb-count" id="kb-count-doing">0</span>
            </div>
            <button class="kb-header-add" onclick="app.openQuickAdd('doing')" title="Adicionar card">
                <i data-lucide="plus"></i>
            </button>
        </div>
        <div class="kb-dropzone" id="kb-col-doing" data-status="doing"
             ondragover="app.allowDrop(event)" ondrop="app.dropTask(event)">
        </div>
        <div class="kb-quick-add" id="kb-quick-add-doing" style="display:none">
            <textarea class="kb-quick-add-input" placeholder="Título do card..."
                      onkeydown="app.handleQuickAddKey(event, 'doing')"></textarea>
            <div class="kb-quick-add-actions">
                <button class="btn btn-sm btn-primary" onclick="app.submitQuickAdd('doing')">Adicionar</button>
                <button class="btn btn-sm btn-ghost" onclick="app.closeQuickAdd('doing')">
                    <i data-lucide="x"></i>
                </button>
            </div>
        </div>
        <button class="kb-add-card-btn" id="kb-add-btn-doing" onclick="app.openQuickAdd('doing')">
            <i data-lucide="plus"></i> Adicionar card
        </button>
    </div>

    <!-- Coluna Finalizadas -->
    <div class="kb-column" data-status="done">
        <div class="kb-column-header">
            <div class="kb-column-title">
                <span class="kb-column-dot" style="background: var(--kb-color-done)"></span>
                <h3>Finalizadas</h3>
                <span class="kb-count" id="kb-count-done">0</span>
            </div>
            <button class="kb-header-add" onclick="app.openQuickAdd('done')" title="Adicionar card">
                <i data-lucide="plus"></i>
            </button>
        </div>
        <div class="kb-dropzone" id="kb-col-done" data-status="done"
             ondragover="app.allowDrop(event)" ondrop="app.dropTask(event)">
        </div>
        <div class="kb-quick-add" id="kb-quick-add-done" style="display:none">
            <textarea class="kb-quick-add-input" placeholder="Título do card..."
                      onkeydown="app.handleQuickAddKey(event, 'done')"></textarea>
            <div class="kb-quick-add-actions">
                <button class="btn btn-sm btn-primary" onclick="app.submitQuickAdd('done')">Adicionar</button>
                <button class="btn btn-sm btn-ghost" onclick="app.closeQuickAdd('done')">
                    <i data-lucide="x"></i>
                </button>
            </div>
        </div>
        <button class="kb-add-card-btn" id="kb-add-btn-done" onclick="app.openQuickAdd('done')">
            <i data-lucide="plus"></i> Adicionar card
        </button>
    </div>

</div>
```

### 4.3 Card HTML gerado via JS (template)

```html
<!-- Gerado por createKanbanCard(task, clientsMap) em app.js -->
<div class="kb-card" draggable="true" data-id="{{task.id}}">

    <!-- Cover color opcional -->
    <!-- Se coverColor: <div class="kb-card-cover" style="background: {{task.coverColor}}"></div> -->
    
    <!-- Labels -->
    <!-- Se labels.length > 0: -->
    <div class="kb-card-labels">
        <span class="kb-label" style="background: #4a9eff">Frontend</span>
        <span class="kb-label" style="background: #ff6b6b">Urgente</span>
    </div>
    
    <!-- Título -->
    <p class="kb-card-title">{{task.title}}</p>
    
    <!-- Badges de metadados -->
    <div class="kb-card-badges">
        <!-- Prioridade -->
        <span class="kb-badge kb-badge-priority-high">
            <i data-lucide="arrow-up" style="width:10px;height:10px"></i> Alta
        </span>
        
        <!-- Due date -->
        <span class="kb-badge kb-badge-due-overdue">
            <i data-lucide="clock" style="width:10px;height:10px"></i> 15/06
        </span>
        
        <!-- Checklist -->
        <span class="kb-badge">
            <i data-lucide="check-square" style="width:10px;height:10px"></i> 2/5
        </span>
        
        <!-- Anexos -->
        <span class="kb-badge">
            <i data-lucide="paperclip" style="width:10px;height:10px"></i> 3
        </span>
    </div>
    
    <!-- Footer: cliente + ações hover -->
    <div class="kb-card-footer">
        <span class="kb-card-client">{{clientName}}</span>
        <!-- Ações visíveis no hover via CSS :hover -->
        <div class="kb-card-actions">
            <button class="kb-action-btn" onclick="app.handleEditTask('{{task.id}}')" title="Editar">
                <i data-lucide="pencil" style="width:12px;height:12px"></i>
            </button>
            <button class="kb-action-btn kb-action-danger" onclick="app.handleDeleteTask('{{task.id}}')" title="Excluir">
                <i data-lucide="trash-2" style="width:12px;height:12px"></i>
            </button>
        </div>
    </div>

</div>
```

---

## 5. Modal Dois Painéis — HTML

```html
<!-- MODAL: TAREFA — substituir o modal-task existente -->
<div class="modal-overlay" id="modal-task">
    <div class="modal modal-task-two-panel glass">

        <!-- Cover bar (visível apenas se coverColor definido) -->
        <div class="modal-task-cover" id="modal-task-cover" style="display:none"></div>

        <!-- Header -->
        <div class="modal-header">
            <div class="modal-task-header-info">
                <span class="modal-task-column-label" id="modal-task-column-label">Novas</span>
                <textarea class="modal-task-title-input" id="task-title" 
                          placeholder="Título da tarefa..." rows="2"></textarea>
            </div>
            <button class="close-modal" onclick="app.closeModal('modal-task')">
                <i data-lucide="x"></i>
            </button>
        </div>

        <!-- Body: dois painéis -->
        <div class="modal-task-body">

            <!-- Painel Esquerdo: conteúdo principal -->
            <div class="modal-task-main">
                <input type="hidden" id="task-id" value="">

                <!-- Labels aplicadas -->
                <div class="modal-task-section" id="modal-task-labels-applied">
                    <h4 class="modal-task-section-label">Labels</h4>
                    <div class="kb-labels-applied" id="kb-labels-applied">
                        <!-- Labels aplicadas aparecem aqui -->
                    </div>
                </div>

                <!-- Descrição -->
                <div class="modal-task-section">
                    <h4 class="modal-task-section-label">
                        <i data-lucide="align-left" style="width:14px;height:14px"></i> Descrição
                    </h4>
                    <textarea id="task-description" class="form-control" rows="4"
                              placeholder="Adicione uma descrição mais detalhada..."></textarea>
                </div>

                <!-- Checklist -->
                <div class="modal-task-section" id="modal-checklist-section">
                    <div class="modal-checklist-header">
                        <h4 class="modal-task-section-label">
                            <i data-lucide="check-square" style="width:14px;height:14px"></i> Checklist
                        </h4>
                        <span class="modal-checklist-progress" id="modal-checklist-progress">0/0</span>
                    </div>
                    <div class="modal-checklist-bar">
                        <div class="modal-checklist-bar-fill" id="modal-checklist-bar-fill" style="width:0%"></div>
                    </div>
                    <div id="modal-checklist-items">
                        <!-- Itens renderizados via JS -->
                    </div>
                    <div class="modal-checklist-add">
                        <input type="text" id="modal-checklist-new-item" class="form-control"
                               placeholder="Adicionar item..."
                               onkeydown="app.handleChecklistItemKey(event)">
                        <button class="btn btn-sm btn-secondary" onclick="app.addChecklistItem()">
                            Adicionar
                        </button>
                    </div>
                </div>

                <!-- Anexos -->
                <div class="modal-task-section">
                    <h4 class="modal-task-section-label">
                        <i data-lucide="paperclip" style="width:14px;height:14px"></i> Anexos
                    </h4>
                    <div class="task-attachments-grid" id="task-attachments-grid"></div>
                    <div class="attachment-hint">
                        <i data-lucide="clipboard" style="width:12px;height:12px"></i>
                        Cole imagens com Ctrl+V ou
                        <label class="attachment-file-label">
                            selecione arquivo
                            <input type="file" id="task-attachment-file" accept="image/*" 
                                   style="display:none" onchange="app.handleTaskAttachmentFile(event)">
                        </label>
                    </div>
                </div>
            </div>

            <!-- Painel Direito: ações e metadados -->
            <div class="modal-task-sidebar">

                <!-- Mover para coluna -->
                <div class="modal-sidebar-section">
                    <h5 class="modal-sidebar-label">Mover para</h5>
                    <div class="modal-sidebar-col-buttons">
                        <button class="kb-col-btn" data-status="new" onclick="app.moveTaskToColumn('new')">
                            <span class="kb-column-dot" style="background: var(--kb-color-new)"></span> Novas
                        </button>
                        <button class="kb-col-btn" data-status="doing" onclick="app.moveTaskToColumn('doing')">
                            <span class="kb-column-dot" style="background: var(--kb-color-doing)"></span> Em Execução
                        </button>
                        <button class="kb-col-btn" data-status="done" onclick="app.moveTaskToColumn('done')">
                            <span class="kb-column-dot" style="background: var(--kb-color-done)"></span> Finalizadas
                        </button>
                    </div>
                </div>

                <!-- Labels -->
                <div class="modal-sidebar-section">
                    <h5 class="modal-sidebar-label">Labels</h5>
                    <div class="kb-label-picker" id="kb-label-picker">
                        <!-- 8 opções de cor geradas via JS -->
                    </div>
                </div>

                <!-- Cover -->
                <div class="modal-sidebar-section">
                    <h5 class="modal-sidebar-label">Cover</h5>
                    <div class="kb-cover-picker" id="kb-cover-picker">
                        <!-- Swatches gerados via JS -->
                        <button class="kb-cover-swatch kb-cover-none active" onclick="app.setCoverColor(null)" title="Sem cover"></button>
                    </div>
                </div>

                <!-- Metadados -->
                <div class="modal-sidebar-section">
                    <h5 class="modal-sidebar-label">Cliente</h5>
                    <select id="task-client" class="form-control form-control-sm">
                        <option value="">Sem cliente</option>
                    </select>
                </div>

                <div class="modal-sidebar-section">
                    <h5 class="modal-sidebar-label">Prioridade</h5>
                    <select id="task-priority" class="form-control form-control-sm">
                        <option value="low">Baixa</option>
                        <option value="medium" selected>Média</option>
                        <option value="high">Alta</option>
                    </select>
                </div>

                <div class="modal-sidebar-section">
                    <h5 class="modal-sidebar-label">Prazo</h5>
                    <input type="date" id="task-due-date" class="form-control form-control-sm">
                </div>

                <div class="modal-sidebar-section">
                    <h5 class="modal-sidebar-label">Tempo estimado (min)</h5>
                    <input type="number" id="task-estimated-minutes" class="form-control form-control-sm"
                           placeholder="Ex: 120">
                </div>

                <!-- Ações -->
                <div class="modal-sidebar-actions">
                    <button class="btn btn-primary btn-block" onclick="app.handleTaskSubmit()">
                        <i data-lucide="save" style="width:14px;height:14px"></i> Salvar
                    </button>
                    <button class="btn btn-ghost btn-block" id="btn-add-time-task"
                            onclick="app.openAddTimeModal()" style="display:none">
                        <i data-lucide="clock" style="width:14px;height:14px"></i> Registrar Tempo
                    </button>
                    <button class="btn btn-danger btn-block" id="btn-delete-task"
                            onclick="app.handleDeleteTaskFromModal()" style="display:none">
                        <i data-lucide="trash-2" style="width:14px;height:14px"></i> Excluir
                    </button>
                </div>

            </div>
        </div>
    </div>
</div>
```

---

## 6. CSS Design Tokens — Kanban

```css
/* ============================================================
   KANBAN DESIGN TOKENS — adicionar em :root no main.css
   ============================================================ */
:root {
    /* Cores das colunas */
    --kb-color-new:   #4a9eff;   /* Azul — Novas */
    --kb-color-doing: #ff922b;   /* Laranja — Em Execução */
    --kb-color-done:  #51cf66;   /* Verde — Finalizadas */

    /* Board */
    --kb-board-gap:      16px;
    --kb-board-padding:  24px;

    /* Coluna */
    --kb-column-width:   280px;
    --kb-column-bg:      rgba(255, 255, 255, 0.04);
    --kb-column-radius:  12px;
    --kb-column-border:  1px solid rgba(255, 255, 255, 0.08);
    --kb-column-padding: 12px;

    /* Card */
    --kb-card-bg:        rgba(255, 255, 255, 0.06);
    --kb-card-bg-hover:  rgba(255, 255, 255, 0.10);
    --kb-card-radius:    8px;
    --kb-card-border:    1px solid rgba(255, 255, 255, 0.10);
    --kb-card-shadow:    0 1px 4px rgba(0, 0, 0, 0.3);
    --kb-card-gap:       8px;
    --kb-card-padding:   12px;

    /* Labels */
    --kb-label-height:   8px;
    --kb-label-radius:   4px;
    --kb-label-min-w:    40px;

    /* Palette de labels (8 cores) */
    --kb-label-blue:     #4a9eff;
    --kb-label-cyan:     #22d3ee;
    --kb-label-green:    #51cf66;
    --kb-label-lime:     #a3e635;
    --kb-label-yellow:   #ffd43b;
    --kb-label-orange:   #ff922b;
    --kb-label-red:      #ff6b6b;
    --kb-label-purple:   #cc5de8;
    --kb-label-gray:     #868e96;
}

/* ============================================================
   BOARD LAYOUT
   ============================================================ */
.kanban-board {
    display: flex;
    gap: var(--kb-board-gap);
    align-items: flex-start;
    overflow-x: auto;
    padding-bottom: var(--kb-board-padding);
    min-height: calc(100vh - 280px);
    scrollbar-width: thin;
}

/* ============================================================
   COLUNA
   ============================================================ */
.kb-column {
    width: var(--kb-column-width);
    min-width: var(--kb-column-width);
    background: var(--kb-column-bg);
    border: var(--kb-column-border);
    border-radius: var(--kb-column-radius);
    display: flex;
    flex-direction: column;
    gap: 0;
    backdrop-filter: blur(8px);
}

.kb-column-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px var(--kb-column-padding) 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.kb-column-title {
    display: flex;
    align-items: center;
    gap: 8px;
}

.kb-column-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
}

.kb-column-title h3 {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
}

.kb-count {
    font-size: 11px;
    background: rgba(255,255,255,0.1);
    color: var(--text-secondary);
    border-radius: 20px;
    padding: 1px 7px;
    font-weight: 500;
}

.kb-header-add {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    opacity: 0;
    transition: opacity 0.15s, background 0.15s;
}

.kb-column:hover .kb-header-add {
    opacity: 1;
}

.kb-header-add:hover {
    background: rgba(255,255,255,0.08);
    color: var(--text-primary);
}

.kb-dropzone {
    padding: var(--kb-column-padding);
    display: flex;
    flex-direction: column;
    gap: var(--kb-card-gap);
    min-height: 60px;
    flex: 1;
    transition: background 0.15s;
}

.kb-dropzone.drag-over {
    background: rgba(74, 158, 255, 0.06);
}

/* ============================================================
   CARD
   ============================================================ */
.kb-card {
    background: var(--kb-card-bg);
    border: var(--kb-card-border);
    border-radius: var(--kb-card-radius);
    box-shadow: var(--kb-card-shadow);
    cursor: pointer;
    transition: background 0.15s, box-shadow 0.15s, transform 0.1s;
    overflow: hidden;
    position: relative;
}

.kb-card:hover {
    background: var(--kb-card-bg-hover);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

.kb-card.dragging {
    opacity: 0.5;
    transform: rotate(2deg);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}

.kb-card.drag-over-above {
    border-top: 2px solid var(--primary-color);
}

.kb-card.drag-over-below {
    border-bottom: 2px solid var(--primary-color);
}

/* Cover */
.kb-card-cover {
    height: 32px;
    width: 100%;
    border-radius: var(--kb-card-radius) var(--kb-card-radius) 0 0;
}

/* Labels */
.kb-card-labels {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 8px var(--kb-card-padding) 0;
}

.kb-label {
    height: var(--kb-label-height);
    min-width: var(--kb-label-min-w);
    border-radius: var(--kb-label-radius);
    opacity: 0.85;
    transition: opacity 0.15s;
}

.kb-label:hover {
    opacity: 1;
}

/* Título */
.kb-card-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.4;
    margin: 0;
    padding: 8px var(--kb-card-padding) 4px;
    word-break: break-word;
}

/* Badges */
.kb-card-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 0 var(--kb-card-padding) 8px;
}

.kb-badge {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(255,255,255,0.08);
    color: var(--text-secondary);
}

.kb-badge-priority-high   { background: rgba(255, 107, 107, 0.15); color: #ff6b6b; }
.kb-badge-priority-medium { background: rgba(255, 146, 43, 0.15);  color: #ff922b; }
.kb-badge-priority-low    { background: rgba(81, 207, 102, 0.15);  color: #51cf66; }
.kb-badge-due-ok          { background: rgba(255,255,255,0.08);    color: var(--text-secondary); }
.kb-badge-due-overdue     { background: rgba(255, 107, 107, 0.2);  color: #ff6b6b; }

/* Footer */
.kb-card-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px var(--kb-card-padding) 8px;
}

.kb-card-client {
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 140px;
}

.kb-card-actions {
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity 0.15s;
}

.kb-card:hover .kb-card-actions {
    opacity: 1;
}

.kb-action-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 3px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    transition: background 0.15s, color 0.15s;
}

.kb-action-btn:hover       { background: rgba(255,255,255,0.1); color: var(--text-primary); }
.kb-action-btn.kb-action-danger:hover { background: rgba(255,107,107,0.2); color: #ff6b6b; }

/* ============================================================
   QUICK-ADD
   ============================================================ */
.kb-quick-add {
    padding: 0 var(--kb-column-padding) 8px;
}

.kb-quick-add-input {
    width: 100%;
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 13px;
    padding: 8px;
    resize: none;
    outline: none;
    font-family: inherit;
}

.kb-quick-add-input:focus {
    border-color: var(--primary-color);
    background: rgba(255,255,255,0.10);
}

.kb-quick-add-actions {
    display: flex;
    gap: 6px;
    margin-top: 6px;
    align-items: center;
}

.kb-add-card-btn {
    width: 100%;
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 13px;
    padding: 8px var(--kb-column-padding);
    text-align: left;
    display: flex;
    align-items: center;
    gap: 6px;
    border-radius: 0 0 var(--kb-column-radius) var(--kb-column-radius);
    transition: background 0.15s, color 0.15s;
}

.kb-add-card-btn:hover {
    background: rgba(255,255,255,0.05);
    color: var(--text-primary);
}

/* ============================================================
   MODAL DOIS PAINÉIS
   ============================================================ */
.modal-task-two-panel {
    max-width: 800px;
    width: 90vw;
    max-height: 90vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
}

.modal-task-cover {
    height: 120px;
    border-radius: var(--border-radius) var(--border-radius) 0 0;
    flex-shrink: 0;
}

.modal-task-header-info {
    flex: 1;
    min-width: 0;
}

.modal-task-column-label {
    font-size: 11px;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    display: block;
    margin-bottom: 4px;
}

.modal-task-title-input {
    width: 100%;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-size: 18px;
    font-weight: 600;
    line-height: 1.3;
    resize: none;
    outline: none;
    font-family: inherit;
    padding: 0;
}

.modal-task-body {
    display: flex;
    gap: 24px;
    overflow: hidden;
    flex: 1;
    padding: 0 24px 24px;
}

.modal-task-main {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding-right: 8px;
}

.modal-task-sidebar {
    width: 180px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow-y: auto;
}

.modal-task-section { display: flex; flex-direction: column; gap: 8px; }
.modal-task-section-label {
    font-size: 12px;
    color: var(--text-secondary);
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
}

.modal-sidebar-section { display: flex; flex-direction: column; gap: 6px; }
.modal-sidebar-label {
    font-size: 11px;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
}

.modal-sidebar-col-buttons {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.kb-col-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 6px;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 12px;
    padding: 6px 10px;
    text-align: left;
    transition: background 0.15s, color 0.15s;
    width: 100%;
}

.kb-col-btn:hover,
.kb-col-btn.active {
    background: rgba(255,255,255,0.10);
    color: var(--text-primary);
}

.modal-sidebar-actions {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: auto;
    padding-top: 16px;
    border-top: 1px solid rgba(255,255,255,0.08);
}

.btn-block { width: 100%; justify-content: center; }
.btn-sm    { font-size: 12px; padding: 5px 10px; }
.btn-ghost {
    background: transparent;
    border: 1px solid rgba(255,255,255,0.15);
    color: var(--text-secondary);
}
.btn-ghost:hover { background: rgba(255,255,255,0.05); }
.btn-danger { background: rgba(255,107,107,0.15); border: 1px solid rgba(255,107,107,0.3); color: #ff6b6b; }
.btn-danger:hover { background: rgba(255,107,107,0.25); }

/* ============================================================
   CHECKLIST
   ============================================================ */
.modal-checklist-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.modal-checklist-progress {
    font-size: 11px;
    color: var(--text-secondary);
}

.modal-checklist-bar {
    height: 4px;
    background: rgba(255,255,255,0.1);
    border-radius: 2px;
    overflow: hidden;
}

.modal-checklist-bar-fill {
    height: 100%;
    background: var(--success-color);
    transition: width 0.3s;
}

.checklist-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 4px 0;
}

.checklist-item input[type="checkbox"] {
    margin-top: 2px;
    accent-color: var(--primary-color);
    cursor: pointer;
}

.checklist-item-text {
    flex: 1;
    font-size: 13px;
    color: var(--text-primary);
    line-height: 1.4;
}

.checklist-item-text.done {
    text-decoration: line-through;
    color: var(--text-secondary);
}

.checklist-item-delete {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 2px;
    border-radius: 3px;
    opacity: 0;
    transition: opacity 0.15s;
    display: flex;
    align-items: center;
}

.checklist-item:hover .checklist-item-delete { opacity: 1; }
.checklist-item-delete:hover { color: #ff6b6b; }

.modal-checklist-add {
    display: flex;
    gap: 8px;
    margin-top: 8px;
}

/* ============================================================
   LABEL PICKER no modal
   ============================================================ */
.kb-label-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.kb-label-option {
    width: 28px;
    height: 28px;
    border-radius: 4px;
    border: 2px solid transparent;
    cursor: pointer;
    transition: border-color 0.15s, transform 0.15s;
}

.kb-label-option:hover { transform: scale(1.1); }
.kb-label-option.selected { border-color: white; }

.kb-labels-applied {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.kb-label-applied-tag {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    color: rgba(0,0,0,0.7);
}

/* ============================================================
   COVER PICKER no modal
   ============================================================ */
.kb-cover-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
}

.kb-cover-swatch {
    width: 28px;
    height: 20px;
    border-radius: 4px;
    border: 2px solid transparent;
    cursor: pointer;
    transition: border-color 0.15s;
}

.kb-cover-swatch:hover { border-color: rgba(255,255,255,0.5); }
.kb-cover-swatch.active { border-color: white; }
.kb-cover-none { background: rgba(255,255,255,0.1); position: relative; }
.kb-cover-none::after { content: "✕"; font-size: 10px; color: var(--text-secondary); 
    position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); }

/* ============================================================
   FILTROS
   ============================================================ */
.kanban-filters {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    align-items: flex-end;
    padding: 16px;
    margin-bottom: 24px;
}

.kanban-filters .form-group {
    flex: 1;
    min-width: 160px;
    margin-bottom: 0;
}

.kanban-filters-actions {
    display: flex;
    align-items: flex-end;
    padding-bottom: 2px;
}
```

---

## 7. Métodos app.js — Contratos

### 7.1 Métodos existentes a reescrever

| Método atual | Substituto | Mudança |
|-------------|-----------|---------|
| `renderTasks()` | `renderTasks()` | Usa novos IDs `.kb-col-*`, chama `createKanbanCard()` |
| `handleEditTask(id)` | `handleEditTask(id)` | Abre modal dois painéis, popula checklist, labels, cover |
| `handleTaskSubmit()` | `handleTaskSubmit()` | Salva labels, checklist, coverColor |
| `dropTask(e)` | `dropTask(e)` | Usa `store.reorderTasks()` para persistir posição |
| `dragStart(e)` | `dragStart(e)` | Sem mudança significativa |

### 7.2 Novos métodos

```javascript
// ── Quick-add por coluna ──────────────────────────────────────
openQuickAdd(status)    // exibe kb-quick-add-{status}, oculta kb-add-btn-{status}
closeQuickAdd(status)   // inverte
submitQuickAdd(status)  // lê textarea, chama store.addTask(), re-render
handleQuickAddKey(e, status) // Enter = submit, Escape = close

// ── Checklist ─────────────────────────────────────────────────
renderChecklist(checklist)        // gera HTML dos itens no modal
addChecklistItem()                // lê input, adiciona ao this._modalChecklist, re-render
toggleChecklistItem(itemId)       // toggle done, atualiza barra de progresso
deleteChecklistItem(itemId)       // remove do array, re-render
updateChecklistProgress()         // atualiza bar-fill e label X/Y
handleChecklistItemKey(e)         // Enter = addChecklistItem()

// ── Labels ────────────────────────────────────────────────────
renderLabelPicker()               // gera swatches no modal sidebar
toggleLabel(color)                // adiciona/remove label do this._modalLabels
renderAppliedLabels()             // atualiza kb-labels-applied no modal

// ── Cover ─────────────────────────────────────────────────────
setCoverColor(color)              // atualiza this._modalCoverColor, preview no modal
renderCoverPicker()               // gera swatches com estado .active

// ── Mover coluna pelo modal ────────────────────────────────────
moveTaskToColumn(status)          // atualiza this._modalStatus, destaca botão ativo

// ── Filtros ───────────────────────────────────────────────────
clearKanbanFilters()              // reseta todos os selects, re-render
populateLabelFilter(tasks)        // preenche #filter-task-label com labels únicas

// ── Utilitários ───────────────────────────────────────────────
createKanbanCard(task, clientsMap) // retorna HTMLElement do card
handleDeleteTaskFromModal()        // lê #task-id, confirma, deleta, fecha modal
```

### 7.3 Estado local do modal (this._modal*)

```javascript
// Inicializado em openModal('modal-task') / handleEditTask()
this._modalTaskId     = null;     // string | null
this._modalStatus     = 'new';    // 'new' | 'doing' | 'done'
this._modalLabels     = [];       // [{color, text}]
this._modalChecklist  = [];       // [{id, text, done}]
this._modalCoverColor = null;     // string | null

// Resetado em closeModal('modal-task')
```

### 7.4 Fluxo do DnD com posição persistente

```javascript
// dropTask(e) — lógica atualizada
async dropTask(e) {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain');
    const targetCol = e.currentTarget; // .kb-dropzone
    const newStatus = targetCol.dataset.status;
    
    // Coletar cards na coluna destino após drop (DOM já atualizado otimisticamente)
    const cardIds = [...targetCol.querySelectorAll('.kb-card')].map(c => c.dataset.id);
    
    // Inserir o card arrastado na posição correta
    // (O elemento já foi movido no DOM pelo handler dragover)
    
    // Montar updates de posição
    const updates = cardIds.map((id, index) => ({
        id,
        status: newStatus,
        position: index
    }));
    
    // Atualizar banco (não bloqueia a UI)
    store.reorderTasks(updates).catch(err => Toast.error('Erro ao salvar ordem'));
    
    // Atualizar contadores
    this._updateColumnCounts();
}
```

---

## 8. Ordem de implementação na Fase 3

```
1. SQL migration no Supabase (2 min — copiar e executar o SQL da seção 2.1)
2. Atualizar _task() mapper no store.js (5 min)
3. Atualizar getTasks(), addTask(), updateTask() no store.js (10 min)
4. Adicionar reorderTasks() e updateTaskChecklist() no store.js (5 min)
5. Substituir HTML do board em index.html (10 min)
6. Substituir HTML do modal em index.html (15 min)
7. Adicionar CSS tokens e estilos em main.css (20 min)
   — remover estilos antigos: .kanban-board, .kanban-column, .task-card, etc.
8. Reescrever renderTasks() + createKanbanCard() em app.js (20 min)
9. Implementar quick-add (openQuickAdd, closeQuickAdd, submitQuickAdd) (10 min)
10. Implementar checklist no modal (renderChecklist, addChecklistItem, etc.) (15 min)
11. Implementar labels (renderLabelPicker, toggleLabel, renderAppliedLabels) (10 min)
12. Implementar cover picker (setCoverColor, renderCoverPicker) (5 min)
13. Implementar moveTaskToColumn() (5 min)
14. Atualizar handleTaskSubmit() e handleEditTask() para novos campos (10 min)
15. Atualizar DnD (dropTask) para usar reorderTasks() (10 min)
16. Atualizar filtros (clearKanbanFilters, populateLabelFilter) (5 min)
17. Remover CSS e métodos do board antigo (10 min)
18. Teste end-to-end: criar, editar, mover, checklist, labels, cover, quick-add
```

**Tempo estimado total: ~2,5 horas**

---

## 9. Análise de Risco e Compatibilidade

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| `position` não populado em tasks existentes | Ordenação incorreta | SQL com ROW_NUMBER() no migration (seção 2.1) |
| `reorderTasks()` upsert sem `user_id` correto | Dados de outro usuário sobrescritos | Incluir `user_id: this.userId` em cada row + RLS como segunda camada |
| Modal antigo sobrescrito — IDs HTML usados em outros lugares | Quebrar referências | Verificar `handleEditTask`, `handleTaskSubmit`, `handleDeleteTask` — manter IDs `task-id`, `task-title` funcionais |
| Testes Playwright — seletores do board antigo | 48 testes falhando | Atualizar seletores `.kanban-column` → `.kb-column`, `.task-card` → `.kb-card` |
| CSS removido — classes usadas inline no HTML | Layout quebrado | Buscar uso de `.task-priority-bar`, `.priority-high` antes de remover |

---

## 10. Artefatos desta fase

| Arquivo | Status |
|---------|--------|
| `FASE2-architecture.md` (este arquivo) | ✅ Criado |
| SQL migration pronto para executar | ✅ Na seção 2.1 |
| HTML do board + modal completo | ✅ Nas seções 4 e 5 |
| CSS tokens + estilos completos | ✅ Na seção 6 |
| Contratos de métodos app.js | ✅ Na seção 7 |
| store.js métodos novos | ✅ Na seção 3 |

**Próximo passo:** Fase 3 — Implementação  
Executar os passos da seção 8 em ordem, um commit por grupo de mudanças.
