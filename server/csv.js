/**
 * Minimal RFC 4180 CSV reader plus the Spanish number, percent and date formats used by the
 * seed spreadsheets exported from SharePoint/Excel. Pure functions: no file system access.
 */

/**
 * Parses CSV text into an array of rows (arrays of strings).
 * Supports quoted fields, escaped quotes (""), separators and line breaks inside quotes,
 * CRLF/LF/CR line endings, a leading UTF-8 BOM and empty fields. Blank lines are skipped.
 */
export function parseCsv(text, { separator = ',' } = {}) {
  const source = String(text ?? '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let fieldStarted = false;

  const endField = () => {
    row.push(field);
    field = '';
    fieldStarted = false;
  };
  const endRow = () => {
    endField();
    // A line with a single empty field is a blank line, not a record.
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
    } else if (char === separator) {
      endField();
    } else if (char === '\r') {
      if (source[index + 1] === '\n') index += 1;
      endRow();
    } else if (char === '\n') {
      endRow();
    } else {
      field += char;
      fieldStarted = true;
    }
  }
  if (inQuotes) throw new Error('CSV inválido: comillas sin cerrar.');
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/**
 * Parses CSV text with a header row into objects keyed by the trimmed header names.
 * Missing trailing cells become empty strings; every value is trimmed.
 */
export function parseCsvRecords(text, options) {
  const [header = [], ...rows] = parseCsv(text, options);
  const keys = header.map((name) => name.trim());
  return rows.map((cells) => Object.fromEntries(keys.map((key, index) => [key, (cells[index] ?? '').trim()])));
}

/**
 * Spanish decimal: "6,0" → 6, "1.234,5" → 1234.5, "12" → 12. Empty or invalid → null.
 * A dot without a comma is read as a thousands separator only in the "1.234" shape.
 */
export function parseSpanishNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value ?? '').replace(/[\s ]/g, '');
  if (raw === '') return null;
  let normalized;
  if (raw.includes(',')) normalized = raw.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(raw)) normalized = raw.replace(/\./g, '');
  else normalized = raw;
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

/** Spanish percent: "75 %" → 75, "12,5%" → 12.5, "0,75" → 0.75 (no rescaling). Invalid → null. */
export function parseSpanishPercent(value) {
  const raw = String(value ?? '').replace('%', '');
  return parseSpanishNumber(raw);
}

/**
 * Spanish date "dd/mm/yyyy" (optionally followed by a time) → ISO "yyyy-mm-dd".
 * Already-ISO dates pass through. Empty or impossible dates → ''.
 */
export function parseSpanishDate(value) {
  const raw = String(value ?? '').trim();
  if (raw === '') return '';
  let day;
  let month;
  let year;
  const spanish = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s.*)?$/.exec(raw);
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(raw);
  if (spanish) [, day, month, year] = spanish.map(Number);
  else if (iso) [, year, month, day] = iso.map(Number);
  else return '';
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
