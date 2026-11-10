import { useEffect, useState } from 'react';
import { listEvents } from './api.js';
import { describeEvent, formatEventTime } from './history.js';

const ACTION_COLORS = {
  created: 'history-dot created',
  moved: 'history-dot moved',
  updated: 'history-dot updated',
};

export default function CardHistory({ opportunityId, refreshKey }) {
  const [state, setState] = useState({ status: 'loading', events: [], error: null });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', events: [], error: null });

    listEvents(opportunityId, { limit: 50 })
      .then(({ events }) => {
        if (cancelled) return;
        setState({ status: 'ready', events: Array.isArray(events) ? events : [], error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ status: 'error', events: [], error: err?.message || 'No se pudo cargar el historial.' });
      });

    return () => {
      cancelled = true;
    };
  }, [opportunityId, refreshKey, reloadToken]);

  return (
    <section className="card-history" aria-labelledby="card-history-title">
      <div className="history-heading">
        <h3 id="card-history-title">Historial de la tarjeta</h3>
        <span>Acciones registradas por los usuarios.</span>
      </div>

      {state.status === 'loading' && (
        <div className="history-state">
          <p>Cargando historial…</p>
        </div>
      )}

      {state.status === 'error' && (
        <div className="history-state">
          <p>{state.error || 'No se pudo cargar el historial.'}</p>
          <button type="button" className="button button-secondary" onClick={() => setReloadToken((value) => value + 1)}>
            Reintentar
          </button>
        </div>
      )}

      {state.status === 'ready' && state.events.length === 0 && (
        <div className="history-state">
          <p>Todavía no hay acciones registradas.</p>
        </div>
      )}

      {state.status === 'ready' && state.events.length > 0 && (
        <ol className="history-timeline">
          {state.events.map((event) => (
            <li key={event.id} className="history-item">
              <span className={ACTION_COLORS[event.action] || 'history-dot'} aria-hidden="true" />
              <div className="history-body">
                <p>
                  <strong>{describeEvent(event)}</strong>
                </p>
                <p>
                  {event.userName} · <time dateTime={event.createdAt}>{formatEventTime(event.createdAt)}</time>
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
