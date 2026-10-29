# TJSP Estudos — aplicativo web

Painel minimalista e responsivo para o concurso TJSP Oficial de Justiça 2027, com cronograma de 19 semanas, registro de desempenho por matéria e assunto, foco adaptativo de questões, caderno de erros, discursivas, login Supabase e sincronização entre dispositivos.

## Estrutura

- `public/`: tudo o que é publicado.
  - `index.html`: interface.
  - `styles.css`: estilos.
  - `theme.js`: aplica o tema claro/escuro antes da renderização (segue o sistema se não houver escolha salva).
  - `app.js`: lógica do painel, validação e mesclagem do estado, foco adaptativo.
  - `cloud.js`: autenticação e sincronização Supabase.
  - `config.js`: URL do Supabase e chave **pública** do projeto.
  - `manifest.webmanifest`, `sw.js`, ícones: suporte a PWA.
  - `_headers`: cabeçalhos de segurança (inclui CSP) para Netlify.
- `supabase.sql`: esquema e políticas de segurança (executar no SQL Editor; não é publicado).
- `netlify.toml`: publica somente a pasta `public/`.

## Rodar localmente

```bash
python -m http.server 8080 -d public
```

Abra `http://localhost:8080`.

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
