import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { SEED_DATASETS, seedFromContent } from './seed.js';
import { createTempDatabase } from './testing.js';

// Synthetic fixtures only: fake people, courses and projects.
const BOM = '﻿';
const csv = (rows) => BOM + rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n';

const ACTIVITY_CSV = csv([
  ['ID', 'Actividad (Skill)', 'Skill - Categoría', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'],
  ['1', 'Diseño de pruebas ficticio', 'Funcional', '✅', '✅', '✅', '✅', '✅', '✅', ''],
  ['2', 'Estrategia ficticia', 'Strategy', '', '', '⚪', 'Apoya', 'Participa', 'Lidera', 'Aprueba'],
]);
const CATALOG_CSV = csv([
  ['Formación', 'Familia', 'Categoría ISTQB', 'Tipos', 'Proveedor', 'Nivel', 'Horas Estimadas', 'Enlace', 'Vigencia/Meses'],
  ['Curso Ficticio A', 'QA', 'Foundation', 'Certificación oficial', 'Proveedor X', 'Fundamentos', '40', 'https://example.com/a', ''],
  ['Curso Ficticio B', 'IA', '', 'Formación', 'Interno', 'Avanzado', '12', '', '24'],
]);
const PLAN_CSV = csv([
  ['QA', 'Tarea', 'Curso/Certificado', 'Familia', 'Horas Estimadas', 'Horas dedicadas totales', 'Avance', 'Estado', 'Fecha Inicio', 'Fecha Fin Prevista', 'Fecha Fin Real', 'Evidencia', 'Próximo Paso', 'Fecha de caducidad'],
  ['Ana Prueba', 'Formación', 'curso ficticio a', 'QA', '40', '6,0', '15 %', 'No iniciada', '03/08/2026', '', '', '', '', ''],
  ['Ana Prueba', 'Formación', 'Curso fuera de catálogo', 'QA', '8', '10,5', '131 %', 'En curso', '13/08/2026', '30/09/2026', '', '', '', ''],
  ['Beto Ficticio', 'Formación', 'Curso Ficticio B', 'IA', '12', '3,5', '29 %', 'No iniciada', '', '', '', '', '', ''],
]);
const PROJECTS_CSV = csv([
  ['ID', 'Application Name', 'Version', 'Client', 'NAQ', 'Project Type', 'Delivery Target', 'Testing Scope', 'QA Service Type', 'Phase', 'Risk Level', 'Automation', 'Status', 'Project URL', 'QA Owner', 'QA Entry Date', 'Target Release Date', 'Comments', 'Created', 'Attachments'],
  ['7', 'App Ficticia', '1.0', 'Cliente Ficticio', 'High', 'Nuevo desarrollo', 'Integrated', '["Functional","API"]', 'Full QA', 'Win', 'High', 'In Progress', 'In Progress', 'https://example.com/p', 'Owner Ficticio', '03/08/2026', '30/09/2026', '', '01/08/2026 10:30', '0'],
]);

const FILES = {
  activityCatalog: ACTIVITY_CSV,
  trainingCatalog: CATALOG_CSV,
  trainingPlan: PLAN_CSV,
  projects: PROJECTS_CSV,
};

const silent = { log: () => {}, error: () => {} };
const count = (db, table) => Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);

