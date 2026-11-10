import { pathToFileURL } from 'node:url';
import { createServer } from './app.js';
import { loadConfig } from './config.js';
import { closeDatabase, openDatabase } from './db.js';

/**
 * Boots the CRM backend: resolves config, opens/seeds the database and starts listening.
 * Throws on invalid configuration so the process exits instead of serving half-broken.
 */
export function start(env = process.env) {
  const config = loadConfig(env);
  const db = openDatabase(config.dbPath);
  const server = createServer({ db, config });

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
