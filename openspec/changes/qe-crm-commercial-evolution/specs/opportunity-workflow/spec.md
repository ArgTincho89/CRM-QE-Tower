# Opportunity Workflow Specification

## Purpose

Define Opportunity fields, lifecycle, independent relationships, summaries, and archive behavior.

## Requirements

### Requirement: Opportunity fields, identifiers, and workflow

New records MUST receive IDs `OP-####`; existing IDs and references MUST remain unchanged. Name and estimated amount are required. The form/model MUST also support external number, client/account, stage, multiple Towers, Responsible, Bid Manager, QA participation (0–100), next-milestone text/date, multiple LoBs, multiple Services, optional close probability (0–100), estimated close date, origin, need/description, loss reason, optional Initiative, PEP string, and multiple titled Workspace links. The six Kanban columns, in order, MUST be `Prospección`, `Contacto iniciado`, `Oportunidad identificada`, `Propuesta/Pliego`, `Seguimiento/Negociación`, `Resultado`. Users MAY move among the first five stages forward or backward; entering `Resultado` requires outcome `Ganada`, `Perdida`, or `Descartada` and a close date. `Perdida` and `Descartada` require a reason. Reopening to any active stage clears the current outcome and close metadata; PEP is retained. Close probability has no default. Legacy mapping is prospecting→Prospección, analysis→Oportunidad identificada, waiting→Seguimiento/Negociación, proposal→Propuesta/Pliego, won/lost→Resultado with matching outcome.

#### Scenario: Validate fields and result transitions

- GIVEN a user creates or edits an Opportunity
- WHEN required fields, percentage bounds, stages, or results are saved
- THEN invalid or incomplete values are rejected and valid forward/backward stage changes are saved
- AND Result requires its outcome and close date, plus a reason for Perdida or Descartada

#### Scenario: Preserve identity and map legacy records

- GIVEN legacy Opportunities and their references
- WHEN new IDs are generated and legacy stages are mapped
- THEN new IDs match `OP-####`, old IDs/references remain intact, and legacy outcome mapping is preserved

### Requirement: Opportunity origin

An Opportunity's origin MUST be selected from exactly `Iniciativa interna`, `Cliente existente`, `Cross-selling`, `Prospección directa`, `Pliego/Licitación`, `Referencia interna`, `Solicitud directa del cliente`, `Otros`. Origin MUST be optional (no default for a manually created Opportunity) and editable at any time. An Opportunity created from an Initiative MUST default its origin to `Iniciativa interna` while remaining editable.

#### Scenario: Constrain and default origin values

- GIVEN an Opportunity form, either new or opened from an Initiative
- WHEN the user selects or changes origin
- THEN only the eight defined values are accepted
- AND a manual creation starts with no origin selected, while an Initiative-derived creation starts with `Iniciativa interna` selected and editable

### Requirement: Independent commercial relationships and management UX

An Opportunity MAY link to zero or one Initiative and MUST independently support multiple LoBs, Towers, and Services; selecting a Tower MUST NOT infer a LoB. Creating from an Initiative MUST propose its client and Services, allow edits, create a separate Opportunity, and show linked count/details/navigation without lifecycle coupling. Initiative detail MUST list each linked Opportunity with its stage, amount, responsible, estimated close date, outcome, and archived state. Service/LoB/Tower selectors MUST be searchable multi-selects with compact relationship displays. The UI MUST show at most six columns and provide an Oportunidades management list separate from the mixed CRM QE dashboard. Action/comment lists MUST be accessible and distinguish `Pendientes` from `Done`.

#### Scenario: Create and navigate an Initiative-linked Opportunity

- GIVEN an Initiative with a client and Services
- WHEN a user creates an Opportunity from it
- THEN client and Services are proposed and editable, the relationship is optional, and both records retain independent lifecycles
- AND linked counts, details, and navigation are available

#### Scenario: Share edits and action status

- GIVEN one authorized user edits an Opportunity and its action/comment list
- WHEN another authorized user reads the record
- THEN the saved values are shared and actions are accessibly grouped as `Pendientes` or `Done`

### Requirement: Probability, PEP, and Workspace links

When present, close-probability weighted amount MUST equal estimated amount × probability / 100; absent probability produces no weighted amount. PEP MUST be a string displayed for `Ganada` and retained if outcome changes. Workspace links MUST allow multiple title/URL pairs and open in a new tab without granting the target access to the originating tab.

#### Scenario: Keep optional calculations and PEP

- GIVEN an Opportunity with estimated amount, optional probability, and PEP
- WHEN probability or outcome changes
- THEN weighting exists only when probability exists and PEP remains saved but is visible only for Ganada

### Requirement: Archive and restore Opportunities

Archive MUST set an archived flag, date, and user; exclude the record from active Kanban/list views; and expose an archive view/filter. Restore MUST return it to its prior stage/outcome. Archive/restore MUST preserve IDs, all relationships, actions/history, proposals/estimations, and historical fields. Physical deletion and cascade archive are prohibited; archived/inactive states MUST be visually distinguishable.

#### Scenario: Restore without data loss or cascading

- GIVEN an Opportunity with related records and history
- WHEN it is archived and later restored
- THEN archive metadata is recorded, active views exclude it until restore, and its prior state and all data remain intact
- AND related entities remain unarchived and no physical deletion occurs
