// Revisão em áudio: valores ajustáveis num lugar só. Mudar o roteiro, a voz ou o pipeline muda a versão, que entra na
// chave do cache: as revisões antigas continuam valendo, as novas saem com a versão nova.

export const AUDIO_PIPELINE_VERSION = 'audio-v1';
export const AUDIO_PROMPT_VERSION = 'audio-script-v1';
export const TTS_MODEL_DEFAULT = 'gemini-3.8-flash-tts';

// Durações oferecidas (minutos) e a padrão.
export const DURATIONS = [10, 20, 30] as const;
export type Duration = (typeof DURATIONS)[number];
export const DEFAULT_DURATION: Duration = 20;

// Ritmo de referência da narração (palavras por minuto): o tempo do roteiro é estimado por ele.
export const WORDS_PER_MINUTE = 140;

// Vozes: uma por revisão. Os nomes são vozes prontas do Gemini TTS; a doc não diz gênero, a escolha foi ouvindo.
export const VOICES = { feminina: 'Kore', masculina: 'Charon' } as const;
export type VoiceKind = keyof typeof VOICES;
export const DEFAULT_VOICE: VoiceKind = 'feminina';

// Orientação de interpretação enviada com cada bloco (fica fora do texto narrado).
export const NARRATOR_STYLE = 'Professor brasileiro especializado em concursos públicos, narrando uma revisão em áudio: voz natural, segura, '
  + 'tranquila e didática, em português do Brasil. Ritmo moderado, entonação expressiva sem exageros, pronúncia clara. Destaque discretamente '
  + 'conceitos, prazos e exceções e fale um pouco mais devagar nos trechos complexos. Entonação interrogativa natural nas perguntas. '
  + 'Sem teatralidade, sem monotonia, sem estilo publicitário. Leia exatamente o texto, sem acrescentar nem omitir nada.';

// Pausas depois de cada tipo de segmento (ms): o roteiro sugere, o pipeline limita a esta faixa. As pausas de
// recuperação são silêncio de verdade, inserido na montagem, não pedido à voz.
export const PAUSE_RANGE: Record<string, [number, number]> = {
  pergunta: [4000, 20000],
  fixacao: [4000, 12000],
  introducao: [600, 1500],
  explicacao: [400, 1200],
  resposta: [600, 1800],
  feedback: [600, 1800],
  exemplo: [500, 1500],
  comparacao: [500, 1500],
  pegadinha: [600, 1800],
  excecao: [500, 1500],
  mnemonico: [800, 2500],
  transicao: [1000, 2500],
  resumo: [600, 1800],
  encerramento: [500, 1500],
};
// Faixas por formato de pergunta (ms), usadas pelo roteirista e para conferir.
export const QUESTION_PAUSE: Record<string, [number, number]> = {
  certo_errado: [4000, 6000],
  conceitual: [6000, 10000],
  enumeracao: [10000, 15000],
  caso: [10000, 20000],
  completar: [4000, 8000],
  diferenciar: [6000, 12000],
};

// Distribuição de referência do tempo (fração): recentes, anteriores a reforçar, erros persistentes.
export const MIX = { recentes: 0.6, anteriores: 0.25, erros: 0.15 } as const;
// Acerto só conta como dificuldade com pelo menos isto de questões no assunto (mesmo corte do "ponto fraco").
export const MIN_ATTEMPTS_FOR_DIFFICULTY = 5;
// Janela de "recente" e de busca de erros (dias).
export const RECENT_DAYS = 7, ERROR_DAYS = 60;

// Limites: gerações por revisão semanal (falha não conta) e teto de fontes enviadas à IA.
export const GENERATIONS_PER_WEEKLY_TASK = 1;
export const MAX_THEMES = 8, MAX_SOURCE_CHARS = 60_000, MAX_ERROR_QUESTIONS = 10;

// Blocos de narração: segmentos seguidos viram um bloco até uma pausa longa (pergunta) ou este tamanho.
// 1000 caracteres ≈ 1 min de fala, o tamanho que a guide-voice já gera dentro do limite de CPU da Edge Function.
export const BLOCK_MAX_CHARS = 1000, BLOCK_BREAK_PAUSE_MS = 2500;

// Montagem: introdução musical antes da primeira fala e encerramento depois da última (iguais nas duas versões, para
// a troca entre elas manter a posição).
export const INTRO_MS = 4000, OUTRO_MS = 5000;
// Loudness e pico do arquivo final; trilha abaixo da voz (dB) por situação.
export const TARGET_LUFS = -16, TRUE_PEAK_DB = -1;
// Trilha baixa mas audível (dB abaixo da voz, com a trilha medida no mesmo loudness): -24 ficava inaudível em alto-falante
// de celular (2026-11-26). Explicação -18, pergunta -23, pausa de recuperação -28, transição -13, abertura -8.
export const MUSIC_DB = { suave: -18, reduzida: -23, pausa: -28, transicao: -13, intro: -8 } as const;
