// Cliente da Quest API (banco de questões). Roda no Deno (Edge Functions) e no Node (avaliações).
// Respeita o limite de requisições: o plano permite 500 por minuto (X-RateLimit-Limit), e 40 chamadas seguidas, a ~6 por
// segundo, passaram sem 429. Um intervalo de 200 ms (~300 por minuto) deixa folga para vários pedidos ao mesmo tempo com a
// mesma chave; no 429, espera o Retry-After. O X-RateLimit-Remaining não diminui a cada chamada, então não serve de guia.
// Custos (docs): /questoes = 3 créditos por questão, 6 com gabarito; /filtros* gratuito.
export interface QuestQuestion {
  id: string; numero?: number; enunciado: string; dificuldade: number; tipo: string; anulada: boolean;
  alternativas: { letra: string; texto: string; imagens?: string[] }[];
  gabarito: string | null;
  provas: { orgao: string; cargo: string; ano: number; banca: string }[];
  classificacao: { materia: string; assunto: string };
  textos_associados: string[]; anexos: string[]; carreiras?: string[];
}
type Page<T> = { items: T[]; total?: number; has_more?: boolean; next_cursor?: string | null };

// Campos declarados à parte (sem "parameter properties"): o arquivo também roda no Node só removendo tipos.
export class QuestClient {
  private last = 0;
  private readonly key: string;
  private readonly minIntervalMs: number;
  private readonly base: string;
  credits = 0;
  constructor(key: string, minIntervalMs = 200, base = 'https://api.quest.api.br/v2') {
    this.key = key; this.minIntervalMs = minIntervalMs; this.base = base;
  }

  private async get<T>(path: string, params: Record<string, string | number | boolean | undefined>, attempt = 1): Promise<T> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    const wait = this.last + this.minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.last = Date.now();
    const res = await fetch(url, { headers: { 'X-API-Key': this.key } });
    if (res.status === 429 && attempt < 4) {
      const after = Number(res.headers.get('retry-after'));
      await new Promise((r) => setTimeout(r, after > 0 ? Math.min(after, 60) * 1000 : 5000 * attempt));
      return this.get<T>(path, params, attempt + 1);
    }
    const body = await res.json().catch(() => ({})) as { data?: T; message?: string };
    if (!res.ok) throw new Error(`Quest API ${path}: ${res.status} ${body.message ?? ''}`.trim());
    return body.data as T;
  }

  // Listas gerais de filtros (anos, dificuldades, tipos de questão, UFs, esferas); gratuito.
  async geral() { return this.get<Record<string, unknown>>('/filtros', {}); }
  async bancas(q: string) { return (await this.get<Page<string>>('/filtros/bancas', { q, per_page: 20 })).items; }
  async materias(q: string, limit = 12) { return (await this.get<{ items: string[] }>('/filtros/materias', { q, limit })).items; }
  // Carreiras da API (gratuito; ~140, em duas páginas), para o filtro `carreira` das questões.
  async carreiras() {
    const out: string[] = [];
    for (let page = 1; page <= 5; page++) {
      const r = await this.get<Page<string>>('/filtros/carreiras', { page, per_page: 100 });
      out.push(...r.items);
      if (!r.has_more || !r.items.length) break;
    }
    return out;
  }
  // Assuntos da matéria que contêm o trecho (busca parcial da API; gratuito): acha "Elasticidades" por "elasticidade" sem
  // baixar a lista inteira, que passa de mil em matérias grandes.
  async assuntosMatching(materia: string, q: string) { return (await this.get<Page<string>>('/filtros/assuntos', { materia, q, per_page: 50 })).items; }
  // Todos os assuntos de uma matéria (paginado; gratuito), os mais cobrados primeiro. Limite de páginas para matérias enormes.
  async assuntos(materia: string, maxPages = 25) {
    const out: string[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const r = await this.get<Page<string>>('/filtros/assuntos', { materia, page, per_page: 100 });
      out.push(...r.items);
      if (!r.has_more || !r.items.length) break;
    }
    return out;
  }
  async count(params: Record<string, string | number | boolean | undefined>) {
    const r = await this.get<Page<QuestQuestion>>('/questoes', { ...params, per_page: 1, include_total: true });
    this.credits += r.items.length * 3;
    return r.total ?? r.items.length;
  }
  async questoes(params: Record<string, string | number | boolean | undefined>, perPage: number, afterId?: string) {
    const r = await this.get<Page<QuestQuestion>>('/questoes', { ...params, per_page: perPage, include_gabarito: true, include_total: false, anulada: false, tem_gabarito: true, after_id: afterId });
    this.credits += r.items.length * 6;
    return { items: r.items, next: r.next_cursor ?? null, hasMore: !!r.has_more };
  }
  // Total com os mesmos filtros de `questoesPage`. A API ordena da questão mais antiga para a mais nova.
  async usableTotal(params: Record<string, string | number | boolean | undefined>) {
    const r = await this.get<Page<QuestQuestion>>('/questoes', { ...params, per_page: 1, include_total: true, anulada: false, tem_gabarito: true });
    this.credits += r.items.length * 3;
    return r.total ?? 0;
  }
  async questoesPage(params: Record<string, string | number | boolean | undefined>, page: number, perPage: number) {
    const r = await this.get<Page<QuestQuestion>>('/questoes', { ...params, page, per_page: perPage, include_gabarito: true, include_total: false, anulada: false, tem_gabarito: true });
    this.credits += r.items.length * 6;
    return r.items;
  }
  // Uma questão pelo id da API; null se não existir.
  async questao(id: string) {
    try {
      const q = await this.get<QuestQuestion>(`/questoes/${encodeURIComponent(id)}`, { include_gabarito: true });
      this.credits += 6;
      return q;
    } catch (e) {
      if (e instanceof Error && /: 404\b/.test(e.message)) return null;
      throw e;
    }
  }
}
