-- Artigos relacionados da apostila: os citados fora dos trechos da sessão, com o texto oficial e a explicação da IA de como
-- complementam o tema (ou o sinal de que a frase não confere com o artigo). null = ainda não feito; {"running": iso} = em
-- andamento; {"failed": iso} = falhou (tenta de novo depois de 1 h); lista = pronto (vazia se não havia o que explicar).
alter table public.study_guides add column related jsonb;
