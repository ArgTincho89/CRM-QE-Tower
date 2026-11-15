import { useEffect, useId, useRef, useState } from 'react';
import { createComment, deleteComment, listComments, updateComment } from './api.js';
import { detectMentionQuery, filterMentionCandidates, insertMention, parseMentionSegments } from './mentions.js';
import { formatNotificationTime } from './notifications.js';

const COMMENT_MAX_LENGTH = 4000;

/** Comment body as React nodes: confirmed mentions become "@Nombre" chips; text is never parsed as HTML. */
function CommentBody({ body, mentions }) {
  return <p className="comment-body">{parseMentionSegments(body, mentions).map((segment, index) => (segment.type === 'mention'
    ? <span key={index} className="mention-chip">@{segment.name}</span>
    : <span key={index}>{segment.text}</span>))}</p>;
}

/**
 * Textarea with @-autocomplete. Typing "@" plus letters opens a listbox of matching users;
 * arrows move, Enter/Tab insert the `@[Nombre](id)` token, Escape closes only the suggestions.
 * Ctrl/Cmd+Enter submits.
 */
function MentionTextarea({ value, onChange, onSubmit, users, excludeId, label, placeholder, disabled, autoFocus = false }) {
  const textareaRef = useRef(null);
  const listboxId = useId();
  const [suggestion, setSuggestion] = useState(null);

  const refreshSuggestions = (text, caret) => {
    const match = detectMentionQuery(text, caret);
    if (!match) { setSuggestion(null); return; }
    const items = filterMentionCandidates(users, match.query, { excludeId });
    setSuggestion(items.length > 0 ? { ...match, caret, items, active: 0 } : null);
  };

  const choose = (user) => {
    if (!suggestion) return;
    const next = insertMention(value, { start: suggestion.start, caret: suggestion.caret }, user);
    onChange(next.text);
    setSuggestion(null);
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(next.caret, next.caret);
    });
  };

  const handleKeyDown = (event) => {
    if (suggestion) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setSuggestion((current) => ({ ...current, active: (current.active + step + current.items.length) % current.items.length }));
        return;
      }
      if ((event.key === 'Enter' && !event.ctrlKey && !event.metaKey) || event.key === 'Tab') {
        event.preventDefault();
        choose(suggestion.items[suggestion.active]);
        return;
      }
      if (event.key === 'Escape') {
        // Close only the suggestions: the dialog must stay open.
        event.preventDefault();
        event.stopPropagation();
        setSuggestion(null);
        return;
      }
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      onSubmit();
    }
  };

  const activeId = suggestion ? `${listboxId}-option-${suggestion.active}` : undefined;
  return <div className="mention-input">
    <textarea
      ref={textareaRef}
      value={value}
      rows={3}
      maxLength={COMMENT_MAX_LENGTH}
      aria-label={label}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={Boolean(suggestion)}
      aria-controls={suggestion ? listboxId : undefined}
      aria-activedescendant={activeId}
      onChange={(event) => { onChange(event.target.value); refreshSuggestions(event.target.value, event.target.selectionStart); }}
      onClick={(event) => refreshSuggestions(event.currentTarget.value, event.currentTarget.selectionStart)}
      onKeyDown={handleKeyDown}
      onBlur={() => setSuggestion(null)}
    />
    {suggestion && <ul className="mention-suggestions" id={listboxId} role="listbox" aria-label="Usuarios para mencionar">
      {suggestion.items.map((user, index) => <li
        key={user.id}
        id={`${listboxId}-option-${index}`}
        role="option"
        aria-selected={index === suggestion.active}
        className={index === suggestion.active ? 'active' : undefined}
        // mousedown keeps the textarea focused, so blur does not close the list before the click.
        onMouseDown={(event) => { event.preventDefault(); choose(user); }}
        onMouseEnter={() => setSuggestion((current) => (current ? { ...current, active: index } : current))}
      >@{user.name}</li>)}
    </ul>}
  </div>;
}

/**
 * "Comentarios" of an opportunity, initiative or framework agreement: a conversation with
 * @mentions, separate from the history and from the notes and actions panel.
 * `kind` is the API collection ('opportunities', 'initiatives' or 'agreements'); without `id`
 * (unsaved record) only a hint is shown.
 */
