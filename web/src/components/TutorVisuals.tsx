// Peças visuais da Aula guiada: esquema do conceito, mapa de conceitos, recapitulação entre etapas e cartão de bolso.
import { Check, CheckCircle2, ChevronRight, Printer, Sparkles } from 'lucide-react';
import { conceptStatuses, isStrong, LEVEL_LABEL, STAGE_LABEL, stageLogs, type ConceptScheme, type ConceptStatus, type Etapa, type TutorConcept, type TutorLesson, type TutorState } from '../../../shared/domain/tutor.ts';

// Esquema do conceito: tabela de comparação ou passos numerados.
export function SchemeView({ scheme }: { scheme: ConceptScheme }) {
  return (
    <figure className="tutor-scheme">
      {scheme.titulo && <figcaption>{scheme.titulo}</figcaption>}
      {scheme.tipo === 'comparacao' ? (
        <div className="guide-table">
          <table className="sum-table">
            <thead><tr>{scheme.colunas.map((c, i) => <th key={i} scope="col">{c}</th>)}</tr></thead>
            <tbody>{scheme.linhas.map((l, i) => <tr key={i}>{l.map((c, j) => (j ? <td key={j}>{c}</td> : <th key={j} scope="row">{c}</th>))}</tr>)}</tbody>
          </table>
        </div>
      ) : (
        <ol className="tutor-flow">{scheme.itens.map((it, i) => <li key={i}><b>{i + 1}</b><span>{it}</span></li>)}</ol>
      )}
    </figure>
  );
}

export const Mnemonic = ({ text }: { text: string }) => <div className="tutor-mnemo"><Sparkles size={15} aria-hidden="true" /><span><b>Para lembrar:</b> {text}</span></div>;

// O que o conceito tem de visual (mnemônico e esquema), para os cartões.
export function ConceptVisuals({ concept }: { concept: TutorConcept }) {
  return <>{concept.mnemonico && <Mnemonic text={concept.mnemonico} />}{concept.esquema && <SchemeView scheme={concept.esquema} />}</>;
}

const STATUS_LABEL: Record<ConceptStatus, string> = { ...LEVEL_LABEL, conhecido: 'Já sabia', pendente: 'A ver' };

// Trilha dos conceitos da aula: cada nó acende conforme o domínio medido até aqui. `current`: conceito em ensino.
export function ConceptMap({ lesson, state, current, legend }: { lesson: Pick<TutorLesson, 'conceitos'>; state: Pick<TutorState, 'logs' | 'known'>; current?: string; legend?: boolean }) {
  const items = conceptStatuses(lesson, state);
  return (
    <div className="tutor-map-wrap">
      <ol className="tutor-map" aria-label="Mapa dos conceitos">
        {items.map((c, i) => (
          <li key={c.id} className={`st-${c.status}` + (c.id === current ? ' current' : '')} title={`${c.nome}: ${STATUS_LABEL[c.status]}`}>
            <span className="node">{c.status === 'dominado' || c.status === 'conhecido' ? <Check size={14} strokeWidth={3} /> : i + 1}</span>
            <span className="label">{c.nome}</span>
            <span className="sr-only">{STATUS_LABEL[c.status]}</span>
          </li>
        ))}
      </ol>
      {legend && (
        <div className="tutor-map-legend faint small">
          <span className="st-pendente">a ver</span><span className="st-em_progresso">em construção</span><span className="st-dominado">dominado</span><span className="st-atencao">precisa de atenção</span>
        </div>
      )}
    </div>
  );
}

const NEXT_HINT: Partial<Record<Etapa, string>> = {
  construcao: 'Um conceito de cada vez, com dica e explicação à mão quando precisar.',
  aplicacao: 'Situações-problema no estilo da prova: aplicar e comparar as regras.',
  desafio: 'Você está indo bem: 3 perguntas no nível das mais difíceis da banca, sem pistas. Errar aqui faz parte.',
  fixacao: 'Perguntas misturadas e sem pistas: lembrar sem ajuda é o que fixa na memória.',
  final: 'Verificação final, no nível da prova e sem pistas. Vá com calma.',
};

