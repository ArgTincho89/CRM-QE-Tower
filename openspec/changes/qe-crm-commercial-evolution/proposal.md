# Proposal: Evolve CRM Commercial Workflows

Extend React/API/SQLite CRM workflows while preserving data and UI patterns.

## Intent

Users get separate workflows, relationship controls, and archive/restore; history and estimates remain.

## Scope

### In Scope
- Separate workflows and map Opportunity stages: prospecting→Prospección, analysis→Oportunidad identificada, waiting→Seguimiento / Negociación, proposal→Propuesta / Pliego, won/lost→Resultado with outcome retained. Map Initiative stages: prospecting→Pendiente, analysis→En curso, waiting/proposal→En seguimiento, won→Completada, lost→Descartada. Keep stages distinct from status/outcome; no default probability.
- Add database-managed Services (initial catalog includes `Otros`), LoBs, multi-value relations, and optional links (0..1 per Opportunity; many per Initiative). Initiative `Otros` is fixed. Keep Tower and LoB links independent; never infer between them.
- Archive/restore without physical deletion; retain relations, actions/history, proposals/estimations, and historical fields. Inactive Services keep links but cannot be newly assigned. Block LoB deactivation while Towers or Opportunities reference it.
- Pipeline QE remains global across filters and sums only each Opportunity's estimated amount × QA participation / 100; Initiative amounts are excluded. Close-probability weighted Opportunity amount is a separate metric.
- Initiatives and Opportunities support multiple titled Workspace links that open in a safe new tab. Opportunities retain a string PEP value, shown for the Ganada outcome.
- Oportunidades has a standalone management list. Towers require a Responsible and support create/edit/delete only; deletion is blocked while referenced.
- Sidebar reads `package.json`; bump each production deployment: patch for fixes/copy/visuals, minor for compatible capabilities, major for breaking workflow/API/data contracts.

### Out of Scope
- Redesign, physical deletes, planning-time production access, unrelated workflows, lifecycle coupling, inferred LoBs, probability defaults, and custom categories.

## Capabilities

### New Capabilities
- `initiative-workflow`: Stages, links, archive.
- `opportunity-workflow`: Stages, outcomes, optional probability, archive.
- `commercial-master-data`: Service/LoB rules.
- `pipeline-summary`: Global estimates.
- `application-versioning`: Version/SemVer.

### Modified Capabilities
- None; no existing OpenSpec capability specs are present.

## Approach

Extend existing stack patterns; preserve IDs/data with repeatable migrations. No local snapshot: require authorized sanitized inventory; no production access during planning.

## Affected Areas

| Area | Impact |
|---|---|
| `server/db.js`, `server/app.js`, `src/api.js` | Data/API. |
| `src/App.jsx`, `src/data.js`, `src/kanban.js`, `src/pipelineFilters.js`, `src/styles.css` | UI. |
| Tests, `package.json`, `README.md` | Verification/version/docs. |

## Risks

| Risk | Mitigation |
|---|---|
| Legacy data loses meaning | Preserve IDs; validate sanitized mappings, links, history. |
| Review/E2E/snapshot gaps | Chain slices; use synthetic tests and manual checks. |

## Rollback Plan

Verify backup/restore and repeatable migrations. Before new writes, restore backup; after writes, pause and preserve data. Use forward-fix or controlled restore, never destructive down-migration. No production action authorized.

## Dependencies

- Authorized sanitized inventory and backup/restore.
- `auto-chain`, feature-branch chain, 800-line budget: forecast slices; PR #1 targets feature/tracker branch, later PRs target predecessors with clean diffs.

## Success Criteria

- [ ] Tests verify mappings and preserve IDs, outcomes, links, history, estimates, historical fields.
- [ ] Workflows stay distinct; archive retains links; absent probability is unweighted.
- [ ] Tests verify global totals and Service/LoB rules, with no inferred LoB.
- [ ] Sidebar matches `package.json`; deployment uses specified SemVer bump.
- [ ] Sanitized migration and backup restore pass before rollout.
