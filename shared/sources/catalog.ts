// Fontes abertas curadas para as matérias sem lei (aba Fontes e apostila). Só obras cuja licença permite reproduzir
// trechos com crédito; a apostila usa o conteúdo como referência e escreve com as próprias palavras (não copia frases).
// commercialOk: a licença permite uso comercial. As que não permitem (NC) precisam sair se o app passar a ser pago.
// Para incluir uma fonte: confira a licença no próprio PDF, acrescente aqui e rode scripts/sources-seed.ts.
export interface OpenSourceEntry {
  key: string; title: string; authors: string; publisher: string; year: number;
  license: string; licenseUrl: string; commercialOk: boolean;
  url: string;          // página oficial da obra (crédito e link na aba)
  pdf?: string;         // PDF oficial; sem ele (site com bloqueio a robôs), o script pede o arquivo baixado à mão
  subjects: RegExp;     // matérias do edital a que a fonte serve
  latexAccents?: boolean;
  note?: string;        // ressalva mostrada com os trechos (ex.: parte desatualizada)
}

const INFO = /inform[aá]tica|produtividade|office|editor(es)? de texto|planilha|su[ií]te/i;

export const OPEN_SOURCES: OpenSourceEntry[] = [
  {
    key: 'libreoffice-writer', title: 'Guia do Writer 7.1', authors: 'Equipe de Documentação do LibreOffice', publisher: 'The Document Foundation', year: 2021,
    license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/deed.pt_BR', commercialOk: true,
    url: 'https://documentation.libreoffice.org/pt-br/', pdf: 'https://documentation.libreoffice.org/assets/Uploads/Documentation/pt-br/WG71/WG71.pdf', subjects: INFO,
  },
  {
    key: 'libreoffice-calc', title: 'Guia do Calc 7.0', authors: 'Equipe de Documentação do LibreOffice', publisher: 'The Document Foundation', year: 2020,
    license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/deed.pt_BR', commercialOk: true,
    url: 'https://documentation.libreoffice.org/pt-br/', pdf: 'https://documentation.libreoffice.org/assets/Uploads/Documentation/pt-br/CG70/CG70-CalcGuide-Master.pdf', subjects: INFO,
  },
  {
    key: 'libreoffice-intro', title: 'Guia de Introdução ao LibreOffice 7.0', authors: 'Equipe de Documentação do LibreOffice', publisher: 'The Document Foundation', year: 2020,
    license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/deed.pt_BR', commercialOk: true,
    url: 'https://documentation.libreoffice.org/pt-br/', pdf: 'https://documentation.libreoffice.org/assets/Uploads/Documentation/pt-br/GS70/GuiaDeIntroducao.pdf', subjects: INFO,
  },
  {
    key: 'maziero-so', title: 'Sistemas Operacionais: Conceitos e Mecanismos', authors: 'Carlos A. Maziero', publisher: 'DINF/UFPR', year: 2019,
    license: 'CC BY-NC-SA 3.0', licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/3.0/deed.pt_BR', commercialOk: false,
    url: 'https://wiki.inf.ufpr.br/maziero/doku.php?id=socm:start', pdf: 'https://wiki.inf.ufpr.br/maziero/lib/exe/fetch.php?media=socm:socm-livro.pdf',
    subjects: /sistemas? operaciona|hardware|arquitetura de computadores|inform[aá]tica/i,
  },
  {
    key: 'certbr-cartilha', title: 'Cartilha de Segurança para Internet', authors: 'CERT.br', publisher: 'NIC.br', year: 2012,
    license: 'CC BY-NC-ND 3.0 BR', licenseUrl: 'https://creativecommons.org/licenses/by-nc-nd/3.0/br/', commercialOk: false,
    url: 'https://cartilha.cert.br/', pdf: 'https://cartilha.cert.br/livro/cartilha-seguranca-internet.pdf', latexAccents: true,
    subjects: /seguran[çc]a|internet|prote[çc][ãa]o de dados|inform[aá]tica|redes/i,
  },
  {
    key: 'manual-redacao-pr', title: 'Manual de Redação da Presidência da República (3ª ed.)', authors: 'Presidência da República, Casa Civil', publisher: 'Presidência da República', year: 2018,
    license: 'Reprodução sem fins lucrativos, citada a fonte (Portaria nº 1.369/2018)', licenseUrl: 'https://www.planalto.gov.br/legislacao', commercialOk: false,
    url: 'https://www4.planalto.gov.br/centrodeestudos/assuntos/manual-de-redacao-da-presidencia-da-republica', subjects: /portugu[eê]s|reda[çc][ãa]o|comunica[çc][ãa]o oficial/i,
    note: 'Pronomes de tratamento mudaram depois desta edição (Decreto nº 9.758/2019): confira a regra vigente.',
  },
];

export const sourceByKey = (key: string) => OPEN_SOURCES.find((s) => s.key === key);
export const sourcesForSubject = (subject: string) => OPEN_SOURCES.filter((s) => s.subjects.test(subject)).map((s) => s.key);
