-- O Supabase concede ALL a anon/authenticated em toda tabela nova (privilégios padrão). A RLS já
-- limitava as linhas, mas as permissões por coluna (ex.: só done_at em tasks) não valiam.
-- Aqui: tira o padrão para tabelas futuras e reaplica, tabela a tabela, só o que o app precisa.

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, public;

revoke all on all tables in schema public from anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.notices, public.notice_files, public.notice_subjects, public.notice_topics to authenticated;
grant select on public.notice_extractions, public.ai_jobs, public.ai_usage to authenticated;
grant select, insert on public.study_plans, public.plan_versions, public.study_sessions, public.tasks to authenticated;
grant update (name, status, active_version_id) on public.study_plans to authenticated;
grant update (done_at, superseded_in_version, time_spent_sec) on public.tasks to authenticated;
grant select, insert, update, delete on public.question_logs, public.question_filters to authenticated;
grant select on public.legal_norms, public.legal_articles to authenticated;
grant select, insert, update, delete on public.legal_marks to authenticated;
-- ai_model_prices: sem permissões (só o backend).
