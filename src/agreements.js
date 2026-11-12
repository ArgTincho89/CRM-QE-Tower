/** Global search over framework agreements: title, registry id, client, owner and notes. */
export function matchesAgreementQuery(agreement, query, clients = [], people = []) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return true;
  const clientName = clients.find((item) => item.id === agreement.clientId)?.name || '';
  const ownerName = people.find((item) => item.id === agreement.ownerId)?.name || '';
  return [agreement.id, agreement.title, agreement.registryId, clientName, ownerName, agreement.notes]
    .join(' ')
    .toLowerCase()
    .includes(needle);
}

export function filterAgreements(agreements, query, clients = [], people = []) {
  return (agreements || []).filter((item) => matchesAgreementQuery(item, query, clients, people));
}
