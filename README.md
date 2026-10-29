# TJSP Estudos — aplicativo web

Painel minimalista e responsivo para o concurso TJSP Oficial de Justiça 2027, com cronograma de 19 semanas, registro de desempenho, caderno de erros, discursivas, login Supabase e sincronização entre dispositivos.

## Estrutura

- `index.html`: interface, estilos e lógica do painel.
- `cloud.js`: autenticação e sincronização Supabase.
- `config.js`: URL do Supabase e chave **pública** do projeto.
- `supabase.sql`: esquema e políticas de segurança (executar no SQL Editor; não é necessário hospedar).
- `manifest.webmanifest`, `sw.js`, `icon.svg`: suporte básico a PWA.
- `_headers`: cabeçalhos de segurança para Netlify.
- `.gitignore`: arquivos locais que não devem ir ao repositório.

## Rodar localmente

Execute um servidor estático na pasta, por exemplo:

```bash
python -m http.server 8080
```

Abra `http://localhost:8080`.

## Supabase

O `config.js` já contém o endereço do projeto e uma **publishable key** pública. Nunca coloque `service_role`, `sb_secret_` ou senhas no código. Execute `supabase.sql` no SQL Editor caso ainda não tenha feito isso. Configure **Authentication → URL Configuration** com o domínio definitivo publicado e habilite o provedor Email.

## Git

```bash
git init
git add .
git commit -m "feat: painel TJSP responsivo com Supabase"
git branch -M main
```

Para enviar ao GitHub, crie um repositório vazio e depois:

```bash
git remote add origin https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
git push -u origin main
```

## Publicação

Publique os arquivos estáticos no Netlify, com diretório de publicação `.`. Antes de publicar, exclua `supabase.sql` da pasta de distribuição (não contém segredos, mas não precisa ficar público). Configure no Supabase a URL do site e os redirecionamentos de autenticação.

## Observações

- A sincronização usa um único JSON por usuário e a última gravação prevalece; evite edições simultâneas em dispositivos diferentes.
- Os dados também são salvos no navegador; use a função de backup JSON periodicamente.
- O projeto é uma aplicação estática, sem `npm install` ou etapa de build.
- O código não foi validado em testes automatizados de navegador nesta entrega.
