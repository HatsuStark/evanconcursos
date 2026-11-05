-- Sessão com até 2 matérias do banco de questões (ex.: "Ética e Relações Interpessoais" → Ética e Relações Humanas):
-- a matéria principal continua em `materia`; os assuntos que vieram da segunda apontam para ela aqui (assunto → matéria).
alter table public.qbank_session_maps add column materia_of jsonb;
