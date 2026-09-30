import path from 'path';

/** Where the product catalog comes from. */
export type CatalogSourceKind = 'json' | 'sqlserver' | 'sqlite';

export interface SqlServerSettings {
  server: string;
  port: number;
  database: string;
  user: string;
  password: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
}

export interface CatalogConfig {
  source: CatalogSourceKind;
  /** JSON mode: the products file (default api/src/products.json, override with PRODUCTS_FILE). */
  productsFile: string;
  /** JSON mode: image folder served at /images (api/public/images). */
  imagesDir: string;
  sqlServer?: SqlServerSettings;
  sqlitePath?: string;
  /** Human-readable reason for the choice, logged at startup. */
  reason: string;
}

export class ConfigError extends Error { }

export const API_ROOT = path.resolve(__dirname, '..', '..');
export const DEFAULT_PRODUCTS_FILE = path.join(API_ROOT, 'src', 'products.json');
export const DEFAULT_IMAGES_DIR = path.join(API_ROOT, 'public', 'images');
export const DEFAULT_SQLITE_PATH = path.join(API_ROOT, 'data', 'catalog.sqlite');

type Env = Record<string, string | undefined>;

function value(env: Env, name: string): string | undefined {
  const v = env[name];
  return v === undefined || v.trim() === '' ? undefined : v.trim();
}

export function parseBool(name: string, raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') {
    return true;
  }
  if (v === 'false' || v === '0' || v === 'no') {
    return false;
  }
  throw new ConfigError(`${name} must be true or false (got "${raw}").`);
}

function parsePort(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const n = Number(raw);
  if (!/^\d+$/.test(raw.trim()) || n < 1 || n > 65535) {
    throw new ConfigError(`${name} must be a TCP port number (got "${raw}").`);
  }
  return n;
}

export function parseProvider(name: string, raw: string | undefined): 'sqlserver' | 'sqlite' {
  const v = (raw || 'sqlserver').trim().toLowerCase();
  if (v === 'sqlserver' || v === 'sqlite') {
    return v;
  }
  throw new ConfigError(`${name} must be "sqlserver" or "sqlite" (got "${raw}").`);
}

/**
 * Reads SQL Server connection settings from `<prefix>SERVER`, `<prefix>PORT`, ... Each
 * variable falls back to the same name under `fallbackPrefix` (the seed script uses
 * GGS_SEED_* falling back to GGS_DB_*).
 */
export function readSqlServerSettings(env: Env, prefix: string, fallbackPrefix?: string): SqlServerSettings {
  const get = (suffix: string) =>
    value(env, prefix + suffix) ?? (fallbackPrefix ? value(env, fallbackPrefix + suffix) : undefined);
  const nameOf = (suffix: string) =>
    value(env, prefix + suffix) !== undefined || !fallbackPrefix ? prefix + suffix : fallbackPrefix + suffix;
  const user = get('USER');
  const password = get('PASSWORD');
  const missing: string[] = [];
  if (!user) missing.push(prefix + 'USER');
  if (!password) missing.push(prefix + 'PASSWORD');
  if (missing.length) {
    throw new ConfigError(`SQL Server login not configured: set ${missing.join(' and ')}` +
      (fallbackPrefix ? ` (or ${missing.map(m => m.replace(prefix, fallbackPrefix)).join(' and ')})` : '') + '.');
  }
  return {
    server: get('SERVER') || 'localhost',
    port: parsePort(nameOf('PORT'), get('PORT'), 1433),
    database: get('NAME') || 'GigaGarageSale',
    user,
    password,
    encrypt: parseBool(nameOf('ENCRYPT'), get('ENCRYPT'), true),
    trustServerCertificate: parseBool(nameOf('TRUST_CERT'), get('TRUST_CERT'), false)
  };
}

/**
 * Decides where the running API reads the catalog from.
 *
 * - GGS_DB_ENABLED unset / false: JSON mode, exactly the pre-database behaviour
 *   (api/src/products.json + api/public/images). This keeps deploys working until the
 *   database has been seeded and the service is switched over on purpose.
 * - GGS_DB_ENABLED=true: database mode. GGS_DB_PROVIDER picks sqlserver (default) or sqlite.
 *   Invalid or incomplete settings throw ConfigError, so a half-configured service fails
 *   loudly at startup instead of silently serving the JSON file.
 */
export function readCatalogConfig(env: Env = process.env): CatalogConfig {
  const productsFile = value(env, 'PRODUCTS_FILE') ? path.resolve(value(env, 'PRODUCTS_FILE')) : DEFAULT_PRODUCTS_FILE;
  const imagesDir = DEFAULT_IMAGES_DIR;
  const enabled = parseBool('GGS_DB_ENABLED', env['GGS_DB_ENABLED'], false);
  if (!enabled) {
    return {
      source: 'json',
      productsFile,
      imagesDir,
      reason: 'GGS_DB_ENABLED is not "true"'
    };
  }
  const provider = parseProvider('GGS_DB_PROVIDER', env['GGS_DB_PROVIDER']);
  if (provider === 'sqlite') {
    return {
      source: 'sqlite',
      productsFile,
      imagesDir,
      sqlitePath: path.resolve(value(env, 'GGS_SQLITE_PATH') || DEFAULT_SQLITE_PATH),
      reason: 'GGS_DB_ENABLED=true, GGS_DB_PROVIDER=sqlite'
    };
  }
  return {
    source: 'sqlserver',
    productsFile,
    imagesDir,
    sqlServer: readSqlServerSettings(env, 'GGS_DB_'),
    reason: 'GGS_DB_ENABLED=true, GGS_DB_PROVIDER=sqlserver'
  };
}

/** Log-safe description of the configured source (never includes the password). */
export function describeCatalogConfig(config: CatalogConfig): string {
  switch (config.source) {
    case 'json':
      return `JSON file ${config.productsFile} + images from ${config.imagesDir} (${config.reason})`;
    case 'sqlite':
      return `SQLite ${config.sqlitePath} (read-only) (${config.reason})`;
    case 'sqlserver': {
      const s = config.sqlServer;
      return `SQL Server ${s.server}:${s.port}, database ${s.database}, login ${s.user}, ` +
        `encrypt=${s.encrypt}, trustServerCertificate=${s.trustServerCertificate} (${config.reason})`;
    }
  }
}
