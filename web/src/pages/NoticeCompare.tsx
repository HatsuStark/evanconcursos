import { AlertTriangle, ArrowRight, CalendarClock, ShieldCheck } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { isOpenEnded } from '../../../shared/domain/rounds.ts';
import { ymd } from '../../../shared/domain/dates.ts';
import type { TopicMatch } from '../../../shared/domain/notice-diff.ts';
import { Shell } from '../components/Shell.tsx';
import { daysUntil, fmtDate } from '../components/ui.tsx';
import { useNoticeDiff } from '../lib/notices.ts';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function TopicList({ title, hint, topics, open = false }: { title: string; hint: string; topics: { id: string; subject: string; text: string; missingNumbers?: string[]; studied?: boolean }[]; open?: boolean }) {
  if (!topics.length) return null;
  return (
    <details className="glass card diff-group" open={open}>
      <summary><strong>{title} ({topics.length})</strong><span className="muted small">{hint}</span></summary>
      <ul className="diff-list">
        {topics.map((t) => (
          <li key={t.id}>
            <span className="faint small">{t.subject}{t.studied ? ' · já estudado' : ''}</span>
            <div>{t.text}</div>
            {!!t.missingNumbers?.length && <div className="small" style={{ color: 'var(--orange)' }}>Números que o edital antigo não citava: {t.missingNumbers.join(', ')}</div>}
          </li>
        ))}
      </ul>
    </details>
  );
}

// Mostra o que mudou entre o edital do plano e o novo. Nada no plano é alterado aqui: a atualização começa em "Continuar".
export function NoticeComparePage() {
  const { noticeId } = useParams();
  const q = useNoticeDiff(noticeId);
  const title = 'O que mudou no edital';

  if (q.isLoading) return <Shell title={title}><div className="spinner" /></Shell>;
  if (q.error) return <Shell title={title}><p className="error" role="alert">{(q.error as Error).message}</p></Shell>;
  if (!q.data) return <Shell title={title}><div className="glass card muted">Este edital não está ligado a um plano anterior. <Link to="/">Volte à tela Hoje</Link> e use "Saiu novo edital?".</div></Shell>;

  const { previous, next, diff, previousId, alreadyUpdated } = q.data, c = diff.counts, total = diff.topics.length;
  const by = (s: TopicMatch['status']) => diff.topics.filter((t) => t.status === s);
  const similar = [...by('similar')].sort((a, b) => b.missingNumbers.length - a.missingNumbers.length);
  const days = daysUntil(diff.examDate), past = isOpenEnded(diff.examDate, ymd(new Date()));
  const otherContest = diff.organizationChanged || diff.roleChanged;

  return (
    <Shell title={title} subtitle={`${previous.role || previous.title} → ${next.role || next.title}`}>
      <div className="grid" style={{ gap: 14 }}>
        {otherContest && (
          <div className="warning-card" role="alert"><AlertTriangle /><span><strong>Parece outro concurso:</strong> {[diff.organizationChanged && `órgão ${previous.organization || '—'} → ${next.organization || '—'}`, diff.roleChanged && `cargo ${previous.role || '—'} → ${next.role || '—'}`].filter(Boolean).join('; ')}. Confira se enviou o edital certo.</span></div>
        )}
        {diff.boardChanged && (
          <div className="warning-card"><AlertTriangle /><span><strong>A banca mudou:</strong> {previous.board || '—'} → {next.board || '—'}. Seu desempenho na banca anterior indica menos sobre o estilo da nova.</span></div>
        )}
        <div className="glass card" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <CalendarClock size={20} style={{ color: 'var(--cyan)' }} />
          {!diff.examDate ? <span>O novo edital não informa a data da prova.</span>
            : past ? <span>A prova deste edital também já foi realizada, em {fmtDate(diff.examDate)}.</span>
            : <span><strong>Prova em {fmtDate(diff.examDate)}</strong>{days != null ? `, daqui a ${plural(days, 'dia', 'dias')}` : ''}.</span>}
        </div>
        <div className="diff-counts">
          <div className="glass card"><strong style={{ color: 'var(--lime)' }}>{c.same}</strong><span className="muted small">{c.same === 1 ? 'igual' : 'iguais'}</span></div>
          <div className="glass card"><strong style={{ color: 'var(--cyan)' }}>{c.similar}</strong><span className="muted small">{c.similar === 1 ? 'mudou um pouco' : 'mudaram um pouco'}</span></div>
          <div className="glass card"><strong style={{ color: 'var(--orange)' }}>{c.new}</strong><span className="muted small">{c.new === 1 ? 'novo' : 'novos'}</span></div>
          <div className="glass card"><strong style={{ color: 'var(--faint)' }}>{c.removed}</strong><span className="muted small">{c.removed === 1 ? 'saiu' : 'saíram'}</span></div>
        </div>
        <p className="muted" style={{ margin: 0 }}>Você já estudou {plural(c.studied, 'tópico', 'tópicos')} de {total} do novo edital. Na dúvida, um tópico conta como novo.</p>
        {!!diff.addedSubjects.length && <p className="small" style={{ margin: 0 }}><strong>Matérias novas:</strong> {diff.addedSubjects.join(', ')}</p>}
        {!!diff.removedSubjects.length && <p className="small" style={{ margin: 0 }}><strong>Matérias que saíram:</strong> {diff.removedSubjects.join(', ')}</p>}
        <TopicList title="Novos" hint="Conteúdo que você precisa estudar." topics={by('new')} open />
        <TopicList title="Mudaram um pouco" hint="Confira o que mudou, principalmente os artigos." topics={similar} open />
        <TopicList title="Saíram" hint="Não caem mais; o que você estudou continua no histórico." topics={diff.removed} />
        <TopicList title="Iguais" hint="Mesmo texto do edital anterior." topics={by('same')} />
        <div className="glass card" style={{ display: 'grid', gap: 12 }}>
          {alreadyUpdated ? (
            <><span><ShieldCheck size={18} style={{ verticalAlign: -3, color: 'var(--lime)' }} /> Seu plano já foi atualizado com este edital.</span>
              <Link className="btn sm" style={{ justifySelf: 'start' }} to="/cronograma">Ir ao cronograma <ArrowRight size={15} /></Link></>
          ) : (
            <><strong>Atualizar meu plano com este edital?</strong>
              <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>
                <li>O conteúdo novo vem primeiro, e o que você já estudou vira revisão.</li>
                <li>O cronograma passa a seguir {!diff.examDate || past ? 'sem prazo, adaptando-se ao seu desempenho' : `até a prova, em ${fmtDate(diff.examDate)}`}.</li>
                <li>{diff.boardChanged ? 'Como a banca mudou, seu desempenho recomeça do zero no plano novo; o histórico continua guardado.' : 'Seu desempenho nas matérias equivalentes vai junto.'}</li>
                <li>Suas apostilas em PDF passam para o novo plano e são mapeadas de novo. Ajustes manuais de páginas se perdem, porque apontam para as sessões antigas.</li>
                <li>O plano antigo fica arquivado, com o histórico, e sai da lista de concursos.</li>
              </ul>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Link className="btn sm" to={`/concursos/${noticeId}/questionario?de=${previousId}`}>Continuar <ArrowRight size={15} /></Link>
                <Link className="btn ghost sm" to="/">Agora não</Link>
              </div></>
          )}
        </div>
      </div>
    </Shell>
  );
}
