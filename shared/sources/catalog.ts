// Fontes abertas curadas para as matérias sem lei (aba Fontes e apostila). Só obras cuja licença permite reproduzir
// trechos com crédito; a apostila usa o conteúdo como referência e escreve com as próprias palavras (não copia frases).
// commercialOk: a licença permite uso comercial. As que não permitem (NC) precisam sair se o app passar a ser pago.
// Para incluir uma fonte: confira a licença no próprio PDF ou site, acrescente aqui (com os grupos de matéria a que
// serve) e rode scripts/sources-seed.ts. scripts/sources-coverage.ts mostra os temas dos editais ainda sem trecho.

// Grupos de matéria: o nome da matéria no edital cai em um ou mais grupos, e cada fonte diz a que grupos serve. Grupo
// sem fonte ainda (ex.: matemática) existe para o relatório de cobertura apontar a lacuna.
export const SUBJECT_GROUPS = {
  informatica: /inform[aá]tica|tecnologia da informa[çc][ãa]o|computa[çc][ãa]o/i,
  office: /produtividade|office|editor(es)? de texto|planilha|su[ií]te/i,
  'hardware-so': /sistemas? operaciona|hardware|arquitetura de computadores|linux|windows/i,
  'seguranca-redes': /seguran[çc]a|internet|prote[çc][ãa]o de dados|redes/i,
  portugues: /portugu[eê]s|reda[çc][ãa]o|comunica[çc][ãa]o oficial|interpreta[çc][ãa]o de texto|gram[aá]tica/i,
  matematica: /matem[aá]tic|c[aá]lculo/i,
  'raciocinio-logico': /racioc[ií]nio|l[oó]gica/i,
  estatistica: /estat[ií]stica|probabilidade/i,
  administracao: /administra[çc][ãa]o (geral|p[uú]blica)|gest[ãa]o p[uú]blica|(?<!\p{L})[ée]tica/iu,
  // Sem /i: "afo" minúsculo aparece dentro de palavras ("parágrafo").
  'afo-contabilidade': /[Oo]r[çc]ament|[Ff]inan[çc]as [Pp][uú]blicas|[Cc]ontabilidade|\bAFO\b/,
  arquivologia: /arquivolog|gest[ãa]o (de )?documen|arquiv[ií]stic/i,
} satisfies Record<string, RegExp>;
export type SubjectGroup = keyof typeof SUBJECT_GROUPS;
export const groupsForSubject = (subject: string) =>
  (Object.entries(SUBJECT_GROUPS) as [SubjectGroup, RegExp][]).filter(([, re]) => re.test(subject)).map(([g]) => g);

// Site em HTML: as páginas são lidas a partir de start, seguindo os links que casam com include, na ordem em que
// aparecem (o índice da obra dá a ordem de leitura). Cada página vira uma "página" da fonte, citada pela seção e link.
export interface HtmlSite { start: string; include: RegExp; max?: number }

export interface OpenSourceEntry {
  key: string; title: string; authors: string; publisher: string; year: number;
  license: string; licenseUrl: string; commercialOk: boolean;
  url: string;          // página oficial da obra (crédito e link na aba)
  pdf?: string;         // PDF oficial; sem ele e sem html (site com bloqueio a robôs), o script pede o arquivo baixado à mão
  html?: HtmlSite;      // obra publicada como site (em vez de PDF)
  subjects: SubjectGroup[];
  latexAccents?: boolean;
  note?: string;        // ressalva mostrada com os trechos (ex.: parte desatualizada)
}

export const OPEN_SOURCES: OpenSourceEntry[] = [
  {
    key: 'libreoffice-writer', title: 'Guia do Writer 7.1', authors: 'Equipe de Documentação do LibreOffice', publisher: 'The Document Foundation', year: 2021,
    license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/deed.pt_BR', commercialOk: true,
    url: 'https://documentation.libreoffice.org/pt-br/', pdf: 'https://documentation.libreoffice.org/assets/Uploads/Documentation/pt-br/WG71/WG71.pdf', subjects: ['informatica', 'office'],
  },
  {
    key: 'libreoffice-calc', title: 'Guia do Calc 7.0', authors: 'Equipe de Documentação do LibreOffice', publisher: 'The Document Foundation', year: 2020,
    license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/deed.pt_BR', commercialOk: true,
    url: 'https://documentation.libreoffice.org/pt-br/', pdf: 'https://documentation.libreoffice.org/assets/Uploads/Documentation/pt-br/CG70/CG70-CalcGuide-Master.pdf', subjects: ['informatica', 'office'],
  },
  {
    key: 'libreoffice-intro', title: 'Guia de Introdução ao LibreOffice 7.0', authors: 'Equipe de Documentação do LibreOffice', publisher: 'The Document Foundation', year: 2020,
    license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/deed.pt_BR', commercialOk: true,
    url: 'https://documentation.libreoffice.org/pt-br/', pdf: 'https://documentation.libreoffice.org/assets/Uploads/Documentation/pt-br/GS70/GuiaDeIntroducao.pdf', subjects: ['informatica', 'office'],
  },
  {
    key: 'maziero-so', title: 'Sistemas Operacionais: Conceitos e Mecanismos', authors: 'Carlos A. Maziero', publisher: 'DINF/UFPR', year: 2019,
    license: 'CC BY-NC-SA 3.0', licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/3.0/deed.pt_BR', commercialOk: false,
    url: 'https://wiki.inf.ufpr.br/maziero/doku.php?id=socm:start', pdf: 'https://wiki.inf.ufpr.br/maziero/lib/exe/fetch.php?media=socm:socm-livro.pdf',
    subjects: ['informatica', 'hardware-so'],
  },
  {
    key: 'certbr-cartilha', title: 'Cartilha de Segurança para Internet', authors: 'CERT.br', publisher: 'NIC.br', year: 2012,
    license: 'CC BY-NC-ND 3.0 BR', licenseUrl: 'https://creativecommons.org/licenses/by-nc-nd/3.0/br/', commercialOk: false,
    url: 'https://cartilha.cert.br/', pdf: 'https://cartilha.cert.br/livro/cartilha-seguranca-internet.pdf', latexAccents: true,
    subjects: ['informatica', 'seguranca-redes'],
  },
  {
    key: 'manual-redacao-pr', title: 'Manual de Redação da Presidência da República (3ª ed.)', authors: 'Presidência da República, Casa Civil', publisher: 'Presidência da República', year: 2018,
    license: 'Reprodução sem fins lucrativos, citada a fonte (Portaria nº 1.369/2018)', licenseUrl: 'https://www.planalto.gov.br/legislacao', commercialOk: false,
    url: 'https://www4.planalto.gov.br/centrodeestudos/assuntos/manual-de-redacao-da-presidencia-da-republica', subjects: ['portugues'],
    note: 'Pronomes de tratamento mudaram depois desta edição (Decreto nº 9.758/2019): confira a regra vigente.',
  },
];

export const sourceByKey = (key: string) => OPEN_SOURCES.find((s) => s.key === key);
export function sourcesForSubject(subject: string) {
  const groups = new Set(groupsForSubject(subject));
  return OPEN_SOURCES.filter((s) => s.subjects.some((g) => groups.has(g))).map((s) => s.key);
}
