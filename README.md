# CRM QE Tower

A Spanish-language React dashboard prototype for Quality Engineering commercial activity. It covers the opportunity pipeline, account development, cross-selling, proposals and estimates, master agreements, service towers, and basic analytics.

## Run locally

```sh
npm install
npm run dev
```

Create a production bundle with `npm run build`, or serve the bundle locally with `npm run preview`.

## Demo data and persistence

The first browser visit seeds the opportunity board with example records. Opportunity edits and new records are stored in that browser's `localStorage`; clearing site data restores the examples. This is demo-only persistence: data is not backed up, shared between users, synchronized across devices, or durable like a database. Other modules currently show illustrative read-only data. No backend, corporate CRM integration, authentication, or authorization is connected.

Opportunity value is an estimate for the QE pipeline. It must not be interpreted as contracted QE revenue or as the value of a deal influenced in the corporate CRM. Proposals and estimates remain separate from opportunities and link to them using an opportunity ID where available.

## Container

The Dockerfile builds the Vite app and serves its static output with Nginx on port `8080`. The repository includes a Fly configuration and a GitHub Actions workflow that deploys on pushes to `main` (or manual dispatch), passing the repository secret `FLY_API_TOKEN` to the remote `flyctl deploy` step. `SESSION_SECRET` is staged as a Fly secret but is currently unused by this static React app; it provides no session or authentication behavior.
