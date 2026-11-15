import { pathToFileURL } from 'node:url';
import { createServer } from './app.js';
import { loadConfig } from './config.js';
import { closeDatabase, openDatabase } from './db.js';
import { ensureMonthlyReports } from './reports.js';
import { seedFromContent } from './seed.js';

/**
 * Boots the CRM backend: resolves config, opens/seeds the database and starts listening.
 * Throws on invalid configuration so the process exits instead of serving half-broken.
 */
export function start(env = process.env) {
  const config = loadConfig(env);
  const db = openDatabase(config.dbPath);
  // Imports the private seed CSVs into empty tables once; a failure must not keep the app down.
  try {
    seedFromContent(db, config.seedDir);
  } catch (error) {
    console.error(`[crm] seed import failed: ${error?.stack ?? error}`);
  }
  const server = createServer({ db, config });

  // The machine auto-stops (no cron), so missing monthly report snapshots are stored at boot and
  // again before the report endpoints answer. A failure here must not keep the app down.
  try {
    const generated = ensureMonthlyReports(db, new Date());
    if (generated.length > 0) console.log(`[crm] stored monthly report snapshots: ${generated.join(', ')}`);
  } catch (error) {
    console.error(`[crm] monthly report snapshots failed: ${error?.stack ?? error}`);
  }

  if (config.usesDevSessionSecret) {
    console.warn('[crm] SESSION_SECRET is not set; using the insecure development secret.');
  }
  if (!config.inviteCode) {
    console.warn('[crm] INVITE_CODE is not set; registration is closed.');
  }

  const shutdown = (signal) => {
    console.log(`[crm] received ${signal}, shutting down`);
    server.close(() => {
      closeDatabase(db);
      process.exit(0);
    });
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  server.on('error', (error) => {
    console.error(`[crm] server error: ${error?.stack ?? error}`);
    closeDatabase(db);
    process.exit(1);
  });

  server.listen(config.port, () => {
    const { port } = server.address();
    console.log(
      `[crm] listening on http://localhost:${port} (env=${config.nodeEnv}, db=${config.dbPath})`,
    );
  });

  return { server, db, config };
}

const isMainModule = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) start();
