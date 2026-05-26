# FASE 1 — Reverse Engineering: Trello UI/UX

**Data de captura:** 2026-05-26  
**Método:** Playwright 1.60.0 — DOM capture, CSS extraction, screenshots, medições  
**Fontes:** trello.com + board público (Trello Development Roadmap)  
**Artefatos:** `screenshots/` (9 imagens) + `trello-dom-analysis.json`  

---

## 1. Visão Geral da Interface

O Trello é uma aplicação SPA (Single Page Application) construída em React com Atlassian Design System. A interface é orientada ao conceito de **Board → List → Card** — três níveis hierárquicos com interações diretas (inline editing, drag-and-drop, click-to-open).

### 1.1 Hierarquia Visual

```
┌─────────────────────────────────────────────────────────────────┐
│  NAVBAR  — logo | nav links | avatar | notificações             │
├─────────────────────────────────────────────────────────────────┤
│  BOARD HEADER — nome do board | membros | filtros | menu        │
├─────────────────────────────────────────────────────────────────┤
│  BOARD CANVAS (scroll horizontal)                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │  LIST    │  │  LIST    │  │  LIST    │  │  + Add list  │   │
│  │──────────│  │──────────│  │──────────│  └──────────────┘   │
│  │  CARD    │  │  CARD    │  │  CARD    │                      │
│  │  CARD    │  │  CARD    │  │          │                      │
│  │  + Add   │  │  + Add   │  │  + Add   │                      │
│  └──────────┘  └──────────┘  └──────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Estrutura Visual — Medições Reais (Playwright)

### 2.1 Board

| Elemento | Valor capturado |
|----------|----------------|
| Background board | `rgba(0,0,0,0)` — depende da imagem/cor do board |
| Board header background | `rgba(0, 0, 0, 0.24)` — overlay translúcido |
| CSS var principal | `--tr-background-list: #f1f2f4` |
| Scroll | horizontal no canvas, vertical em cada lista |
| Overflow | `overflow-x: auto` no canvas |

### 2.2 Coluna (List)

| Propriedade | Valor medido |
|-------------|-------------|
| **Largura** | **272px** (fixa) |
| **Border radius** | **12px** |
| **Background** | **`rgb(241, 242, 244)` — `#f1f2f4`** (cinza claro) |
| **Box shadow** | `rgba(30,31,33,0.25) 0px 1px 1px 0px, rgba(30,31,33,0.31) 0px 0px 1px 0px` |
| Padding | `0px 0px 4px` |
| Font size | 14px |
| Font weight | 400 |
| Color (texto) | `rgb(80, 82, 88)` |

### 2.3 Cabeçalho da Coluna (List Header)

| Propriedade | Valor medido |
|-------------|-------------|
| **Altura** | **40px** |
| **Largura** | 272px (mesma da coluna) |
| Padding | `8px 8px 0px` |
| Background | `rgba(0,0,0,0)` — herda da coluna |
| Display | `flex` + `flex-direction: row` |
| Font size | 14px |
| Color | `rgb(80, 82, 88)` |

**Elementos do header:**
- `h2[data-testid="list-name"]` — título editável inline via `<button>` filho
- `button[data-testid="list-collapse-button"]` — botão recolher (→ ícone SVG)
- Menu de lista (3 pontos) — aparece no hover

### 2.4 Card

| Propriedade | Valor medido |
|-------------|-------------|
| **Largura** | **256px** (272 - 8px padding × 2) |
| **Altura típica** | **76px** (varia com conteúdo) |
| Border radius | `8px` (card interno, não o `li`) |
| Background | `rgba(0,0,0,0)` no `li` — branco/cor no `div` interno |
| Box shadow | `rgba(30,31,33,0.25) 0px 1px 1px 0px` (card front) |
| Gap entre cards | `8px` (via `list-card-gap` separators) |
| Font size título | **16px, font-weight 500** |
| Cursor | `pointer` no card-name |

