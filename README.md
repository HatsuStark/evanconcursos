# Evan Concursos

Preparação para concursos públicos guiada por IA: o estudante envia o edital em PDF, confere os dados extraídos, responde um questionário (disponibilidade, nível por matéria, perfil) e recebe um cronograma personalizado com orientação diária, materiais, revisões, questões e discursivas.

Começa como projeto pessoal (primeiro caso real: TJSP · Oficial de Justiça), com arquitetura pronta para vários usuários e vários concursos por usuário.

## Arquitetura

```
shared/      TypeScript puro, usado pelo web e pelas Edge Functions
  ai/        schemas Zod, prompts versionados, chamada ao Gemini e verificações da extração
  domain/    scheduler (calendário determinístico), foco adaptativo e revisão espaçada,
             filtro do QConcursos, materiais (buscas e lei seca)
web/         React + TypeScript (Vite)
supabase/
  migrations/ SQL versionado (aplicado com scripts/db.mjs push)
  tests/     testes pgTAP de isolamento entre usuários (scripts/db.mjs test)
  functions/ Edge Functions: notice-extract (leitura do edital), plan-design (estratégia e sessões); study-guide na E5
evals/       editais de referência (gabaritos) e avaliação da extração
scripts/     legal-seed.ts (carrega as leis do registro), db.mjs (migrações e testes do banco), deploy-functions.mjs (funções e segredos), gemini-models.mjs
```

Princípios:

- **IA só no backend**, com respostas validadas por schemas tipados e consumo/custo registrados.
- **Três etapas de IA separadas**: interpretação do edital, planejamento pedagógico e materiais.
- **Calendário determinístico**: datas, horas, revisões e simulados vêm do scheduler, nunca da IA. A IA decide conteúdo e prioridade.
- **Dados relacionais** com migrações versionadas, RLS por usuário e testes de isolamento; PDFs em bucket privado.
- **Cronograma versionado**: refazer o plano nunca apaga tarefas concluídas nem seus registros.

## Desenvolvimento

```bash
npm install
npm run dev        # app em http://localhost:5173
npm test           # testes (Vitest)
npm run check      # tipos + testes + build (o mesmo da CI)
```

Segredos ficam no `.env` (fora do Git; modelo em `.env.example`).

Banco (projeto Supabase linkado; sem Docker):

```bash
node scripts/db.mjs dry    # migrações pendentes
node scripts/db.mjs push   # aplica as migrações
node scripts/db.mjs test   # testes pgTAP (RLS, Storage), numa transação desfeita no fim
```

## Qualidade da extração

A leitura do edital é medida contra gabaritos feitos à mão (`evals/gabaritos`), com editais públicos de bancas diferentes (VUNESP, FGV, Cebraspe, inclusive edital com vários cargos). Os PDFs ficam fora do Git; o gabarito guarda a URL e o sha256.

| Métrica | Limite |
|---|---|
| Banca, cargo, data da prova, total de questões, discursiva e blocos | 100% |
| Matérias encontradas / corretas | 100% / ≥ 95% |
| Questões por matéria (quando o edital informa) | 100% |
| Tópicos que não aparecem no texto do PDF | ≤ 2% |

Prompt `notice-v2` com `gemini-3.8-flash`: 4/4 editais dentro dos limites (0% de tópicos fora do PDF), 35–80 s e US$ 0,03–0,07 por edital. Rode a avaliação antes de trocar modelo ou prompt:

```bash
node evals/pdf-text.mjs <pasta> evals/editais/*.pdf     # texto dos PDFs, para montar gabaritos
node --experimental-strip-types evals/run.ts [filtro]    # chama o Gemini (custo real) e gera evals/results/
```

No app, as mesmas verificações viram avisos na conferência (tópico não encontrado no PDF, soma de questões, data ausente ou passada).

## Planejamento do cronograma

1. **Questionário**: horas por dia da semana, data de início, revisão semanal, nível por matéria e um texto livre sobre o candidato.
2. **Estratégia (IA)**: prioridade 1–5 e foco de cada matéria (questões na prova × nível × perfil) e até 6 orientações.
3. **Dias por matéria (scheduler)**: o calendário determinístico calcula quantos dias de teoria cada matéria recebe.
4. **Sessões (IA)**: cada matéria é dividida em exatamente esse número de sessões, na ordem de aprendizado, cada uma apontando para os tópicos do edital. Uma correção determinística (`repairSessions`) garante contagem exata e cobertura de 100% dos tópicos; se a IA falhar, as sessões saem direto dos tópicos.
5. **Gravação**: `create_plan_version` grava versão, sessões e tarefas numa transação. Refazer cria nova versão a partir de hoje: tarefas futuras não feitas ficam substituídas; concluídas e passadas são preservadas.

Avaliação com a IA real (`node --experimental-strip-types evals/plan-run.ts [filtro]`), prompt `plan-v2`: TJSP Escrevente 11/11 e TJRJ 9/9 matérias com contagem exata e cobertura total já na resposta da IA (194/194 tópicos no TJRJ), cerca de 50 s e US$ 0,11 por plano.

## Questões (Quest API)

