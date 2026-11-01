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
3. **Dias por matéria (scheduler)**: o calendário determinístico calcula quantos dias de teoria cada matéria recebe.
4. **Sessões (IA)**: cada matéria é dividida em exatamente esse número de sessões, na ordem de aprendizado, cada uma apontando para os tópicos do edital. Uma correção determinística (`repairSessions`) garante contagem exata e cobertura de 100% dos tópicos; se a IA falhar, as sessões saem direto dos tópicos.
5. **Gravação**: `create_plan_version` grava versão, sessões e tarefas numa transação. Refazer cria nova versão a partir de hoje: tarefas futuras não feitas ficam substituídas; concluídas e passadas são preservadas.

Avaliação com a IA real (`node --experimental-strip-types evals/plan-run.ts [filtro]`), prompt `plan-v2`: TJSP Escrevente 11/11 e TJRJ 9/9 matérias com contagem exata e cobertura total já na resposta da IA (194/194 tópicos no TJRJ), cerca de 50 s e US$ 0,11 por plano.

## Questões (Quest API)

A chave fica só no servidor (segredo `QUEST_API_KEY`) e o gabarito nunca vai ao navegador antes da resposta. Filtros automáticos (`shared/qbank/map.ts`, prompt `qmap-v3`): matéria do edital → matéria da API (nome + tamanho da lista de assuntos; IA nos casos ambíguos) e sessão → até 5 assuntos escolhidos pela IA dentro da lista oficial (sem assunto correspondente, a sessão fica sem questões em vez de mostrar questões erradas). Busca: banca nos assuntos, depois os mesmos assuntos em outras bancas; Atualidades só em provas recentes; dias de reforço usam os assuntos com pior acerto. Avaliação nas sessões reais do TJSP (`evals/qmap-run.ts`): 93% de relevância ponderada, nenhuma questão irrelevante.

**Meta e distribuição:** a sessão de teoria pede de 5 a 10 questões (`theoryGoal`, 1 a cada 12 minutos); é só meta, e o estudante pode continuar. Primeiro, todos os assuntos da sessão recebem uma questão, do mais ao menos cobrado. Depois, cada questão vai para o assunto mais abaixo da sua parte na cobrança da banca (`planPicks`). A cobrança é o total de questões da banca em cada assunto, medido uma vez por sessão com 3 créditos por assunto (`qbank_session_maps.incidence`); sem nenhuma na banca, vale o total das outras. Dias de consolidação mantêm a meta maior. A API não mostra ordenação por repetição: só dentro de cada lote vêm antes as questões que caíram em mais provas.

`scripts/e2e-questions.ts` testa a função ponta a ponta com um usuário temporário (exige incluir `e2e@evanconcursos.test` em `ALLOWED_EMAILS`).

## Reorganizar depois de atrasos

Com tarefas atrasadas, a tela Hoje e o Cronograma mostram o que mudaria e só gravam ao clicar em **Reorganizar** (`shared/domain/replan.ts`, sem IA e sem custo). Tarefas feitas não mudam. Toda sessão de teoria pendente continua no plano, na mesma ordem, a partir de hoje. O espaço vem dos dias de consolidação, depois da revisão final e da revisão semanal; simulados, véspera e prova ficam onde estão. Se ainda faltar tempo, um dia recebe mais de uma sessão, com tempo e meta divididos. Revisões e simulados que já passaram saem da agenda. Os dias de reforço restantes são redistribuídos pelo peso no edital e pela fraqueza da matéria, em que **erro por falta de atenção** conta metade. A função `replan_version` grava uma nova versão (`adaptive`), mantém as tarefas antigas no histórico, reaproveita as sessões (apostila, PDFs e questões continuam ligados) e leva tempo estudado e tentativas para a tarefa nova.

**Motivo do erro:** ao errar, o estudante pode marcar falta de conteúdo, falta de atenção ou pegadinha (`question_attempts.error_reason`). O total aparece em Desempenho.

## Leitor por voz

O botão **Ouvir** da apostila lê bloco a bloco com destaque na tela, escreve siglas e abreviações por extenso (`shared/ai/speech.ts`) e tem pausar, pular seção, velocidade e escolha de voz. A leitura para ao sair da aba Apostila. Nenhuma voz em uso tem custo por leitura:

