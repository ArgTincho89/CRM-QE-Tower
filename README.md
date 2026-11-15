# QE Operations Centre

QE Operations Centre is a Spanish-language React application for the SEIDOR Quality Engineering team. It covers the CRM QE opportunity pipeline, initiatives and cross-selling, proposals and estimates, master agreements, the calendar, reports, master data (clients, LoB, towers, people in charge and services), and internal quality resources.

## Run locally

```sh
npm install
npm run dev
```

Create a production bundle with `npm run build`, or serve the bundle locally with `npm run preview`.

## Persistence and versioning

Data is stored server-side in SQLite behind an authenticated Node API (`server/`); the browser holds only the session cookie. Records are shared between authenticated users and survive restarts as long as the SQLite volume is preserved. Run `npm start` to serve the API and the built bundle. No corporate CRM integration is connected.

The application version has a single source, the `version` field in `package.json`. The server exposes it at `GET /api/version`, and the UI shows it on the login screen and in the sidebar footer. Every production deployment must bump it with compatibility-based SemVer: patch for fixes, copy, or visual changes; minor for compatible capabilities; major for breaking workflow, API, or data-contract changes. Current version: 1.1.0.

Opportunity value is an estimate for the QE pipeline. It must not be interpreted as contracted QE revenue or as the value of a deal influenced in the corporate CRM. Proposals and estimates remain separate from opportunities and link to them using an opportunity ID where available.

## Private resources

Internal documents live in `content/resources/` (HTML docs plus their `images/`) and are served by the Node server under `/resources/` only to signed-in users: anonymous requests get a 401 (a top-level navigation is redirected to the login screen). Responses are `Cache-Control: private`. They appear in the app under the "Recursos" menu group, embedded in an in-app page.

`public/` is copied verbatim into `dist/`, which is served without authentication, so it must only hold public assets (logo, background). Never put documents, CSV/XLSX data or archives there; a test fails if it does. Seed data for later imports lives in `content/seed/` (the image source archive `content/seed/*.zip` is git-ignored; its images are committed extracted under `content/resources/images/`).

## Container

The Dockerfile builds the Vite app and serves its static output with Nginx on port `8080`. The repository includes a Fly configuration and a GitHub Actions workflow that deploys on pushes to `main` (or manual dispatch), passing the repository secret `FLY_API_TOKEN` to the remote `flyctl deploy` step. `SESSION_SECRET` is staged as a Fly secret but is currently unused by this static React app; it provides no session or authentication behavior.
