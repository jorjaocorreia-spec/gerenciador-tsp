# Product

## Register

product

## Platform

web

## Users
Consultores independentes/pequenas equipes de consultoria (o público **primário**) que usam o app diariamente para controlar contratos, horas consumidas, tarefas (Kanban), agenda de atendimentos e faturamento de múltiplos clientes simultaneamente — cada consultor com sua própria carteira isolada. O contexto de uso é intercalado com o trabalho real de consultoria: lançar horas entre atendimentos, mover cards no Kanban, checar rapidamente o saldo de um cliente antes de uma call.

Um público **secundário** existe via Portal do Cliente: o próprio cliente do consultor, com uma conta restrita a um único `client_id`, acesso somente-leitura ao Kanban do seu projeto e ao Painel de Indicadores — sem visibilidade de dados financeiros, notas internas ou outros clientes. Esse público espera transparência de andamento, não controle.

## Product Purpose
Sistema de gerenciamento de horas e consultoria: controla contratos de clientes, horas consumidas, tarefas, agenda e faturamento, com sincronização Google Calendar e integração com IA e OTOBO (chamados). Existe para substituir planilhas soltas e ferramentas genéricas por uma ferramenta feita sob medida para o fluxo real de um consultor de TI — nasceu do próprio uso do autor. Sucesso é o consultor confiar no número que a tela mostra (saldo, horas, faturamento) sem precisar conferir em outro lugar, e gastar o mínimo de fricção possível entre "terminei o atendimento" e "está registrado".

## Positioning
Uma ferramenta de consultoria feita por um consultor para o próprio fluxo de trabalho — densidade de controle (horas, saldo, faturamento, chamados, agenda, tudo cruzado por cliente) que uma planilha ou um SaaS genérico de time tracking não entrega, sem a sobrecarga de configuração de uma suíte corporativa.

## Brand Personality
Profissional e confiável, moderno e ágil, elegante e premium, técnico e denso. O tema escuro roxo/glassmorphism já em produção é a expressão visual dessa personalidade: parece uma ferramenta de trabalho séria (lida com contratos e valores de clientes pagantes), não um brinquedo, mas também não abre mão de densidade de informação — telas como Kanban, Agenda e Financeiro priorizam mostrar dado sobre respirar espaço em branco. Sem referência negativa específica além dos princípios gerais do impeccable (evitar clichês de SaaS genérico, cards hero-metric, gradientes decorativos).

## Anti-references
Nenhuma referência negativa específica indicada pelo usuário, além dos anti-padrões gerais do impeccable (SaaS genérico, cards hero-metric, gradiente decorativo, planilha disfarçada de app).

## Design Principles
- **O número certo importa mais que o efeito bonito**: qualquer decisão visual cede a legibilidade e precisão de dados financeiros/horas — é uma ferramenta de controle, não uma vitrine.
- **Densidade com hierarquia, não densidade crua**: o app é técnico e denso por natureza (Kanban, tabelas, múltiplas views), então cada tela precisa de hierarquia visual clara para não virar ruído.
- **Confiança visual = seriedade percebida**: como lida com valores de clientes pagantes e comissão do consultor, o acabamento (contraste, consistência, ausência de bugs visuais) comunica confiabilidade tanto quanto a funcionalidade em si.
- **Dois públicos, dois escopos**: toda tela nova deve considerar se é exclusiva do consultor ou também visível (em versão restrita/read-only) ao cliente via Portal — nunca vazar dado financeiro ou interno para o público secundário.
- **Fricção mínima no fluxo de registro**: já que o objetivo é "menos fricção entre terminar o atendimento e estar registrado", preferir componentes que reduzem cliques/etapas (quick-add, preenchimento assistido por IA, autocomplete) a formulários longos.

## Accessibility & Inclusion
WCAG AA padrão: contraste mínimo AA em todo texto (atenção redobrada no tema escuro atual — verificar `--text-secondary`/`--text-muted` contra `--bg-color`/`--surface-color`), suporte a `prefers-reduced-motion` nas animações já documentadas em CLAUDE.md, foco visível em todos os elementos interativos. Nenhum requisito adicional (WCAG AAA, daltonismo específico) foi indicado.
