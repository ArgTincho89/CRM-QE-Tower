import { useId } from 'react';

/**
 * Inline SVG charts of "Estrategia de formación" (the four charts of the Excel "01. Dashboard
 * Ejecutivo"): clustered columns and a pie. No chart library: thin columns with rounded tops on a
 * zero baseline, recessive grid, native tooltips (<title>), a legend for two or more series and a
 * "Ver datos" table so the values are never conveyed by color alone.
 */

/** Categorical slots in fixed order (validated reference palette, light surface). */
export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

const defaultFormat = (value) => Number(value || 0).toLocaleString('es-ES', { maximumFractionDigits: 2 });

/** Rounded "nice" axis maximum and tick step for values up to `max`. */
export function niceScale(max, tickCount = 4) {
  if (!(max > 0)) return { max: 1, step: 1 };
  const rough = max / tickCount;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough) || 10 * magnitude;
  return { max: Math.ceil(max / step) * step, step };
}

function ChartFrame({ title, subtitle, legend = [], table, children }) {
  const headingId = useId();
  return <figure className="strategy-chart" aria-labelledby={headingId}>
    <figcaption id={headingId}><strong>{title}</strong>{subtitle && <span>{subtitle}</span>}</figcaption>
    {legend.length > 1 && <ul className="strategy-legend" aria-label="Leyenda">{legend.map((item) => <li key={item.name}><span className="strategy-swatch" style={{ background: item.color }} aria-hidden="true" />{item.name}</li>)}</ul>}
    {children}
    <details className="strategy-chart-data"><summary>Ver datos</summary>{table}</details>
  </figure>;
}

function DataTableView({ headers, rows }) {
  return <table className="report-table strategy-data-table"><thead><tr>{headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => (cellIndex === 0 ? <th key={cellIndex} scope="row">{cell}</th> : <td key={cellIndex}>{cell}</td>))}</tr>)}</tbody></table>;
}

/** Column path with 4px rounded top corners anchored to the baseline. */
function columnPath(x, y, width, height) {
  if (height <= 0) return '';
  const radius = Math.min(4, width / 2, height);
  return `M${x},${y + height}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + width - radius}Q${x + width},${y} ${x + width},${y + radius}V${y + height}Z`;
}

/**
 * Clustered column chart. `categories`: x labels; `series`: [{ name, values, color? }] (values may
 * hold null = no value). One y axis from zero.
 */
export function ColumnChart({ title, subtitle, categories = [], series = [], format = defaultFormat, emptyMessage = 'Sin datos.' }) {
  const width = 520;
  const height = 260;
  const margin = { top: 22, right: 12, bottom: 54, left: 52 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const colored = series.map((item, index) => ({ ...item, color: item.color || SERIES_COLORS[index % SERIES_COLORS.length] }));
  const values = colored.flatMap((item) => item.values.map((value) => Number(value) || 0));
  const { max, step } = niceScale(Math.max(0, ...values));
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, index) => index * step);
  const band = categories.length > 0 ? plotWidth / categories.length : plotWidth;
  const gap = 2;
  const groupWidth = Math.min(band * 0.7, 46 * colored.length + gap * (colored.length - 1));
  const columnWidth = colored.length > 0 ? (groupWidth - gap * (colored.length - 1)) / colored.length : 0;
  const y = (value) => margin.top + plotHeight - (plotHeight * value) / max;
  const hasData = values.some((value) => value > 0);
  const table = <DataTableView headers={['Categoría', ...colored.map((item) => item.name)]}
    rows={categories.map((category, index) => [category, ...colored.map((item) => (item.values[index] === null || item.values[index] === undefined ? '—' : format(item.values[index])))])} />;
  const summary = categories.map((category, index) => `${category}: ${colored.map((item) => `${item.name} ${item.values[index] === null || item.values[index] === undefined ? 'sin dato' : format(item.values[index])}`).join(', ')}`).join('; ');
  return <ChartFrame title={title} subtitle={subtitle} legend={colored} table={table}>
    {!hasData ? <p className="strategy-chart-empty">{emptyMessage}</p>
      : <svg className="strategy-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}. ${summary}`}>
        {ticks.map((tick) => <g key={tick} className="strategy-grid">
          <line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />
          <text x={margin.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">{format(tick)}</text>
        </g>)}
        {categories.map((category, index) => {
          const groupX = margin.left + band * index + (band - groupWidth) / 2;
          return <g key={category}>
            {colored.map((item, seriesIndex) => {
              const raw = item.values[index];
              const value = Number(raw) || 0;
              const x = groupX + seriesIndex * (columnWidth + gap);
              return <g key={item.name} className="strategy-mark">
                <title>{`${category} · ${item.name}: ${raw === null || raw === undefined ? 'sin dato' : format(raw)}`}</title>
                {/* Transparent hit area taller than the mark, so short columns stay hoverable. */}
                <rect x={x} y={margin.top} width={columnWidth} height={plotHeight} fill="transparent" />
                <path d={columnPath(x, y(value), columnWidth, y(0) - y(value))} fill={item.color} />
                {raw !== null && raw !== undefined && <text className="strategy-value" x={x + columnWidth / 2} y={y(value) - 5} textAnchor="middle">{format(raw)}</text>}
              </g>;
            })}
            <text className="strategy-axis-label" x={margin.left + band * index + band / 2} y={height - margin.bottom + 18} textAnchor="middle">
              {wrapLabel(category).map((line, lineIndex) => <tspan key={lineIndex} x={margin.left + band * index + band / 2} dy={lineIndex === 0 ? 0 : 14}>{line}</tspan>)}
            </text>
          </g>;
        })}
        <line className="strategy-baseline" x1={margin.left} x2={width - margin.right} y1={y(0)} y2={y(0)} />
      </svg>}
  </ChartFrame>;
}

