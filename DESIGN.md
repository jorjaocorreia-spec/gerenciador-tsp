---
name: GerenciadorTSP
description: Painel de controle noturno para consultoria — horas, clientes, agenda e faturamento num só lugar
colors:
  bg: "#0b0f19"
  surface: "rgba(30, 41, 59, 0.6)"
  surface-glass: "rgba(30, 41, 59, 0.82)"
  surface-border: "rgba(255, 255, 255, 0.08)"
  primary: "#8b5cf6"
  primary-hover: "#7c3aed"
  secondary: "#3b82f6"
  success: "#10b981"
  danger: "#ef4444"
  warning: "#eab308"
  text-main: "#f8fafc"
  text-muted: "#94a3b8"
  kb-new: "#4a9eff"
  kb-doing: "#ff922b"
  kb-done: "#51cf66"
  ai-accent: "#a78bfa"
  delta-positive: "#4ade80"
  delta-negative: "#f87171"
typography:
  brand:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "1.6rem"
    fontWeight: 700
    letterSpacing: "0.5px"
  headline:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
  title:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "1.1rem"
    fontWeight: 600
  body:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
  label:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.85rem"
    fontWeight: 500
    letterSpacing: "0.05em"
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  pill: "20px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "10px 20px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "rgba(255, 255, 255, 0.05)"
    textColor: "{colors.text-main}"
    rounded: "{rounded.md}"
  button-danger:
    backgroundColor: "rgba(239, 68, 68, 0.1)"
    textColor: "{colors.danger}"
    rounded: "{rounded.md}"
  card:
    backgroundColor: "{colors.surface-glass}"
    rounded: "{rounded.lg}"
    padding: "24px"
  input:
    backgroundColor: "rgba(15, 23, 42, 0.5)"
    textColor: "{colors.text-main}"
    rounded: "{rounded.md}"
    padding: "12px"
---

# Design System: GerenciadorTSP

## 1. Overview

**Creative North Star: "The Control Room"**

