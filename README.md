# CRM QE Tower

A Spanish-language React dashboard prototype for Quality Engineering commercial activity. It covers the opportunity pipeline, account development, cross-selling, proposals and estimates, master agreements, service towers, and basic analytics.

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

## Container

The Dockerfile builds the Vite app and serves its static output with Nginx on port `8080`. The repository includes a Fly configuration and a GitHub Actions workflow that deploys on pushes to `main` (or manual dispatch), passing the repository secret `FLY_API_TOKEN` to the remote `flyctl deploy` step. `SESSION_SECRET` is staged as a Fly secret but is currently unused by this static React app; it provides no session or authentication behavior.