**Estrutura DOM do card:**
```
li[data-testid="list-card", data-planner-draggable="true"]
  └── div[data-testid="list-card-wrapper"]
        └── div[data-testid="full-cover-card" OR "link-card"]
              ├── div[data-testid="card-front-cover"]  ← cover colorido opcional
              ├── div[data-testid="card-labels"]        ← etiquetas coloridas
              ├── span[data-testid="card-name"]         ← título do card
              ├── div[data-testid="card-front-badges"]  ← due date, checklist, attachments
              └── div[data-testid="card-front-members"] ← avatares dos membros
```

### 2.5 Tipografia

| Tipo | Fonte | Tamanho | Peso |
|------|-------|---------|------|
| **Família principal** | `"Atlassian Sans"`, ui-sans-serif | — | — |
| Board title | Atlassian Sans | 20px | 700 |
| List name | Atlassian Sans | 14px | 600 |
| Card title | Atlassian Sans | 16px | 500 |
| Card meta | Atlassian Sans | 12px | 400 |
| Buttons nav | Atlassian Sans | 16px | 400 |

**Para nosso projeto (dark theme):** substituir por `Inter, system-ui, sans-serif`

---

## 3. Estrutura DOM — Hierarquia Semântica

```
div.board-wrapper[data-testid="board-view"]
  └── div.board-main-content
        ├── div.board-header[data-testid="board-header"]
        │     ├── div[data-testid="board-name-container"]
        │     │     ├── input.board-name-input  (edição inline)
        │     │     └── h1[data-testid="board-name-display"]
        │     └── div.board-header-actions
        │           ├── div.board-facepile  (avatares de membros)
        │           ├── button[data-testid="filter-popover-button"]
        │           ├── button[data-testid="board-visibility-option-public"]
        │           └── button[aria-label="Mostrar Menu"]
        │
        └── div.board-canvas[data-testid="board-canvas"]
              └── ul#board[data-testid="lists", data-drag-scroll-enabled="true"]
                    ├── li[data-testid="list-wrapper", data-list-id="..."]
                    │     └── div[data-testid="list", data-drag-scroll-disabled="true"]
                    │           ├── div[data-testid="list-header"]
                    │           │     ├── h2[data-testid="list-name"]
                    │           │     │     └── button (inline edit trigger)
                    │           │     └── button[data-testid="list-collapse-button"]
                    │           ├── div[data-testid="list-card-gap"]  ← drag placeholder
                    │           ├── ol[data-testid="list-cards", data-auto-scrollable="true"]
                    │           │     ├── li[data-testid="list-card", data-planner-draggable="true"]
                    │           │     │     └── div[data-testid="list-card-wrapper"]
                    │           │     │           └── div[data-testid="full-cover-card"]
                    │           │     ├── div[data-testid="list-card-gap"]  ← drop zone gap
                    │           │     └── li[data-testid="list-card"] ...
                    │           └── button[data-testid="list-add-card-button"]
                    └── li[data-testid="add-list"]
                          └── button "Adicionar outra lista"
```

**Observações arquiteturais:**
- Listas são `<ul><li>` — semanticamente correto e acessível
- Cards são `<li>` dentro de `<ol>` — acessível via teclado
- `data-planner-draggable="true"` — Atlassian usa seu próprio sistema de DnD
- `data-drag-scroll-disabled/enabled` — scroll automático durante drag
- `list-card-gap` são elementos separadores que se expandem durante drag como drop zones

---

## 4. Sistema de Design — Tokens Extraídos

### 4.1 Paleta de Cores (Trello → Adaptação para Dark Theme)

