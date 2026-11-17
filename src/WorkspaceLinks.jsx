import { useState } from 'react';
import { DEFAULT_WORKSPACE_LINK_TITLE, MAX_WORKSPACE_LINKS, safeWorkspaceUrl } from './workspaceLinks.js';

/** Same "close" glyph as the app icon set. */
function CloseIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>;
}

/**
 * Shared Workspace links editor ("Enlaces") for opportunities, initiatives, framework agreements,
 * services and delivery projects.
 */
export function WorkspaceLinksEditor({ links, onChange, disabled, legend = 'Enlaces Workspace' }) {
  // Saved links with a safe URL render as clickable links; new or edited rows render as inputs.
  const [editingRows, setEditingRows] = useState(() => new Set());
  const updateLink = (index, field, value) => onChange(links.map((link, position) => (position === index ? { ...link, [field]: value } : link)));
  const addLink = () => {
    if (links.length >= MAX_WORKSPACE_LINKS) return;
    setEditingRows((current) => new Set(current).add(links.length));
    onChange([...links, { title: DEFAULT_WORKSPACE_LINK_TITLE, url: '' }]);
  };
  const editLink = (index) => setEditingRows((current) => new Set(current).add(index));
  const removeLink = (index) => {
    setEditingRows((current) => new Set([...current].filter((row) => row !== index).map((row) => (row > index ? row - 1 : row))));
    onChange(links.filter((_, position) => position !== index));
  };
  return <fieldset className="relation-field">
    <legend>{legend}</legend>
    <span className="field-hint">Cada enlace necesita título y URL. Hasta {MAX_WORKSPACE_LINKS} enlaces.</span>
    <div className="link-editor">
      {links.length === 0 && <span className="field-hint">Todavía no hay enlaces.</span>}
      {links.map((link, index) => {
        const href = safeWorkspaceUrl(link.url);
        const linkTitle = link.title || DEFAULT_WORKSPACE_LINK_TITLE;
        if (href && !editingRows.has(index)) {
          return <div className="link-view" key={index}>
            <span className="link-view-text"><strong>{linkTitle}</strong><a href={href} target="_blank" rel="noopener noreferrer" aria-label={`${linkTitle}: ${link.url} (se abre en una pestaña nueva)`}>{link.url}</a></span>
            <button type="button" className="inline-link" onClick={() => editLink(index)} disabled={disabled} aria-label={`Editar enlace ${linkTitle}`}>Editar</button>
            <button type="button" className="icon-button" aria-label={`Quitar enlace ${index + 1}`} onClick={() => removeLink(index)} disabled={disabled}><CloseIcon /></button>
          </div>;
        }
        return <div className="link-row" key={index}><input aria-label={`Título del enlace ${index + 1}`} value={link.title} onChange={(event) => updateLink(index, 'title', event.target.value)} placeholder={DEFAULT_WORKSPACE_LINK_TITLE} maxLength="120" disabled={disabled} /><input aria-label={`URL del enlace ${index + 1}`} value={link.url} onChange={(event) => updateLink(index, 'url', event.target.value)} placeholder="https://workspaces.example/..." maxLength="500" disabled={disabled} />{href ? <a className="link-open" href={href} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${link.title || DEFAULT_WORKSPACE_LINK_TITLE} en una pestaña nueva`}>Abrir</a> : <span className="link-open" aria-hidden="true" />}<button type="button" className="icon-button" aria-label={`Quitar enlace ${index + 1}`} onClick={() => removeLink(index)} disabled={disabled}><CloseIcon /></button></div>;
      })}
    </div>
    <button type="button" className="inline-link" onClick={addLink} disabled={disabled || links.length >= MAX_WORKSPACE_LINKS}>+ Añadir enlace</button>
  </fieldset>;
}

/**
 * Read-only link list for tables and detail dialogs: each safe URL becomes an anchor named by its
 * title, opened in a new tab. Table rows ignore clicks on anchors, so a link never opens the row detail.
 */
export function WorkspaceLinkList({ links }) {
  const safe = (links || []).map((link) => ({ ...link, href: safeWorkspaceUrl(link.url) })).filter((link) => link.href);
  if (safe.length === 0) return '—';
  return <span className="workspace-link-list">{safe.map((link) => <a key={link.id || link.href} href={link.href} target="_blank" rel="noopener noreferrer" title={link.url} aria-label={`${link.title} (se abre en una pestaña nueva)`}>{link.title}</a>)}</span>;
}
