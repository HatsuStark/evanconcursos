-- Apostilas em segundo plano: no máximo uma geração em andamento por apostila, mesmo entre estudantes.
create unique index ai_jobs_guide_running_idx on public.ai_jobs ((input->>'cacheKey'))
  where kind = 'study_guide' and status = 'running';
