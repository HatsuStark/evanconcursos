-- Artigos relacionados v2 (resumo do trecho citado, no próprio texto): os feitos na v1 são refeitos na próxima abertura.
update public.study_guides set related = null where jsonb_typeof(related) = 'array';