GerenciadorTSP é a sala de controle noturna de um consultor: ardósia profunda (#0b0f19) segurando todo o painel, violeta elétrico (#8b5cf6) pontuando exatamente onde a ação acontece. Não é um dashboard de SaaS querendo parecer amigável — é uma ferramenta de trabalho densa, usada por quem já sabe o que está procurando e precisa achar rápido: saldo de um cliente, próximo compromisso, card que ainda não foi movido. O glassmorphism (`rgba(30,41,59,0.82)` + `blur(16px)` nos modais) não é decoração; é o vidro fosco da cabine — separa camadas de informação sem esconder o que está atrás.

O sistema rejeita explicitamente o clichê de SaaS genérico: sem gradiente decorativo em texto, sem cards hero-metric, sem ícones fofos. Cada elemento visual carrega uma função — cor de status no Kanban, glow de progresso na barra de horas, badge de prioridade — nunca ornamento puro.

**Key Characteristics:**
- Fundo quase-preto (#0b0f19) como constante; nada compete com ele por atenção de base.
- Um único acento vibrante (violeta #8b5cf6) reservado para ação, foco e identidade — nunca espalhado como enchimento.
- Superfícies flat em repouso; profundidade só aparece como resposta a hover/foco (glow roxo), nunca como sombra ambiente permanente.
- Densidade alta é aceita e assumida: tabelas, Kanban, agenda — a ferramenta prioriza mostrar dado, não respirar espaço em branco.

## 2. Colors

A paleta é curta de propósito: um fundo, uma superfície, um acento, e cores de status funcionais — nada de paleta decorativa expandida.

### Primary
- **Violeta Elétrico** (`#8b5cf6` / hover `#7c3aed`): a única cor de ação do sistema — botões primários, ícone de marca, foco de input, linha ativa do menu, glow de hover nos cards. Se aparece, é para chamar clique ou indicar seleção.

### Secondary
- **Azul Cobalto** (`#3b82f6`): usado quase sempre em par com o violeta (gradiente da barra de progresso `linear-gradient(90deg, primary, secondary)`), nunca sozinho como CTA — é o complemento, não uma segunda ação.

### Neutral
- **Ardósia Profunda** (`#0b0f19`): fundo base de toda a aplicação, atrás de tudo.
- **Vidro Ardósia** (`rgba(30,41,59,0.82)` glass / `rgba(30,41,59,0.6)` surface): a camada de card/painel sobre o fundo — sempre com `border: 1px solid rgba(255,255,255,0.08)`.
- **Branco Neblina** (`#f8fafc`): texto principal, títulos.
- **Cinza Névoa** (`#94a3b8`): texto secundário/muted — labels de tabela, placeholders, legendas.

### Status (funcional, não decorativa)
- **Sucesso** (`#10b981`), **Perigo** (`#ef4444`), **Aviso** (`#eab308`): reservadas a estado real (over-limit, exclusão, feriado) — nunca usadas como cor de marca.
- **Kanban**: Novas `#4a9eff`, Em Execução `#ff922b`, Finalizadas `#51cf66` — a única paleta multicor do sistema, porque o Kanban é a única superfície onde múltiplas categorias precisam de distinção simultânea.

### Duas exceções nomeadas (confirmadas em auditoria, 2026-07-10)
- **Acento de IA** (`#a78bfa`, bordas em `rgba(167,139,250,0.2-0.3)`): usado de forma consistente em todo o app para marcar especificamente recursos de IA — botão "Insights" do Dashboard, "Assistente de Agendamento" da Agenda, painéis de melhoria de texto em Atendimentos/Relatórios. É um violeta mais claro que o `--primary-color` (`#8b5cf6`), nunca usado fora desse contexto.
- **Delta financeiro** (`#4ade80` positivo / `#f87171` negativo, variante de barra `#22c55e`): usado de forma consistente para saldo/delta financeiro e de cobertura (Saldo de Horas, Cobertura de Agenda, Produtividade, Financeiro) — mais vívido que `--success-color`/`--danger-color`, que continuam reservados a estado de sistema (toast, validação).

### Named Rules
**The One Accent Rule.** Violeta (`#8b5cf6`) é o único acento não-funcional de ação/identidade do sistema. As duas exceções acima são deliberadas e escopadas (IA, delta financeiro) — qualquer outra tela que "precisa de uma segunda cor para destacar" deve resolver com peso tipográfico ou contraste de superfície, nunca uma nova cor de marca.

**The Functional Color Rule.** Verde, vermelho e âmbar significam sempre a mesma coisa (sucesso/perigo/aviso) em qualquer tela nova. Nunca reutilizar `--danger-color` para algo que não é um erro ou estado destrutivo. O par delta financeiro (`#4ade80`/`#f87171`) é semanticamente distinto (positivo/negativo, não sucesso/erro) — não usar `--success-color`/`--danger-color` para representar saldo, e não usar o par delta para estado de sistema.

## 3. Typography

**Display/Body Font:** Inter (fallback `system-ui, -apple-system, sans-serif`)

**Character:** Uma única família sans-serif geométrica-humanista em múltiplos pesos — sem par de fontes. A hierarquia inteira é construída por tamanho e peso, não por troca de família; isso mantém a densidade legível sem introduzir ruído visual de uma segunda voz tipográfica.

### Hierarchy
- **Brand** (700, 1.6rem, letter-spacing 0.5px): nome do app no cabeçalho da sidebar. Único lugar com tracking positivo.
- **Headline** (600, 1.5rem): títulos de modal e de seção principal.
- **Title** (600, 1.1rem): nome de cliente em card, títulos de card de Kanban.
- **Body** (400, 1rem): valores de formulário, texto corrido, descrições.
- **Label** (500, 0.85rem, letter-spacing 0.05em, uppercase em cabeçalhos de tabela): rótulos de campo, cabeçalhos `.data-table th`, texto muted funcional.

### Named Rules
**The Single Voice Rule.** Uma família (Inter) carrega toda a hierarquia. Uma segunda família só entraria para um propósito claramente distinto (ex.: mono para código em Implementações) — nunca por variedade estética.

## 4. Elevation

Sistema flat-by-default confirmado: cards e superfícies (`.stat-card`, `.glass`, `.clickable-card`) não têm sombra em repouso — só borda sutil (`rgba(255,255,255,0.08)`). A profundidade é inteiramente uma resposta de interação: hover eleva o card (`translateY(-4px)`) e acende um glow roxo. Nada no sistema tem sombra "ambiente" permanente — se algo tem sombra parada, é modal (que precisa se destacar do overlay) ou botão primário (que precisa parecer clicável).

### Shadow Vocabulary
- **Hover glow (cards/stat)** (`0 10px 36px rgba(139,92,246,0.18)` + borda `rgba(139,92,246,0.35)`): resposta a hover em `.stat-card`, `.clickable-card`. Nunca visível em repouso.
- **Botão primário** (`0 4px 15px rgba(139,92,246,0.3)`, hover `0 6px 20px rgba(139,92,246,0.4)`): a única sombra estrutural (não de resposta) do sistema — sinaliza affordance de clique mesmo parado.
- **Ícone de marca** (`0 0 16px rgba(139,92,246,0.25)`): glow fixo e discreto, só no ícone da sidebar.

### Named Rules
**The Flat-Until-Touched Rule.** Nenhuma superfície de conteúdo (card, linha de tabela, item de Kanban) carrega sombra em repouso. Sombra é sempre resposta — hover, foco, ou o estado "isto é clicável" de um botão primário.

## 5. Components

### Buttons
- **Shape:** cantos suavemente arredondados (`border-radius: 8px`).
- **Primary:** fundo violeta sólido (`#8b5cf6`), texto branco, `padding: 10px 20px`, sombra estrutural roxa leve.
- **Hover / Focus:** primary escurece para `#7c3aed`, sobe 2px (`translateY(-2px)`), sombra intensifica.
- **Secondary:** fundo quase transparente (`rgba(255,255,255,0.05)`), borda `--surface-border`, texto `--text-main`; hover clareia levemente o fundo.
- **Danger:** fundo vermelho a 10% de opacidade, texto vermelho puro, borda vermelha a 20%; hover inverte para fundo vermelho sólido + texto branco.
- **Active-mode (toggle):** fundo violeta a 20%, borda e texto violeta — usado em filtros/toggles selecionados.

### Cards / Containers
- **Corner Style:** `border-radius: 12px` (`--border-radius`) para painéis/glass; `8px` para cards de Kanban.
- **Background:** vidro ardósia (`.glass` = `rgba(30,41,59,0.82)`; `.stat-card`/superfícies gerais = `rgba(30,41,59,0.6)`).
- **Shadow Strategy:** flat em repouso, glow roxo só no hover (ver Elevation).
- **Border:** sempre 1px `rgba(255,255,255,0.08)`.
- **Internal Padding:** 24px em cards de dashboard/stat; 12px em cards de Kanban.

### Inputs / Fields
- **Style:** fundo escuro semi-transparente (`rgba(15,23,42,0.5)`), borda `--surface-border`, `border-radius: 8px`, com uma linha inferior violeta animada (`background-size 0%→100% 2px`) que "acende" no foco.
- **Focus:** borda vira violeta + anel `0 0 0 2px rgba(139,92,246,0.2)` + a linha inferior se completa. Sem glow neon exagerado — o foco é preciso, não festivo.

### Navigation (Sidebar)
- **Style:** 260px expandida / 70px colapsada, gradiente vertical sutil de ardósia (`linear-gradient(180deg, rgba(17,25,45,0.85), rgba(15,23,42,0.85))`), borda direita `--surface-border`.
- **Item padrão:** texto `--text-muted`, `border-radius: 9px`, sem fundo.
- **Hover:** fundo branco a 5%, texto sobe para `--text-main`, ícone escala 1.12x.
- **Active:** gradiente horizontal violeta suave (`rgba(139,92,246,0.18)→rgba(139,92,246,0.03)`), texto violeta.
- **Colapsado:** só ícones centralizados, `.nav-label` oculto via `display:none`, tooltip nativo via `title`.

### Kanban Cards (componente de assinatura)
Densidade máxima do sistema em um único componente: fundo `rgba(255,255,255,0.06)`, hover `rgba(255,255,255,0.10)`, `border-radius: 8px`, sombra própria discreta (`0 1px 4px rgba(0,0,0,0.3)`). Labels de coluna usam as três cores funcionais do Kanban (azul/laranja/verde) como barra de 8px, nunca como fundo do card inteiro — a cor identifica categoria, não decora.

## 6. Do's and Don'ts

### Do:
- **Do** manter o violeta (`#8b5cf6`) como o único acento não-funcional — se uma tela nova "precisa de mais cor", resolver com peso tipográfico ou contraste de superfície primeiro.
- **Do** manter superfícies flat em repouso; introduzir sombra/glow só como resposta a hover, foco, ou para sinalizar affordance de clique (botão primário).
- **Do** usar as cores de status (verde/vermelho/âmbar) estritamente para o significado que já carregam no sistema (sucesso/perigo/aviso) — nunca como paleta decorativa.
- **Do** priorizar densidade de informação com hierarquia clara (tamanho/peso de Inter) sobre espaço em branco generoso — esta é uma ferramenta de controle, não uma landing page.
- **Do** verificar contraste AA em qualquer novo texto sobre o fundo escuro, especialmente `--text-muted` (#94a3b8) sobre superfícies translúcidas.

### Don't:
- **Don't** usar `background-clip: text` com gradiente em texto (gradiente decorativo) — proibido pelos princípios gerais do sistema.
- **Don't** usar `border-left`/`border-right` colorido como stripe decorativo em cards ou alertas.
- **Don't** criar cards hero-metric (número grande + label pequeno + stat de apoio) só porque "parece SaaS profissional" — não é a linguagem visual deste produto.
- **Don't** introduzir uma segunda família tipográfica por variedade estética — só por propósito distinto e deliberado (ex.: monoespaçada para código).
- **Don't** vazar dado financeiro (`clientPays`, `hourlyRate`, comissão) para qualquer superfície visível ao Portal do Cliente — a restrição de dois públicos (consultor vs. cliente) é regra de produto, não só de acesso a dados.
