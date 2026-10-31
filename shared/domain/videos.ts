// Vídeo-aulas da sessão pela YouTube Data API: monta a busca pelo tema, descarta o que não serve e ordena.
// Sem IA: a ordem sai de uma conta fixa sobre a relevância do YouTube, o título, a duração, as visualizações e a idade.
import { normalizeText } from '../ai/notice.ts';

export interface Video { id: string; title: string; channel: string; durationSec: number; publishedAt: string; views: number; thumb: string }
export interface VideoCandidate extends Video { description: string; embeddable: boolean; live: boolean; blockedBR: boolean }

// Os termos da API exigem renovar ou apagar dados guardados em até 30 dias.
export const CACHE_DAYS = 30;
// Muda quando as regras mudam: busca guardada com as regras antigas não é reaproveitada.
export const CACHE_VERSION = 'v3';
const MIN_RESULTS = 2, MAX_RESULTS = 3, MAX_PER_CHANNEL = 2;
const MIN_SEC = 4 * 60, MAX_SEC = 30 * 60; // abaixo são Shorts e dicas soltas; acima, passa do tempo de uma sugestão
const IDEAL_MIN_SEC = 10 * 60, OLD_YEARS = 5;
const YEAR_MS = 365.25 * 864e5;

const STOPWORDS = new Set(['para', 'como', 'sobre', 'entre', 'pela', 'pelo', 'pelas', 'pelos', 'suas', 'seus', 'dos', 'das', 'nos', 'nas', 'com', 'sem', 'que', 'uma', 'art', 'arts', 'lei']);
const termsOf = (s: string) => [...new Set(normalizeText(s).split(' ').filter((w) => w.length > 2 && !STOPWORDS.has(w)))];
// Compara pelo começo da palavra, para aceitar variações ("processo" e "processual").
const hasTerm = (words: string[], term: string) => words.some((w) => w.slice(0, 6) === term.slice(0, 6));

// Parte curta do título: antes de ":" ou ";", sem parênteses (artigos, "parte 1 de 2") nem numeração do edital.
function shortTopic(title: string, topics: string[]) {
  const clean = (s: string) => (s.split(/[:;]/)[0] ?? '').replace(/\([^)]*\)/g, ' ').replace(/^[\d.\s–-]+/, '').replace(/\s+/g, ' ').trim();
  const head = clean(title);
  return (/^Estudo \d+ de \d+$/.test(head) ? clean(topics[0] ?? '') : head).split(' ').slice(0, 8).join(' ');
}

// Busca da sessão. `key` identifica a busca no cache; `terms` são as palavras que um vídeo precisa citar.
// A palavra-chave do plano diz o assunto melhor que o começo do título ("Ingresso e Exercício" é vago; "Estatuto SP
// provimento posse", não), e já dispensa a matéria na busca.
export function videoQuery({ subject, title, topics, keyword = '' }: { subject: string; title: string; topics: string[]; keyword?: string }) {
  const topic = shortTopic(title, topics);
  const subjectInTopic = normalizeText(topic).includes(normalizeText(subject));
  const lawDigits = /\bLei\s*(?:Complementar\s*)?(?:Federal\s*|Estadual\s*)?(?:n[º°o.]*\s*)?(\d{1,2}\.?\d{3})/i.exec(title)?.[1]?.replace('.', '');
  const law = lawDigits ? `${lawDigits.slice(0, -3)}.${lawDigits.slice(-3)}` : '';
  const q = (keyword.trim() ? [keyword.trim(), law && `Lei ${law}`, 'aula concurso'] : [subjectInTopic ? '' : subject, topic, law && `Lei ${law}`, 'aula concurso']).filter(Boolean).join(' ');
  const subjectTerms = termsOf(subject), topicTerms = termsOf(`${topic} ${keyword}`).filter((t) => !subjectTerms.includes(t));
  return { q, key: normalizeText(q), terms: topicTerms.length ? topicTerms : subjectTerms, law };
}

// Vídeo que cita a lei da sessão ("10.261" ou "10261"), para vir antes das aulas sobre leis parecidas de outros lugares.
const citesLaw = (text: string, law: string) => new RegExp(`(^|\\D)${law.replace('.', '\\.?')}(\\D|$)`).test(text);

export function parseDuration(iso: string) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  return m ? Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0) : 0;
}

