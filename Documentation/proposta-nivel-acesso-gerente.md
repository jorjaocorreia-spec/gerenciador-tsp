# Proposta de Melhoria: Novo Nível de Acesso "Gerente"

## Resumo

Hoje o sistema tem dois tipos de acesso:

- **Consultor**: acesso total à sua própria carteira de clientes (cadastro, horas, tarefas, agenda, financeiro).
- **Cliente** (Portal do Cliente): acesso restrito e somente leitura, exclusivo ao próprio projeto do cliente.

A proposta é criar um terceiro nível, o **Gerente**, com visão de supervisão sobre **todos os consultores da equipe** — permitindo acompanhar o andamento de todos os projetos em um único lugar, sem depender de pedir relatórios manualmente a cada consultor.

## O que o Gerente poderá ver

Ao ativar o "Modo Supervisão" e escolher um consultor da equipe, o Gerente enxerga exatamente as mesmas telas que aquele consultor vê no seu dia a dia:

- Clientes e contratos
- Horas consumidas e saldo de horas
- Tarefas (Kanban) e seu andamento
- Agenda de atendimentos
- Indicadores de produtividade
- **Financeiro** (valores faturados, comissões) — visão completa, sem restrição

## O que o Gerente **não** poderá fazer

- **Não edita nada** nos dados de outro consultor — é um modo 100% de leitura/consulta, como um "espelho" da tela do consultor.
- Não consegue criar, alterar ou excluir clientes, tarefas, horas ou eventos de agenda de outra pessoa.
- Não tem acesso a credenciais/senhas configuradas por outros consultores (ex.: integração com sistema de chamados).

Essa proteção não é só uma regra de tela — está garantida também no banco de dados, então mesmo em caso de falha do sistema, uma tentativa de edição de dados de outro consultor seria bloqueada.

## O Gerente continua sendo consultor

Importante: quem tiver o papel de Gerente **continua com sua própria carteira de clientes**, exatamente como um consultor normal — cria, edita e gerencia seus próprios projetos sem nenhuma restrição. A supervisão dos demais é um modo à parte, que ele liga/desliga quando quiser consultar o trabalho da equipe, sem misturar com os seus próprios dados.

## Como vai funcionar na prática

1. Um botão novo aparece na barra lateral, visível só para quem tem o papel de Gerente: **"Ver outro consultor"**.
2. Ao clicar, uma lista mostra todos os consultores da equipe.
3. Ao escolher um, o sistema abre a visão completa daquele consultor em modo somente leitura, com um aviso fixo no topo da tela ("Visualizando: [nome] — somente leitura") e um botão para sair a qualquer momento.
4. O convite para dar acesso de Gerente a alguém é feito pelo mesmo cadastro de usuários que já existe hoje (mesmo fluxo usado para convidar clientes para o Portal), só que escolhendo o novo papel "Gerente".

## Benefício esperado

- Visibilidade centralizada de todos os projetos da equipe, sem pedir informação manualmente a cada consultor.
- Nenhum risco de um Gerente alterar dados de outro consultor por engano.
- Não exige nenhuma mudança no fluxo de trabalho dos consultores — eles continuam usando o sistema exatamente como hoje.
