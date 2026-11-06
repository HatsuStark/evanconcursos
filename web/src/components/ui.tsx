import { BookOpen, Brain, Calculator, Cpu, Gavel, Globe, Landmark, Languages, Scale, ScrollText, Shield, type LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';

// Cor e ícone por matéria: cores em rodízio (as do tema) e ícone pelo nome.
export const PALETTE = ['var(--violet)', 'var(--orange)', 'var(--cyan)', 'var(--blue)', 'var(--magenta)', 'var(--lime)'];
export const subjectColor = (i: number) => PALETTE[i % PALETTE.length]!;

const ICONS: [RegExp, LucideIcon][] = [
  [/portugu|l[ií]ngua|reda[cç]/i, Languages],
  [/penal|criminal/i, Gavel],
  [/constitucional/i, Landmark],
  [/process|civil/i, Scale],
  [/administrativ|servi[cç]o p[uú]blico|[ée]tica/i, ScrollText],
  [/matem|racioc|l[oó]gic|estat/i, Calculator],
  [/inform|software|dados|sistema|devops|nuvem|tecnolog/i, Cpu],
  [/intelig[eê]ncia|ia\b/i, Brain],
  [/seguran/i, Shield],
  [/atualidade|geral|hist|geogr/i, Globe],
];
export const subjectIcon = (name: string): LucideIcon => ICONS.find(([re]) => re.test(name))?.[1] ?? BookOpen;

export function SubjectIcon({ name, index, style }: { name: string; index: number; style?: CSSProperties }) {
  const Icon = subjectIcon(name);
  return <span className="subject-icon" style={{ color: subjectColor(index), ...style }}><Icon /></span>;
}

// Com noticeId, conferência e questionário viram links: as etapas já feitas e, até `upTo`, as seguintes (edital já
// conferido pode ir direto ao questionário). Sem noticeId (envio do edital, cronograma sendo gerado), só indicação.
export function Steps({ current, noticeId, upTo = current }: { current: number; noticeId?: string; upTo?: number }) {
  const steps = ['Edital', 'Conferência', 'Questionário', 'Cronograma'];
  const paths: (string | null)[] = [null, 'conferencia', 'questionario', null];
  return (
    <ol className="stepper" aria-label="Etapas da configuração">
      {steps.map((s, i) => {
        const inner = <><b>{i < current ? '✓' : i + 1}</b>{s}</>;
        const path = noticeId && i !== current && i <= upTo ? paths[i] : null;
        return (
          <li key={s} className={'step' + (i < current ? ' done' : i === current ? ' current' : '') + (path ? ' link' : '')} aria-current={i === current ? 'step' : undefined}>
            {path ? <Link to={`/concursos/${noticeId}/${path}`} title={`Voltar para ${s.toLowerCase()}`}>{inner}</Link> : inner}
          </li>
        );
      })}
    </ol>
  );
}

export const fmtDate = (ymd: string | null | undefined) =>
  ymd ? new Date(ymd + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : 'a definir';

export const daysUntil = (ymd: string | null | undefined) =>
  ymd ? Math.ceil((new Date(ymd + 'T12:00:00').getTime() - Date.now()) / 864e5) : null;
