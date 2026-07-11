---
target: "Tela de Apontamentos (index.html #view-apontamentos)"
total_score: 20
p0_count: 1
p1_count: 1
timestamp: 2026-07-11T01-17-22Z
slug: index-html-view-apontamentos
---
Method: dual-agent (A: a649ec48d3dd1b945 · B: ade735ec34f604668)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Nenhum estado de loading no botão salvar além de `disabled`; o split de almoço só é sinalizado por um `<small>` passivo, fácil de não notar |
| 2 | Match System / Real World | 3 | "Nº Projeto" + autocomplete via datalist casa com o vocabulário do consultor |
| 3 | User Control and Freedom | 1 | Excluir dispara direto (fade de 400ms, sem confirmação) — não usa o padrão `_twostepDelete` já documentado no CLAUDE.md para o resto do app |
| 4 | Consistency and Standards | 3 | Reaproveita grid/glass/ícones do sistema, mas a exclusão sem confirmação quebra o próprio padrão do app |
| 5 | Error Prevention | 1 | Sem detecção de sobreposição de horário; `calcDuration` zera silenciosamente duração negativa (fim < início) sem aviso |
| 6 | Recognition Rather Than Recall | 2 | Ações (copiar/editar/excluir) são só ícone com `title`, sem rótulo de texto |
| 7 | Flexibility and Efficiency | 1 | Todo lançamento exige modal completo — sem quick-add como o Kanban já tem documentado no próprio app |
| 8 | Aesthetic and Minimalist Design | 3 | Tabela é genuinamente minimalista; colunas proporcionais ao conteúdo |
| 9 | Error Recovery | 2 | Erros de salvar mostram `err.message` cru no toast; fallback da IA (textarea manual) é gracioso |
| 10 | Help and Documentation | 2 | `title` do botão "Gerar do Dia" ensina a regra de elegibilidade; sem onboarding no empty state |
| **Total** | | **20/40** | **Acceptable — melhorias significativas necessárias** |

## Anti-Patterns Verdict

**LLM assessment**: Nenhum tell de "isso é feito por IA" — sem gradiente decorativo, sem card hero-metric, sem glassmorphism ornamental. O hover-wash do `.apt-row` é uma micro-interação legítima, não decoração gratuita.

**Deterministic scan**: `detect.mjs` rodou sobre `index.html` inteiro (exit 2, 81 achados) — mas o markup específico do Apontamentos (`index.html:599-626`) é apenas um shell vazio preenchido em runtime pelo JS; **nenhum dos 81 achados cai dentro dessa faixa de linhas**. Todos são drift de tokens de design (font-size/color/radius) no CSS global compartilhado ou em outras views — não específicos desta tela. Sem falso-positivo relevante isolado para Apontamentos; o scan simplesmente não tem visibilidade sobre conteúdo renderizado em runtime.

**Visual overlays**: Não disponível nesta sessão — não há ferramenta de automação de browser (Playwright/Puppeteer/computer-use) exposta, e a view autenticada `#view-apontamentos` está atrás de login Supabase sem credenciais fornecidas à sub-tarefa. Nenhum overlay visual foi gerado; nenhuma evidência de renderização real foi coletada.

## Overall Impression

A tela cumpre bem o "número certo importa mais que o efeito bonito" — nenhum vício visual de IA, densidade adequada, split de almoço é uma automação de domínio genuinamente inteligente. Mas o fluxo de registro (o próprio objetivo declarado do produto: "fricção mínima entre terminar o atendimento e estar registrado") é o ponto mais fraco: cada lançamento exige abrir modal, preencher 4 campos e submeter — exatamente o padrão que o Kanban já resolveu com quick-add em outro lugar do mesmo app. A maior oportunidade é reduzir esse custo por lançamento, não redesenhar a estética.

## What's Working
1. **Split automático de almoço** (`app.js` ~6488-6497) — deriva 2 segmentos limpos sem pedir ao usuário para fazer a conta.
2. **UI de conflito no gerador de IA** — mostra o apontamento existente com radios de anexar/pular, evitando duplicação acidental (real ganho de prevenção de erro).
3. **Degradação graciosa da IA** — quando falha por entrada, cai para um textarea editável em branco com aviso, sem bloquear o lote inteiro.

## Priority Issues

**[P0] Excluir sem confirmação nem desfazer, contrariando o padrão já documentado do próprio app**
- Why it matters: um clique errado no ícone de lixeira (`app.js:7529`/`7652`) remove permanentemente um lançamento com só um fade de 400ms como feedback; o CLAUDE.md documenta `_twostepDelete` como o padrão de exclusão destrutiva usado no resto do app, e esta tela não usa.
- Fix: rotear pelo `_twostepDelete` (clique-de-novo-para-confirmar) igual ao restante do app, ou toast com ação "Desfazer".
- Suggested command: `/impeccable harden`

