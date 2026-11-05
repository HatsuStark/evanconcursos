-- Carreiras do banco de questões que valem para o edital (a específica e a geral, ex.: "Tribunais / Justiça Comum Federal e
-- Estadual (STF, STJ, CNJ, TRFs e TJ’s)" e "Tribunais"), escolhidas uma vez pela IA. null: ainda não escolhidas; vazio: nenhuma serve.
alter table public.notices add column qbank_carreiras text[];
