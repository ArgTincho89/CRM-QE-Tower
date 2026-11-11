# Application Versioning Specification

## Purpose

Define the user-visible application version source and production release bump policy.

## Requirements

### Requirement: Single version source and compatibility-based SemVer

The application MUST use one version source, `package.json`, and the sidebar MUST display that version. Every production deployment MUST bump the version. The bump MUST follow compatibility-based SemVer: patch for fixes, copy, or visual changes; minor for compatible capabilities; major for breaking workflow, API, or data-contract changes.

#### Scenario: Display the package version

- GIVEN a version value in `package.json`
- WHEN the application sidebar is rendered
- THEN it displays that version without an independently maintained version value

#### Scenario: Bump for each production deployment

- GIVEN a production deployment containing a patch-level fix, compatible capability, or breaking contract change
- WHEN its version is selected
- THEN the version is respectively bumped by patch, minor, or major under SemVer
- AND every production deployment has a version bump

#### Scenario: Preserve compatibility classification

- GIVEN a change that breaks an existing workflow, API, or data contract
- WHEN its production version is classified
- THEN it receives a major bump rather than a minor or patch bump

Context references to current surfaces only (not claims of target implementation): `package.json`, `src/App.jsx`, `.github/workflows/fly-deploy.yml`.
