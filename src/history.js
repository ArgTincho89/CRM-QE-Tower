import { stages } from './data.js';

const STAGE_LABELS = new Map(stages.map((stage) => [stage.id, stage.label]));

const FIELD_LABELS = {
  title: 'nombre',
  account: 'cliente',
  amount: 'importe estimado',
  stage: 'etapa',
  tower: 'tower',
  owner: 'responsable',
  due: 'próximo hito',
  tags: 'etiquetas',
  registry_id: 'ICRM',
  assigned_user_id: 'asignado a',
  next_action_date: 'fecha de próxima acción',
  next_milestone_date: 'fecha próximo hito',
  resolution_date: 'fecha resolución',
  // Retired field: older history entries may still name it.
  expected_close_date: 'fecha estimada de cierre',
  delivery_deadline: 'fecha límite de entrega',
  start_date: 'fecha inicio',
  end_date: 'fecha fin',
  ai_score: 'scoring calificación IA',
  reusable: 'reutilizable',
  reusable_reason: 'motivo de reutilización',
  market_scope: 'ámbito',
  contract_type: 'tipo de contrato',
  service_type: 'tipo de servicio',
  added_value: 'valor añadido',
  services_added_value: 'VA servicios',
  client_id: 'cliente',
  opportunity_type: 'tipo',
  number: 'número',
  towers: 'towers',
  lobs: 'LoB',
  services: 'servicios',
  links: 'enlaces',
  // Initiative fields (the initiative history shares these labels).
  category: 'categoría',
  priority: 'prioridad',
  description: 'descripción',
  operational_status: 'estado operativo',
  next_action: 'próxima acción',
};

function pad(value) {
  return String(value).padStart(2, '0');
}

export function formatEventTime(iso) {
  if (typeof iso !== 'string' || iso === '') return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function stageLabel(stageId) {
  if (typeof stageId !== 'string' || stageId === '') return '';
  return STAGE_LABELS.get(stageId) || stageId;
}

export function fieldLabel(field) {
  if (typeof field !== 'string' || field === '') return '';
  return FIELD_LABELS[field] || field;
}

export function describeEvent(event) {
  if (!event || typeof event !== 'object') return 'Acción registrada';
  const action = typeof event.action === 'string' ? event.action : '';
  const detail = event.detail && typeof event.detail === 'object' && !Array.isArray(event.detail)
    ? event.detail
    : {};

  if (action === 'created') return 'Creó la oportunidad';

  if (action === 'moved') {
    const from = stageLabel(detail.from);
    const to = stageLabel(detail.to);
    if (from && to) return `Movió la tarjeta de «${from}» a «${to}»`;
    if (to) return `Movió la tarjeta a «${to}»`;
    if (from) return `Movió la tarjeta desde «${from}»`;
    return 'Movió la tarjeta de etapa';
  }

  if (action === 'updated') {
    const fields = Array.isArray(detail.fields) ? detail.fields.map(fieldLabel).filter(Boolean) : [];
    if (fields.length > 0) return `Actualizó: ${fields.join(', ')}`;
    return 'Actualizó la tarjeta';
  }

  if (action === '') return 'Acción registrada';
  return `Acción registrada: ${action}`;
}
