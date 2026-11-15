import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseCsv, parseCsvRecords, parseSpanishDate, parseSpanishNumber, parseSpanishPercent } from './csv.js';

describe('parseCsv', () => {
  test('reads quoted fields with separators, escaped quotes and line breaks inside quotes', () => {
    const text = 'a,b,c\r\n"one, two","say ""hi""","line 1\nline 2"\r\n';
    assert.deepEqual(parseCsv(text), [['a', 'b', 'c'], ['one, two', 'say "hi"', 'line 1\nline 2']]);
  });

  test('strips the BOM and accepts CRLF, LF and CR line endings', () => {
    assert.deepEqual(parseCsv('﻿x,y\r\n1,2\n3,4\r5,6'), [['x', 'y'], ['1', '2'], ['3', '4'], ['5', '6']]);
  });

  test('keeps empty fields and skips blank lines', () => {
    assert.deepEqual(parseCsv('a,,c\n\n,,\n"",x,\n'), [['a', '', 'c'], ['', '', ''], ['', 'x', '']]);
  });

  test('reads a last row without a trailing newline', () => {
    assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
  });

  test('rejects an unterminated quote', () => {
    assert.throws(() => parseCsv('a,"b\n1,2'), /comillas/);
  });

  test('parseCsvRecords keys rows by trimmed header and fills missing cells', () => {
    const records = parseCsvRecords('﻿"Nombre ","Horas"\r\n"Ana Prueba"," 6,0 "\r\n"Beto Ficticio"\r\n');
    assert.deepEqual(records, [{ Nombre: 'Ana Prueba', Horas: '6,0' }, { Nombre: 'Beto Ficticio', Horas: '' }]);
  });
});

describe('Spanish value parsers', () => {
  test('parseSpanishNumber reads decimal commas and thousands dots', () => {
    assert.equal(parseSpanishNumber('6,0'), 6);
    assert.equal(parseSpanishNumber('10,5'), 10.5);
    assert.equal(parseSpanishNumber('1.234,5'), 1234.5);
    assert.equal(parseSpanishNumber('1.234'), 1234);
    assert.equal(parseSpanishNumber('12.5'), 12.5);
    assert.equal(parseSpanishNumber('40'), 40);
    assert.equal(parseSpanishNumber(7), 7);
    assert.equal(parseSpanishNumber(''), null);
    assert.equal(parseSpanishNumber('abc'), null);
  });

  test('parseSpanishPercent drops the percent sign without rescaling', () => {
    assert.equal(parseSpanishPercent('75 %'), 75);
    assert.equal(parseSpanishPercent('438 %'), 438);
    assert.equal(parseSpanishPercent('12,5%'), 12.5);
    assert.equal(parseSpanishPercent(''), null);
  });

  test('parseSpanishDate converts dd/mm/yyyy (with optional time) to ISO', () => {
    assert.equal(parseSpanishDate('03/08/2026'), '2026-08-03');
    assert.equal(parseSpanishDate('3/8/2026'), '2026-08-03');
    assert.equal(parseSpanishDate('31/08/2026 14:05'), '2026-08-31');
    assert.equal(parseSpanishDate('2026-09-30'), '2026-09-30');
    assert.equal(parseSpanishDate('31/02/2026'), '');
    assert.equal(parseSpanishDate('mañana'), '');
    assert.equal(parseSpanishDate(''), '');
  });
});
