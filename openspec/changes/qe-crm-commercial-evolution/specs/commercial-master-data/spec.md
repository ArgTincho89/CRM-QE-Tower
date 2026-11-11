# Commercial Master Data Specification

## Purpose

Define Service, LoB, and Tower catalogs and their independent relationships.

## Requirements

### Requirement: Manage Service catalog

The shared Service catalog MUST start with exactly: `QA Automation`, `API Testing`, `Performance Testing`, `Accessibility Testing`, `AI Testing`, `QA Consulting`, `QA Managed Services`, `Quality Engineering Framework`, `Otros`. Service names MUST be unique. Each Service MUST have name, description, active/inactive status, and creation/update timestamps. Users MUST be able to create, read, edit, activate, deactivate, search, filter, and view details. Details MUST show related Opportunities and Initiatives. Service associations MUST be many-to-many with both entity types. Inactive Services MUST remain visible on historical links, MUST NOT be newly assigned, and deactivation MUST NOT remove links. Selectors MUST be searchable multi-selects with compact relationship displays; inactive/archived records MUST have a distinct visual state.

#### Scenario: Manage and find a Service

- GIVEN an authorized user and the initial catalog
- WHEN the user searches/filters, views details, or creates/edits/activates/deactivates a uniquely named Service
- THEN catalog values, timestamps, and related-record details are available and duplicate names are rejected

#### Scenario: Keep inactive Service history

- GIVEN a Service linked to historical Opportunities or Initiatives
- WHEN the Service is deactivated
- THEN links remain visible, no new assignment is allowed, and the Service can later be reactivated

### Requirement: Manage LoBs and Towers

A LoB MAY have many Towers; each Tower MUST have at most one optional LoB. LoB deactivation MUST be blocked while a Tower or Opportunity references it. Tower create/edit MUST require a Responsible; Tower operations are create, edit, and delete only, with no Active/Inactive control. Deleting a Tower referenced by an Opportunity or Initiative MUST be blocked. Tower details MUST show relationships.

#### Scenario: Enforce LoB and Tower lifecycle

- GIVEN a referenced LoB or Tower
- WHEN a user deactivates the LoB or deletes the Tower
- THEN the operation is blocked until references are removed or reassigned
- AND Tower creation/editing without Responsible is rejected

### Requirement: Preserve explicit independent relationships and migration safety

Opportunities MUST independently relate to multiple LoBs and multiple Towers; selecting a Tower MUST never infer a LoB. Services MUST be many-to-many with Opportunities and Initiatives. One Initiative MAY relate to zero or many Opportunities; each Opportunity MAY relate to zero or one Initiative. No inferred association is permitted. Migration MUST preserve IDs/references, actions/history, proposals/estimations, existing relationships, and legacy Initiative fields; it MUST NOT invent LoB links. Archive is non-cascading. Before rollout, an authorized sanitized pre-deploy inventory and backup-restore verification MUST pass in a non-production environment. No local production DB snapshot exists and production access is not authorized during planning.

#### Scenario: Save only selected independent relationships

- GIVEN a Tower with a LoB and an Opportunity selecting that Tower but no LoB
- WHEN the record is saved or migrated
- THEN no LoB is inferred; all selected many-to-many links remain independently addressable

#### Scenario: Verify safe repeatable migration

- GIVEN an authorized sanitized inventory and backup in non-production
- WHEN migration is repeated and backup restoration is verified before rollout
- THEN IDs, references, history, proposals/estimations, legacy fields, and explicit relationships remain intact without duplicates or invented links
