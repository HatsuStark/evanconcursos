-- Última nota de corte do cargo, em % da prova objetiva: define o mínimo e a meta de acerto do concurso.
-- Sem ela, o app usa mínimo de 80% e meta de 90%.
alter table public.notices add column cutoff_pct numeric(5, 2) check (cutoff_pct > 0 and cutoff_pct <= 100);
