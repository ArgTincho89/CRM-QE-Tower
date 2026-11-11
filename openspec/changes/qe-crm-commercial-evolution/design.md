# Design: Evolve CRM Commercial Workflows

## Overview

Extend the existing React 19 + Vite frontend, Node HTTP API (`server/app.js`), and SQLite schema (`server/db.js`) in place. No new runtime dependencies, no new services, and no visual redesign. All new state is persisted through the existing authenticated API; the frontend keeps its current polling model.

## Architecture Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Keep one SQLite database opened by `openDatabase`, extended through idempotent `applySchema` additions plus a new `runMigrations` step | Matches the existing additive migration style and the single Fly volume |
| D2 | Model relations as join tables, not JSON columns | Supports integrity, dedupe, and filtering in SQL |
| D3 | Keep legacy scalar columns (`tower_id`, `owner_id`, `amount`, `qa_percent`) in place | Preserves historical data and rollback safety; the active Initiative form simply stops writing them |
| D4 | Archive through `archived_at`/`archived_by_*` columns; no deletes for Initiatives/Opportunities | Meets the archive/restore requirement while keeping current DELETE routes for masters |
| D5 | Workspace links live in one polymorphic `workspace_links` table keyed by `(entity_type, entity_id)` | One implementation and one editor component for both entity types |
| D6 | Version is read from `package.json` and exposed at `GET /api/version`; the SPA never hardcodes a version string | One source of truth for login screen, sidebar footer, and deploys |

## Data Model

### New tables

```sql
services(id TEXT PK, name TEXT NOT NULL UNIQUE COLLATE NOCASE, description TEXT NOT NULL DEFAULT '',
         status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)

lobs(id TEXT PK, name TEXT NOT NULL UNIQUE COLLATE NOCASE, description TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)

opportunity_towers(opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
                   tower_id TEXT NOT NULL REFERENCES towers(id), PRIMARY KEY(opportunity_id, tower_id))
opportunity_lobs(...same shape with lob_id...)
opportunity_services(...same shape with service_id...)
initiative_services(...same shape with initiative_id...)

workspace_links(id TEXT PK, entity_type TEXT NOT NULL CHECK(entity_type IN ('opportunity','initiative')),
                entity_id TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL,
                created_at TEXT NOT NULL, created_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
                created_by_name TEXT NOT NULL DEFAULT '')
```

### Column additions

`towers`: `lob_id TEXT REFERENCES lobs(id)` (nullable, one LoB per Tower).

`opportunities`: `origin TEXT NOT NULL DEFAULT ''`, `probability INTEGER`, `expected_close_date TEXT NOT NULL DEFAULT ''`, `next_milestone TEXT NOT NULL DEFAULT ''`, `next_milestone_date TEXT NOT NULL DEFAULT ''`, `need TEXT NOT NULL DEFAULT ''`, `initiative_id TEXT REFERENCES initiatives(id)`, `outcome TEXT NOT NULL DEFAULT ''`, `pep TEXT NOT NULL DEFAULT ''`, `archived_at TEXT`, `archived_by_id TEXT REFERENCES users(id)`, `archived_by_name TEXT NOT NULL DEFAULT ''`.

`initiatives`: `priority TEXT NOT NULL DEFAULT 'media'`, `next_action TEXT NOT NULL DEFAULT ''`, `next_action_date TEXT NOT NULL DEFAULT ''`, `description TEXT NOT NULL DEFAULT ''`, `operational_status TEXT NOT NULL DEFAULT 'active'`, `archived_at TEXT`, `archived_by_id TEXT REFERENCES users(id)`, `archived_by_name TEXT NOT NULL DEFAULT ''`.

Indexes: `opportunity_towers(tower_id)`, `opportunity_lobs(lob_id)`, `opportunity_services(service_id)`, `initiative_services(service_id)`, `workspace_links(entity_type, entity_id)`, `opportunities(initiative_id)`, `opportunities(archived_at)`, `initiatives(archived_at)`.

### Canonical stage keys

- Opportunity `stage`: `prospecting`, `contacted`, `identified`, `proposal`, `negotiation`, `result`. `outcome`: `won`, `lost`, `discarded` (only in `result`).
- Initiative `stage`: `pending`, `in_progress`, `following`, `completed`. `operational_status`: `active`, `paused`, `discarded`.

## Migration

Runs once inside `withTransaction` after the additive DDL, guarded by a `schema_meta(key, value)` marker row so a restart is a no-op.

1. **Services seed** — `INSERT OR IGNORE` the nine catalog names.
2. **Legacy stage mapping** — Single `UPDATE ... CASE` per table using the confirmed nearest mapping:
   - Opportunities: `prospecting→prospecting`, `analysis→identified`, `waiting→negotiation`, `proposal→proposal`, `won→result/outcome=won`, `lost→result/outcome=lost`. Unknown values keep their raw value and are counted in the migration summary.
   - Initiatives: `prospecting→pending`, `analysis→in_progress`, `waiting→following`, `proposal→following`, `won→completed`, `lost→pending/operational_status=discarded`. Unknown values keep their raw value.
