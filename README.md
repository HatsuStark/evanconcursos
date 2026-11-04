# Evan Concursos

Preparação para concursos públicos guiada por IA: o estudante envia o edital em PDF, confere os dados extraídos, responde um questionário (disponibilidade, nível por matéria, perfil) e recebe um cronograma personalizado com orientação diária, materiais, revisões, questões e discursivas.

Começa como projeto pessoal (primeiro caso real: TJSP · Oficial de Justiça), com arquitetura pronta para vários usuários e vários concursos por usuário.

## Arquitetura

```
shared/      TypeScript puro, usado pelo web e pelas Edge Functions
  ai/        schemas Zod, prompts versionados, chamada ao Gemini e verificações da extração
  domain/    scheduler (calendário determinístico), foco adaptativo e revisão espaçada,
             filtro do QConcursos, materiais (buscas e lei seca), vídeos (busca e ordenação)
web/         React + TypeScript (Vite)
supabase/
  migrations/ SQL versionado (aplicado com scripts/db.mjs push)
  tests/     testes pgTAP de isolamento entre usuários (scripts/db.mjs test)
  functions/ Edge Functions: notice-extract (leitura do edital), plan-design (estratégia e sessões), study-guide (apostila), discursive (treino e correção), videos (vídeo-aulas da sessão), entre outras
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

Prompt `notice-v2` com `gemini-3.8-flash` e raciocínio baixo: 4/4 editais dentro dos limites (0% de tópicos fora do PDF), 23–30 s e US$ 0,02–0,04 por edital. Se o Gemini recusar a transcrição (filtro `RECITATION`), a função tenta de novo dentro de um limite de 130 s, para gravar a falha antes de ser encerrada aos 150 s. Rode a avaliação antes de trocar modelo ou prompt:

```bash
node evals/pdf-text.mjs <pasta> evals/editais/*.pdf     # texto dos PDFs, para montar gabaritos
node --experimental-strip-types evals/run.ts [filtro]    # chama o Gemini (custo real) e gera evals/results/
```

No app, as mesmas verificações viram avisos na conferência (tópico não encontrado no PDF, soma de questões, data ausente ou passada).

## Planejamento do cronograma

1. **Questionário**: horas por dia da semana, data de início, revisão semanal, nível por matéria e um texto livre sobre o candidato.
2. **Estratégia (IA)**: prioridade 1–5 e foco de cada matéria (questões na prova × nível × perfil) e até 6 orientações.
3. **Blocos por matéria (scheduler-v2)**: o calendário determinístico (`shared/domain/scheduler.ts`) calcula quantos blocos de teoria cada matéria recebe, pelos pontos em jogo (questões na prova; sem o número no edital, a parte que falta do bloco da prova, `questionsOf`), pela distância até a meta (nível declarado), pela prioridade da IA e pela nota mínima eliminatória, com um bloco a cada 4 tópicos como mínimo.
4. **Sessões (IA, `plan-v3`)**: cada matéria é dividida em exatamente esse número de sessões, na ordem de aprendizado, cada uma apontando para os tópicos do edital e com a incidência do assunto na banca (1 a 3; o mais cobrado ganha mais sessões). Uma correção determinística (`repairSessions`) garante contagem exata e cobertura de 100% dos tópicos; se a IA falhar, as sessões saem direto dos tópicos.
5. **Gravação**: `create_plan_version` grava versão, sessões (com a incidência) e tarefas numa transação. Refazer cria nova versão a partir de hoje: tarefas futuras não feitas ficam substituídas; concluídas e passadas são preservadas.

Como um especialista monta o calendário:
- **Dia com 2 ou 3 blocos** de 1 h a 1h30, de matérias diferentes, alternando específica e básica. A ordem suave entre as matérias é corrigida trocando blocos com dias próximos; quando uma matéria domina o plano, a repetição que sobra fica espalhada (no TJSP real, nenhum dia repetiu matéria).
- **Questões desde o início, cada vez mais**: a meta do bloco de teoria cresce com a fase do plano (`theoryGoal`, pela posição do dia entre os dias de teoria): no 1º terço, 1 questão a cada 12 min (5 a 10, cerca de 60% teoria e 40% questões); no 2º, 1 a cada 5 min (10 a 20); no último, 1 a cada 3 min (15 a 30). Reorganizar mantém a fase: a meta da sessão movida é proporcional à original no tempo do novo dia (`movedGoal`). Blocos de **reforço** (questões dos pontos fracos) a partir da 3ª semana.
- **Pente-fino na reta final**: o primeiro bloco de cada dia da reta final (num dia de um bloco só, dia sim, dia não) relê o que já foi estudado na matéria, sem teoria nova: o que memorizar e as pegadinhas das apostilas existentes das sessões concluídas, da mais antiga para a mais recente, e as marcações feitas nos PDFs nas páginas de cada sessão (aba **Pente-fino**, `PenteFinoPanel`, ação `pente` da `study-guide`, que só lê e não gera apostila). Fecha com flashcards e 5 a 10 questões dos pontos fracos. Os outros blocos seguem como revisão final dos pontos fracos.
- **Prazo**: com 16 semanas ou mais, 12% de reta final e 10% de reforço; de 8 a 15, 15% e 15%; com menos de 8, 20% e 25%.
- **Simulados** no maior dia da semana: diagnóstico na 2ª semana, depois a cada 3 semanas (2 com menos de 16) e toda semana na reta final, menos a da prova.
- **Revisão semanal** num bloco de 45 min a 1h30 (40% do dia) no último dia de estudo da semana; dia com menos de 1h30 fica todo para ela.
- **Lei seca diária** (20 a 25 min, abrindo o dia) quando pelo menos um quarto das matérias cita lei: relê os artigos das sessões que citam artigos, no dia seguinte e uma semana depois (as de incidência 3, também um mês depois). Sem sessão para reler, o tempo volta para os outros blocos.
- **Ritmo**: semana leve (70% das horas) a cada 5, fora da reta final; dia com menos de 1 h só tem questões e revisão.
- **Rebalanceamento** (`rebalance` em `shared/domain/replan.ts`, cartão em Hoje): a cada 2 semanas sem mudança no cronograma e com pelo menos 20 questões, os blocos futuros de reforço e revisão final mudam de matéria para onde há mais pontos a ganhar até a meta (questões × distância até a meta), com prioridade a quem está abaixo da nota mínima eliminatória. A teoria não muda.

Avaliação com os editais reais (TJSP Oficial de Justiça e Prefeitura de Suzano, IA real, 2026-11-04): TJSP com 140 blocos de teoria (Direito 73%, nível iniciante declarado; Português 17), 76 leituras de lei seca, 7 simulados e nenhum dia com matéria repetida, US$ 0,11 de IA; Suzano (5 semanas) com 31 blocos de teoria, 11 de reforço e 9 de revisão final.

Avaliação com a IA real (`node --experimental-strip-types evals/plan-run.ts [filtro]`), prompt `plan-v2`: TJSP Escrevente 11/11 e TJRJ 9/9 matérias com contagem exata e cobertura total já na resposta da IA (194/194 tópicos no TJRJ), cerca de 50 s e US$ 0,11 por plano.

## Questões (Quest API)

A chave fica só no servidor (segredo `QUEST_API_KEY`) e o gabarito nunca vai ao navegador antes da resposta. Filtros automáticos (`shared/qbank/map.ts`, prompt `qmap-v3`): matéria do edital → matéria da API (nome + tamanho da lista de assuntos; IA nos casos ambíguos) e sessão → até 5 assuntos escolhidos pela IA dentro da lista oficial, com o **tema da sessão como foco** e o item do edital só como contexto (prompt `qmap-v4`: um item longo, como "Classes de palavras: substantivo, adjetivo, …, conjunção", vira várias sessões, e assunto genérico como "Classes de palavras" só entra sem um específico do tema; o pré-filtro pesa em dobro as palavras do tema). Mapa de sessão de versão antiga é refeito na próxima abertura, e a incidência só é medida de novo se os assuntos mudaram. Na sessão real "Substantivos e Adjetivos", saiu o genérico "Classes de palavras" e ficaram flexão do substantivo, do adjetivo, de gênero e de número (sem assunto correspondente, a sessão fica sem questões em vez de mostrar questões erradas). Trava de lugar (`shared/qbank/places.ts`): matéria ou assunto que cita estado, município ou sigla de órgão com UF ("Normas da Corregedoria-Geral de Justiça do Estado de Minas Gerais", "Lei Orgânica do Município de Natal", "TCE MG") só entra se o lugar aparece no órgão do edital ou no texto da sessão; categorias que misturam lugares ("Conhecimentos Específicos dos Municípios") nunca entram. Sessão que cita o município do órgão (`localPlace`: "Prefeitura Municipal de Suzano" → Suzano) usa só matéria daquele município, como "Município de Suzano - Legislação Aplicada". Não pega órgão diferente do mesmo lugar ou federal (ex.: regimento do TCU num edital do TJSP); aí vale a escolha da IA. Sessão que cita o órgão do edital (`organSearch`: "Tribunal de Justiça do Estado de São Paulo" → "TJ SP", marcado na sessão como "TJSP" ou "TJ SP") busca primeiro as matérias dele, e a corregedoria quando fala em normas; nas sessões "Normas TJSP" reais, deu "Legislação Aplicada - TJ SP". Banca do edital (`pickBoard`): nome exato, sigla ("Fundação Getulio Vargas" → FGV) ou palavras próprias ("Instituto Nosso Rumo" → NOSSO RUMO); sem correspondência, fica sem banca. Busca: só dificuldade média, difícil ou muito difícil (3 a 5), alternando entre elas; primeiro provas do mesmo cargo, depois da escolaridade do edital (`notices.education_level`) e depois de qualquer uma, nunca em dificuldade menor; em cada etapa, a banca e depois as outras no formato predominante dela (`qbank_subject_maps.banca_tipo`, 60% ou mais, 6 créditos por disciplina). Antes da API, vêm as questões já compradas (`fromCache`, tabela `qbank_questions`) que servem ao filtro e o estudante ainda não viu, a banca do edital primeiro: em 2026-11-03, das 248 questões pagas, só 28 tinham sido respondidas, porque lotes buscados adiantados e amostras das apostilas nunca voltavam. O app manda as questões que já estão na tela (`exclude`), para não voltarem no lote seguinte. A API devolve da questão mais antiga para a mais nova, então `takeNewest` anda de trás para frente, também em questões livres e simulados (3 créditos a mais por filtro, na primeira vez). Sessões não intercalam erros: o caderno de erros volta na tarefa de revisão semanal, que traz os erros vencidos do concurso, do cache e sem créditos; a resposta conta na tarefa e avança a etapa (1, 7 e 30 dias). Atualidades só em provas recentes; dias de reforço usam os assuntos com pior acerto. Questões livres começam em "Média ou difícil", mas o estudante pode mudar. Simulados do concurso usam a escolaridade do edital, com a dificuldade livre, como numa prova real. Avaliação nas sessões reais do TJSP (`evals/qmap-run.ts`): 93% de relevância ponderada, nenhuma questão irrelevante.

**Triagem de relevância e questões inéditas** (`shared/qbank/relevance.ts`, `shared/qbank/generated.ts`): o assunto da API é largo demais para o tema de uma sessão ("Prazos" junta a contagem dos arts. 798 e 798-A do CPP com os prazos do procedimento ordinário). Antes de mostrar o lote de uma sessão, a IA confere cada questão nova contra o tema, com raciocínio baixo, e descarta a de outro tema; na dúvida, sai. O veredito fica em `qbank_relevance`, por sessão, para não julgar nem mostrar de novo, e até 3 rodadas repõem as descartadas no mesmo pedido. Se a triagem falhar, as questões passam. **Corte de assunto ruim** (`prunedAssuntos`): a API não mostra o texto antes da compra (3 créditos sem gabarito, 6 com), então a economia vem de parar de comprar onde a triagem descarta muito; com 5 ou mais questões julgadas de um assunto na sessão e 60% ou mais descartadas, a sessão deixa de comprar dele, e a parte dele vai para os outros assuntos ou, sem nenhum, para as inéditas da IA (sem créditos). A questão descartada fica no cache e serve de graça à sessão em que ela está no tema. Sem questão real no tema (ou sessão sem assunto no banco), a sessão recebe **questões inéditas da IA** no formato e estilo da banca, só sobre o tema e apoiadas nos artigos oficiais da sessão, marcadas como "Inédita (IA)". Elas ficam em `qbank_questions` (qid `ia-…`, marca `ia_tema`), então correção, caderno de erros, explicação e comentários funcionam igual, e são reaproveitadas entre estudantes com o mesmo tema. Nível médio a difícil (`qgen-v2`): o prompt leva até 3 questões reais no tema como modelo (as que a triagem aprovou na sessão ou, sem elas, as do cache nos assuntos dela) e pede caso concreto, parágrafos, incisos e exceções, e distrator que troca um único detalhe da lei, sem distrator absurdo; cada questão traz o dispositivo que decide a resposta, e as da versão anterior não são reaproveitadas. Na sessão de normas fundamentais e competência do CPC, saíram casos sobre os arts. 25, 45, § 3º, e 47, § 2º (52 s). Busca sem desperdício de tempo: a Quest API aceita uma chamada a cada ~1,1 s, e busca vazia custa o mesmo que cheia. O mapa pede até 8 assuntos em ordem de relevância e a medição de incidência fica com os 5 primeiros que têm questões (assunto sem questão na banca e com menos de 5 nas outras sai). Cargo e escolaridade só estreitam a busca da disciplina quando rendem (`usefulNarrowing`: ao menos 500 questões na matéria e no máximo 90% dela; medido uma vez em `qbank_subject_maps.narrowing`). Na sessão de normas fundamentais e competência do CPC (VUNESP, Oficial de Justiça), o cargo tinha 178 questões na matéria e o nível superior 97% dela: cada assunto passava por 18 buscas, quase todas vazias, antes de chegar às outras bancas, e a sessão caía nas questões da IA; agora passa por 6. **Normas enviadas pelo estudante** (`shared/legal/norms.ts`, função `law-upload`, bucket privado `leis`): `unlistedNorms` acha as normas citadas no edital ou no título da sessão que não estão no registro (ex.: Lei estadual 10.261/68, Resolução CNJ 354/2020, Lei 11.608/2003). O questionário lista as do edital, e a aba Lei seca, as do título da sessão. O estudante envia o PDF oficial, `parseNormsText` separa os artigos, e a norma fica em `legal_norms` com `owner_id`, só para ele (não há como garantir que o PDF é o oficial). Para esse estudante, ela vale como lei do registro (`ownLawEntry`, parâmetro `extra` de `findLawRefs`/`sessionLawRefs`/`lawByKey`) na lei seca, na apostila, nas questões e discursivas da IA e na medição do cronograma. O plan-design também baixa do normas.leg.br as leis do registro que ainda não estão no banco. **Aprendizado adaptativo** (migração `adaptive_learning`): (1) os dias "Aprofundamento:" e "Revisão com questões:" ficam reservados no plano, e o tema de cada um é escolhido quando o dia chega (`bind_adaptive_sessions`, chamado ao carregar o plano e ao abrir a sessão): a sessão já concluída da matéria com maior (1 − acerto suavizado) × cobrança², com a cobrança da banca medida no banco de questões quando houver, e peso 0,3 para tema aprofundado nos últimos 14 dias; (2) nesses dias, as questões começam pelos erros do estudante no tema e são só de dificuldade 4 e 5, e a apostila tem a profundidade "aprofundamento" (exceções, distinções finas, casos difíceis, pegadinhas, sem repetir o básico); (3) a revisão de teoria ajusta o intervalo (1, 7, 30 dias) pelo acerto na sessão: 85% ou mais estica 1,5×, abaixo de 60% encurta pela metade; (4) o preparo das apostilas mede a cobrança da banca por assunto de cada sessão; (5) aquecimento: cada sessão de teoria começa com até 3 questões da sessão anterior da matéria (erradas primeiro), e a resposta conta para a anterior (`answer_question(p_session)`). **Dias pelo conteúdo e pela cobrança** (`allocateSessions`, plan-v4): a matéria tem n dias de teoria (do tempo disponível), e a IA devolve até n sessões, sem repetir assunto para completar. Cada sessão começa com um dia; os que sobram vão primeiro para conteúdo que não cabe num dia (lei medida no texto oficial a ~150 caracteres por minuto de sessão vira partes, cada uma com o intervalo de artigos vigentes no título, para lei seca, apostila e questões focarem nele; sem lei, divide os tópicos) e depois para aprofundamento, escolhido por incidência ao quadrado e, menos, pelo tamanho, até 2 por sessão (o 2º é "Revisão com questões"), 3 sessões depois da original. Sessão de lei curta nunca ganha dia extra; norma sem texto no banco é estimada pelos artigos citados. Faltando dias, juntam-se as vizinhas de menor peso. As citações de artigos também passaram a pegar todas as listas de cada norma ("Cap. I, arts. 1º a 4º; Cap. III, arts. 33, 47 e 49"), até a próxima norma citada. **Sessão de lei quase vazia** (`mergeShortLawSessions`, no passo de sessões do plan-design): o edital às vezes cita artigos revogados ou só remissivos. Cada sessão com artigos citados é medida no texto oficial; com menos de 600 caracteres vigentes, ou maioria revogada e menos de 1.500, ela é juntada à vizinha mais próxima da mesma lei, com os artigos vigentes no título, e repairSessions divide a maior para manter a contagem. No cronograma de Oficial de Justiça do TJSP, isso pegou 3 sessões: Normas da CGJ arts. 105 a 110 (só o 105 vigente, remissivo) e duas sessões sobre os arts. 1.071 a 1.091-A, todos revogados. Vale para cronogramas novos e replanejamentos. **Fontes legais da sessão: o título manda** (`sessionLawRefs`, usado em questões da IA, apostila e discursivas): o item do edital costuma juntar leis de várias sessões, então só completa o título quando bate com ele. Título com artigos de lei conhecida usa só eles; título que cita artigos de norma fora do registro não recebe nada do item; título que nomeia a lei sem artigos usa os artigos dela no item; título sem lei usa o item só se ele tiver uma lei só. Antes, a sessão "Normas da CGJ (arts. 1º a 4º, 33, 47 e 49)" recebia a Lei 6.830, a primeira do item, e as questões da IA saíam sobre execução fiscal. **Artigos gravados na sessão** (plan-v5, coluna `study_sessions.law_refs`): na montagem, a IA devolve com cada sessão a lei e todos os artigos (campo `laws`, só números, códigos do registro e das normas enviadas pelo estudante); o app confere as leis (`aiLawRefs`), soma os artigos que o próprio título cita, mede no texto oficial e grava em `law_refs`, que acompanha junções, partes e aprofundamentos. Lei seca, apostila, questões e discursivas buscam o texto por esse campo (`resolveSessionRefs`) e só leem o título em planos antigos. Lista da IA que não acha nenhum artigo no banco cede lugar à leitura do título. **Normas da CGJ SP (Tomo I)**: a Quest API tem só 20 questões sobre as Normas da Corregedoria (cerca de 13 do Tomo I, judicial), então essas sessões vivem das questões da IA. Para elas saírem do texto oficial, o Tomo I (NSCGJ) entrou no registro de leis com o PDF do site do TJSP; `parseNormsText` separa os artigos do texto do PDF (pula o sumário e os provimentos de abertura, tira as notas de rodapé, guarda capítulo e seção) e `node --experimental-strip-types scripts/legal-seed.ts NSCGJ` carrega (1.511 artigos, até o 1.315). A função legal-text não busca essa norma no normas.leg.br. Cada questão da IA guarda quantos artigos oficiais recebeu (`ia_fontes`), e tema que cita artigos só reaproveita as feitas com o texto. **Banca primeiro**: cada pedido busca em duas passadas, primeiro só a banca do edital em todos os assuntos (cache e depois API) e só o que faltar nas outras bancas; no lote, as questões da banca vêm antes. Teste real na sessão de contagem de prazos do CPP: a triagem separou as 3 questões fora do tema (procedimento ordinário, investigação e ANPP, prescrição) das 2 no tema (US$ 0,002), e as 3 inéditas cobriram os arts. 792, 798 e 798-A com gabaritos conferidos com a lei (23 s, US$ 0,01).

**Meta e distribuição:** a sessão de teoria pede de 5 a 30 questões, mais conforme o plano avança (`theoryGoal`, ver Planejamento do cronograma); é só meta, e o estudante pode continuar. Primeiro, todos os assuntos da sessão recebem uma questão, do mais ao menos cobrado. Depois, cada questão vai para o assunto mais abaixo da sua parte na cobrança da banca (`planPicks`). A cobrança é o total de questões da banca em cada assunto, medido uma vez por sessão com 3 créditos por assunto (`qbank_session_maps.incidence`); sem nenhuma na banca, vale o total das outras. Dias de consolidação mantêm a meta maior. A API não mostra ordenação por repetição: só dentro de cada lote vêm antes as questões que caíram em mais provas.

**ID da questão:** cada questão mostra o id da Quest API, e a aba Questões → Resolver abre uma questão por esse id (`action: 'by_id'`). Questão já em cache não gasta créditos; as outras custam 6. Anuladas ou sem gabarito não abrem. A resposta entra no histórico de questões livres.

`scripts/e2e-questions.ts` testa a função ponta a ponta com um usuário temporário (exige incluir `e2e@evanconcursos.test` em `ALLOWED_EMAILS`).

## Reorganizar depois de atrasos

Com tarefas atrasadas, a tela Hoje e o Cronograma mostram o que mudaria e só gravam ao clicar em **Reorganizar** (`shared/domain/replan.ts`, sem IA e sem custo). Tarefas feitas não mudam. Toda sessão de teoria pendente continua no plano, na mesma ordem, a partir de hoje. O espaço vem dos dias de consolidação, depois da revisão final e da revisão semanal; simulados, véspera e prova ficam onde estão. Se ainda faltar tempo, um dia recebe mais de uma sessão, com tempo e meta divididos. Revisões e simulados que já passaram saem da agenda. Os dias de reforço restantes são redistribuídos pelo peso no edital e pela fraqueza da matéria, em que **erro por falta de atenção** conta metade. A função `replan_version` grava uma nova versão (`adaptive`), mantém as tarefas antigas no histórico, reaproveita as sessões (apostila, PDFs e questões continuam ligados) e leva tempo estudado e tentativas para a tarefa nova.

**Motivo do erro:** ao errar, o estudante pode marcar falta de conteúdo, falta de atenção ou pegadinha (`question_attempts.error_reason`). O total aparece em Desempenho.

## Leitor por voz

O botão **Ouvir** da apostila lê bloco a bloco com destaque na tela, escreve siglas e abreviações por extenso (`shared/ai/speech.ts`) e tem pausar, pular seção, velocidade e escolha de voz. A leitura para ao sair da aba Apostila. Nenhuma voz em uso tem custo por leitura:

- **Cadu** (padrão; Piper, `web/src/lib/piper.ts`): gerada no próprio aparelho, em worker, com locução mais pausada que o padrão do modelo (`CONFIG` em `web/src/lib/piper.worker.ts`). Baixa o modelo de 63 MB de `VITE_VOICE_MODEL_URL` uma vez (padrão: bucket `evan-vozes` no Cloudflare R2, sem custo de saída; fica no OPFS do navegador) e carrega o runtime dos CDNs cdnjs e jsDelivr, em versões fixas. O texto não sai do aparelho e o áudio não é salvo. Se o modelo for hospedado em outro domínio, inclua-o em `connect-src` no `web/public/_headers`.
- **Navegador** (Web Speech API): sem download; a qualidade depende do aparelho.

**Antes do uso comercial:** o pacote `@mintplex-labs/piper-tts-web` se declara MIT, mas o componente de pronúncia que ele carrega deriva do espeak-ng (GPL). Revisar as licenças do pacote, desse componente e da voz.

**Vozes de IA, fora de uso:** a função `guide-voice`, a tabela `guide_audio` e o bucket `guide-audio` continuam no backend, sem chamadas do app, para um futuro plano pago (Gemini TTS, cerca de US$ 0,09 por apostila e voz no modelo Lite, com áudio salvo e reaproveitado). O acesso segue `ALLOWED_EMAILS`; `GEMINI_TTS_MODEL` troca o modelo.

## Modo foco

Começar o cronômetro de uma sessão (ou o botão **Modo foco**) esconde barra lateral, painel direito e título da sessão e deixa só o elemento em uso (apostila, vídeo, lei, PDF ou questões) ocupando a tela, com abas, tempo, meta de questões, pausar e concluir numa barra fina no topo. **Esc** ou "Sair do foco" volta ao normal sem parar o cronômetro; concluir a tarefa pausa e sai. Dias de simulado não entram no foco: já têm tela própria.

## Comentários

Cada questão tem uma discussão entre estudantes, liberada só depois de responder (no simulado, depois da entrega); a regra fica no banco, em funções `comment_*` e `comments_list`, sem acesso direto às tabelas. Só texto, com apelido (o e-mail nunca aparece), votos de "útil" ordenando a lista e limite de 5 comentários por minuto. Três denúncias de pessoas diferentes escondem o comentário. Não há painel: para revisar, consulte `question_comments where hidden` e, se for o caso, faça `update ... set hidden = false` e apague as linhas de `comment_reports` (ou apague o comentário). **Antes de abrir o app ao público:** publicar termos de uso com regras de comentários e canal de denúncia, e confirmar nos termos da Quest API que a discussão pública é permitida.

## Acesso por convite e publicação

O site fica na Netlify, ligada ao GitHub: cada push na `main` publica (`netlify.toml`). O cadastro público está desligado no Supabase, e só entra quem tem conta criada por `scripts/users.mjs`:

```
node scripts/users.mjs add email@exemplo.com     # cria a conta, libera em ALLOWED_EMAILS e mostra a senha temporária
node scripts/users.mjs reset email@exemplo.com   # nova senha temporária (não há "esqueci a senha")
node scripts/users.mjs remove email@exemplo.com  # encerra o acesso; os dados ficam no banco
node scripts/users.mjs rename antigo@x.com novo@y.com  # troca o e-mail da conta (mesma senha e dados)
node scripts/users.mjs list                      # contas, último acesso e gasto de IA em 30 dias
```

A troca da senha temporária é obrigatória no primeiro acesso. Na página **Conta**, o estudante altera a senha e sai. Não há limite de IA por pessoa: o controle é a lista de convidados e o `list`. A cota do YouTube e as chaves de IA são compartilhadas.

O CSP de produção fica em `web/public/_headers` e não se aplica ao `npm run dev`: recurso externo novo precisa entrar lá. Hoje ele libera o player do YouTube e as origens que a voz local baixa (cdnjs, jsDelivr e Hugging Face). A violação `script-src eval` no console é a sondagem do Zod, que ele captura; não libere `unsafe-eval` por causa dela.

**Antes de abrir a qualquer pessoa:** limite de IA por usuário, termos de uso e privacidade (LGPD), canal de denúncia, e-mail transacional com "esqueci a senha" e confirmar o uso nos termos da Quest API.

## Edital verticalizado

A página **Edital** lista todos os tópicos do edital por matéria: situação (não estudado, em andamento, estudado, fora do cronograma), questões, acerto, última vez visto e atalho para a próxima tarefa do tópico. Filtros: não estudados, pontos fracos e estudados sem questões. Um tópico é **ponto fraco** com pelo menos 5 questões e acerto abaixo do mínimo do concurso, o mesmo limite do reforço. Mínimo e meta (`scoreGoal` em `shared/domain/adaptive.ts`): com a última nota de corte do cargo (`notices.cutoff_pct`, % da prova objetiva, preenchida no painel lateral desta página), mínimo nela e meta 10 pontos acima, até 95%; sem ela, mínimo de 80% e meta de 90%. Valem para o veredito da sessão, as cores de desempenho, o resumo da bateria e o resultado do simulado, que mostra também os mínimos dos blocos do edital. **Onde focar** ordena os pontos fracos pelo erro e pelo peso da matéria. Sem IA nem custo: a conta está em `shared/domain/verticalized.ts`, e o banco só soma as questões por sessão (`session_attempt_stats`).

A tentativa aponta para a sessão, não para o tópico. Por isso, uma sessão com vários tópicos conta suas questões para todos eles, sem repetir nos totais da matéria. Simulados, revisão de erros e questões livres não têm sessão e ficam fora: continuam na aba Desempenho.

## Revisão de teoria

Concluir uma sessão de teoria agenda o tema para voltar em **1, 7 e 30 dias**, os mesmos intervalos do caderno de erros. Os temas vencidos aparecem em **Hoje**, do mais atrasado para o mais recente, e abrem a sessão com a revisão curta da apostila. O estudante tenta lembrar, faz algumas questões, se quiser, e responde: **lembrei bem** avança (depois da 3ª, o tema encerra), **lembrei em parte** repete o intervalo e **esqueci** volta para 1 dia. O resultado é a avaliação do próprio estudante; o app não o confere com as questões.

**Tema em partes** (`shared/domain/parts.ts`, migração `theme_reviews`): lei longa vira "Tema (parte 1 de 3): ...". O cronograma põe cada parte até 2 dias de estudo depois da anterior (sem vaga, até 3), nunca no mesmo dia, trocando o bloco com o de outra matéria (`keepPartsClose`); antes, a parte seguinte caía no próximo bloco da matéria, uma ou duas semanas depois em matéria leve. Aprofundamento nunca entra entre duas partes. A revisão espaçada conta o tema inteiro: concluir uma parte que não é a última adia a revisão para o dia seguinte à data planejada da última parte; concluir a última abre uma revisão só ("Tema (partes 1 a 3)" em Revisões, com links para reler as outras partes) e apaga as das partes anteriores ainda não feitas, e o intervalo usa o acerto de todas as partes. Da parte 2 em diante, o aquecimento traz até 5 questões da parte anterior (no máximo metade das questões do dia).

**Prioridade pela cobrança** (`shared/domain/priority.ts`): com prazo curto (até 12 semanas de calendário até a prova), a montagem põe, em cada matéria, os temas mais cobrados (incidência estimada pela IA, 1 a 3) primeiro; empate fica na ordem do edital, as partes andam juntas e os aprofundamentos ficam no lugar. A estratégia do plano ganha uma orientação dizendo isso. **Edital todo visto antes da reta final** (`shared/domain/coverage.ts`, aviso em Hoje e no Cronograma): a até 8 semanas do primeiro dia de pente-fino ou revisão final, sem tarefa atrasada, o app compara as sessões de teoria concluídas nas últimas 3 semanas com as que o plano pede no mesmo tempo. Se, nesse ritmo, o conteúdo novo pendente não couber até a reta final, avisa quantos temas ficariam para depois e quais estão no fim da fila, e oferece **Priorizar**: nos mesmos dias de teoria de cada matéria, os temas mais cobrados primeiro e os aprofundamentos depois do conteúdo novo; a lei seca pendente passa a reler a sessão que agora ocupa o dia de teoria que ela seguia. Grava como reorganização (`replan_version`, `summary.replan.kind = prioritize`).

Perto da prova, a revisão é antecipada para a véspera, e nada novo é agendado a partir da véspera. Desfazer a conclusão apaga a revisão ainda não feita. As regras ficam no banco (`theory_reviews`, `theory_review_answer`), com datas no fuso de Brasília. A única despesa de IA é gerar a revisão curta, uma vez por tema, com reaproveitamento.

## Adiantar o estudo

Em **Hoje**, **Ver próximas tarefas** lista as tarefas pendentes dos próximos dias, e clicar em uma matéria de **Conteúdo estudado** abre todas as aulas dela. Qualquer uma pode ser estudada antes da data. A tarefa adiantada continua na data original, já marcada como feita, e as demais não mudam de dia; a revisão de teoria conta a partir do dia da conclusão.

## Painel de revisões

`/revisoes`, aberto por **Ver todas** no cartão de revisão da tela Hoje, separa os temas em atrasadas, de hoje, programadas e concluídas. Só as revisões vencidas podem ser respondidas, como manda `theory_review_answer`.

## Ciclo de estudos

Em **Cronograma**, o estudante alterna entre **Agenda** e **Ciclo** sem refazer o plano (`study_plans.pacing`). No ciclo, as mesmas tarefas viram uma fila na ordem do plano, sem dias fixos e sem tarefa atrasada: a tela Hoje mostra as próximas, e as datas só medem o ritmo até a prova (`shared/domain/cycle.ts`). Voltar para a agenda devolve as datas originais, e o que passou sem ser feito aparece como atrasado, com a proposta de reorganizar.

Metas semanais e folgas continuam vindo do plano, e o preparo antecipado de apostilas segue as datas: no ciclo, a apostila pode ser gerada só ao abrir a sessão.

## Plano sem prazo

Edital com a prova já realizada também é aceito. O questionário avisa que ele não está aberto, e o plano fica sem prazo, adaptando-se ao desempenho (`shared/domain/rounds.ts`, sem IA nas rodadas). Trocar a data na conferência por uma futura e refazer o cronograma volta ao plano com data.

1. **Primeira volta:** todas as sessões, em fila, sem datas nem atrasos. O número de sessões vem do tamanho do conteúdo (cada tópico, com mínimo de 4 por matéria e teto de 180), e não do tempo até a prova.
2. **Rodadas de 2 semanas:** com menos de 3 tarefas pendentes, o app grava sozinho uma nova rodada pela `replan_version`. Os dias vão para as matérias por `peso no edital × fraqueza`; dentro de cada matéria, vêm primeiro as sessões mais fracas e há mais tempo sem ver. Sessão fraca vira **Reforço**, e a boa ou ainda sem dados vira **Manutenção**, com 5 a 10 questões da própria sessão.
3. **Equilíbrio:** nenhuma matéria passa de 40% da rodada, e toda matéria aparece; se faltarem dias, ficam as há mais tempo sem estudo. Há um simulado a cada 4 semanas e a revisão semanal, se foi pedida no questionário.
4. **Edital dominado:** a tela Hoje troca a contagem regressiva por esse percentual, ponderado pelo peso das matérias. Uma sessão conta com 80% de acerto nas últimas 10 questões e estudo nos últimos 60 dias. Sem isso, deixa de contar.

A revisão de teoria segue os intervalos normais de 1, 7 e 30 dias. Depois disso, os temas voltam pelas rodadas. Esses valores são pontos de partida, ainda sem medição com uso real.

**Novo edital:** no plano sem prazo, **Saiu novo edital?** envia o PDF pelo fluxo normal de leitura e conferência e mostra o que mudou, sem alterar o plano (`shared/domain/notice-diff.ts`, sem IA). Cada tópico novo é comparado aos antigos: **igual**, **mudou um pouco** ou **novo**; na dúvida, conta como novo. Leis diferentes nunca casam, e artigo que o edital antigo não citava é apontado. Um tópico longo só conta como estudado com todas as suas sessões concluídas. Trocar banca, cargo ou órgão gera aviso.

Ao confirmar, o plano do novo edital é gerado com o conteúdo novo primeiro em cada matéria; a sessão já estudada vira tarefa de **Revisão**, com a apostila curta. A `adopt_notice_update` arquiva o plano e o edital antigos, com o histórico, leva as apostilas, que são mapeadas de novo, e leva o desempenho das matérias equivalentes, salvo se a banca mudou. Ajustes manuais de páginas não vão junto, porque apontam para as sessões antigas. Excluir o concurso apaga também os editais antigos que ele substituiu. Edital novo sem data fica sem prazo.

Avaliação com editais reais (`node --experimental-strip-types evals/notice-diff-run.ts <antigo.pdf> <novo.pdf>`): TJSP Escrevente 2023 → 2025 deu 32 iguais, 7 parecidos e 4 novos; TJSP × TJRJ, concursos diferentes, deu 0 coincidências em 70 tópicos.

## Metas e constância

As metas da semana (segunda a domingo) saem do cronograma, sem configuração: horas, questões e tarefas previstas contra o que foi feito na semana. Tarefa adiantada ou atrasada conta na semana em que foi feita, e questões de qualquer origem do concurso contam. A constância soma os dias seguidos com pelo menos 1 minuto de cronômetro, uma questão, uma tarefa concluída ou uma discursiva corrigida. Hoje ainda sem estudo e as folgas do questionário não quebram a sequência. Depois de reorganizar ou refazer o cronograma, valem as folgas da versão ativa.

O cronômetro guarda o total por tarefa, então um gatilho soma o que ele avança em `study_days`, por concurso e dia no fuso de Brasília. O tempo estudado antes dessa tabela não entra nas horas. A conta fica em `shared/domain/goals.ts`.

## Como a banca cobra

As seções da apostila podem trazer um destaque **Como a [banca] cobra**, escrito pela IA a partir de até 8 questões reais da banca nos assuntos da sessão (`boardSample`). Primeiro usa as questões já guardadas; faltando, busca na Quest API, a 6 créditos por questão, uma vez por apostila. Sem questão real, sem banca identificada ou em Atualidades, o destaque não aparece: o servidor descarta o que a IA tiver escrito (`applyBoardEvidence`). É uma leitura de amostra, e o rodapé diz o tamanho dela. A mudança veio com o prompt `guide-v2`: cada apostila antiga é gerada de novo só quando aberta, e as antigas continuam no banco.

## Atribuições do cargo

**Escolha do cargo:** o candidato não digita mais o cargo. Depois do envio do PDF, a `notice-extract` (`action: 'roles'`, prompt `roles-v1`, pelo texto do PDF) lista os cargos do quadro de vagas com código e escolaridade, e o candidato escolhe o dele (com um só cargo, a leitura começa direto; sem lista, volta o campo de texto). A leitura (`notice-v5`) recebe o nome literal, o código e os demais cargos: nada de "o cargo mais próximo", e em quadros e anexos com vários cargos vale só o trecho com o título do escolhido. O cargo e os outros cargos gravados vêm da escolha, não da IA. Com o cargo digitado e "o mais próximo", a leitura do Agente Escolar de Suzano voltou como Agente de Segurança Escolar, que fica na linha de cima da tabela de provas e no bloco anterior do Anexo II. Teste real (`node --experimental-strip-types evals/roles-run.ts <edital.pdf> "<cargo>"`) no edital de Suzano: 22 cargos em 8 s (US$ 0,05) e leitura do 102 com as atribuições e os Conhecimentos Específicos do Agente Escolar (21 s, US$ 0,04). O Gemini recusa `maxItems` no schema (erro 400), por isso a lista não tem limite no schema e é cortada no código.

A leitura do edital (desde `notice-v4`) guarda as atribuições do cargo escolhido (`notices.role_duties`), conferidas e editáveis na conferência e no painel da aba Edital. Estratégia, sessões do cronograma e apostilas recebem essas atribuições e a lista dos outros cargos do edital, com a ordem de não usar o que é deles; sem elas, a IA deduzia pelo nome do cargo e, no edital de Suzano, escreveu a apostila de "Atribuições do Cargo" do Agente Escolar com funções de vigilância do Agente de Segurança Escolar. Apostila de tema do cargo (atribuições, rotina, funções: `roleSpecific`) leva o cargo na chave e não é reaproveitada de tema parecido. Leitura real do edital de Suzano com o prompt novo: atribuições iguais às do Anexo I do cargo 102, 17 s e US$ 0,04.

## Apostila de especialista

Prompt `guide-v5` (`shared/ai/guide.ts`; aprofundamento `deep-v2`, revisão `review-v2`): a apostila segue o roteiro de material de cursinho, no **tom de professor explicando em aula** para quem nunca estudou o assunto: fala com o aluno, explica a ideia em palavras do dia a dia antes do nome técnico, traduz todo termo técnico na primeira vez (o termo fica, porque a prova usa), comenta cada artigo dizendo primeiro o que ele quer dizer na prática, usa exemplos com pessoas e situações da rotina do cargo, antecipa a dúvida do aluno e evita juridiquês e latim; prazos, números e exceções continuam exatos. Na revisão curta, os itens seguem de uma linha, em palavras simples. **Duas partes em paralelo** (`GuideText` e `GuidePractice`): o tempo da apostila é quase todo de escrita (numa chamada só, ~4.500 tokens de saída, 45 a 85 s; média de 67 s na `guide-v4`). Completa e aprofundamento saem em duas chamadas ao mesmo tempo, com raciocínio baixo: o texto (introdução, mapa, seções, quadros, lei comentada) começa na hora e é gravado como `parcial` assim que fica pronto, e a tela já mostra; a prática (o que memorizar, o que mais cai, pegadinhas, resumo, questões de fixação, perguntas e "como a banca cobra") começa quando chegam as questões da banca e completa a apostila. "Como a banca cobra" vem por assunto e vai para a seção que mais compartilha palavras com ele (`mergeGuide`). Se a prática falhar, fica a apostila só com o texto. Medido na sessão de nulidades do CPP, sem as questões da banca: texto em 19 a 23 s e apostila inteira em 23 a 25 s, US$ 0,02, nenhuma citação fora das fontes; no servidor, a busca das questões da banca (cerca de 17 s na primeira vez da sessão) atrasa só a prática. A revisão curta continua numa chamada só. Na sessão de nulidades do CPP (arts. 563 a 570), a 1ª seção passou a abrir com "Imagine que um ato no processo não seguiu o modelo previsto na lei, mas atingiu seu objetivo…" (66 s, US$ 0,03). Objetivos do tema, mapa do assunto, seções do conceito para as exceções com prioridade ("cai muito" no que a banca mais cobra), quadros comparativos do que a banca costuma confundir, lei seca comentada, **para memorizar** (prazos, penas, quóruns, só dos artigos fornecidos), pontos de prova, pegadinhas, resumo, **questões de fixação** inéditas no formato da banca (múltipla escolha ou certo/errado, pelo `banca_tipo` da matéria), com gabarito comentado, e perguntas de revisão. Tudo passa pela conferência de citações, e o leitor por voz lê também quadros, o que memorizar e as questões. **Revisão curta** (prompt `review-v1`, versão própria: mudar a revisão não refaz as completas): folha de memorização para quem já estudou, sem texto corrido e sem questões de fixação (a revisão de teoria usa as questões reais). Traz **mapa mental** (tema no centro e 4 a 6 ramos com palavras-chave), **mnemônicos** (1 a 3, só para listas, requisitos, ordens e prazos das fontes, com a explicação de cada letra), **gatilhos de prova** (pista do enunciado → o que lembrar), o que memorizar, até 3 artigos-chave, pegadinhas, resumo e 3 perguntas para tentar lembrar. `trimReview` (`REVIEW_LIMITS`) garante os tetos ao gravar e ao servir, e a revisão não compra questões da banca. Avaliação real (`evals/guide-run.ts revisao`): 4 a 7 mil caracteres (25% a 43% da completa), cerca de US$ 0,02. Antes, em 2026-11-03, a revisão tinha 74% do tamanho da completa. O pente-fino mostra também os mnemônicos e gatilhos das revisões já geradas. Apostilas antigas (`guide-v3`) continuam abrindo; as novas saem com a versão nova. Exemplo real (peculato e concussão, CP arts. 312 a 316, VUNESP): 2 quadros, 10 itens para memorizar, 5 questões, nenhuma citação fora das fontes, 62 s e US$ 0,03.

## Apostilas em segundo plano

A apostila é gerada no servidor, sem depender da tela: dá para sair e voltar, e a tela consulta a cada 4 s até ficar pronta. Uma trava em `ai_jobs` (índice único, com liberação depois de 3 min) impede pagar duas vezes pela mesma apostila, mesmo com estudantes diferentes.

Ao abrir a tela **Hoje**, no máximo uma vez por dia e plano, o app prepara as apostilas **completas** das sessões pendentes dos próximos 3 dias, até 2 por vez, na ordem do cronograma. A revisão curta só é gerada ao pedir. O que já existe não gasta nada, e uma apostila que falhou só volta a ser tentada automaticamente depois de 24 h. Custo medido: cerca de US$ 0,02 a 0,03 por apostila, com o texto na tela em cerca de 20 s (`guide-v5`). Com 2 sessões por dia, são cerca de US$ 0,06 por dia, valor que seria gasto de qualquer forma ao estudar essas sessões. Para mudar o horizonte ou o limite: `PREPARE_DAYS` e `PREPARE_MAX` em `supabase/functions/study-guide/index.ts`.

## Vídeos

A aba **Vídeos** do modo estudo sugere até 5 vídeo-aulas da sessão, de qualquer duração, com player dentro do app e marcação de assistido por concurso. Não usa IA: a função `videos` busca na YouTube Data API (50 candidatos) pela palavra-chave da sessão e pelo número da lei citada no título, descarta Shorts (até 1 min ou marcados #shorts), lives, vídeos sem incorporação ou bloqueados no Brasil e os fora do tema (sem termo do tema no título nem pelo menos metade dos termos na descrição), e ordena por uma conta fixa (`shared/domain/videos.ts`) que privilegia a proximidade com o tema: fração dos termos no título e na descrição, palavra-chave inteira no título, número da lei e nome ou sigla das leis da sessão; depois relevância do YouTube, visualizações e idade, com no máximo 2 por canal. A duração não conta: aula longa no tema vale mais que vídeo curto genérico. Os vídeos não são revisados, e a tela avisa isso.

**Cargo do edital nos vídeos:** em tema genérico ("O espaço escolar"), o YouTube devolve sobretudo aulas para concursos de professor, e o Agente Escolar de Suzano recebia vídeos de pedagogia. Sai o vídeo cujo título cita outro cargo do edital (a 1ª palavra de cada um: Professor, Médico, Cozinheiro...; palavras genéricas como Auxiliar ou Técnico não contam) ou a família do professor (professor, pedagogia, docente, PEB), salvo o que o próprio cargo ou o tema cita. Sessão sobre o próprio cargo (atribuições, rotina, `roleSpecific`) busca com o nome do cargo e só aceita vídeo que o traga no título; sem nenhum, a sessão fica sem vídeos. A chave do cache leva esses filtros (`v5`). Avaliação real (`evals/video-run.ts` com cargo e outros cargos): em "O espaço escolar" saiu "A função social da escola – Pedagogia para concursos"; em "Principais atribuições do cargo", em vez de Princípios da Administração e Agente de Endemias, vieram 5 vídeos de agente escolar/apoio escolar.

A cota gratuita é de 10 mil unidades por dia, e cada busca nova gasta 101 (cerca de 99 buscas por dia). Se restar menos de 3 vídeos, uma segunda busca com o tema dito de outro jeito (matéria e título em vez da palavra-chave) gasta mais 101; sem vídeo suficiente, a aba mostra o que houver. Por isso a busca só roda ao abrir a aba e fica guardada em `video_searches` por 30 dias, compartilhada entre sessões e estudantes; 30 dias é o limite de guarda dos termos da API. Sem chave, sem cota ou com erro, a aba mostra o link de busca do YouTube.

Para ativar: no Google Cloud, ative a **YouTube Data API v3**, crie uma chave de API restrita a essa API, grave `YOUTUBE_API_KEY` no `.env` e rode `node scripts/deploy-functions.mjs`. Para avaliar a busca: `node --experimental-strip-types evals/video-run.ts "Direito Penal" "Peculato"` (opcionais: palavra-chave, cargo e outros cargos separados por `;`). **Antes de abrir o app ao público:** os termos de uso e a política de privacidade precisam citar os do YouTube e do Google.

## Discursivas

A página **Discursivas** lê do edital o formato, o número de questões, a nota e o mínimo (`discursiveRules`, sem IA). O treino de **questão** tira o tema das sessões do cronograma, priorizando o que já foi estudado e menos treinado, e usa só os artigos oficiais da lei seca. Em conhecimentos específicos, só entram as matérias específicas. O treino de **redação** traz tema de interesse público, sem dados inventados.

O rascunho salva sozinho. **Corrigir** envia o texto à IA, que marca cada ponto do espelho como atendido, parcial ou ausente e avalia estrutura e linguagem. A nota sai de uma conta no código (`scoreGrade`): conteúdo 70%, estrutura 15% e linguagem 15% na questão; 50%, 25% e 25% na redação. **Esses pesos são do app, não da banca**, e a tela avisa que a nota é estimada. Ponto não avaliado conta como ausente, fora do tema zera, trecho apontado que não está no texto é descartado e artigo citado sem fonte vira aviso. **Reescrever** cria nova versão do mesmo enunciado e mostra a evolução. Enunciados são reaproveitados entre treinos e estudantes; espelho e resposta modelo só ficam disponíveis depois da correção (`discursive_prompts` é só do backend). O mesmo texto não é corrigido duas vezes.

A tela Hoje lembra de treinar depois de 7 dias sem correção. Os treinos não viram tarefas no cronograma. Avaliação com a IA real: `node --experimental-strip-types evals/discursive-run.ts [questao|redacao]`.

## Excluir um concurso

Na página **Concursos**, a lixeira de cada card apaga de vez o edital, os PDFs (edital e materiais), o cronograma, as tarefas, as tentativas, os simulados, os treinos de discursiva e os vídeos marcados como assistidos daquele concurso (`delete_notice`). Caderno de erros, flashcards, questões livres, revisões, simulados e tempo de estudo são do concurso e saem com ele. Anotações e marcações de lei são por questão ou artigo: saem só se foram usadas apenas nele. Fica o que também aparece em outro concurso ou em simulado personalizado antigo (sem concurso), além dos catálogos compartilhados (apostilas, mnemônicos, questões, leis) e do registro de custo da IA. `scripts/e2e-delete-notice.ts` testa os buckets com login real.

## Concurso ativo

Cada concurso tem os próprios dados: caderno de erros, flashcards, questões livres, revisões, simulados, tempo de estudo, metas e desempenho ficam no plano dele (`plan_id`). Na página **Concursos** ("Estudar este") ou no seletor do topo de todas as telas, o estudante escolhe o concurso ativo (`profiles.active_notice_id`), e o app inteiro passa a usar o plano dele; sem escolha, vale o plano mais recente, e montar um cronograma novo o torna ativo. O servidor usa a mesma regra (`active_plan_for`) para gravar prática livre, revisão e simulado personalizado. Edital novo do mesmo concurso (`adopt_notice_update`) leva esses dados para o plano novo.

## Prática além do cronograma

Página **Questões**: resolver questões livres com filtros (matéria, assunto, banca, ano, dificuldade, tipo — inclusive Certo/Errado —, órgão, cargo, só inéditas) e 1, 5 ou 10 questões por página, buscando só o que a página mostra (`shared/qbank/materias.ts` põe as matérias principais no topo da busca, sem depender de acento, aceita abreviações como "proc penal" e troca nomes quase vazios da API pela versão cheia: "Direito Processual Civil" tem 7 questões, "Direito Processual Civil - CPC 2015" tem mais de 6 mil; o cronograma segue a mesma troca e liga "Português" a "Língua Portuguesa", não a "Alfabeto português"), **caderno de erros** (do concurso ativo; toda questão errada volta na revisão semanal, e acertos levam a 7 e 30 dias), **flashcards** (Leitner; nascem das questões erradas e dos mnemônicos), **simulados** (do concurso, na estrutura de blocos e nota mínima do edital, completo ou reduzido, ou personalizados; com ou sem cronômetro; correção só na entrega) e **desempenho por contexto** (cronograma, livres, simulados, revisão), com gráfico do acerto por semana, geral ou por matéria, contra o mínimo e a meta do concurso (`shared/domain/evolution.ts`, `EvolutionChart`). O card da revisão semanal mostra quantos erros do concurso vencem até o dia dela. Os dias de simulado do cronograma abrem o simulado do concurso. No modo estudo, as questões são a última aba, a lei seca só aparece em assuntos de legislação, a explicação abre o artigo citado ("ver artigo") e cada bateria termina com resumo por assunto e tempo médio.

## Leitor de PDF e trechos

O leitor (`web/src/components/PdfViewer.tsx`) rola as páginas em sequência e desenha só as próximas da área visível. O canvas é múltiplo exato dos pixels da tela, para o texto não borrar. Zoom vai de 50% a 250% e fica salvo; a última página lida fica salva por apostila ou trecho.

Selecionar um texto abre uma barra para marcar em três cores, anotar ou copiar (`material_notes`). As marcações valem para a apostila inteira, em qualquer trecho, e guardam a posição em frações da página, então acompanham o zoom. PDF escaneado não tem texto para selecionar.

Na aba **Meus PDFs** do modo estudo, cada apostila aparece como "Ler das páginas X a Y" e o leitor só mostra e navega por esse trecho. O estudante corrige, acrescenta e apaga trechos, e em **Meus materiais** o botão **No cronograma** mostra em que matérias e sessões a apostila entra, com as páginas e as tarefas de cada sessão (data, feita ou atrasada, com link para estudar; no ciclo, sem datas). "Mapear de novo" mantém os trechos corrigidos ou acrescentados (`manual`) e só refaz as outras sessões. A restrição é da tela: o navegador baixa o PDF inteiro, e a apostila completa segue em **Meus materiais**.

O navegador extrai o texto do PDF e a função `material-map` só chama a IA e responde na mesma requisição, porque extrair no servidor esbarra no limite de CPU das Edge Functions em apostilas grandes. Para gastar pouco, a IA não recebe a apostila inteira: recebe o sumário, o começo de cada página, os títulos e as linhas que citam termos das sessões, com raciocínio reduzido. Pode indicar até 3 trechos por sessão, porque uma sessão como "Estabilidade e Petição" costuma juntar assuntos de partes diferentes da apostila. Trecho cuja leitura estimada (1,5 min por página) passa do tempo da tarefa de teoria ganha um aviso.

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
| E4.6 | Vídeos do YouTube no modo estudo (busca na YouTube Data API, sem IA) | feito |
| E5 | Desempenho, reforço e discursivas | feito |
| E5.1 | Apostilas em segundo plano e preparadas com antecedência (o mapeamento de PDFs já rodava assim) | feito |
| E6.1 | Edital verticalizado: situação e desempenho por tópico | feito |
| E6.2 | Revisão de teoria: tema estudado volta em 1, 7 e 30 dias | feito |
| E6.3 | Metas semanais e constância na tela Hoje | feito |
| E6.4 | Painel de revisões de teoria | feito |
| E6.5 | Ciclo de estudos sem dias fixos | feito |
| E7 | Publicação para convidados: login por convite, Netlify e CSP de produção | feito |

O app estático original está na tag `v0-legado`.