**[P1] Sem quick-add — todo lançamento custa um round-trip completo de modal**
- Why it matters: é uma tarefa diária, repetitiva e de baixo risco, explicitamente enquadrada como custando "o próprio tempo do consultor"; forçar abrir→preencher→submeter por lançamento é o padrão de maior fricção que o próprio vocabulário do app já resolveu em outro lugar (Kanban tem quick-add inline).
- Fix: adicionar uma "linha rápida" inline na própria tabela (horário+horário+projeto+descrição) com Enter para salvar; reservar o modal para edição/assistência de IA.
- Suggested command: `/impeccable optimize`

**[P2] Modal do gerador de IA concentra decisões demais de uma vez**
- Why it matters: num dia com 3+ clientes, o usuário enfrenta N cards cada um com checkbox/radio/horário/textarea independentes antes de um único "Criar Apontamentos" — viola divulgação progressiva e arrisca pular silenciosamente algo se um checkbox ficar desmarcado.
- Fix: colapsar cards por padrão (resumo de uma linha + "Revisar"), expandir sob demanda; manter o botão único de confirmação mostrando quantos serão de fato criados.
- Suggested command: `/impeccable clarify`

**[P3] Sem validação quando início > fim ou quando horários se sobrepõem**
- Why it matters: `calcDuration` zera silenciosamente a duração negativa em vez de sinalizar o campo como errado; sobreposição de lançamentos no mesmo dia nunca é checada, então horas duplicadas podem escapar para o export do ERP sem aviso.
- Fix: mensagem de validação inline + borda vermelha quando fim ≤ início; aviso não-bloqueante quando o novo intervalo colide com um lançamento existente do dia.
- Suggested command: `/impeccable harden`

**[P3] Ações da linha são só ícone, sem nenhum rótulo de texto**
- Why it matters: tooltips via `title` (`app.js:7520-7531`) exigem hover-e-espera; numa grade densa com 4 botões em 148px, um usuário ocasional (ou a persona "Riley" sob pressão de tempo) precisa caçar o botão certo.
- Fix: manter ícone puro para editar/excluir (universalmente reconhecidos), mas considerar rótulo revelado no hover ou agrupar as ações de copiar sob um único menu "mais" se surgir uma 5ª ação.
- Suggested command: `/impeccable clarify`

## Persona Red Flags

**Alex (Power User)**
- Sem atalho de teclado para abrir "Novo Apontamento" — precisa clicar no botão do header toda vez, apesar de ser uma ação repetida várias vezes ao dia.
- Sem operações em lote: não é possível selecionar múltiplas linhas para excluir ou re-datar de uma vez; cada linha é uma unidade isolada de CRUD.
- Sem duplicar um lançamento parecido ("mesmo projeto, novo horário") — precisa redigitar número de projeto e descrição do zero, mesmo quando o mesmo projeto se repete todo dia.

**Riley (Stress Tester)**
- Submeter início=fim ou fim<início produz uma duração zerada silenciosamente, sem erro — pode logar um lançamento de 0 minutos e só notar quando o total do ERP não fechar.
- Duplo-clique rápido em "Excluir" antes do fade de 400ms terminar: não há `disabled` no botão durante a animação — um duplo-clique não é bloqueado na origem (o comportamento do lado do store não foi verificado nesta revisão).
- Abrir o gerador de IA e fechá-lo no meio do processamento: sem cancelamento/abort visível das chamadas de IA em andamento — pode repopular estado obsoleto se reaberto rapidamente.

## Minor Observations
- `.apt-proj-name` trunca via ellipsis mas depende só do `title` do elemento pai para o nome completo — funciona, mas sem `max-width` explícito o comportamento em viewports estreitos não foi confirmado sem renderização real.
- `.apt-desc` usa `white-space: pre-wrap; word-break: break-word` — correto, evita overflow horizontal em descrições longas.
- O flash de fundo no botão "Melhorar com IA" é um toque de delight discreto, consistente com o glow restrito da "Control Room".

## Questions to Consider
- E se o split de almoço fosse mostrado como preview *antes* de submeter (o formulário visivelmente se bifurcando em duas linhas ao digitar o horário), em vez de um hint passivo descoberto só depois?
- E se "Novo Apontamento" não fosse um modal, mas um compositor inline sempre visível fixado no topo da tabela — eliminando navegação do hábito diário?
- E se o gerador de IA já viesse com todo lançamento sem conflito marcado como "confirmado" por padrão, deslocando o trabalho do usuário de "preencher 4 campos por cliente" para "revisar e aprovar"?