| Token | Trello (light) | Nossa Adaptação (dark) |
|-------|---------------|----------------------|
| `--board-bg` | imagem/cor personalizada | `#0f1729` (azul escuro) |
| `--column-bg` | `#f1f2f4` | `rgba(15, 23, 42, 0.6)` glassmorphism |
| `--column-shadow` | `rgba(30,31,33,0.25) 0 1px 1px` | `0 4px 24px rgba(0,0,0,0.4)` |
| `--card-bg` | `#ffffff` | `rgba(30, 41, 59, 1)` |
| `--card-shadow` | `rgba(30,31,33,0.25) 0 1px 1px` | `0 2px 8px rgba(0,0,0,0.3)` |
| `--card-hover-shadow` | `rgba(30,31,33,0.31) 0 8px 16px` | `0 8px 24px rgba(0,0,0,0.5)` |
| `--text-primary` | `rgb(22, 75, 53)` | `#f1f5f9` |
| `--text-secondary` | `rgb(80, 82, 88)` | `#94a3b8` |
| `--header-bg` | `rgba(0,0,0,0.24)` | `rgba(0,0,0,0.4)` |
| `--label-green` | `#4bce97` | `#4bce97` |
| `--label-yellow` | `#f5cd47` | `#f5cd47` |
| `--label-red` | `#f87168` | `#f87168` |
| `--label-blue` | `#579dff` | `#579dff` |
| `--label-purple` | `#9f8fef` | `#9f8fef` |
| `--label-orange` | `#fea362` | `#fea362` |

### 4.2 Espaçamento e Dimensões

| Token | Valor |
|-------|-------|
| `--column-width` | `272px` |
| `--column-min-width` | `272px` |
| `--column-radius` | `12px` |
| `--column-gap` | `8px` (gap entre colunas no board) |
| `--card-width` | `256px` (column - 2×8px padding) |
| `--card-radius` | `8px` |
| `--card-gap` | `8px` |
| `--card-padding` | `8px 12px` |
| `--header-height` | `40px` (list header) |
| `--board-header-height` | `48px` |
| `--cover-height` | `32px` (label cover) ou `112px` (image cover) |

### 4.3 Sombras (Sistema de Elevação)

```css
/* Elevação 1 — coluna */
--shadow-column: rgba(30, 31, 33, 0.25) 0px 1px 1px 0px,
                 rgba(30, 31, 33, 0.31) 0px 0px 1px 0px;

/* Elevação 2 — card em repouso */
--shadow-card: rgba(30, 31, 33, 0.25) 0px 1px 1px 0px;

/* Elevação 3 — card em hover */
--shadow-card-hover: rgba(30, 31, 33, 0.31) 0px 8px 16px -4px,
                     rgba(30, 31, 33, 0.31) 0px 0px 1px 0px;

/* Elevação 4 — card sendo arrastado */
--shadow-card-dragging: rgba(30, 31, 33, 0.4) 0px 20px 32px -8px,
                        rgba(30, 31, 33, 0.31) 0px 0px 1px 0px;
```

### 4.4 Animações

| Interação | Propriedade | Valor |
|-----------|-------------|-------|
| Card hover | `transform` | `translateY(-2px)` |
| Card hover | `box-shadow` | elevação 3 |
| Card hover | `transition` | `all 0.2s ease` |
| Drag start | `opacity` | `0.5` |
| Drag start | `transform` | `rotate(2deg) scale(1.02)` |
| Drop placeholder | `height` animada | `0 → card height` |
| Label expand | `max-height` | `0 → 16px` |
| Modal open | `opacity + scale` | `0 → 1`, `0.9 → 1` |
| Button click | `transform` | `scale(0.95)` |

---

## 5. Funcionalidades Mapeadas

### 5.1 CRUD de Boards
| Ação | Como funciona |
|------|--------------|
| Criar | Homepage → "Criar novo quadro" → modal simples (nome + cor/imagem) |
| Renomear | Click no título → inline edit (input sobrepõe o h1) |
| Trocar background | Sidebar direito → "Mudar fundo" → picker de cor ou imagem |
| Arquivar | Menu do board → "Arquivar este quadro" |
| Visualizar | Listagem em `/boards` com preview das colunas |

### 5.2 CRUD de Listas (Colunas)
| Ação | Como funciona |
|------|--------------|
| Criar | Botão "+ Adicionar outra lista" no final do canvas |
| Renomear | Click no nome → textarea inline (substitui o h2) |
| Reordenar | Drag-and-drop da lista inteira (segurando o header) |
| Recolher | Botão `⇔` no header → lista vira uma barra vertical estreita |
| Menu de lista | `···` no hover do header → Adicionar card, Copiar, Mover, Arquivar, Observar |
| Arquivar | Menu → "Arquivar esta lista" (não deleta — vai para arquivo) |