3. **Tower backfill** — Copy each non-null `opportunities.tower_id` into `opportunity_towers` with `INSERT OR IGNORE`; keep the scalar column untouched.
4. **No LoB backfill** — `lobs` starts empty; no association is inferred from Towers.
5. **Idempotence** — All steps use `INSERT OR IGNORE`/deterministic `UPDATE ... WHERE` guards, so a repeated run creates no duplicates.
6. **Backup** — Before deploy, copy `/data/app.db` (plus `-wal`/`-shm`) on the Fly volume and run the new tests against a sanitized copy.

## API Surface

| Method + path | Behavior |
|---|---|
| `GET /api/version` | Public. Returns `{ version }` read from `package.json` at server start |
| `GET/POST /api/services`, `PATCH/DELETE /api/services/:id` | Service CRUD; unique name; `status` toggle; delete blocked when referenced |
| `GET/POST /api/lobs`, `PATCH/DELETE /api/lobs/:id` | LoB CRUD; deactivation blocked while a Tower or Opportunity references it; delete blocked likewise |
| `GET /api/towers`, `POST /api/towers`, `PATCH /api/towers/:id` | Existing master routes gain `lob_id`; Responsible still required; delete still blocked when referenced |
| `GET /api/opportunities?archived=1` | Active by default; `archived=1` returns archived only; each record carries `towers[]`, `lobs[]`, `services[]`, `links[]`, `initiative`, `weightedAmount`, `qaWeightedAmount` |
| `POST /api/opportunities` | Accepts scalar fields plus `tower_ids`, `lob_ids`, `service_ids`, `links`, `initiative_id`; writes them in one transaction |
| `PATCH /api/opportunities/:id` | Same payload; replaces join rows and links transactionally |
| `POST /api/opportunities/:id/archive` / `restore` | Sets or clears archive metadata; returns the mapped record |
| `GET /api/initiatives?archived=1` | Same list/archive contract; includes `services[]`, `links[]`, `opportunities[]` summary |
| `POST/PATCH /api/initiatives` | Adds priority, next action/date, description, operational status, services, links |
| `POST /api/initiatives/:id/archive` / `restore` | Archive/restore with preserved stage and relations |

Validation: percentages 0–100; `outcome` required with `stage=result`; `outcome != won` requires `closure_reason` for `lost`/`discarded`; URL must be `http(s)`; service must be active to be newly linked; archived records reject updates unless restored.

## Frontend

- `src/data.js`: six opportunity stages with labels and colors, four initiative stages, origin list, priority list, initiative categories, operational status list, outcome list.
- `src/App.jsx`: navigation gains `Servicios` and `LoB`; Opportunities and Initiatives each get their own board page, filter bar, archive toggle, and detail dialog. A reusable `MultiSelect` (search + chips) serves Services/LoB/Towers. A `WorkspaceLinks` block adds and renders title/URL pairs. Opportunity detail shows PEP only for `Ganada`.
- `src/api.js`: helpers for the new endpoints and payload arrays.
- `src/pipelineFilters.js`: entity-scoped filters; Pipeline QE reads `amount × qa_percent / 100` over active opportunities only.
- `src/App.jsx` login screen and sidebar footer render the version fetched from `/api/version`.
- `src/styles.css`: compact chips, archive/inactive badges, link list, using existing tokens.

## Versioning

`package.json` `version` is the only source. This change ships `1.0.0 → 1.1.0` (minor: compatible capabilities). Deploy script reads it; the sidebar and login screen display it; every production deploy bumps it.

## PR Slicing (feature-branch chain)

Tracker branch `feat/qe-crm-evolution`; PR #1 targets the tracker, each later PR targets its predecessor; only the tracker merges to `main`.

1. Schema, migrations, Services/LoB catalog API and tests.
2. Opportunities backend: relations, new fields, origin, links, archive/restore, stage migration tests.
3. Initiatives backend: fields, services, links, archive, create-from-initiative.
4. Frontend master data: navigation, Services/LoB pages, Tower LoB, API client.
5. Frontend opportunities: form, six-column board, detail, links, PEP.
6. Frontend initiatives: form, four-column board, links, linked opportunities.
7. Pipeline QE KPI, filters, version surfaces, docs.

## Risks

- Production data shape is unverified; migration must be exercised on a sanitized copy with a backup restore test.
- `App.jsx` and `app.js` are large; slicing keeps each PR reviewable but risks merge drift inside the chain.
- No browser E2E layer, so multi-select and archive flows rely on API tests plus manual checks.
- Blocking LoB deactivation may need UI messaging so users understand the required cleanup.