/** Up to three lines of about 18 characters, ellipsized after that. */
function wrapLabel(text, size = 18) {
  const lines = [];
  let current = '';
  for (const word of String(text).split(/\s+/)) {
    if (current && `${current} ${word}`.length > size) { lines.push(current); current = word; } else current = current ? `${current} ${word}` : word;
  }
  if (current) lines.push(current);
  return lines.length > 3 ? [...lines.slice(0, 2), `${lines[2]}…`] : lines;
}

/** Pie chart of `items` [{ label, value }] with a 2px surface gap between slices. */
export function PieChart({ title, subtitle, items = [], format = defaultFormat, emptyMessage = 'Sin datos.' }) {
  const total = items.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
  const colored = items.map((item, index) => ({ ...item, name: item.label, color: SERIES_COLORS[index % SERIES_COLORS.length] }));
  const percent = (value) => (total > 0 ? `${Math.round(((Number(value) || 0) / total) * 1000) / 10} %` : '0 %');
  const table = <DataTableView headers={['Categoría', 'Total', '%']} rows={colored.map((item) => [item.label, format(item.value), percent(item.value)])} />;
  const radius = 90;
  const center = 100;
  let angle = -Math.PI / 2;
  const slices = colored.filter((item) => Number(item.value) > 0).map((item) => {
    const sweep = (Number(item.value) / total) * Math.PI * 2;
    const start = angle;
    angle += sweep;
    const point = (theta) => `${center + radius * Math.cos(theta)},${center + radius * Math.sin(theta)}`;
    const d = sweep >= Math.PI * 2 - 1e-9
      ? `M${center - radius},${center}a${radius},${radius} 0 1,0 ${radius * 2},0a${radius},${radius} 0 1,0 ${-radius * 2},0`
      : `M${center},${center}L${point(start)}A${radius},${radius} 0 ${sweep > Math.PI ? 1 : 0},1 ${point(angle)}Z`;
    return { ...item, d };
  });
  const summary = colored.map((item) => `${item.label}: ${format(item.value)} (${percent(item.value)})`).join('; ');
  return <ChartFrame title={title} subtitle={subtitle} table={table}>
    {total <= 0 ? <p className="strategy-chart-empty">{emptyMessage}</p>
      : <div className="strategy-pie">
        <svg className="strategy-svg strategy-pie-svg" viewBox="0 0 200 200" role="img" aria-label={`${title}. ${summary}`}>
          {slices.map((slice) => <path key={slice.label} className="strategy-mark" d={slice.d} fill={slice.color}><title>{`${slice.label}: ${format(slice.value)} (${percent(slice.value)})`}</title></path>)}
        </svg>
        <ul className="strategy-pie-legend">{colored.map((item) => <li key={item.label}><span className="strategy-swatch" style={{ background: item.color }} aria-hidden="true" /><span>{item.label}</span><strong>{format(item.value)}</strong><small>{percent(item.value)}</small></li>)}</ul>
      </div>}
  </ChartFrame>;
}
