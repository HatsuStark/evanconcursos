import { useQueryClient } from '@tanstack/react-query';
import { Flag, Pencil, ThumbsUp, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { addComment, deleteComment, editComment, reportComment, setNickname, useComments, voteComment, type Comment } from '../lib/comments.ts';

// Discussão da questão entre estudantes. Só texto: o React escapa o conteúdo (nunca renderizar como HTML).
export function CommentsPanel({ qid }: { qid: string }) {
  const qc = useQueryClient();
  const list = useComments(qid);
  const [nick, setNick] = useState('');
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function act(fn: () => Promise<unknown>, done?: () => void) {
    setBusy(true); setError('');
    try { await fn(); done?.(); await qc.invalidateQueries({ queryKey: ['comments', qid] }); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  if (list.isLoading) return <div className="spinner" />;
  if (list.isError) return <p className="error" style={{ margin: 0 }}>{(list.error as Error).message}</p>;
  const { nickname, comments } = list.data!;

  return (
    <section className="q-comments">
      {nickname ? (
        <form className="q-note" onSubmit={(e) => { e.preventDefault(); void act(() => addComment(qid, text), () => setText('')); }}>
          <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Ajude quem vem depois: o macete, o artigo, onde a banca costuma pegar…" />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn sm" disabled={busy || !text.trim()}>Publicar</button>
            <span className="faint small">Público para quem já respondeu esta questão, como <b>{nickname}</b>. Seja respeitoso e confira antes de afirmar.</span>
          </div>
        </form>
      ) : (
        <form className="q-note" onSubmit={(e) => { e.preventDefault(); void act(() => setNickname(nick)); }}>
          <span className="muted small">Escolha um apelido para comentar. Ele aparece nos seus comentários; seu e-mail nunca aparece.</span>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input className="input" style={{ flex: 1, minWidth: 160 }} value={nick} onChange={(e) => setNick(e.target.value)} maxLength={24} placeholder="Apelido" />
            <button className="btn sm" disabled={busy || nick.trim().length < 3}>Salvar apelido</button>
          </div>
        </form>
      )}
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      {!comments.length && <p className="muted" style={{ margin: 0 }}>Ninguém comentou ainda. Seja a primeira pessoa a ajudar.</p>}
      {comments.map((c) => editing?.id === c.id ? (
        <form key={c.id} className="q-note" onSubmit={(e) => { e.preventDefault(); void act(() => editComment(c.id, editing.body), () => setEditing(null)); }}>
          <textarea className="textarea" value={editing.body} onChange={(e) => setEditing({ id: c.id, body: e.target.value })} maxLength={2000} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn sm" disabled={busy || !editing.body.trim()}>Salvar</button>
            <button type="button" className="btn ghost sm" onClick={() => setEditing(null)}>Cancelar</button>
          </div>
        </form>
      ) : <CommentRow key={c.id} c={c} busy={busy} onEdit={() => setEditing({ id: c.id, body: c.body })} act={act} />)}
    </section>
  );
}

function CommentRow({ c, busy, onEdit, act }: { c: Comment; busy: boolean; onEdit: () => void; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  return (
    <article className="q-comment">
      <div className="q-comment-head">
        <b>{c.author}</b>
        <span className="faint small">{new Date(c.created_at).toLocaleDateString('pt-BR')}{c.edited_at ? ' · editado' : ''}</span>
        {c.hidden && <span className="badge orange">Escondido por denúncias</span>}
      </div>
      <p className="q-comment-body">{c.body}</p>
      <div className="q-comment-actions">
        <button className={'chip-btn' + (c.voted ? ' on' : '')} disabled={busy || c.mine || c.hidden} aria-pressed={c.voted} title={c.mine ? 'Seu comentário' : 'Marcar como útil'} onClick={() => void act(() => voteComment(c.id))}><ThumbsUp size={14} /> Útil{c.helpful ? ` · ${c.helpful}` : ''}</button>
        {c.mine ? (
          <>
            {!c.hidden && <button className="chip-btn" disabled={busy} onClick={onEdit}><Pencil size={14} /> Editar</button>}
            <button className="chip-btn" disabled={busy} onClick={() => confirm('Apagar este comentário?') && void act(() => deleteComment(c.id))}><Trash2 size={14} /> Apagar</button>
          </>
        ) : (
          <button className="chip-btn" disabled={busy || c.reported} onClick={() => confirm('Denunciar este comentário como ofensivo, spam ou inadequado?') && void act(() => reportComment(c.id))}><Flag size={14} /> {c.reported ? 'Denunciado' : 'Denunciar'}</button>
        )}
      </div>
    </article>
  );
}