A chave fica só no servidor (segredo `QUEST_API_KEY`) e o gabarito nunca vai ao navegador antes da resposta. Filtros automáticos (`shared/qbank/map.ts`, prompt `qmap-v3`): matéria do edital → matéria da API (nome + tamanho da lista de assuntos; IA nos casos ambíguos) e sessão → até 5 assuntos escolhidos pela IA dentro da lista oficial (sem assunto correspondente, a sessão fica sem questões em vez de mostrar questões erradas). Busca: banca nos assuntos, depois os mesmos assuntos em outras bancas; Atualidades só em provas recentes; dias de reforço usam os assuntos com pior acerto. Avaliação nas sessões reais do TJSP (`evals/qmap-run.ts`): 93% de relevância ponderada, nenhuma questão irrelevante.

`scripts/e2e-questions.ts` testa a função ponta a ponta com um usuário temporário (exige incluir `e2e@evanconcursos.test` em `ALLOWED_EMAILS`).

## Leitor por voz

O botão **Ouvir** da apostila lê o texto com a voz do próprio navegador (Web Speech API): sem custo de IA e sem enviar nada a servidores do app. Lê bloco a bloco com destaque na tela, escreve siglas e abreviações por extenso (`shared/ai/speech.ts`) e tem pausar, pular seção, velocidade e escolha de voz. A qualidade da voz depende do aparelho; a leitura para ao sair da aba Apostila.

## Modo foco

Começar o cronômetro de uma sessão (ou o botão **Modo foco**) esconde barra lateral, painel direito e título da sessão e deixa só o elemento em uso (apostila, lei, PDF ou questões) ocupando a tela, com abas, tempo, meta de questões, pausar e concluir numa barra fina no topo. **Esc** ou "Sair do foco" volta ao normal sem parar o cronômetro; concluir a tarefa pausa e sai. Dias de simulado não entram no foco: já têm tela própria.

## Comentários

Cada questão tem uma discussão entre estudantes, liberada só depois de responder (no simulado, depois da entrega); a regra fica no banco, em funções `comment_*` e `comments_list`, sem acesso direto às tabelas. Só texto, com apelido (o e-mail nunca aparece), votos de "útil" ordenando a lista e limite de 5 comentários por minuto. Três denúncias de pessoas diferentes escondem o comentário. Não há painel: para revisar, consulte `question_comments where hidden` e, se for o caso, faça `update ... set hidden = false` e apague as linhas de `comment_reports` (ou apague o comentário). **Antes de abrir o app ao público:** publicar termos de uso com regras de comentários e canal de denúncia, e confirmar nos termos da Quest API que a discussão pública é permitida.

## Excluir um concurso

Na página **Concursos**, a lixeira de cada card apaga de vez o edital, os PDFs (edital e materiais), o cronograma, as tarefas, as tentativas e os simulados daquele concurso (`delete_notice`). Anotações, caderno de erros, flashcards e marcações de lei são por questão ou artigo: saem só se foram usados apenas nele. Fica o que também aparece em outro concurso, em questões livres ou em simulados personalizados, além dos catálogos compartilhados (apostilas, mnemônicos, questões, leis) e do registro de custo da IA. `scripts/e2e-delete-notice.ts` testa os buckets com login real.

## Prática além do cronograma

Página **Questões**: resolver questões livres com filtros (matéria, assunto, banca, ano, dificuldade, tipo — inclusive Certo/Errado —, órgão, cargo, só inéditas), **caderno de erros** (toda questão errada volta em 1, 7 e 30 dias), **flashcards** (Leitner; nascem das questões erradas e dos mnemônicos), **simulados** (do concurso, na estrutura de blocos e nota mínima do edital, completo ou reduzido, ou personalizados; com ou sem cronômetro; correção só na entrega) e **desempenho por contexto** (cronograma, livres, simulados, revisão). Os dias de simulado do cronograma abrem o simulado do concurso. No modo estudo, as questões são a última aba, a lei seca só aparece em assuntos de legislação, a explicação abre o artigo citado ("ver artigo") e cada bateria termina com resumo por assunto e tempo médio.

## Etapas

| # | Etapa | Status |
|---|---|---|
| E0 | Base React/TS, domínio portado com testes (equivalência com o gerador antigo), CI | feito |
| E1 | Banco: migrações, bucket privado de editais, RLS e testes de isolamento | feito |
| E2 | Upload do edital → extração (`notice-extract`) → conferência; registro de custo da IA | feito |
| E3 | Questionário → planejamento (`plan-design`, sessões ligadas aos tópicos) → cronograma versionado no banco | feito |
| E4.1 | Modo estudo: cronômetro, questões no QConcursos/TecConcursos em outra aba com filtro pronto e registro rápido na volta | feito |
| E4.2 | Lei seca: textos oficiais (normas.leg.br, CC BY 4.0) no banco e leitor com os artigos da sessão | feito |
| E4.3 | Questões no app (Quest API): filtros automáticos por sessão, correção no servidor, explicação da IA com base na lei seca | feito |
| E4.4 | Apostila da IA (completa ou revisão curta) baseada só no edital e na lei seca, com fontes e reaproveitamento | feito |
| E4.5 | Biblioteca pessoal: PDFs privados, leitor PDF.js e mapeamento de páginas para as sessões | feito |
| depois | Vídeos do YouTube integrados (precisa de chave da YouTube Data API) | |
| E5 | Roteiros e materiais em segundo plano, desempenho, reforço e discursivas | |

O app estático original está na tag `v0-legado`.
