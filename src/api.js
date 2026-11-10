const API_BASE = '/api';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const init = {
    method,
    credentials: 'same-origin',
    headers: {},
  };

  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError(0, 'network_error', 'No hay conexión con el servidor.');
  }

  const text = await response.text();
  let payload = null;
  if (text !== '') {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const code = payload?.error?.code || `http_${response.status}`;
    const message = payload?.error?.message || 'Ha ocurrido un error inesperado.';
    throw new ApiError(response.status, code, message);
  }

  return payload;
}

export const getMe = () => request('/me');
export const login = (body) => request('/auth/login', { method: 'POST', body });
export const register = (body) => request('/auth/register', { method: 'POST', body });
export const logout = () => request('/auth/logout', { method: 'POST' });
export const listOpportunities = () => request('/opportunities');
export const createOpportunity = (body) => request('/opportunities', { method: 'POST', body });
export const updateOpportunity = (id, body) =>
  request(`/opportunities/${encodeURIComponent(id)}`, { method: 'PATCH', body });
export const listEvents = (id, { limit } = {}) => {
  const query = limit ? `?limit=${encodeURIComponent(limit)}` : '';
  return request(`/opportunities/${encodeURIComponent(id)}/events${query}`);
};
export const listInitiativeEvents = (id) => request(`/initiatives/${encodeURIComponent(id)}/events`);
export const listClients = () => request('/clients');
export const createClient = (body) => request('/clients', { method: 'POST', body });
export const updateClient = (id, body) => request(`/clients/${encodeURIComponent(id)}`, { method: 'PATCH', body });
export const deactivateClient = (id) => request(`/clients/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const listTowers = () => request('/towers');
export const createTower = (body) => request('/towers', { method: 'POST', body });
export const updateTower = (id, body) => request(`/towers/${encodeURIComponent(id)}`, { method: 'PATCH', body });
export const deactivateTower = (id) => request(`/towers/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const listPeople = () => request('/people');
export const createPerson = (body) => request('/people', { method: 'POST', body });
export const updatePerson = (id, body) => request(`/people/${encodeURIComponent(id)}`, { method: 'PATCH', body });
export const deactivatePerson = (id) => request(`/people/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const listInitiatives = () => request('/initiatives');
export const createInitiative = (body) => request('/initiatives', { method: 'POST', body });
export const updateInitiative = (id, body) => request(`/initiatives/${encodeURIComponent(id)}`, { method: 'PATCH', body });
export const listAgreements = () => request('/agreements');
export const createAgreement = (body) => request('/agreements', { method: 'POST', body });
export const listActions = (type, id) => request(`/${type}/${encodeURIComponent(id)}/actions`);
export const createAction = (type, id, body) => request(`/${type}/${encodeURIComponent(id)}/actions`, { method: 'POST', body });
export const updateAction = (id, body) => request(`/actions/${encodeURIComponent(id)}`, { method: 'PATCH', body });