describe('seedFromContent', () => {
  let temp;
  let seedDir;

  beforeEach(() => {
    temp = createTempDatabase('crm-seed-');
    seedDir = path.join(temp.dir, 'seed');
    mkdirSync(seedDir);
  });
  afterEach(() => temp.cleanup());

  const writeAll = (keys = Object.keys(FILES)) => {
    for (const dataset of SEED_DATASETS.filter((item) => keys.includes(item.key))) {
      writeFileSync(path.join(seedDir, dataset.file), FILES[dataset.key]);
    }
  };

  test('imports every dataset into empty tables and parses Spanish formats', () => {
    writeAll();
    const summary = seedFromContent(temp.db, seedDir, { logger: silent });
    assert.deepEqual(Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, value.status])), {
      activityCatalog: 'imported', trainingCatalog: 'imported', trainingPlan: 'imported', projects: 'imported',
    });
    assert.equal(count(temp.db, 'activity_catalog'), 2);
    assert.equal(count(temp.db, 'training_catalog'), 2);
    assert.equal(count(temp.db, 'training_plan'), 3);
    assert.equal(count(temp.db, 'projects'), 1);

    const activity = temp.db.prepare("SELECT * FROM activity_catalog WHERE id = '2'").get();
    assert.equal(activity.l3, '⚪');
    assert.equal(activity.l6, 'Lidera');
    assert.equal(activity.l1, '');

    const course = temp.db.prepare("SELECT * FROM training_catalog WHERE name = 'Curso Ficticio B'").get();
    assert.equal(course.estimated_hours, 12);
    assert.equal(course.validity_months, 24);

    const project = temp.db.prepare('SELECT * FROM projects').get();
    assert.deepEqual(JSON.parse(project.testing_scope), ['Functional', 'API']);
    assert.equal(project.qa_entry_date, '2026-08-03');
    assert.equal(project.created_date, '2026-08-01');
  });

  test('creates one talent per distinct plan person and links plan rows to talents and catalog courses', () => {
    writeAll();
    seedFromContent(temp.db, seedDir, { logger: silent });
    const talents = temp.db.prepare('SELECT id, name, category FROM talents ORDER BY name').all();
    assert.deepEqual(talents.map((row) => row.name), ['Ana Prueba', 'Beto Ficticio']);
    assert.equal(talents[0].category, '');

    const rows = temp.db.prepare(`SELECT training_plan.*, talents.name AS talent FROM training_plan
      JOIN talents ON talents.id = training_plan.talent_id ORDER BY talents.name, start_date DESC`).all();
    const linked = rows.find((row) => row.course_name === 'Curso Ficticio A');
    assert.equal(linked.talent, 'Ana Prueba');
    assert.ok(linked.course_id, 'case-insensitive course name match links the catalog course');
    assert.equal(linked.dedicated_hours, 6);
    assert.equal(linked.progress, 15);
    assert.equal(linked.start_date, '2026-08-03');
    const freeText = rows.find((row) => row.course_name === 'Curso fuera de catálogo');
    assert.equal(freeText.course_id, null);
    assert.equal(freeText.progress, 131);
    assert.equal(freeText.dedicated_hours, 10.5);
    assert.equal(freeText.planned_end_date, '2026-09-30');
  });

  test('is idempotent: a second run imports nothing', () => {
    writeAll();
    seedFromContent(temp.db, seedDir, { logger: silent });
    const second = seedFromContent(temp.db, seedDir, { logger: silent });
    for (const value of Object.values(second)) assert.equal(value.status, 'already_seeded');
    assert.equal(count(temp.db, 'training_plan'), 3);
    assert.equal(count(temp.db, 'talents'), 2);
  });

  test('never re-imports after the user empties a seeded table', () => {
    writeAll(['projects']);
    seedFromContent(temp.db, seedDir, { logger: silent });
    temp.db.exec('DELETE FROM projects');
    assert.equal(seedFromContent(temp.db, seedDir, { logger: silent }).projects.status, 'already_seeded');
    assert.equal(count(temp.db, 'projects'), 0);
  });

  test('skips a missing file without the marker and imports it once the file appears', () => {
    writeAll(['activityCatalog']);
    const first = seedFromContent(temp.db, seedDir, { logger: silent });
    assert.equal(first.activityCatalog.status, 'imported');
    assert.equal(first.projects.status, 'missing_file');
    assert.equal(temp.db.prepare("SELECT value FROM schema_meta WHERE key = 'seed_projects_v1'").get(), undefined);

    writeAll(['projects']);
    const second = seedFromContent(temp.db, seedDir, { logger: silent });
    assert.equal(second.projects.status, 'imported');
    assert.equal(second.activityCatalog.status, 'already_seeded');
    assert.equal(count(temp.db, 'projects'), 1);
  });

  test('a missing seed directory skips every dataset', () => {
    rmSync(seedDir, { recursive: true });
    const summary = seedFromContent(temp.db, seedDir, { logger: silent });
    for (const value of Object.values(summary)) assert.equal(value.status, 'missing_file');
  });

  test('does not import over rows the user already created', () => {
    writeAll(['trainingCatalog']);
    const now = new Date().toISOString();
    temp.db.prepare('INSERT INTO training_catalog (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('own', 'Curso propio', now, now);
    assert.equal(seedFromContent(temp.db, seedDir, { logger: silent }).trainingCatalog.status, 'table_not_empty');
    assert.equal(count(temp.db, 'training_catalog'), 1);
  });

  test('a malformed file is rolled back, logged and retried on the next boot', () => {
    writeFileSync(path.join(seedDir, SEED_DATASETS.find((item) => item.key === 'projects').file), 'ID,"Application Name\n1,broken');
    const errors = [];
    const summary = seedFromContent(temp.db, seedDir, { logger: { log: () => {}, error: (message) => errors.push(message) } });
    assert.equal(summary.projects.status, 'failed');
    assert.equal(errors.length, 1);
    assert.equal(temp.db.prepare("SELECT value FROM schema_meta WHERE key = 'seed_projects_v1'").get(), undefined);
  });
});
