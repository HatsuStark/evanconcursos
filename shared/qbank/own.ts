// Banco próprio (projeto apiQuestoes): provas do PCI transcritas e classificadas na taxonomia da Quest API. Cada prova
// aceita é um JSON; aqui as questões viram linhas de `qbank_questions` no mesmo formato público das da Quest, então
// `fromCache` as serve antes de gastar créditos, e correção, explicação, mnemônico e caderno de erros funcionam iguais.
// Ficam de fora: anuladas, dependentes de imagem (o JSON só tem a descrição), suspeitas de desatualizadas, sem matéria
// classificada e sem gabarito válido.

export interface OwnExam {
  prova: { banca: string; orgao: string; cargo: string; ano: number; formato: string };
  classificacao?: { banca?: string; carreiras?: string[] };
  textos?: Record<string, string>;
  questoes: {
    numero: number; enunciado: string; alternativas: { letra: string; texto: string }[]; gabarito: string | null;
    anulada: boolean; texto_associado: string | null; depende_visual: boolean;
    classificacao?: { materia: string; assunto: string; dificuldade: number; desatualizada: boolean };
  }[];
}
export interface OwnRow {
  qid: string; materia: string; assunto: string; gabarito: string;
  payload: {
    qid: string; enunciado: string; tipo: string; dificuldade: number;
    alternativas: { letra: string; texto: string; imagens: string[] }[];
    textos: string[]; anexos: string[];
    prova: { banca: string; ano: number; orgao: string; cargo: string };
    materia: string; assunto: string; carreiras: string[]; fonte: 'propria';
  };
}

export const OWN_PREFIX = 'own-';

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Texto da transcrição (parágrafos por linha em branco, destaques em **negrito**) para o HTML que a tela já exibe.
export function ownHtml(text: string) {
  const inline = (s: string) => escape(s).replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>').replace(/\n/g, '<br>');
  return text.trim().split(/\n\s*\n/).map((p) => `<p>${inline(p.trim())}</p>`).join('');
}

// Id estável por prova e número (sem ":" para passar no filtro de id das questões livres). `hash` dá os 16 primeiros hex
// de um SHA-1; vem de fora para o arquivo rodar no Node e no Deno.
export const ownQid = (hash: (s: string) => string, examKey: string, numero: number) => `${OWN_PREFIX}${hash(`${examKey}#${numero}`).slice(0, 16)}`;

export function ownRows(exam: OwnExam, qidOf: (numero: number) => string): { rows: OwnRow[]; skipped: Record<string, number> } {
  const skipped: Record<string, number> = {};
  const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  const banca = exam.classificacao?.banca || exam.prova.banca;
  const rows: OwnRow[] = [];
  for (const q of exam.questoes) {
    const c = q.classificacao;
    const letras = q.alternativas.map((a) => a.letra.toUpperCase());
    const gabarito = (q.gabarito ?? '').trim().toUpperCase();
    const ce = !q.alternativas.length;
    if (q.anulada) { skip('anulada'); continue; }
    if (q.depende_visual) { skip('imagem'); continue; }
    if (!c?.materia) { skip('sem matéria'); continue; }
    if (c.desatualizada) { skip('desatualizada'); continue; }
    if (ce ? !['C', 'E'].includes(gabarito) : !letras.includes(gabarito)) { skip('gabarito'); continue; }
    const qid = qidOf(q.numero);
    const textos = (q.texto_associado ?? '').split(/[,;\s]+/).filter(Boolean).map((k) => exam.textos?.[k]).filter((t): t is string => !!t).map(ownHtml);
    rows.push({
      qid, materia: c.materia, assunto: c.assunto ?? '', gabarito,
      payload: {
        qid, enunciado: ownHtml(q.enunciado), tipo: ce ? 'certo e errado' : 'multipla escolha',
        dificuldade: Math.max(1, Math.min(5, Math.round(c.dificuldade || 3))),
        alternativas: q.alternativas.map((a) => ({ letra: a.letra.toUpperCase(), texto: ownHtml(a.texto), imagens: [] })),
        textos, anexos: [],
        prova: { banca, ano: exam.prova.ano, orgao: exam.prova.orgao, cargo: exam.prova.cargo },
        materia: c.materia, assunto: c.assunto ?? '', carreiras: exam.classificacao?.carreiras ?? [], fonte: 'propria',
      },
    });
  }
  return { rows, skipped };
}
