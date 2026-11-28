import { useQueryClient } from '@tanstack/react-query';
import { EyeOff, Headphones, Pin, PinOff, Play, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { smartQueue, themeClips, type Clip, type Mark, type QueueItem } from '../../../shared/audio/playlist.ts';
import { PlaylistPlayer } from '../components/PlaylistPlayer.tsx';
import { Shell } from '../components/Shell.tsx';
import { fmtDate } from '../components/ui.tsx';
import { setPlaylistMark, useAudioLibrary, usePlaylistMarks, type Library } from '../lib/audioPlaylist.ts';
import { fmtTime } from '../lib/audioReview.ts';
import { useActivePlan } from '../lib/plans.ts';

type Tab = 'voce' | 'tema' | 'todas';
const LENGTHS = [15, 30, 60];
const minutes = (ms: number) => `${Math.max(1, Math.round(ms / 60000))} min`;
const total = (cs: Clip[]) => cs.reduce((a, c) => a + c.endMs - c.startMs, 0);

// Seus áudios: as revisões em áudio já geradas viram uma playlist que cresce a cada semana. Sem IA nova: só reorganiza
// o que já foi narrado. Ouvir não conta como revisão feita.
export function AudioLibraryPage() {
  const active = useActivePlan();
  const planId = active.data?.plan.id;
  const lib = useAudioLibrary(planId);
  const marksQ = usePlaylistMarks(planId);
  const [tab, setTab] = useState<Tab>('voce');
  const [playing, setPlaying] = useState<{ name: string; items: QueueItem[] } | null>(null);
  const subtitle = 'Ouça de novo as revisões em áudio que você já gerou, organizadas pelo que você mais precisa.';

  if (active.isLoading || (planId && lib.isLoading)) return <Shell title="Seus áudios" subtitle={subtitle}><div className="spinner" /></Shell>;
  if (!active.data) return <Shell title="Seus áudios" subtitle={subtitle}><div className="glass card muted">Monte um cronograma para ter revisões em áudio. <Link to="/concursos">Ir para Concursos</Link></div></Shell>;
  if (lib.isError) return <Shell title="Seus áudios" subtitle={subtitle}><p className="error">{(lib.error as Error).message}</p></Shell>;
  const data = lib.data!;
  if (!data.reviews.length) {
    return (
      <Shell title="Seus áudios" subtitle={subtitle}>
        <div className="glass card grid" style={{ gap: 8 }}>
          <div className="daily-review-head"><Headphones size={20} style={{ color: 'var(--lime)' }} /><strong>Nenhuma revisão em áudio ainda</strong></div>
          <p className="muted small" style={{ margin: 0 }}>No dia da revisão semanal, gere a sua revisão em áudio. Cada uma entra aqui, e a playlist cresce semana a semana.</p>
        </div>
      </Shell>
    );
  }
  const marks = marksQ.data ?? new Map<string, Mark>();
  const play = (name: string, items: QueueItem[]) => { if (items.length) { setPlaying(null); setTimeout(() => setPlaying({ name, items }), 0); } };

  return (
    <Shell title="Seus áudios" subtitle={subtitle}>
      {playing && <PlaylistPlayer key={playing.name + playing.items.length} name={playing.name} items={playing.items} reviews={data.reviews} onClose={() => setPlaying(null)} />}
      <div className="segmented" style={{ justifySelf: 'start' }} role="tablist">
        {([['voce', 'Para você'], ['tema', 'Por tema'], ['todas', 'Todas as revisões']] as [Tab, string][]).map(([k, t]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t}</button>
        ))}
      </div>
      {tab === 'voce' && <ForYou data={data} marks={marks} planId={planId!} onPlay={play} />}
      {tab === 'tema' && <ByTheme data={data} onPlay={play} />}
      {tab === 'todas' && <AllReviews data={data} marks={marks} planId={planId!} onPlay={play} />}
      <p className="faint small" style={{ margin: 0 }}>Ouvir não conta como revisão feita: a revisão dos temas continua nas questões e na Revisão da semana.</p>
    </Shell>
  );
}