export default function RecordComments({ kind, id, users = [], currentUserId = '', focus = false }) {
  const sectionRef = useRef(null);
  const titleId = useId();
  const [state, setState] = useState({ status: 'loading', comments: [], error: '' });
  const [reloadToken, setReloadToken] = useState(0);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [now, setNow] = useState(() => new Date());
  const focused = useRef(false);

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    setState({ status: 'loading', comments: [], error: '' });
    listComments(kind, id)
      .then(({ comments }) => { if (!cancelled) setState({ status: 'ready', comments: Array.isArray(comments) ? comments : [], error: '' }); })
      .catch((err) => { if (!cancelled) setState({ status: 'error', comments: [], error: err?.message || 'No se pudieron cargar los comentarios.' }); });
    return () => { cancelled = true; };
  }, [kind, id, reloadToken]);

  // Relative times stay fresh while the dialog is open.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Opened from a mention notification: bring the section into view once it has loaded.
  useEffect(() => {
    if (!focus || focused.current || state.status === 'loading') return;
    focused.current = true;
    sectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [focus, state.status]);

  if (!id) {
    return <section className="record-comments" aria-labelledby={titleId}>
      <div className="record-comments-heading"><h3 id={titleId}>Comentarios</h3></div>
      <p className="empty-actions">Guarda el registro para comentar.</p>
    </section>;
  }

  const replaceComment = (comment) => setState((current) => ({ ...current, comments: current.comments.map((item) => (item.id === comment.id ? comment : item)) }));

  const submit = async () => {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    try {
      const { comment } = await createComment(kind, id, body);
      setState((current) => ({ ...current, comments: [...current.comments, comment] }));
      setDraft('');
      setError('');
      setNow(new Date());
    } catch (err) {
      setError(err?.message || 'No se pudo publicar el comentario.');
    } finally {
      setPosting(false);
    }
  };

  const saveEdit = async () => {
    if (!editing || editing.saving) return;
    const body = editing.body.trim();
    if (!body) { setError('El comentario no puede estar vacío.'); return; }
    setEditing((current) => ({ ...current, saving: true }));
    try {
      const { comment } = await updateComment(editing.id, body);
      replaceComment(comment);
      setEditing(null);
      setError('');
    } catch (err) {
      setEditing((current) => (current ? { ...current, saving: false } : current));
      setError(err?.message || 'No se pudo guardar el comentario.');
    }
  };

  const remove = async (comment) => {
    if (!window.confirm('¿Eliminar este comentario? Esta acción no se puede deshacer.')) return;
    try {
      await deleteComment(comment.id);
      setState((current) => ({ ...current, comments: current.comments.filter((item) => item.id !== comment.id) }));
      if (editing?.id === comment.id) setEditing(null);
      setError('');
    } catch (err) {
      setError(err?.message || 'No se pudo eliminar el comentario.');
    }
  };

  const { comments } = state;
  return <section className="record-comments" ref={sectionRef} aria-labelledby={titleId}>
    <div className="record-comments-heading">
      <h3 id={titleId}>Comentarios{state.status === 'ready' ? ` (${comments.length})` : ''}</h3>
      <span>Conversación del equipo. Escribe @ para mencionar.</span>
    </div>
    {state.status === 'loading' && <p className="empty-actions">Cargando comentarios…</p>}
    {state.status === 'error' && <div className="history-state"><p>{state.error}</p><button type="button" className="button button-secondary" onClick={() => setReloadToken((value) => value + 1)}>Reintentar</button></div>}
    {state.status === 'ready' && comments.length === 0 && <p className="empty-actions">Todavía no hay comentarios.</p>}
    {state.status === 'ready' && comments.length > 0 && <div className="history-scroll" tabIndex={0} role="region" aria-label="Lista de comentarios">
      <ul className="comment-list">{comments.map((comment) => {
        const own = Boolean(currentUserId) && comment.userId === currentUserId;
        const isEditing = editing?.id === comment.id;
        return <li key={comment.id} className="comment-item">
          <div className="comment-meta">
            <strong>{comment.userName}</strong>
            <time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString('es-ES')}>{formatNotificationTime(comment.createdAt, now)}</time>
            {comment.edited && <span className="comment-edited" title={comment.updatedAt ? `Editado: ${new Date(comment.updatedAt).toLocaleString('es-ES')}` : undefined}>(editado)</span>}
            {own && !isEditing && <span className="comment-actions">
              <button type="button" className="inline-link" onClick={() => { setEditing({ id: comment.id, body: comment.body, saving: false }); setError(''); }}>Editar</button>
              <button type="button" className="inline-link comment-delete" onClick={() => remove(comment)}>Eliminar</button>
            </span>}
          </div>
          {isEditing
            ? <div className="comment-edit">
              <MentionTextarea value={editing.body} onChange={(body) => setEditing((current) => ({ ...current, body }))} onSubmit={saveEdit} users={users} excludeId={currentUserId} label="Editar comentario" disabled={editing.saving} autoFocus />
              <div className="comment-edit-actions">
                <button type="button" className="button button-secondary" onClick={() => setEditing(null)} disabled={editing.saving}>Cancelar</button>
                <button type="button" className="button button-primary" onClick={saveEdit} disabled={editing.saving || !editing.body.trim()}>{editing.saving ? 'Guardando…' : 'Guardar'}</button>
              </div>
            </div>
            : <CommentBody body={comment.body} mentions={comment.mentions} />}
        </li>;
      })}</ul>
    </div>}
    <div className="comment-composer">
      <MentionTextarea value={draft} onChange={setDraft} onSubmit={submit} users={users} excludeId={currentUserId} label="Nuevo comentario" placeholder="Escribe un comentario… Usa @ para mencionar a un usuario." disabled={posting} />
      <div className="comment-composer-footer">
        <span className="field-hint">Ctrl+Enter para publicar.</span>
        <button type="button" className="button button-primary" onClick={submit} disabled={posting || !draft.trim()}>{posting ? 'Publicando…' : 'Comentar'}</button>
      </div>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