### 5.3 CRUD de Cards
| Ação | Como funciona |
|------|--------------|
| Criar rápido | "+ Adicionar um cartão" → textarea no rodapé da coluna |
| Criar completo | Ícone de edição no quick-add → abre modal completo |
| Editar inline | Click com segura `alt` no card → edita o título diretamente |
| Abrir modal | Click normal no card → modal full (lado esquerdo: conteúdo, direito: ações) |
| Mover | Drag-and-drop entre colunas e dentro da mesma coluna |
| Copiar | Modal → "Ações" → "Copiar" |
| Arquivar | Modal → "Ações" → "Arquivar" ou `Backspace` quando em foco |

### 5.4 Drag and Drop
| Aspecto | Comportamento |
|---------|--------------|
| Biblioteca | Atlassian DnD (@atlaskit/pragmatic-drag-and-drop) |
| Card dragging | `opacity: 0.5`, `rotate(2deg)`, `scale(1.02)` no ghost |
| Drop zone | `list-card-gap` se expande como placeholder visual |
| Coluna dragging | A lista inteira se move com o conteúdo |
| Auto-scroll | `data-auto-scrollable` — scroll automático ao chegar nas bordas |
| Reordenação | Posição calculada por índice na lista, não por coordenada Y |
| Cross-list | Payload contém: cardId + sourceListId + targetListId + targetIndex |

### 5.5 Etiquetas (Labels)
- 6 cores padrão + 1 sem cor + possibilidade de criar cores customizadas
- Labels aparecem como `div` coloridos acima do título no card front
- Modo expandido (texto) ↔ modo compacto (só cor) — toggle com click
- Até ~6 labels visíveis no card; extras ficam ocultos

### 5.6 Checklist
- Criado via modal → "Checklist"
- Exibido como seção dentro do modal do card
- Badge no card front: `☑ 2/5` mostrando progresso
- Barra de progresso `0 → 100%` (fica verde quando 100%)
- Itens podem ser reordenados com DnD dentro do checklist
- Pode converter item em novo card

### 5.7 Comentários
- Área no modal abaixo da descrição
- Editor de texto simples com `@mention` e formatação básica
- Comentários exibem: avatar + nome + timestamp + texto
- Podem ser editados/deletados pelo autor

### 5.8 Datas
- Due date no card front: ícone relógio + data formatada
- Cores: vermelho (atrasada), amarelo (vence hoje), verde (concluída)
- Modal: date picker nativo com hora opcional
- Start date: campo adicional (optional)

### 5.9 Filtros e Pesquisa
- Filtro no board header: por membro, etiqueta, data de vencimento, palavra
- Cards que não passam no filtro ficam com `opacity: 0.3`
- Pesquisa global: `Ctrl+/` abre busca rápida no topo

---

## 6. Fluxos UX Críticos

### 6.1 Criação Rápida de Card

```
[Usuário vê coluna] 
  → hover na coluna → "+ Adicionar um cartão" aparece no rodapé
  → click → textarea aparece inline no rodapé da coluna
  → digita título + Enter → card criado no topo/fundo da coluna
  → ESC ou click fora → cancela
```

**Princípio:** Zero atrito — 2 cliques + texto + Enter.

### 6.2 Abertura e Edição do Card

```
[Card na coluna]
  → hover → botão de edição rápida (caneta) aparece no canto superior direito
  → click no card (qualquer área) → modal abre com animação suave
  → modal: coluna esquerda (título, desc, checklist, comentários)
           coluna direita (etiquetas, membros, data, anexos, ações)
  → click fora do modal → fecha
  → ESC → fecha
```

### 6.3 Drag and Drop

```
[Card]
  → mousedown + movimento > 5px → inicia drag
  → ghost = cópia rotacionada + elevada do card
  → placeholder = espaço vazio que indica onde vai cair
  → list-card-gap entre cada card é a drop zone
  → ao soltar: animação do card "pousando" na posição
  → se mudou de coluna: chamada PATCH para API
  → se reordenou: chamada PATCH para atualizar posições
```

