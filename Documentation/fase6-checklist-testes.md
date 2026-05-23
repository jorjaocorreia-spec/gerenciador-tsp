# Fase 6 — Checklist de Testes Multi-Usuário

## Pré-requisitos
- 2 contas criadas no Supabase (ex: user_a@teste.com, user_b@teste.com)
- RLS verificado via `fase6-rls-verificacao.sql`
- Acesso ao app em produção: https://jorge-gerenciador-tsp.27pl2o.easypanel.host

---

## Bloco 1 — Autenticação

- [ ] Login com user_a funciona
- [ ] Login com credenciais erradas mostra erro "E-mail ou senha incorretos."
- [ ] Logout redireciona para tela de login
- [ ] Após logout, sidebar e conteúdo ficam ocultos
- [ ] Tela de login reaparece corretamente após logout
- [ ] Login com user_b funciona em seguida (sem precisar recarregar a página)

---

## Bloco 2 — Isolamento de Dados (RLS)

> Executar com user_a logado, depois repetir com user_b

- [ ] User_a cria 1 cliente "Cliente A"
- [ ] User_b loga: não vê "Cliente A" no dashboard nem na lista de clientes
- [ ] User_b cria 1 cliente "Cliente B"
- [ ] User_a loga: não vê "Cliente B"
- [ ] User_a cria 1 atendimento para "Cliente A"
- [ ] User_b loga: não vê o atendimento de user_a em Atendimentos
- [ ] User_b cria 1 tarefa
- [ ] User_a loga: não vê a tarefa de user_b no Kanban
- [ ] User_a cria 1 evento de agenda
- [ ] User_b loga: não vê o evento de user_a na Agenda

---

## Bloco 3 — CRUD Completo (user_a)

### Clientes
- [ ] Criar cliente com todos os campos preenchidos
- [ ] Editar nome e horas do cliente
- [ ] Verificar cálculo automático de comissão (43%)
- [ ] Excluir cliente (confirmar que atendimentos vinculados também somem)

### Atendimentos
- [ ] Lançar atendimento com start/end time — cálculo automático de minutos
- [ ] Filtrar por cliente
- [ ] Filtrar por período (data início + data fim)
- [ ] Exportar PDF com filtro aplicado
- [ ] Editar atendimento existente
- [ ] Excluir atendimento

### Tarefas (Kanban)
- [ ] Criar tarefa com prioridade alta
- [ ] Arrastar tarefa de "Novas" → "Em Execução" → "Finalizadas"
- [ ] Adicionar tempo gasto (modal de tempo)
- [ ] Editar tarefa
- [ ] Excluir tarefa
- [ ] Filtro por cliente funciona no Kanban

### Agenda
- [ ] Criar evento tipo "Reunião" com data/hora
- [ ] Visualizar no modo Semanal
- [ ] Visualizar no modo Diário
- [ ] Navegar semanas (< Anterior / Próximo >)
- [ ] Editar evento clicando no bloco
- [ ] Excluir evento pelo botão X no bloco

---

## Bloco 4 — Dashboard e Relatórios

- [ ] Dashboard mostra barra de progresso correta para cada cliente
- [ ] Filtro Ativos/Finalizados no dashboard funciona
- [ ] Clicar no card do cliente abre dashboard mensal
- [ ] Clicar em um mês abre lista de atendimentos do mês
- [ ] Badge "Estourado" aparece quando horas > contrato

---

## Bloco 5 — Backup e Migração

- [ ] Exportar dados (JSON) — arquivo gerado com dados corretos
- [ ] Importar dados (JSON) — dados aparecem na plataforma
- [ ] Botão "Migrar Dados Locais" aparece apenas se houver dados no localStorage
- [ ] Migração conclui sem erros e dados aparecem no Supabase
- [ ] Opção de limpar localStorage após migração funciona

---

## Bloco 6 — Segurança (verificar via DevTools → Network)

- [ ] Response headers incluem `X-Frame-Options: SAMEORIGIN`
- [ ] Response headers incluem `X-Content-Type-Options: nosniff`
- [ ] Response headers incluem `Content-Security-Policy`
- [ ] Nenhum erro de CSP no Console do browser
- [ ] `js/config.js` retorna 200 com credenciais corretas (não placeholder)
- [ ] `skills/` retorna 404 (bloqueado pelo nginx)

---

## Bloco 7 — UX e Estados de Loading

- [ ] Spinner aparece nos containers durante carregamento inicial
- [ ] Toast de sucesso aparece após salvar cliente
- [ ] Toast de erro aparece ao tentar salvar sem preencher campos obrigatórios
- [ ] Botões ficam desabilitados durante operação async (evita double-submit)
- [ ] Toast desaparece automaticamente após ~3,5s

---

## Resultado

| Bloco | Status |
|-------|--------|
| 1 — Autenticação | ⬜ |
| 2 — Isolamento RLS | ⬜ |
| 3 — CRUD Completo | ⬜ |
| 4 — Dashboard | ⬜ |
| 5 — Backup/Migração | ⬜ |
| 6 — Segurança | ⬜ |
| 7 — UX/Loading | ⬜ |
