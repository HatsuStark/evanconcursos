import { BookOpen, Brain, Calculator, Cpu, Gavel, Globe, Landmark, Languages, Scale, ScrollText, Shield, type LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';

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

export function Steps({ current }: { current: number }) {
  const steps = ['Edital', 'Conferência', 'Questionário', 'Cronograma'];
  return (
    <ol className="stepper" aria-label="Etapas da configuração">
      {steps.map((s, i) => (
        <li key={s} className={'step' + (i < current ? ' done' : i === current ? ' current' : '')} aria-current={i === current ? 'step' : undefined}>
          <b>{i < current ? '✓' : i + 1}</b>{s}
        </li>
      ))}
    </ol>
  );
}

export const fmtDate = (ymd: string | null | undefined) =>
  ymd ? new Date(ymd + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : 'a definir';

export const daysUntil = (ymd: string | null | undefined) =>
  ymd ? Math.ceil((new Date(ymd + 'T12:00:00').getTime() - Date.now()) / 864e5) : null;
