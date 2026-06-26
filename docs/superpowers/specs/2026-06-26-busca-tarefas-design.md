# Design: Busca textual em Tarefas (Kanban)

## Contexto

A view Tarefas (Kanban) hoje só tem filtros estruturados — Cliente, Prioridade, Label — sem nenhuma forma de buscar por palavra/tema livre. O board Kanban exige um Cliente selecionado para aparecer; sem cliente, mostra só um placeholder. Isso impede achar rapidamente uma tarefa específica quando o usuário não lembra de qual cliente ela é, ou quando quer varrer o texto (título/descrição/comentários) por um termo.

Esta feature adiciona um campo de busca textual livre que reaproveita o cache de tarefas já carregado (`_tasksCache`), sem queries novas.

## Decisões

- **Escopo da busca**: funciona com ou sem Cliente selecionado. Com cliente: refina o board Kanban (mais um filtro, como Prioridade/Label). Sem cliente: substitui o placeholder atual por uma lista de resultados entre todos os clientes.
- **Campos buscados**: `title`, `description` e `comments[].text` (apenas itens com `type === 'comment'`; entradas de log de atividade são ignoradas pois não têm texto livre).
- **Casamento de termo**: substring, case-insensitive, **insensível a acento** (normaliza removendo diacríticos nos dois lados — relevante para PT-BR).
- **Disparo da busca**: ao pressionar `Enter` no campo. Sem debounce/live-typing — decisão explícita do usuário para evitar re-render a cada tecla.
- **Combinação com filtros existentes**: Cliente, Prioridade e Label continuam aplicando normalmente (AND) junto com o termo de busca.
- **Clique em resultado (modo lista, sem cliente)**: abre direto `app.handleEditTask(id)` — já é self-contained (busca a task e as colunas do cliente certo por conta própria), sem precisar trocar o filtro de Cliente.
- **Sem query nova**: `store.getTasks()` já busca *todas* as tarefas do usuário (`select('*')`, sem filtro de cliente) e popula `_tasksCache` mesmo quando o filtro de Cliente está vazio. A busca roda 100% client-side sobre esse cache.

## UI (`index.html`)

Novo `form-group` dentro de `.kanban-filters`, após o filtro de Label:

```html
<div class="form-group">
    <label>Buscar</label>
    <input type="text" id="filter-task-search" class="form-control"
           placeholder="Título, descrição ou comentário..."
           onkeydown="if(event.key==='Enter') app.renderTasks()">
</div>
```

`clearKanbanFilters()` (já existente) passa a também limpar `#filter-task-search` e reexecutar `renderTasks()`.

## Lógica de filtragem (`js/app.js`)

Função utilitária nova, `_taskMatchesSearch(task, normalizedTerm)`:

```js
_normalizeSearch(s) {
    return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

_taskMatchesSearch(task, term) {
    if (!term) return true;
    const haystack = [
        task.title,
        task.description,
        ...(task.comments || []).filter(c => c.type === 'comment').map(c => c.text)
    ].map(s => this._normalizeSearch(s)).join(' ');
    return haystack.includes(term);
}
```

Em `renderTasks()` e `_renderTasksFromCache()`:

1. Lê `const searchTerm = this._normalizeSearch(document.getElementById('filter-task-search')?.value || '');`
2. Aplica `tasks.filter(t => this._taskMatchesSearch(t, searchTerm))` junto aos filtros de Prioridade/Label já existentes (mesma cadeia de `.filter()`).
3. **Ramo sem Cliente selecionado**: se `searchTerm` não vazio, em vez do placeholder atual, filtra `this._tasksCache` pelo termo (+ Prioridade/Label, se setados) e chama `_renderTaskSearchResultsList(filtered, this._clientsMapCache)`. Se `searchTerm` vazio, comportamento atual (placeholder) é mantido.

## Modo lista — `_renderTaskSearchResultsList(tasks, clientsMap)`

Substitui o conteúdo de `#kanban-board` por uma tabela simples (reaproveitando classes de tabela já existentes no projeto, ex. `.data-table`):

| Título | Cliente | Prioridade | Concluída? |
|---|---|---|---|
| título da tarefa | nome do cliente (via `clientsMap[t.clientId]`) ou "—" | badge colorido (igual ao já usado no card Kanban) | ✓ / — (usa `t.completed`, sem resolver nome da coluna Kanban — evita N queries de `kanban_columns` por cliente diferente) |

Cada `<tr>` tem `onclick="app.handleEditTask('${t.id}')"` e cursor pointer. Mensagem de "nenhum resultado encontrado" quando o array filtrado está vazio. Ao final, chama `lucide.createIcons()` se houver ícones (ex. ícone de prioridade).

## Fora de escopo

- Live search com debounce — descartado, busca só dispara no Enter.
- Busca em Labels (nome da etiqueta) — descartado; só título/descrição/comentários.
- Resolver e exibir o nome real da coluna Kanban (status) na lista de resultados — descartado para não introduzir N queries de `kanban_columns`; usa apenas o booleano `completed`.
- Highlight do termo encontrado no resultado — não solicitado, fora de escopo.
- Alterar `handleEditTask` ou o fluxo do modal de edição — reaproveitado como está.

## Arquivos afetados

- `index.html`: novo campo `#filter-task-search` em `.kanban-filters`.
- `js/app.js`: `renderTasks()`, `_renderTasksFromCache()`, `clearKanbanFilters()`, novos métodos `_normalizeSearch()`, `_taskMatchesSearch()`, `_renderTaskSearchResultsList()`.
- `CLAUDE.md`: documentar a armadilha de que a busca depende de `_tasksCache` conter sempre todas as tarefas (não só as do cliente filtrado), e que o modo lista usa `completed` em vez do nome da coluna Kanban.