### 6.4 Edição Inline do Título da Lista

```
[List header]
  → click no nome → textarea substitui o h2 (mesmo tamanho visual)
  → Enter → salva
  → ESC → cancela
  → click fora → salva
```

### 6.5 Hover States

| Elemento | Hover behavior |
|----------|---------------|
| Card | `translateY(-2px)` + sombra maior + botões de ação aparecem |
| Botão de edição rápida | aparece no canto direito do card |
| List header | botão `···` (menu) aparece no canto direito |
| Label | expande de barra para badge com texto |
| "+ Add card" | aparece no rodapé da coluna |
| Coluna inteira | sutil highlight de fundo |

---

## 7. Modal do Card — Layout Detalhado

```
┌─────────────────────────────────────────────────────────┐
│  [Cover image/cor opcional — largura total]             │
├──────────────────────────────────┬──────────────────────┤
│  COLUNA PRINCIPAL (65%)          │  SIDEBAR (35%)       │
│                                  │                      │
│  [Ícone] Título editável         │  Adicionar ao card:  │
│                                  │  [👤] Membros        │
│  em: [Nome da Lista] →           │  [🏷] Etiquetas      │
│                                  │  [☑] Checklist       │
│  [Ícone] Descrição               │  [📅] Datas          │
│  textarea editável               │  [📎] Anexo          │
│  "Adicionar descrição..."        │  [📍] Localização    │
│                                  │                      │
│  [Checklist sections]            │  Ações:              │
│  ■■■■░░░░ 50%                    │  [→] Mover           │
│  ☑ Item 1                        │  [📋] Copiar         │
│  ☐ Item 2                        │  [👁] Observar       │
│                                  │  [🗄] Arquivar       │
│  [Ícone] Atividade               │                      │
│  [Avatar] Adicionar comentário   │                      │
│  [Avatar] Comentário 1           │                      │
│  [Avatar] Comentário 2           │                      │
└──────────────────────────────────┴──────────────────────┘
```

---

## 8. Análise do Kanban Existente (GerenciadorTSP)

### 8.1 O que já existe

| Feature | Status | Implementação |
|---------|--------|--------------|
| 3 colunas fixas (nova/doing/done) | ✅ | HTML estático + JS render |
| Cards básicos | ✅ | `div.task-card` com drag nativo HTML5 |
| Drag-and-drop entre colunas | ✅ | `dragstart/dragover/drop` HTML5 |
| Reordenação dentro da coluna | ✅ | `drag-over-above/below` classes |
| Barra de prioridade (cor lateral) | ✅ | `div.task-priority-bar` |
| Filtro por cliente e prioridade | ✅ | selects com re-render |
| Prazo com alerta de atraso | ✅ | comparação de datas |
| Tempo estimado/gasto | ✅ | `estimatedMinutes/spentMinutes` |
| Anexos de imagem | ✅ | base64 JPEG em JSONB |
| Modal de criação/edição | ✅ | `#modal-task` |
| Métricas no dashboard de tarefas | ✅ | contagens e totais |

### 8.2 O que falta vs Trello

| Feature | Prioridade | Complexidade |
|---------|------------|-------------|
| Colunas dinâmicas (criar/renomear/reordenar) | Alta | Média |
| Etiquetas coloridas no card | Alta | Baixa |
| Criação rápida inline (sem abrir modal) | Alta | Baixa |
| Edição inline do título do card | Média | Baixa |
| Checklist com barra de progresso | Alta | Média |
| Comentários no card | Média | Média |
| Cover image/cor no card | Baixa | Baixa |
| Múltiplos usuários/membros no card | Baixa | Alta |
| Filtro visual (cards dimmed) | Média | Baixa |
| Botão de ação hover no card | Alta | Baixa |
| Modal dois painéis (conteúdo + sidebar ações) | Alta | Média |
| Drag-and-drop de colunas | Média | Média |
| Realtime (Supabase Realtime) | Baixa | Alta |
| Recolher coluna | Baixa | Baixa |

### 8.3 Gap Summary

