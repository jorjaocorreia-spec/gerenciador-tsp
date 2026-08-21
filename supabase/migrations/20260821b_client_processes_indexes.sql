-- Índices para as FKs process_id adicionadas em 20260821_client_processes.sql.
-- getProcessDetailData() (js/store.js) roda 4 queries filtradas por process_id
-- em paralelo a cada abertura da view de detalhe do processo; sem índice,
-- cada uma delas é um full scan das tabelas correspondentes.
CREATE INDEX IF NOT EXISTS idx_tasks_process_id ON tasks(process_id) WHERE process_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agenda_events_process_id ON agenda_events(process_id) WHERE process_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_records_process_id ON records(process_id) WHERE process_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_process_id ON tickets(process_id) WHERE process_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_client_processes_user_status ON client_processes(user_id, status);