- **Faber** (padrão; Piper, `web/src/lib/piper.ts`): gerada no próprio aparelho, em worker. Baixa o modelo de 63 MB do Hugging Face uma vez (fica no OPFS do navegador) e carrega o runtime dos CDNs cdnjs e jsDelivr, em versões fixas. O texto não sai do aparelho e o áudio não é salvo.
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
node scripts/users.mjs list                      # contas, último acesso e gasto de IA em 30 dias
```

A troca da senha temporária é obrigatória no primeiro acesso. Na página **Conta**, o estudante altera a senha e sai. Não há limite de IA por pessoa: o controle é a lista de convidados e o `list`. A cota do YouTube e as chaves de IA são compartilhadas.

O CSP de produção fica em `web/public/_headers` e não se aplica ao `npm run dev`: recurso externo novo precisa entrar lá. Hoje ele libera o player do YouTube e as origens que a voz local baixa (cdnjs, jsDelivr e Hugging Face). A violação `script-src eval` no console é a sondagem do Zod, que ele captura; não libere `unsafe-eval` por causa dela.

**Antes de abrir a qualquer pessoa:** limite de IA por usuário, termos de uso e privacidade (LGPD), canal de denúncia, e-mail transacional com "esqueci a senha" e confirmar o uso nos termos da Quest API.

## Edital verticalizado

A página **Edital** lista todos os tópicos do edital por matéria: situação (não estudado, em andamento, estudado, fora do cronograma), questões, acerto, última vez visto e atalho para a próxima tarefa do tópico. Filtros: não estudados, pontos fracos e estudados sem questões. Um tópico é **ponto fraco** com pelo menos 5 questões e acerto abaixo de 75%, o mesmo limite do reforço. **Onde focar** ordena os pontos fracos pelo erro e pelo peso da matéria. Sem IA nem custo: a conta está em `shared/domain/verticalized.ts`, e o banco só soma as questões por sessão (`session_attempt_stats`).

A tentativa aponta para a sessão, não para o tópico. Por isso, uma sessão com vários tópicos conta suas questões para todos eles, sem repetir nos totais da matéria. Simulados, revisão de erros e questões livres não têm sessão e ficam fora: continuam na aba Desempenho.

## Revisão de teoria

Concluir uma sessão de teoria agenda o tema para voltar em **1, 7 e 30 dias**, os mesmos intervalos do caderno de erros. Os temas vencidos aparecem em **Hoje**, do mais atrasado para o mais recente, e abrem a sessão com a revisão curta da apostila. O estudante tenta lembrar, faz algumas questões, se quiser, e responde: **lembrei bem** avança (depois da 3ª, o tema encerra), **lembrei em parte** repete o intervalo e **esqueci** volta para 1 dia. O resultado é a avaliação do próprio estudante; o app não o confere com as questões.

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

As metas da semana (segunda a domingo) saem do cronograma, sem configuração: horas, questões e tarefas previstas contra o que foi feito na semana. Tarefa adiantada ou atrasada conta na semana em que foi feita, e questões de qualquer origem contam. A constância soma os dias seguidos com pelo menos 1 minuto de cronômetro, uma questão, uma tarefa concluída ou uma discursiva corrigida. Hoje ainda sem estudo e as folgas do questionário não quebram a sequência. Depois de reorganizar ou refazer o cronograma, valem as folgas da versão ativa.

O cronômetro guarda o total por tarefa, então um gatilho soma o que ele avança em `study_days`, por dia no fuso de Brasília. O tempo estudado antes dessa tabela não entra nas horas. A conta fica em `shared/domain/goals.ts`.

## Como a banca cobra

As seções da apostila podem trazer um destaque **Como a [banca] cobra**, escrito pela IA a partir de até 8 questões reais da banca nos assuntos da sessão (`boardSample`). Primeiro usa as questões já guardadas; faltando, busca na Quest API, a 6 créditos por questão, uma vez por apostila. Sem questão real, sem banca identificada ou em Atualidades, o destaque não aparece: o servidor descarta o que a IA tiver escrito (`applyBoardEvidence`). É uma leitura de amostra, e o rodapé diz o tamanho dela. A mudança veio com o prompt `guide-v2`: cada apostila antiga é gerada de novo só quando aberta, e as antigas continuam no banco.

## Apostilas em segundo plano

A apostila é gerada no servidor, sem depender da tela: dá para sair e voltar, e a tela consulta a cada 4 s até ficar pronta. Uma trava em `ai_jobs` (índice único, com liberação depois de 3 min) impede pagar duas vezes pela mesma apostila, mesmo com estudantes diferentes.

Ao abrir a tela **Hoje**, no máximo uma vez por dia e plano, o app prepara as apostilas **completas** das sessões pendentes dos próximos 3 dias, até 2 por vez, na ordem do cronograma. A revisão curta só é gerada ao pedir. O que já existe não gasta nada, e uma apostila que falhou só volta a ser tentada automaticamente depois de 24 h. Custo medido: cerca de US$ 0,012 por apostila e 33 s. Com 2 sessões por dia, são cerca de US$ 0,024 por dia, valor que seria gasto de qualquer forma ao estudar essas sessões. Para mudar o horizonte ou o limite: `PREPARE_DAYS` e `PREPARE_MAX` em `supabase/functions/study-guide/index.ts`.

## Vídeos

A aba **Vídeos** do modo estudo sugere de 2 a 3 vídeo-aulas da sessão, de até 30 minutos cada, com player dentro do app e marcação de assistido por concurso. Não usa IA: a função `videos` busca na YouTube Data API pela palavra-chave da sessão e pelo número da lei citada no título, descarta Shorts (menos de 4 min), vídeos de mais de 30 min, lives, vídeos sem incorporação ou bloqueados no Brasil e os fora do tema (sem termo do tema no título nem pelo menos metade dos termos na descrição), e ordena por uma conta fixa (`shared/domain/videos.ts`): relevância do YouTube, tema no título, citação da lei da sessão, duração, visualizações e idade, com no máximo 2 por canal. Os vídeos não são revisados, e a tela avisa isso.

A cota gratuita é de 10 mil unidades por dia, e cada busca nova gasta 101 (cerca de 99 buscas por dia). Se restar menos de 2 vídeos, uma segunda busca só por vídeos médios (4 a 20 min) gasta mais 101; sem vídeo suficiente, a aba mostra o que houver. Por isso a busca só roda ao abrir a aba e fica guardada em `video_searches` por 30 dias, compartilhada entre sessões e estudantes; 30 dias é o limite de guarda dos termos da API. Sem chave, sem cota ou com erro, a aba mostra o link de busca do YouTube.

Para ativar: no Google Cloud, ative a **YouTube Data API v3**, crie uma chave de API restrita a essa API, grave `YOUTUBE_API_KEY` no `.env` e rode `node scripts/deploy-functions.mjs`. Para avaliar a busca: `node --experimental-strip-types evals/video-run.ts "Direito Penal" "Peculato"`. **Antes de abrir o app ao público:** os termos de uso e a política de privacidade precisam citar os do YouTube e do Google.

## Discursivas

A página **Discursivas** lê do edital o formato, o número de questões, a nota e o mínimo (`discursiveRules`, sem IA). O treino de **questão** tira o tema das sessões do cronograma, priorizando o que já foi estudado e menos treinado, e usa só os artigos oficiais da lei seca. Em conhecimentos específicos, só entram as matérias específicas. O treino de **redação** traz tema de interesse público, sem dados inventados.

O rascunho salva sozinho. **Corrigir** envia o texto à IA, que marca cada ponto do espelho como atendido, parcial ou ausente e avalia estrutura e linguagem. A nota sai de uma conta no código (`scoreGrade`): conteúdo 70%, estrutura 15% e linguagem 15% na questão; 50%, 25% e 25% na redação. **Esses pesos são do app, não da banca**, e a tela avisa que a nota é estimada. Ponto não avaliado conta como ausente, fora do tema zera, trecho apontado que não está no texto é descartado e artigo citado sem fonte vira aviso. **Reescrever** cria nova versão do mesmo enunciado e mostra a evolução. Enunciados são reaproveitados entre treinos e estudantes; espelho e resposta modelo só ficam disponíveis depois da correção (`discursive_prompts` é só do backend). O mesmo texto não é corrigido duas vezes.

A tela Hoje lembra de treinar depois de 7 dias sem correção. Os treinos não viram tarefas no cronograma. Avaliação com a IA real: `node --experimental-strip-types evals/discursive-run.ts [questao|redacao]`.

## Excluir um concurso

Na página **Concursos**, a lixeira de cada card apaga de vez o edital, os PDFs (edital e materiais), o cronograma, as tarefas, as tentativas, os simulados, os treinos de discursiva e os vídeos marcados como assistidos daquele concurso (`delete_notice`). Anotações, caderno de erros, flashcards e marcações de lei são por questão ou artigo: saem só se foram usados apenas nele. Fica o que também aparece em outro concurso, em questões livres ou em simulados personalizados, além dos catálogos compartilhados (apostilas, mnemônicos, questões, leis) e do registro de custo da IA. `scripts/e2e-delete-notice.ts` testa os buckets com login real.

## Prática além do cronograma

Página **Questões**: resolver questões livres com filtros (matéria, assunto, banca, ano, dificuldade, tipo — inclusive Certo/Errado —, órgão, cargo, só inéditas) e 1, 5 ou 10 questões por página, buscando só o que a página mostra (`shared/qbank/materias.ts` põe as matérias principais no topo da busca, sem depender de acento, aceita abreviações como "proc penal" e troca nomes quase vazios da API pela versão cheia: "Direito Processual Civil" tem 7 questões, "Direito Processual Civil - CPC 2015" tem mais de 6 mil; o cronograma segue a mesma troca e liga "Português" a "Língua Portuguesa", não a "Alfabeto português"), **caderno de erros** (toda questão errada volta em 1, 7 e 30 dias), **flashcards** (Leitner; nascem das questões erradas e dos mnemônicos), **simulados** (do concurso, na estrutura de blocos e nota mínima do edital, completo ou reduzido, ou personalizados; com ou sem cronômetro; correção só na entrega) e **desempenho por contexto** (cronograma, livres, simulados, revisão). Os dias de simulado do cronograma abrem o simulado do concurso. No modo estudo, as questões são a última aba, a lei seca só aparece em assuntos de legislação, a explicação abre o artigo citado ("ver artigo") e cada bateria termina com resumo por assunto e tempo médio.

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
