// Edge Function "law-upload": norma fora do registro enviada pelo estudante em PDF (ex.: Resolução CNJ 354/2020).
//   POST {path, citation} → {norm: {id, key, short, articles, first, last}}
// O PDF já está no bucket privado "leis", na pasta do estudante. A citação vem do edital ou da sessão (unlistedNorms) e
// define a chave e como a norma é achada nos textos. O texto é separado por artigo (parseNormsText) e gravado só para
// ele: não há como garantir que o PDF é o oficial, então a norma não vale para os outros estudantes.
import { extractText } from 'unpdf';
import { parseNormsText } from '../../../shared/legal/parse.ts';
import { shortCitation, unlistedNorms, uploadUrn } from '../../../shared/legal/norms.ts';
import { adminClient, CORS, json, requireUser } from '../_shared/http.ts';

const MAX_BYTES = 50 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });
  const auth = await requireUser(req, { ai: false });
  if (auth instanceof Response) return auth;
  const body = await req.json().catch(() => ({}));
  const path = String(body.path ?? ''), citation = String(body.citation ?? '').slice(0, 300);
  // Só a pasta do próprio estudante.
  if (!path.startsWith(`${auth.user.id}/`) || path.includes('..') || !/\.pdf$/i.test(path)) return json(400, { error: 'Arquivo inválido.' });
  const norm = unlistedNorms(citation)[0];
  if (!norm) return json(400, { error: 'Não reconheci a norma. Informe como o edital a cita (ex.: "Resolução CNJ 354/2020").' });

  const admin = adminClient();
  try {
    const { data: file, error } = await admin.storage.from('leis').download(path);
    if (error || !file) return json(404, { error: 'PDF não encontrado. Envie de novo.' });
    if (file.size > MAX_BYTES) return json(400, { error: 'PDF maior que 50 MB.' });
    const { text } = await extractText(new Uint8Array(await file.arrayBuffer()), { mergePages: false });
    const articles = parseNormsText(text.map((t, i) => `\n=== PÁGINA ${i + 1} ===\n${t}`).join(''));
    if (articles.length < 2) {
      return json(422, { error: 'Não achei artigos ("Art. 1º", "Art. 2º"…) no PDF. Confira se é o texto da norma, com texto selecionável (não escaneado).' });
    }
    // Trecho da norma (ex.: material de cursinho só com os artigos de um edital): as sessões, a apostila e as questões de
    // outros artigos ficariam sem texto. Pede a norma inteira.
    if (articles[0]!.num > 1) {
      return json(422, { error: `Este PDF começa no art. ${articles[0]!.label} (vai até o art. ${articles.at(-1)!.label}): parece um trecho da norma. Envie o PDF da norma completa, do art. 1º ao último, como o publicado no site oficial.` });
    }
    const { data: row, error: e1 } = await admin.from('legal_norms').upsert({
      urn: uploadUrn(auth.user.id, norm.key), law_key: norm.key, name: norm.citation, short_name: shortCitation(norm.citation), citation: norm.citation,
      match_pattern: norm.pattern, owner_id: auth.user.id, source_url: path, content_url: path, version: 'Current', license: 'enviado pelo estudante',
      articles_count: articles.length, fetched_at: new Date().toISOString(),
    }, { onConflict: 'urn' }).select('id').single();
    if (e1 || !row) throw new Error(e1?.message ?? 'falha ao gravar a norma');
    for (let i = 0; i < articles.length; i += 400) {
      const { error: e2 } = await admin.from('legal_articles').upsert(articles.slice(i, i + 400).map((a) => ({
        norm_id: row.id, ord: a.ord, label: a.label, num: a.num, suffix: a.suffix, heading: a.heading, text: a.text, notes: a.notes, revoked: a.revoked,
      })), { onConflict: 'norm_id,label' });
      if (e2) throw new Error(e2.message);
    }
    // PDF novo da mesma norma: artigos que não estão mais nele saem.
    const labels = new Set(articles.map((a) => a.label));
    const { data: old } = await admin.from('legal_articles').select('id, label').eq('norm_id', row.id);
    const gone = (old ?? []).filter((o) => !labels.has(o.label)).map((o) => o.id);
    if (gone.length) await admin.from('legal_articles').delete().in('id', gone);
    return json(200, { norm: { id: row.id, key: norm.key, short: shortCitation(norm.citation), articles: articles.length, first: articles[0]!.label, last: articles.at(-1)!.label } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('law-upload:', message);
    return json(502, { error: 'Não foi possível ler o PDF agora.', detail: message.slice(0, 300) });
  }
});
