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
