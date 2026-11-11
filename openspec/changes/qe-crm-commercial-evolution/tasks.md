# Tasks: Evolve CRM Commercial Workflows

Delivery: feature-branch chain on `feat/qe-crm-evolution`; PR #1 targets the tracker, each later PR targets its predecessor, only the tracker merges to `main`. Review budget 800 changed lines per PR.

## Review Workload Forecast

- Estimated changed lines: ~3,900–4,600 across seven PRs.
- Chained PRs recommended: Yes
- 400-line budget risk: High (any single slice exceeds it without chaining)
- Decision needed before apply: No — delivery strategy `auto-chain` + `feature-branch-chain` already selected.
- Largest slice: backend opportunities (~700–800 lines with tests).

## 1. Schema, migrations, Services and LoB catalogs

- [x] 1.1 Add `services`, `lobs`, `schema_meta`, relation join tables, and `workspace_links` to `SCHEMA_STATEMENTS`.
- [x] 1.2 Add `towers.lob_id` and all new opportunity/initiative columns through conditional `ALTER TABLE`.
- [x] 1.3 Implement `runMigrations(db)` inside `withTransaction`, guarded by `schema_meta`, seeding the nine services and mapping legacy stages.
- [x] 1.4 Backfill `opportunity_towers` from `tower_id` with `INSERT OR IGNORE`; assert no LoB rows are created.
- [x] 1.5 Add `GET/POST /api/services`, `PATCH/DELETE /api/services/:id` with unique-name, active/inactive, and referenced-delete guard.
- [x] 1.6 Add `GET/POST /api/lobs`, `PATCH/DELETE /api/lobs/:id` with referenced-deactivation block.
- [x] 1.7 Extend Tower master mapping/validation with `lob_id`.
- [x] 1.8 Tests in `server/db.test.js` and `server/api.test.js`: idempotent migration, seed set, stage mapping, tower backfill, uniqueness, deactivation block, duplicate-free repeats.

## 2. Opportunities backend

- [x] 2.1 Extend `mapOpportunity` with relations, origin, probability, dates, need, PEP, outcome, initiative, links, and computed amounts.
- [x] 2.2 Accept `tower_ids`, `lob_ids`, `service_ids`, `links`, `initiative_id` on create/update with transactional replace and dedupe.
- [x] 2.3 Validate percentages, result outcomes, loss reason, workspace URLs, and active-service assignment.
- [x] 2.4 Add archive/restore routes and `archived=1` listing; keep active board filtered.
- [x] 2.5 Enforce initiative linkage cardinality (0..1 per opportunity, many per initiative) and inheritance defaults.
- [x] 2.6 Tests: relation persistence, no LoB inference, weighted amounts, archive/restore preservation, cardinality, validation.

## 3. Initiatives backend

- [x] 3.1 Extend `mapInitiative` and payload handling with priority, next action/date, description, operational status, services, links, archive, and linked opportunity summaries.
- [x] 3.2 Stop reading/writing retired fields in the active path while keeping columns and historical values intact.
- [x] 3.3 Add create-from-initiative support (inherited client/services, editable, independent record).
- [x] 3.4 Add archive/restore routes and `archived=1` listing.
- [x] 3.5 Tests: four-stage workflow, alternate statuses, categories, retired-field preservation, linkage, archive/restore.

## 4. Frontend master data

- [x] 4.1 Add Services and LoB navigation entries and pages with list/search/create/edit/deactivate and related-record details.
- [x] 4.2 Add `lob_id` to the Tower form/list/filter with a LoB selector.
- [x] 4.3 Extend `src/api.js` with service, LoB, archive, and version helpers.
- [ ] 4.4 Reusable searchable `MultiSelect` component; wire into Tower/form contexts.
- [x] 4.5 Styles for chips, badges, and inactive states using existing tokens.

## 5. Frontend opportunities

- [x] 5.1 Six-column board (`Prospección`, `Contacto iniciado`, `Oportunidad identificada`, `Propuesta/Pliego`, `Seguimiento/Negociación`, `Resultado`) with forward/backward movement.
- [x] 5.2 Form fields: multi LoB/Tower/Service, origin, probability, close date, milestone date, need, loss reason, PEP.
- [x] 5.3 Result outcome handling, PEP visibility on `Ganada`, and Workspace links editor/render.
- [x] 5.4 Detail view with relations, initiative origin link, archive/restore, archive filter.
- [ ] 5.5 Tests for board moves, outcome rules, weighted display, and archive filtering.

## 6. Frontend initiatives

- [x] 6.1 Four-column board with paused/discarded status filters, not columns.
- [x] 6.2 Form: categories, priority, next action/date, description, services, links; retired fields hidden.
- [x] 6.3 "Crear oportunidad" flow with inherited client/services, editable, origin default `Iniciativa interna`.
- [x] 6.4 "Oportunidades generadas" list with count, stage, amount, owner, close date, outcome, archived state.
- [x] 6.5 Archive/restore and archive filter.
- [x] 6.6 Tests for stage mapping, status filters, inheritance, and archive.

## 7. Pipeline QE, filters, version surfaces

- [x] 7.1 Pipeline QE = Σ `amount × qa_percent / 100` over active opportunities only; global across filters.
- [x] 7.2 Opportunity probability-weighted amount shown separately, only when probability exists.
- [x] 7.3 Entity-scoped filters for Services/LoB/Towers and archive state.
- [x] 7.4 `GET /api/version` from `package.json`; render on login and sidebar footer.
- [x] 7.5 Bump `package.json` to `1.1.0` and update README persistence/version notes.
- [x] 7.6 Tests for KPI scope, weighted amounts, version endpoint, and filter behavior.

## Verification Gate

- [ ] `npm test` passes with all new coverage.
- [ ] `npm run build` passes.
- [ ] Migration dry run on a sanitized copy plus backup/restore check.
- [ ] No production mutation before deploy approval.
