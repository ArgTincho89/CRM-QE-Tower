# Pre-Proposal Decision Gate

Change: `qe-crm-commercial-evolution`
State: resolved

The Explore phase found product decisions that affect stage migration, category semantics, archived/inactive relationships, and deployed versioning. This file persisted those decisions before the grouped prompt and records the user's confirmed answers below.

## Confirmed Decisions

- `research_unselected` — Do not run `sdd-research`; use repository evidence and the supplied requirements.
- `opportunity_map_nearest` — Map prospecting→Prospección, analysis→Oportunidad identificada, waiting→Seguimiento / Negociación, proposal→Propuesta / Pliego, and won/lost→Resultado with the corresponding outcome.
- `initiative_map_nearest` — Map prospecting→Pendiente, analysis→En curso, waiting→En seguimiento, proposal→En seguimiento, won→Completada, and lost→Descartada.
- `initiative_other_fixed` — Keep `Otros` as a fixed Initiative category.
- `lob_block_deactivation` — Block LoB deactivation while Towers or Opportunities reference it; require reassignment or removal first.
- `version_semver_compatibility` — Use compatibility-based SemVer: patch for fixes/copy/visual adjustments, minor for backward-compatible capabilities, major for breaking workflow/API/data-contract changes. Use one app-version source and bump on every production deployment.
- `pipeline_qa_weight_opportunities_only` — Pipeline QE includes only Opportunity gross amount × QA participation / 100. Initiative amounts are excluded; close-probability weighted opportunity amount remains a separate metric.

## SDD Research Selection

Why it matters: selecting research makes the `sdd-research` phase mandatory before proposal generation.

- `research_selected` — Run source-backed research and wait for its completed evidence before proposal. Adds a research phase.
- `research_unselected` — Skip research and use the repository and supplied requirements only. Proposal may proceed after the remaining decisions are confirmed.

## Legacy Opportunity Stage Migration

Existing stored values include `prospecting`, `analysis`, `waiting`, `proposal`, `won`, and `lost`; the target Opportunity workflow is Prospección, Contacto iniciado, Oportunidad identificada, Propuesta / Pliego, Seguimiento / Negociación, and Resultado.

- `opportunity_map_nearest` — Map prospecting→Prospección, analysis→Oportunidad identificada, waiting→Seguimiento / Negociación, proposal→Propuesta / Pliego, and won/lost→Resultado with the corresponding outcome. All records enter the new active workflow, but analysis/waiting semantics are inferred.
- `opportunity_preserve_unmapped` — Map only prospecting, proposal, won, and lost to clear equivalents; preserve analysis/waiting as legacy stages for manual review instead of assigning an assumed business meaning. Preserves semantics but requires review before those records use the new Kanban.

## Legacy Initiative Stage Migration

Existing stored values use the shared old stages; the target Initiative workflow is Pendiente, En curso, En seguimiento, and Completada, with Pausada and Descartada as alternate statuses.

- `initiative_map_nearest` — Map prospecting→Pendiente, analysis→En curso, waiting→En seguimiento, proposal→En seguimiento, won→Completada, and lost→Descartada. All records immediately enter the new workflow, but proposal is interpreted as follow-up.
- `initiative_preserve_unmapped` — Map prospecting, analysis, waiting, won, and lost to the direct operational equivalents; preserve proposal and unknown values as legacy stage for manual review, rather than inventing a mapping. Preserves meaning but requires review for those records.

## Initiative `Other` Category

- `initiative_other_fixed` — Keep `Otros` as a fixed selectable category; additional categories require a deliberate future product change. Keeps reporting values consistent.
- `initiative_other_custom` — Allow custom category text alongside the initial categories. More flexible, but reporting must handle user-defined labels.

## Inactive LoB Relationships

Services explicitly retain historical associations when inactive. The user selected blocking LoB deactivation while Towers or Opportunities still reference the LoB.

- `lob_preserve_existing` — Keep existing links visible when a LoB becomes inactive; do not offer inactive LoBs for new links, but allow an existing link to be removed. Preserves history and prevents new inactive assignments.
- `lob_block_deactivation` — Prevent deactivating a LoB while any Tower or Opportunity references it; the user must reassign or remove links first. Keeps inactive LoBs unreferenced, but requires relationship cleanup before deactivation.

## Production Version Bump Policy

The sidebar version must come from one source and be bumped on every production deployment.

- `version_semver_compatibility` — Use compatibility-based SemVer: patch for fixes/copy/visual changes, minor for backward-compatible capabilities, major for breaking workflow/API/data-contract changes. Communicates compatibility clearly.
- `version_semver_impact` — Use impact-based SemVer: patch for small fixes, minor for medium feature sets, major for high-impact cross-entity/workflow changes even if compatible. Communicates change weight rather than strict compatibility.

## Response Domain

All original decision groups have a selected answer recorded above. Tokens are internal allowed answers; the user-facing prompt used localized labels and consequences.

## Subsequent Scope Additions

The user added these confirmed requirements after Explore/Proposal:

- Pipeline QE must use the QE share of an Opportunity's amount (`amount × QA participation / 100`). The Opportunity's gross estimated amount remains unchanged.
- Keep the separately requested close-probability weighted amount (`amount × closing probability / 100`) as a distinct Opportunity metric; do not multiply the Pipeline QE value by closing probability.
- Add multiple titled `Enlace Workspace` links to Initiatives and Opportunities; each can be added independently and opens in a new browser tab.
- Show a string `PEP` field when an Opportunity reaches the Ganada outcome; preserve it if the outcome later changes.

### Initiative contribution to Pipeline QE

Why it matters: Initiatives also have an amount and QA participation percent, and an earlier request said both entity types contribute to Pipeline QE. The new clarification explicitly describes the Opportunity calculation, so the Initiative rule needs confirmation.

- `pipeline_qa_weight_all_entities` — Sum the QA share (`amount × QA participation / 100`) for both Initiatives and Opportunities. Keeps Pipeline QE aligned with all QE activity.
- `pipeline_qa_weight_opportunities_only` — Sum only Opportunity QA shares; Initiative amounts do not contribute to Pipeline QE. Keeps the metric restricted to formal business opportunities.

This additional decision is resolved. All current product choices are confirmed; read native SDD status before continuing.