function useMark(planId: string) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const mark = async (c: Clip, m: Mark | null) => {
    setError('');
    qc.setQueryData<Map<string, Mark>>(['audio-marks', planId], (old) => { const n = new Map(old ?? []); if (m) n.set(c.key, m); else n.delete(c.key); return n; });
    try { await setPlaylistMark(c, m); } catch (e) { setError((e as Error).message); void qc.invalidateQueries({ queryKey: ['audio-marks', planId] }); }
  };
  return { mark, error };
}

function MarkButtons({ clip, marks, mark }: { clip: Clip; marks: Map<string, Mark>; mark: (c: Clip, m: Mark | null) => void }) {
  const m = marks.get(clip.key);
  return (
    <span className="playlist-actions">
      <button className={'icon-btn' + (m === 'pin' ? ' on' : '')} aria-label={m === 'pin' ? 'Desafixar' : 'Fixar na playlist'} title={m === 'pin' ? 'Desafixar' : 'Fixar: sempre entra em Para você'} onClick={() => mark(clip, m === 'pin' ? null : 'pin')}>{m === 'pin' ? <PinOff size={15} /> : <Pin size={15} />}</button>
      {m === 'hide'
        ? <button className="icon-btn" aria-label="Devolver à playlist" title="Devolver à playlist" onClick={() => mark(clip, null)}><Undo2 size={15} /></button>
        : <button className="icon-btn" aria-label="Tirar da playlist" title="Tirar: não entra em Para você" onClick={() => mark(clip, 'hide')}><EyeOff size={15} /></button>}
    </span>
  );
}

