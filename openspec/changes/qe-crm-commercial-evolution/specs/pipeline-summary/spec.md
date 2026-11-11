# Pipeline Summary Specification

## Purpose

Specify Opportunity QE-share and close-probability summaries and their filter scope.

## Requirements

### Requirement: Global Pipeline QE and separate Opportunity weighted amount

Pipeline QE MUST be global across active filters and MUST equal the sum, for Opportunities only, of estimated amount × QA participation / 100. Initiative amounts MUST NOT contribute. The Opportunity close-probability weighted amount MUST remain a separate metric, calculated as estimated amount × close probability / 100 only when probability exists.

#### Scenario: Calculate Pipeline QE from Opportunity QA shares

- GIVEN Opportunities with amounts and QA participation, plus Initiatives with amounts
- WHEN the Pipeline QE KPI is calculated
- THEN it equals the sum of each Opportunity's amount × QA participation / 100
- AND no Initiative amount is included

#### Scenario: Keep KPI global across filters

- GIVEN a Pipeline QE total and one or more active filters that change the visible Opportunities
- WHEN a user changes or combines filters
- THEN the Pipeline QE total remains the same global total

#### Scenario: Keep close-probability weighting separate

- GIVEN an Opportunity amount and optional close probability
- WHEN the weighted Opportunity amount is displayed
- THEN it equals amount × probability / 100 only when probability is present
- AND it is not added to Pipeline QE

Context references to current surfaces only (not claims of target implementation): `src/App.jsx`, `src/pipelineFilters.js`.
