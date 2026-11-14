-- qbank_questions só tinha a chave primária. Com o banco próprio (56 mil questões, 206 MB), cada busca do cache por
-- matéria e assunto varria a tabela inteira (~9 s), várias vezes por pedido, e a das inéditas da IA por tema ~14 s: era a
-- maior parte da espera nas questões, e o limite de tempo estourado liberava a IA no lugar das questões reais.
create index if not exists qbank_questions_materia_assunto_idx on public.qbank_questions (materia, assunto);
create index if not exists qbank_questions_ia_tema_idx on public.qbank_questions ((payload->>'ia_tema'));
analyze public.qbank_questions;