```
EXISTENTE (bom):
  ✅ Kanban funcional com DnD
  ✅ Integração Supabase
  ✅ Prioridade visual
  ✅ Prazo e tempo

FALTA (crítico para "Trello-like"):
  ❌ Colunas dinâmicas
  ❌ Etiquetas no card front
  ❌ Quick add (criação inline)
  ❌ Modal dois painéis
  ❌ Checklist
  ❌ Ações visíveis no hover do card

FALTA (nice-to-have):
  ❌ Comentários
  ❌ Cover
  ❌ Realtime
  ❌ Drag de colunas
```

---

## 9. Arquitetura Recomendada — Visão Geral

> Detalhamento completo na FASE 2.

### 9.1 Banco de Dados (Delta — o que adicionar)

```sql
-- Nova tabela: colunas dinâmicas
CREATE TABLE kanban_columns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Alterações na tabela tasks existente
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS column_id UUID REFERENCES kanban_columns(id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS position INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS labels JSONB DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS checklist JSONB DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS comments JSONB DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS cover_color TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS cover_image TEXT;

-- Índices para performance
CREATE INDEX tasks_column_position ON tasks(column_id, position);
CREATE INDEX tasks_user_status ON tasks(user_id, status);
```

### 9.2 Componentes Frontend (novos)

```
KanbanBoard
  ├── BoardHeader (título, filtros, botão nova coluna)
  ├── KanbanColumn (replicável, dinamico)
  │     ├── ColumnHeader (título inline-editável, count, menu, recolher)
  │     ├── CardList (ol com scroll, drop zone)
  │     │     ├── KanbanCard (li draggable)
  │     │     │     ├── CardCover (opcional)
  │     │     │     ├── CardLabels (badges coloridos)
  │     │     │     ├── CardTitle
  │     │     │     ├── CardMeta (prazo, checklist progress, anexos)
  │     │     │     ├── CardMembers (avatares)
  │     │     │     └── CardQuickActions (hover: edit, time, delete)
  │     │     └── CardDropPlaceholder
  │     └── QuickAddCard (textarea inline no rodapé)
  └── AddColumnButton

CardModal
  ├── ModalCover
  ├── ModalMain (65%)
  │     ├── CardTitleEditor
  │     ├── CardDescription
  │     ├── ChecklistSection
  │     └── CommentsSection
  └── ModalSidebar (35%)
        ├── LabelsPicker
        ├── DueDatePicker
        ├── AttachmentsSection
        └── CardActions (move, copy, archive, delete)
```

### 9.3 Estado Global

```javascript
boardStore = {
  columns: Column[],        // ordenadas por position
  cards: Card[],            // todas as cards, agrupadas por column_id
  filters: {
    client: string | null,
    priority: string | null,
    label: string | null,
    search: string
  },
  dragging: {
    cardId: string | null,
    sourceColumnId: string | null,
    isDraggingColumn: boolean
  },
  ui: {
    openCardId: string | null,
    quickAddColumnId: string | null,
    collapsedColumns: string[]
  }
}
```

---

## 10. Design System para o Novo Kanban

### 10.1 Paleta Dark (adaptada para GerenciadorTSP)