// `candidates` vem na ordem de relevância do YouTube.
export function rankVideos(candidates: VideoCandidate[], terms: string[], now = Date.now(), law = ''): Video[] {
  const scored = candidates.flatMap((v, i) => {
    if (!v.embeddable || v.live || v.blockedBR || v.durationSec < MIN_SEC || v.durationSec > MAX_SEC) return [];
    const titleWords = normalizeText(v.title).split(' '), textWords = [...titleWords, ...normalizeText(v.description).split(' ')];
    // Tema no título basta. Na descrição, que costuma ser longa e genérica, precisa citar pelo menos metade dos termos.
    if (terms.length && !terms.some((t) => hasTerm(titleWords, t)) && terms.filter((t) => hasTerm(textWords, t)).length < terms.length / 2) return [];
    const years = (now - new Date(v.publishedAt).getTime()) / YEAR_MS;
    const score = 3 * (1 - i / candidates.length)
      + 4 * (terms.length ? terms.filter((t) => hasTerm(titleWords, t)).length / terms.length : 0)
      + (law && citesLaw(`${v.title} ${v.description}`, law) ? 5 : 0)
      + (titleWords.some((w) => w === 'aula' || w === 'aulas' || w.startsWith('concurso')) ? 1 : 0)
      + 1.5 * Math.min(1, Math.log10(v.views + 1) / 6)
      + (v.durationSec >= IDEAL_MIN_SEC ? 1 : 0)
      - (years > OLD_YEARS ? 1 : 0); // a lei pode ter mudado
    return [{ v, score }];
  }).sort((a, b) => b.score - a.score);
  const perChannel = new Map<string, number>();
  const out: Video[] = [];
  for (const { v } of scored) {
    const n = perChannel.get(v.channel) ?? 0;
    if (n >= MAX_PER_CHANNEL) continue;
    perChannel.set(v.channel, n + 1);
    const { id, title, channel, durationSec, publishedAt, views, thumb } = v;
    out.push({ id, title, channel, durationSec, publishedAt, views, thumb });
    if (out.length === MAX_RESULTS) break;
  }
  return out;
}

// O erro nunca leva a URL, que contém a chave.
export class YoutubeError extends Error {
  readonly quota: boolean;
  constructor(status: number, reason: string) {
    super(`YouTube ${status}: ${reason}`);
    this.quota = ['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded'].includes(reason);
  }
}

// Custo na cota diária (10 mil unidades): 100 da busca + 1 dos detalhes.
export async function searchYoutube(apiKey: string, q: string, f: typeof fetch = fetch, videoDuration?: 'medium'): Promise<VideoCandidate[]> {
  async function get(path: string, params: Record<string, string>) {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
    for (const [k, v] of Object.entries({ ...params, key: apiKey })) url.searchParams.set(k, v);
    const res = await f(url, { signal: AbortSignal.timeout(10_000) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new YoutubeError(res.status, body?.error?.errors?.[0]?.reason ?? '');
    return (body.items ?? []) as any[];
  }
  const found = await get('search', { part: 'id', q, type: 'video', maxResults: '25', relevanceLanguage: 'pt', regionCode: 'BR', videoEmbeddable: 'true', safeSearch: 'moderate', ...(videoDuration ? { videoDuration } : {}) });
  const ids = found.map((i) => i.id?.videoId as string).filter(Boolean);
  if (!ids.length) return [];
  const details = await get('videos', { part: 'snippet,contentDetails,statistics,status', id: ids.join(','), maxResults: '50' });
  const byId = new Map(details.map((d) => [d.id as string, d]));
  return ids.flatMap((id) => {
    const d = byId.get(id);
    if (!d) return [];
    return [{
      id,
      title: String(d.snippet?.title ?? ''),
      channel: String(d.snippet?.channelTitle ?? ''),
      description: String(d.snippet?.description ?? ''),
      durationSec: parseDuration(String(d.contentDetails?.duration ?? '')),
      publishedAt: String(d.snippet?.publishedAt ?? ''),
      views: Number(d.statistics?.viewCount ?? 0),
      thumb: String(d.snippet?.thumbnails?.medium?.url ?? ''),
      embeddable: d.status?.embeddable === true,
      live: (d.snippet?.liveBroadcastContent ?? 'none') !== 'none',
      blockedBR: (d.contentDetails?.regionRestriction?.blocked ?? []).includes('BR'),
    }];
  });
}

// Em muitos temas as aulas passam de 30 minutos. Faltando sugestões, busca de novo só os vídeos médios do YouTube
// (4 a 20 minutos): é o filtro mais próximo que a API oferece, e gasta mais 101 unidades só nesses casos.
export async function findVideos(apiKey: string, q: string, terms: string[], f: typeof fetch = fetch, now = Date.now(), law = ''): Promise<Video[]> {
  const first = await searchYoutube(apiKey, q, f);
  const picked = rankVideos(first, terms, now, law);
  if (picked.length >= MIN_RESULTS) return picked;
  const seen = new Set(first.map((v) => v.id));
  return rankVideos([...first, ...(await searchYoutube(apiKey, q, f, 'medium')).filter((v) => !seen.has(v.id))], terms, now, law);
}
