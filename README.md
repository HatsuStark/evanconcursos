# Evan Concursos — aplicativo web

Painel minimalista (preparação atual: TJSP Oficial de Justiça 2027) e responsivo para o concurso TJSP Oficial de Justiça 2027, com cronograma de 19 semanas, registro de desempenho por matéria e assunto, foco adaptativo de questões, caderno de erros, discursivas, login Supabase e sincronização entre dispositivos.

## Estrutura

- `public/`: tudo o que é publicado.
  - `index.html`: interface.
  - `styles.css`: estilos.
  - `theme.js`: aplica o tema claro/escuro antes da renderização (segue o sistema se não houver escolha salva).
  - `plans.js`: formato de plano de estudos e o plano embutido do TJSP.
  - `generator.js`: gerador determinístico de cronograma.
  - `app.js`: lógica do painel, validação e mesclagem do estado, foco adaptativo.
  - `cloud.js`: autenticação e sincronização Supabase.
  - `config.js`: URL do Supabase e chave **pública** do projeto.
  - `manifest.webmanifest`, `sw.js`, ícones: suporte a PWA.
  - `_headers`: cabeçalhos de segurança (inclui CSP) para Netlify.
- `public/materials.js`: material de estudo de cada tarefa (buscas de vídeo-aula e PDF, lei seca no Planalto).
- `supabase/functions/`: Edge Functions com o Gemini: `edital` (lê o PDF do edital), `plano` (estratégia e sessões por matéria), `roteiro` (roteiro de estudo da tarefa) e `_shared/` (login permitido e chamada ao Gemini).
- `scripts/`: `gemini-models.mjs` (lista modelos da sua chave) e `deploy-functions.mjs` (publica as funções e os segredos).
- `.env` (local, fora do Git; modelo em `.env.example`): chaves do Gemini e do Supabase.
- `supabase.sql`: esquema e políticas de segurança (executar no SQL Editor; não é publicado).
- `netlify.toml`: publica somente a pasta `public/`.

## Rodar localmente

```bash
python -m http.server 8080 -d public
```

Abra `http://localhost:8080`.

## Planos de estudo (um por edital)

Cada edital é um plano com nome, cargo, banca, data da prova, data de início, matérias e cronograma (semanas × 7 dias; cada dia tem texto, horas, matéria, palavra-chave e meta de questões). Tarefas, metas, registros e filtros do QConcursos ficam separados por plano. Em **Conta e planos** é possível editar o plano ativo, criar um novo (ainda sem cronograma), exportar e importar planos em JSON. Dados antigos, de antes dos planos, são migrados automaticamente para o plano do TJSP.

## Gerador de cronograma

Em **Cronograma → Gerar cronograma automaticamente**: horas por dia da semana, revisão semanal e, por matéria, peso no edital (1–5), nível (iniciante a avançado) e conteúdo programático colado do edital. O gerador alinha as semanas na segunda-feira, divide o tempo em teoria (≈70%), consolidação com questões dos pontos fracos (≈15%) e reta final com um simulado por semana (≈15%), distribui os dias por peso × nível intercalando as matérias, respeita a ordem dos tópicos e reserva a véspera e o dia da prova. Mesma entrada, mesmo resultado. As respostas ficam salvas no plano para refazer depois.

## Plano a partir do edital (IA)

Em **Conta e planos → Criar plano a partir do edital (PDF)**: o PDF vai para a Edge Function `edital`, que confere o login (só e-mails em `ALLOWED_EMAILS`) e pede ao Gemini um rascunho estruturado: órgão, cargo, banca, data da prova, matérias (específica ou não, nº de questões, peso 1–5, tópicos de estudo de ~2h) e observações. Você revisa, cria o plano e vai para as perguntas do Cronograma: horas por dia, nível em cada matéria e um texto livre sobre você.