```css
:root {
  /* Board */
  --kb-board-bg: #0f1729;
  --kb-board-header-bg: rgba(0, 0, 0, 0.35);

  /* Colunas */
  --kb-col-bg: rgba(15, 23, 42, 0.65);
  --kb-col-border: rgba(255, 255, 255, 0.08);
  --kb-col-radius: 12px;
  --kb-col-width: 272px;
  --kb-col-shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
  --kb-col-header-height: 40px;

  /* Cards */
  --kb-card-bg: rgba(30, 41, 59, 0.95);
  --kb-card-border: rgba(255, 255, 255, 0.08);
  --kb-card-radius: 8px;
  --kb-card-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  --kb-card-shadow-hover: 0 8px 24px rgba(0, 0, 0, 0.5);
  --kb-card-gap: 8px;

  /* Etiquetas (mesmas do Trello) */
  --kb-label-green: #4bce97;
  --kb-label-yellow: #f5cd47;
  --kb-label-red: #f87168;
  --kb-label-blue: #579dff;
  --kb-label-purple: #9f8fef;
  --kb-label-orange: #fea362;
  --kb-label-teal: #60c6d2;
  --kb-label-pink: #e774bb;

  /* Prioridade (existente) */
  --kb-priority-high: #ef4444;
  --kb-priority-medium: #eab308;
  --kb-priority-low: #3b82f6;

  /* Interações */
  --kb-drop-zone-bg: rgba(99, 102, 241, 0.15);
  --kb-drop-zone-border: rgba(99, 102, 241, 0.5);
  --kb-drag-ghost-opacity: 0.5;
  --kb-drag-ghost-rotation: 2deg;
  --kb-drag-ghost-scale: 1.02;

  /* Tipografia */
  --kb-font: "Inter", ui-sans-serif, system-ui, sans-serif;
  --kb-font-size-col-title: 14px;
  --kb-font-size-card-title: 14px;
  --kb-font-size-card-meta: 12px;
  --kb-font-weight-col-title: 600;
  --kb-font-weight-card-title: 500;

  /* Animações */
  --kb-transition-fast: 0.15s ease;
  --kb-transition-normal: 0.2s ease;
  --kb-transition-slow: 0.3s ease;
}
```

### 10.2 Padrões de Interação

```
CARD:
  repouso   → bg: rgba(30,41,59,0.95), shadow: low
  hover     → translateY(-2px), shadow: high, quick-actions aparecem
  dragging  → opacity: 0.5, rotate(2deg), scale(1.02)
  dropping  → placeholder animated height
  selected  → ring: 2px rgba(99,102,241,0.6)

COLUNA:
  repouso   → glassmorphism base
  drag-over → bg: rgba(99,102,241,0.1), border: dashed indigo

BOTÕES:
  primary   → bg: var(--primary), borderRadius: 6px, padding: 6px 12px
  ghost     → bg: transparent, border: 1px solid, hover: bg fill
  icon      → 28×28px, borderRadius: 6px, padding: 6px
  icon-sm   → 24×24px, borderRadius: 4px, padding: 4px
```

---

## 11. Roadmap do Módulo Kanban

### Fase 1 (esta fase) ✅ — Reverse Engineering
- [x] Captura DOM/CSS via Playwright
- [x] Análise dos elementos reais do Trello
- [x] Mapeamento do gap entre o atual e o desejado
- [x] Definição do design system
- [x] Esboço da arquitetura

### Fase 2 — Arquitetura e Modelagem
- [ ] Schema SQL definitivo (migrations)
- [ ] Endpoints REST / Supabase queries
- [ ] Estado global (store.js)
- [ ] Estrutura de componentes detalhada
- [ ] Contratos de interface entre componentes

### Fase 3 — Implementação
- [ ] Design system CSS
- [ ] Colunas dinâmicas (CRUD)
- [ ] Card refatorado com labels + quick-add
- [ ] Modal dois painéis
- [ ] Checklist
- [ ] Drag-and-drop via @hello-pangea/dnd
- [ ] Integração Supabase Realtime

---

## 12. Artefatos Gerados

| Arquivo | Descrição |
|---------|-----------|
| `screenshots/01-homepage-full.png` | Homepage completa Trello |
| `screenshots/01-homepage-hero.png` | Hero section (navbar + headline) |
| `screenshots/01-homepage-navbar.png` | Navbar isolada |
| `screenshots/02-board-full.png` | Board público com colunas e cards |
| `screenshots/02-board-header.png` | Header do board |
| `screenshots/02-board-column.png` | Coluna isolada (272px, bg #f1f2f4) |
| `screenshots/02-board-card.png` | Card isolado com cover verde |
| `screenshots/06-board-tablet.png` | Layout 768px |
| `screenshots/06-board-mobile.png` | Layout 375px |
| `trello-dom-analysis.json` | CSS tokens, DOM, medições, botões |

---

**Status:** ✅ FASE 1 COMPLETA — Aguardando validação para avançar para FASE 2  
**Próximo passo:** Transformar esta análise em entidades, banco de dados, APIs e componentes.
