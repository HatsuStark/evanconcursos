# Evan Concursos

Preparação para concursos públicos guiada por IA: o estudante envia o edital em PDF, confere os dados extraídos, responde um questionário (disponibilidade, nível por matéria, perfil) e recebe um cronograma personalizado com orientação diária, materiais, revisões, questões e discursivas.

Começa como projeto pessoal (primeiro caso real: TJSP · Oficial de Justiça), com arquitetura pronta para vários usuários e vários concursos por usuário.

## Arquitetura

```
shared/      TypeScript puro, usado pelo web e pelas Edge Functions
  domain/    scheduler (calendário determinístico), foco adaptativo e revisão espaçada,
             filtro do QConcursos, materiais (buscas e lei seca)
web/         React + TypeScript (Vite)
supabase/
  migrations/ SQL versionado (aplicado com scripts/db.mjs push)
  tests/     testes pgTAP de isolamento entre usuários (scripts/db.mjs test)
  functions/ Edge Functions de IA (Gemini). Serão reescritas na E2/E3 (notice-extract, plan-design, study-guide)
scripts/     db.mjs (migrações e testes do banco), deploy-functions.mjs (funções e segredos), gemini-models.mjs
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

## Etapas

| # | Etapa | Status |
|---|---|---|
| E0 | Base React/TS, domínio portado com testes (equivalência com o gerador antigo), CI | feito |
| E1 | Banco: migrações, bucket privado de editais, RLS e testes de isolamento | feito |
| E2 | Upload do edital → extração (`notice-extract`) → conferência; registro de custo da IA | |
| E3 | Questionário → planejamento (`plan-design`, sessões ligadas aos tópicos) → cronograma versionado no banco | |
| E4 | Tela "Hoje": assunto, tempo, roteiro, materiais e questões | |
| E5 | Roteiros e materiais em segundo plano, desempenho, reforço e discursivas | |

O app estático original está na tag `v0-legado`.
