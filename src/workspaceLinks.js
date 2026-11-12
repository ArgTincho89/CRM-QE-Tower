// Workspace links shared by opportunities, initiatives and framework agreements.
// Mirrors the API rules: title and http(s) URL required, at most 20 links.
export const MAX_WORKSPACE_LINKS = 20;
export const DEFAULT_WORKSPACE_LINK_TITLE = 'Enlace Workspace';

/** Editable form rows for the links a record already has. */
export function toWorkspaceLinkForm(links) {
  return (links || []).map((link) => ({ title: link.title || DEFAULT_WORKSPACE_LINK_TITLE, url: link.url || '' }));
}

/** Payload for the API: trimmed rows, dropping incomplete ones. */
export function normalizeWorkspaceLinks(links) {
  return (links || [])
    .map((link) => ({ title: String(link.title || '').trim(), url: String(link.url || '').trim() }))
    .filter((link) => link.title && link.url);
}

/** Returns the URL when it is safe to open (http or https only), otherwise ''. */
export function safeWorkspaceUrl(url) {
  const value = String(url || '').trim();
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? value : '';
  } catch {
    return '';
  }
}
