# Initiative Workflow Specification

## Purpose

Define Initiative fields, operational lifecycle, relationships, and archive behavior.

## Requirements

### Requirement: Initiative fields, fixed categories, and operational workflow

New records MUST receive IDs `IN-####`; existing IDs/references MUST remain unchanged. The form/model MUST support name, category, optional client, multiple Services, priority `Alta`/`Media`/`Baja`, next action/date, description/objective, operational status, and multiple titled Workspace links. Categories are fixed: `Prospección externa`, `Desarrollo de negocio en cliente existente`, `Desarrollo de negocio interno (Seidor/Towers)`, `Cross-selling`, `Desarrollo de nuevos servicios QE`, `Alianzas/colaboraciones`, `Otros`. Permanent Kanban columns MUST be exactly `Pendiente`, `En curso`, `En seguimiento`, `Completada`; `Pausada` and `Descartada` are alternate statuses/filter views, never columns. `Otros` is fixed, not custom. The active Initiative form/model MUST exclude Tower, Responsible, Bid Manager, amount, commercial stage, and QA percentage; legacy values MUST be preserved as historical data. Legacy mapping is prospecting→Pendiente, analysis→En curso, waiting/proposal→En seguimiento, won→Completada, lost→Descartada status.

#### Scenario: Validate Initiative catalog and board

- GIVEN a user creates or edits an Initiative
- WHEN the user selects a category, priority, stage, or alternate status
- THEN only fixed values are accepted, the board has four permanent columns, and Pausada/Descartada remain status filters

#### Scenario: Preserve legacy Initiative identity and fields

- GIVEN a legacy Initiative with retired fields and references
- WHEN mapped to the new workflow
- THEN its ID/references and historical fields remain preserved, with no retired fields in the active form/model

### Requirement: Initiative services and Opportunity links

Initiatives MUST support many Services and zero or more related Opportunities; each Opportunity MAY link to at most one Initiative. Creating an Opportunity from an Initiative MUST prefill its client and propose its Services, allow edits, and create a separate entity. Linked counts/details/navigation MUST be available. No relationship may couple lifecycles. Service selectors MUST be searchable multi-selects with compact relationship displays. The UI MUST show at most four columns. Accessible action/comment lists MUST distinguish `Pendientes` and `Done`.

#### Scenario: Relate and create independent opportunities

- GIVEN an Initiative with Services and no linked Opportunities
- WHEN a user adds an Opportunity link or creates an Opportunity from it
- THEN multiple linked Opportunities are supported, inherited client/Services are editable, and each Opportunity links to no more than one Initiative
- AND changing either lifecycle does not change the other

#### Scenario: Share edits and action status

- GIVEN one authorized user updates an Initiative and its action/comment list
- WHEN another authorized user reads it
- THEN saved values are shared and actions are accessibly grouped as `Pendientes` or `Done`

### Requirement: Workspace links

An Initiative MUST support zero or more titled URL links that open in a new tab without granting the target access to the originating tab.

#### Scenario: Add and read multiple links

- GIVEN an Initiative and authorized CRM users
- WHEN one user adds multiple titled links and another reads the Initiative
- THEN all saved links are shared and navigable

### Requirement: Archive and restore Initiatives

Archive MUST set an archived flag, date, and user; exclude the record from active Kanban/list views; and expose an archive view/filter. Restore MUST return it to its prior stage/status. Archive/restore MUST preserve IDs, relationships, actions/history, proposals/estimations, and retired historical fields. Physical deletion and cascade archive are prohibited; archived/inactive states MUST be visually distinguishable.

#### Scenario: Restore without data loss or cascading

- GIVEN an Initiative with relationships, history, and retired historical values
- WHEN it is archived and later restored
- THEN archive metadata is recorded, its prior state and data are restored, and active views exclude it until restore
- AND related records remain unarchived and no physical deletion occurs