// Cartão entre etapas: o que a etapa mostrou, os conceitos vistos (com o esquema dos que tropeçaram) e o que vem a seguir.
export function StageRecap({ stage, next, lesson, state, onContinue }: { stage: Etapa; next: Etapa; lesson: TutorLesson; state: TutorState; onContinue: () => void }) {
  const logs = stageLogs(state, stage);
  const right = logs.filter((l) => l.correct).length, strong = logs.filter(isStrong).length;
  const wrongIds = new Set(logs.filter((l) => !l.correct).map((l) => l.conceito));
  const seen = lesson.conceitos.filter((c) => logs.some((l) => l.conceito === c.id));
  const known = lesson.conceitos.filter((c) => state.known.includes(c.id));
  const nextHint = next === 'aplicacao' && lesson.exemplo?.passos.length && !state.exampleSeen ? `${NEXT_HINT.aplicacao} Antes, um exemplo resolvido passo a passo.` : NEXT_HINT[next];
  return (
    <div className="glass card tutor-recap">
      <div className="q-meta"><span className="badge lime"><CheckCircle2 size={12} /> Etapa concluída</span><span className="muted small">{STAGE_LABEL[stage]}</span></div>
      <h3>{stage === 'diagnostico' ? 'Seu ponto de partida' : stage === 'construcao' ? 'O que você construiu' : `${STAGE_LABEL[stage]}: como foi`}</h3>
      {!!logs.length && <p className="muted" style={{ margin: 0 }}>{right} de {logs.length} {logs.length === 1 ? 'certa' : 'certas'}{strong ? `, ${strong} de primeira e sem ajuda` : ''}.</p>}
      <ConceptMap lesson={lesson} state={state} />

      {stage === 'diagnostico' ? (
        <>
          <p style={{ margin: 0 }}>{state.novice
            ? 'O tema é novo para você, e tudo bem: cada conceito começa com uma explicação curta antes da pergunta.'
            : 'Você já tem base: as perguntas vêm direto, com dica e explicação à mão quando precisar.'}</p>
          {!!known.length && <p className="small" style={{ margin: 0 }}><b>Você já domina:</b> {known.map((c) => c.nome).join(' · ')}. Esses ficam de fora da construção.</p>}
          <div>
            <strong className="small">Sua trilha nesta aula</strong>
            <ol className="tutor-trail">{lesson.conceitos.map((c) => <li key={c.id} className={known.includes(c) ? 'faint' : ''}>{c.nome}</li>)}</ol>
          </div>
        </>
      ) : stage === 'construcao' ? (
        <div className="tutor-recap-list">
          {seen.map((c) => (
            <details key={c.id} open={wrongIds.has(c.id)}>
              <summary><span>{c.nome}</span>{wrongIds.has(c.id) && <span className="badge orange">reveja</span>}</summary>
              <p>{c.essencial}</p>
              <ConceptVisuals concept={c} />
            </details>
          ))}
          <p className="faint small" style={{ margin: 0 }}>Toque num conceito para ver a ideia central e o esquema.</p>
        </div>
      ) : wrongIds.size ? (
        <div className="tutor-recap-list">
          <p className="small" style={{ margin: 0 }}>Vale rever antes de seguir:</p>
          {seen.filter((c) => wrongIds.has(c.id)).map((c) => (
            <details key={c.id} open>
              <summary><span>{c.nome}</span></summary>
              <p>{c.essencial}</p>
              <ConceptVisuals concept={c} />
            </details>
          ))}
        </div>
      ) : <p style={{ margin: 0 }}>Nenhum tropeço nesta etapa. Bom sinal!</p>}

      <div className="tutor-next">
        <span><b>A seguir: {STAGE_LABEL[next]}.</b> {nextHint}</span>
        <button className="btn" onClick={onContinue}>Seguir <ChevronRight size={16} /></button>
      </div>
    </div>
  );
}

// Cartão de bolso do fim da aula: a ideia central de cada conceito, com o domínio, o mnemônico e o esquema. Imprimível.
export function PocketCard({ lesson, state }: { lesson: TutorLesson; state: Pick<TutorState, 'logs' | 'known'> }) {
  const status = new Map(conceptStatuses(lesson, state).map((c) => [c.id, c.status]));
  const color: Record<ConceptStatus, string> = { dominado: 'lime', conhecido: 'lime', em_progresso: 'cyan', atencao: 'orange', pendente: '' };
  return (
    <section className="tutor-pocket">
      <div className="tutor-pocket-head">
        <h3>Cartão de bolso · {lesson.titulo}</h3>
        <button className="btn ghost sm no-print" onClick={() => window.print()}><Printer size={15} /> Imprimir / PDF</button>
      </div>
      <div className="tutor-pocket-list">
        {lesson.conceitos.map((c) => {
          const st = status.get(c.id) ?? 'pendente';
          return (
            <article key={c.id}>
              <header><strong>{c.nome}</strong>{st !== 'pendente' && <span className={'badge ' + color[st]}>{STATUS_LABEL[st]}</span>}</header>
              <p>{c.essencial}</p>
              <ConceptVisuals concept={c} />
              {c.base && <p className="faint small">Base: {c.base}</p>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
