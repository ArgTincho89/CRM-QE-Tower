## Exploration: qe-crm-commercial-evolution

### Current State

- The application is a React 19/Vite frontend (`src/App.jsx`, `src/api.js`) backed by a Node.js HTTP API (`server/app.js`) and SQLite (`server/db.js`). The frontend keeps fetched records in React state and polls the API; no `localStorage` or `sessionStorage` use was found in `src/` or `server/`.
- Opportunities and Initiatives are separate SQLite entities, but the CRM QE board currently combines both into a shared Kanban, shares one six-value stage list (`src/data.js`), and shares several filters. Opportunities have a single `tower_id` plus legacy text fields; Initiatives have one client and Tower and retain owner, Bid Manager, amount, QA percentage, status, closure reason, and stage fields.
- Existing API/master-data patterns cover clients, Towers, people, agreements, record actions, and audit events. Services, LoBs, multi-value associations, an Initiative-to-Opportunity relation, opportunity origin/probability/close date, and logical archive fields/routes do not exist.
- Current record DELETE routes physically delete Initiatives/Opportunities and remove their actions/events. Tower deletion is blocked only while linked. This differs from the requested archive behavior and makes preserving history a migration and lifecycle concern.
- `applySchema()` uses idempotent `CREATE TABLE IF NOT EXISTS` and conditional `ALTER TABLE ADD COLUMN`; there is no separate versioned migration runner. It preserves existing IDs and current columns, but does not yet express safe table rebuilds or relation backfills.
- No `data/app.db` exists at the configured local path, and no production data was accessed. Existing migration tests use synthetic legacy schemas; record-level migration coverage against a sanitized database snapshot remains unavailable.
- `README.md` says persistence is browser-local and that there is no backend, while the current code and tests demonstrate authenticated API/SQLite persistence. `openspec/config.yaml` also mentions localStorage. These descriptions are stale relative to the implementation and should not be used as migration evidence.
- The current navigation includes Home, CRM QE, Clients, Opportunities, Initiatives, Proposals/Estimations, Agreements, Cross-Selling, Towers, People, Reports, and Settings. Proposals are currently an empty static array; agreements and other listed records use the API. The package version is `1.0.0`, the sidebar displays hard-coded `v1.0`, and `.github/workflows/fly-deploy.yml` deploys on pushes to `main` or manual dispatch.
- The repository has 95 passing `node:test` tests across API/database/auth and pure frontend helpers. There is no configured browser E2E framework or React component-test layer.

### Affected Areas

- `server/db.js` — SQLite schema and additive migrations for new entities, associations, archive metadata, and compatibility fields.
- `server/app.js` — current API validation, mapping, list/create/update/delete routes, master CRUD, and event history; likely the main API surface affected.
- `src/api.js` — frontend API client methods for masters, multi-entity relationships, archive/restore, and detail navigation.
- `src/App.jsx` — navigation, independent workflows, shared board, forms, cards/lists, detail views, filters, KPI summaries, and current version label are composed here.
- `src/data.js`, `src/kanban.js`, `src/pipelineFilters.js` — shared stage values, board behavior, and mixed-entity filters currently assume common stage data and singular Tower-oriented filtering.
- `src/styles.css` — current visual system and board/form/list presentation; requirements call for compact relationship display and bounded column counts without a redesign.
- `server/db.test.js`, `server/api.test.js`, `src/kanban.test.js`, `src/pipelineFilters.test.js` — migration, API persistence/validation, lifecycle, and filter regression coverage. Current Node built-in test runner is `npm test`.
- `package.json`, `src/App.jsx`, `.github/workflows/fly-deploy.yml`, and `README.md` — version visibility, deployment trigger/version policy, and stale persistence/deployment documentation need review in later phases.

### Approaches

1. **Incrementally extend the existing React/API/SQLite architecture** — add schema/API behavior and frontend sections while preserving existing IDs, records, event history, proposals/estimations, and current visual patterns.
   - Pros: aligns with the deployed stack and existing auth, API, database, and test conventions; can preserve current entities and apply explicit migration/backfill rules.
   - Cons: significant cross-cutting work in large `App.jsx`/`app.js` modules; legacy stage/text-field and relationship migration requires careful compatibility and transactional tests.
   - Effort: High.

2. **Replace the CRM with a new domain/backend implementation** — rebuild the same requested workflows on a different application structure.
   - Pros: could establish a cleaner domain model without legacy compatibility constraints.
   - Cons: conflicts with the stated preserve-architecture/no-redesign boundary, expands data migration risk, and has no evidence-based need in the current repository.
   - Effort: Very High.

### Recommendation

For future planning, investigate an incremental extension of the current stack; it best fits the preservation boundary and existing persistence/test patterns. This is an exploration recommendation only, not a product decision, migration design, or authorization to implement. Do not write a proposal until the unresolved product decisions below are confirmed and the research state is either completed or explicitly unselected.

### Risks

- **Unresolved product decisions — do not infer:** how each legacy opportunity/initiative stage maps to the new independent workflows, and how unmappable values should be retained/presented; whether `Otros` is only a selectable catalog/category record or also permits free-text values; what editing/removal is allowed when an existing relation points to an inactive master or archived record; the exact semver bump rules by change type/size; which CRM QE summaries are global versus filter-scoped; and whether existing navigation areas outside Initiatives, Opportunities, Services, LoB, and Towers remain visible or are consolidated.
- **Migration evidence is incomplete:** no local data database was present and production was intentionally not accessed. A later migration plan needs an authorized, sanitized snapshot or equivalent schema/data inventory to quantify legacy values, duplicate associations, and existing linked-versus-text-only records.
- **Data preservation is sensitive:** existing opportunity data includes both textual fallback fields and optional master IDs; current Tower links are singular. Migration must preserve both linked and legacy-only information without inventing LoB mappings, changing IDs, or dropping audit/action history, proposals/estimations, or retired Initiative fields that are required as historical data.
- **Lifecycle behavior changes:** current DELETE operations erase records/history, while the target requires independent logical archive/restore. Future API/database tests must verify retained stage/status, relations, audit/history, archived date/user, and restore behavior.
- **Relationship semantics need explicit validation:** opportunity LoBs and Towers are independent, and Initiative-derived opportunities remain independent records. Association migration must avoid duplicate links and must not infer a Tower's LoB as an opportunity LoB.
- **Test gap:** the API/database suite can validate persistence and migration invariants, but there is no browser E2E/component framework to validate searchable multi-selects, navigation, detail flows, and archive filters end-to-end.
- Opportunity probability is explicitly optional with no default and no weighted value when absent; this is treated as settled scope, not an open decision.

### Ready for Proposal

No. First confirm the unresolved product decisions and select/complete or explicitly leave unselected source-backed research. The next orchestration step should gather those decisions; run `sdd-research` only if selected, then resume with proposal generation after its readiness conditions are met.
