import path from 'node:path';

/**
 * Development-only fallback secret. It exists so `npm start` works out of the box
 * without a .env file, and it is never accepted when NODE_ENV=production.
 */
const DEV_SESSION_SECRET = 'insecure-development-session-secret';

function parsePort(rawPort) {
  if (rawPort === undefined || rawPort === null || String(rawPort).trim() === '') return 8080;
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be an integer between 0 and 65535, received "${rawPort}"`);
  }
  return port;
}

function resolveSessionSecret(env, isProduction) {
  const secret = typeof env.SESSION_SECRET === 'string' ? env.SESSION_SECRET.trim() : '';
  if (secret) return secret;
  if (isProduction) {
    throw new Error(
      'SESSION_SECRET is required when NODE_ENV=production. Set it to a long random value (for example: openssl rand -base64 48).',
    );
  }
  return DEV_SESSION_SECRET;
}

/**
 * Resolves runtime configuration from an environment object.
 * Throws on invalid input so the process fails fast at boot instead of misbehaving later.
 */
export function loadConfig(env = process.env) {
  const nodeEnv = (env.NODE_ENV ?? 'development').trim() || 'development';
  const isProduction = nodeEnv === 'production';
  const sessionSecret = resolveSessionSecret(env, isProduction);

  return {
    nodeEnv,
    isProduction,
    port: parsePort(env.PORT),
    dbPath: path.resolve((env.CRM_DB_PATH ?? '').trim() || './data/app.db'),
    distDir: path.resolve((env.DIST_DIR ?? '').trim() || './dist'),
    sessionSecret,
    // Empty string means "registration closed".
    inviteCode: (env.INVITE_CODE ?? '').trim(),
    // Behind a platform proxy (Fly.io, Render, ...) the client IP is the first
    // X-Forwarded-For entry. Only trust it when the deployment opts in.
    trustProxy: (env.TRUST_PROXY ?? '').trim() === 'true',
    usesDevSessionSecret: !(env.SESSION_SECRET ?? '').trim(),
  };
}