function ForYou({ data, marks, planId, onPlay }: { data: Library; marks: Map<string, Mark>; planId: string; onPlay: (name: string, items: QueueItem[]) => void }) {
  const [len, setLen] = useState(30);
  const { mark, error } = useMark(planId);
  const queue = useMemo(() => smartQueue(data.clips, data.themes, marks, len * 60000), [data, marks, len]);
  const hidden = data.clips.filter((c) => marks.get(c.key) === 'hide');
  const reviewTitle = new Map(data.reviews.map((r) => [r.id, r]));
  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="glass card grid" style={{ gap: 10 }}>
        <div className="daily-review-head">
          <div style={{ flex: 1, minWidth: 200 }}>
            <strong>Sua playlist de hoje</strong>
            <div className="muted small">Primeiro os trechos que você fixou; depois os temas com revisão vencida, acerto baixo ou pouca prática. Tema dominado fica de fora.</div>
          </div>
          <div className="segmented" role="group" aria-label="Duração">
            {LENGTHS.map((m) => <button key={m} className={len === m ? 'on' : ''} aria-pressed={len === m} onClick={() => setLen(m)}>{m} min</button>)}
          </div>
          <button className="btn" disabled={!queue.length} onClick={() => onPlay('Para você', queue)}><Play size={16} /> Tocar ({minutes(total(queue.map((i) => i.clip)))})</button>
        </div>
        {!queue.length && <p className="muted small" style={{ margin: 0 }}>Nada pendente: os temas das suas revisões em áudio estão dominados. Fixe um trecho em Todas as revisões para ouvir de novo.</p>}
        {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
        <ol className="weekly-list">
          {queue.map((it) => (
            <li key={it.clip.key} className="playlist-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>{it.clip.title}</div>
                <span className="faint small">{[it.reasons.join(' · '), fmtWeek(reviewTitle.get(it.clip.reviewId)?.weekOf ?? it.clip.createdAt), fmtTime(it.clip.endMs - it.clip.startMs)].filter(Boolean).join(' · ')}</span>
              </div>
              <MarkButtons clip={it.clip} marks={marks} mark={mark} />
            </li>
          ))}
        </ol>
      </div>
      {!!hidden.length && (
        <details className="glass card">
          <summary className="muted small">Tirados da playlist ({hidden.length})</summary>
          <ul className="weekly-list" style={{ marginTop: 10 }}>
            {hidden.map((c) => <li key={c.key} className="playlist-row"><span style={{ flex: 1 }}>{c.title}</span><MarkButtons clip={c} marks={marks} mark={mark} /></li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function ByTheme({ data, onPlay }: { data: Library; onPlay: (name: string, items: QueueItem[]) => void }) {
  const bySubject = new Map<string, typeof data.themes>();
  for (const t of data.themes) bySubject.set(t.subject || 'Outros', [...(bySubject.get(t.subject || 'Outros') ?? []), t]);
  return (
    <div className="grid" style={{ gap: 12 }}>
      {[...bySubject].sort((a, b) => a[0].localeCompare(b[0])).map(([subject, themes]) => {
        const all = themes.flatMap((t) => themeClips(data.clips, t.id));
        const uniq = [...new Map(all.map((c) => [c.key, c])).values()];
        return (
          <div key={subject} className="glass card grid" style={{ gap: 10 }}>
            <div className="daily-review-head">
              <strong style={{ flex: 1 }}>{subject}</strong>
              <button className="btn ghost sm" disabled={!uniq.length} onClick={() => onPlay(subject, uniq.map((clip) => ({ clip, reasons: [] })))}><Play size={14} /> Tudo ({minutes(total(uniq))})</button>
            </div>
            <ul className="weekly-list">
              {themes.map((t) => {
                const cs = themeClips(data.clips, t.id);
                return (
                  <li key={t.id} className="playlist-row">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div>{t.title}</div>
                      <span className="faint small">{[`${cs.length} ${cs.length === 1 ? 'trecho' : 'trechos'} · ${minutes(total(cs))}`, t.overdue ? 'revisão vencida' : '', t.acc !== null && t.attempts >= 3 ? `acerto ${Math.round(t.acc * 100)}%` : ''].filter(Boolean).join(' · ')}</span>
                    </div>
                    <button className="btn ghost sm" disabled={!cs.length} onClick={() => onPlay(t.title, cs.map((clip) => ({ clip, reasons: [] })))}><Play size={14} /> Ouvir</button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function AllReviews({ data, marks, planId, onPlay }: { data: Library; marks: Map<string, Mark>; planId: string; onPlay: (name: string, items: QueueItem[]) => void }) {
  const { mark, error } = useMark(planId);
  return (
    <div className="grid" style={{ gap: 12 }}>
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      {data.reviews.map((r) => {
        const cs = data.clips.filter((c) => c.reviewId === r.id);
        // A revisão inteira, do começo ao fim (com abertura e encerramento).
        const whole: QueueItem = { clip: { key: `${r.id}:inteira`, reviewId: r.id, chapterId: 'inteira', title: r.title, startMs: 0, endMs: r.timeline.totalMs, themeIds: [], createdAt: r.createdAt }, reasons: [] };
        return (
          <details key={r.id} className="glass card">
            <summary className="daily-review-head" style={{ cursor: 'pointer' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>{r.title}</div>
                <span className="faint small">{fmtWeek(r.weekOf ?? r.createdAt)} · {minutes(r.durationMs ?? r.timeline.totalMs)} · {cs.length} trechos</span>
              </div>
              <button className="btn ghost sm" onClick={(e) => { e.preventDefault(); onPlay(r.title, [whole]); }}><Play size={14} /> Ouvir inteira</button>
            </summary>
            <ol className="weekly-list" style={{ marginTop: 10 }}>
              {cs.map((c, i) => (
                <li key={c.key} className="playlist-row">
                  <button className="link-btn" style={{ flex: 1, textAlign: 'left' }} onClick={() => onPlay(r.title, cs.slice(i).map((clip) => ({ clip, reasons: [] })))}>{c.title}</button>
                  <span className="faint small">{fmtTime(c.endMs - c.startMs)}</span>
                  {!!c.themeIds.length && <MarkButtons clip={c} marks={marks} mark={mark} />}
                </li>
              ))}
            </ol>
          </details>
        );
      })}
    </div>
  );
}

const fmtWeek = (d: string) => `semana de ${fmtDate(d.slice(0, 10))}`;