**Montar plano com IA** (Edge Function `plano`): (1) a IA define a estratégia e a prioridade (peso 1–5) e o foco de cada matéria pelas questões na prova, seu nível e seu perfil; (2) o gerador calcula quantos dias cada matéria recebe e a IA divide o conteúdo do edital em exatamente essas sessões, na ordem de aprendizado e no seu nível; (3) o gerador monta o calendário (teoria, consolidação, reta final, revisões, simulados), que continua determinístico; (4) os roteiros de todas as sessões são gerados em lotes de 7, em segundo plano, com o progresso acima da lista de dias. **Gerar sem IA** usa só o gerador.

## Material de estudo por tarefa

Cada dia com matéria tem, além de **Questões**, a seção **Estudar**: busca de vídeo-aulas no YouTube e de PDFs/resumos no Google pelo tema do dia, e link da lei seca no Planalto quando a tarefa cita um código ou lei (ou pela matéria: CPP, CPC, CP, CC, CF). Nos dias de reforço, o tema é o assunto mais fraco do momento. Com login, o app gera sozinho, em segundo plano e em lotes de 7, os roteiros que faltam: no plano montado pela IA, todas as sessões até a prova; nos demais, os próximos 7 dias (ao entrar, ao trocar de plano e ao gerar o cronograma). Dias de reforço só ganham roteiro a 7 dias, pois o tema depende do desempenho; o botão **Gerar/Refazer roteiro com IA** faz um dia avulso. A Edge Function `roteiro` (até 7 tarefas por chamada) devolve resumo, o que ler (lei e artigos), pontos que mais caem, pegadinhas, autoteste e termos de busca de vídeo; a IA não gera links. O roteiro fica salvo na tarefa e sincroniza; se o cronograma for refeito e o texto da tarefa mudar, ele deixa de aparecer.

## Publicação das funções de IA

Uma vez, e sempre que mudar uma função ou os segredos: preencha o `.env` (o token do Supabase precisa de escrita em Edge Functions e em seus segredos) e rode `node scripts/deploy-functions.mjs`. Para conferir os modelos disponíveis: `node scripts/gemini-models.mjs`.

## Foco adaptativo de questões

Cada registro de questões tem matéria e, opcionalmente, assunto. O painel calcula um acerto suavizado por matéria e por assunto (começa em 70% e dá mais peso aos últimos 30 dias) e sugere as três matérias prioritárias, com o assunto mais fraco de cada uma.

O QConcursos não oferece API pública, então o app não monta filtros com IDs internos. Em **Desempenho → Configurar filtros do QConcursos**, cole para cada matéria a URL de um filtro criado no site (banca VUNESP + disciplina). O botão do foco abre esse filtro; sem link configurado, faz uma busca no Google restrita ao QConcursos com a matéria e o assunto.

## Sincronização

O estado guarda carimbos de tempo por tarefa, notas e links, e registra exclusões. A cada sincronização o app busca a nuvem, mescla com os dados locais e envia o resultado. Assim, progresso feito offline ou em outro dispositivo não é sobrescrito. Importar um backup também mescla, em vez de substituir.

## Supabase

O `config.js` contém o endereço do projeto e uma **publishable key** pública. Nunca coloque `service_role`, `sb_secret_` ou senhas no código. Execute `supabase.sql` no SQL Editor caso ainda não tenha feito isso. Configure **Authentication → URL Configuration** com o domínio definitivo publicado e habilite o provedor Email.

## Publicação (Netlify)

Conecte o repositório do GitHub no Netlify. O `netlify.toml` já define `public` como diretório de publicação, sem etapa de build. Depois, cadastre a URL do site no Supabase (Site URL e Redirect URLs).

Se mudar o projeto Supabase, atualize também o `connect-src` da CSP em `public/_headers`.

## Observações

- Os dados também ficam salvos no navegador; use o backup JSON periodicamente.
- O projeto é uma aplicação estática, sem `npm install` ou etapa de build.
