import dns from 'dns';
import net from 'net';
import * as sql from 'mssql';
import { SqlServerSettings } from './config';
import {
  CATALOG_TABLES, CatalogInfo, CatalogReader, DescriptionRow, ImageMeta, LoginPermissions, ProductRow,
  SELECT_CATALOG_INFO, SELECT_DESCRIPTIONS, SELECT_IMAGE_INDEX, SELECT_PRODUCTS, assembleProducts
} from './reader';

/**
 * mssql/tedious pool settings shared by the API (reader) and the seed script (writer).
 * `tlsServerName` keeps the TLS server name (SNI) as the configured host name when `server`
 * is an address resolved by connectPool.
 */
export function toMssqlConfig(s: SqlServerSettings, appName: string, tlsServerName?: string): sql.config {
  return {
    server: s.server,
    port: s.port,
    database: s.database,
    user: s.user,
    password: s.password,
    connectionTimeout: 10000,
    requestTimeout: 30000,
    pool: { min: 0, max: 5, idleTimeoutMillis: 60000 },
    options: {
      encrypt: s.encrypt,
      trustServerCertificate: s.trustServerCertificate,
      appName,
      ...(tlsServerName && !net.isIP(tlsServerName) ? { serverName: tlsServerName } : {})
    }
  };
}

/**
 * Addresses to try for the configured server, IPv4 first. SQL Server on the web server
 * listens on 127.0.0.1 only, while "localhost" resolves to ::1 first on Windows, and a
 * refused connection to ::1 costs Windows about two seconds (SYN retries) on every new
 * pooled connection. Resolving once and preferring IPv4 avoids that; the other addresses
 * are still tried if IPv4 does not answer.
 */
export async function candidateHosts(server: string): Promise<string[]> {
  if (net.isIP(server)) {
    return [server];
  }
  try {
    const addresses = await dns.promises.lookup(server, { all: true });
    const ordered = addresses.filter(a => a.family === 4).concat(addresses.filter(a => a.family !== 4));
    const unique = Array.from(new Set(ordered.map(a => a.address)));
    return unique.length ? unique : [server];
  } catch {
    return [server]; // let tedious report the resolution error
  }
}

/** Connects a pool to the first address that accepts a TCP connection (see candidateHosts). */
export async function connectPool(s: SqlServerSettings, appName: string): Promise<sql.ConnectionPool> {
  const errors: Error[] = [];
  for (const host of await candidateHosts(s.server)) {
    const pool = new sql.ConnectionPool(toMssqlConfig({ ...s, server: host }, appName, s.server));
    try {
      return await pool.connect();
    } catch (err) {
      errors.push(err as Error);
      pool.close().catch(() => undefined);
      const code = (err as { code?: string }).code;
      if (code !== 'ESOCKET' && code !== 'ETIMEOUT') {
        throw err; // e.g. ELOGIN: a wrong password won't get better on another address
      }
    }
  }
  // Report the most useful failure (e.g. a TLS certificate error on 127.0.0.1) rather than
  // "connection refused" from an address SQL Server doesn't listen on.
  throw errors.find(e => !/Could not connect \(sequence\)|ECONNREFUSED/.test(String(e && e.message))) || errors[0];
}

const WRITE_PERMISSIONS = ['INSERT', 'UPDATE', 'DELETE', 'ALTER'];

/**
 * SQL Server permission probe: effective write permissions of the current login on the
 * database and on each catalog table (role memberships and DENYs included).
 */
export function permissionsQuery(): string {
  const cols: string[] = ['SUSER_SNAME() AS LoginName', 'USER_NAME() AS UserName'];
  for (const p of WRITE_PERMISSIONS.concat(['CREATE TABLE'])) {
    cols.push(`HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'${p}') AS [DATABASE:${p}]`);
  }
  for (const t of CATALOG_TABLES) {
    for (const p of WRITE_PERMISSIONS) {
      cols.push(`HAS_PERMS_BY_NAME(N'dbo.${t}', N'OBJECT', N'${p}') AS [${t}:${p}]`);
    }
  }
  cols.push(`IS_MEMBER(N'db_owner') AS [ROLE:db_owner]`);
  return 'SELECT ' + cols.join(', ');
}

/**
 * SQL Server implementation (production). Uses mssql over tedious (pure JavaScript, SQL
 * authentication), so no native module or ODBC driver is needed on the server. The login
 * should be the read-only ggs_reader (db/reader-login.sql); /api/health reports 503 if the
 * login turns out to have write permissions.
 */
export class SqlServerCatalogReader implements CatalogReader {
  readonly provider = 'sqlserver' as const;
  private pool: sql.ConnectionPool | null = null;
  private connecting: Promise<sql.ConnectionPool> | null = null;

  constructor(private readonly settings: SqlServerSettings) { }

  private async connection(): Promise<sql.ConnectionPool> {
    if (this.pool && this.pool.connected) {
      return this.pool;
    }
    if (!this.connecting) {
      const stale = this.pool;
      this.pool = null;
      if (stale) {
        stale.close().catch(() => undefined);
      }
      this.connecting = connectPool(this.settings, 'GigaGarageSale API (read-only)').then(
        p => {
          p.on('error', err => console.error('SQL Server pool error:', err.message));
          this.pool = p;
          this.connecting = null;
          return p;
        },
        err => { this.connecting = null; throw err; }
      );
    }
    return this.connecting;
  }

  private async query<T>(text: string): Promise<T[]> {
    const pool = await this.connection();
    const result = await pool.request().query<T>(text);
    return result.recordset as unknown as T[];
  }

  async readCatalogInfo(): Promise<CatalogInfo | null> {
    const [row] = await this.query<any>(SELECT_CATALOG_INFO);
    if (!row) {
      return null;
    }
    return {
      version: String(row.Version).trim(),
      productCount: row.ProductCount,
      imageCount: row.ImageCount,
      seededUtc: toIso(row.SeededUtc),
      seededBy: row.SeededBy
    };
  }

  async readProducts() {
    const rows = await this.query<ProductRow>(SELECT_PRODUCTS);
    const descriptions = await this.query<DescriptionRow>(SELECT_DESCRIPTIONS);
    return assembleProducts(rows, descriptions);
  }

  async readImageIndex(): Promise<ImageMeta[]> {
    return (await this.query<any>(SELECT_IMAGE_INDEX)).map(r => ({
      name: r.Name,
      contentType: r.ContentType,
      byteLength: r.ByteLength,
      sha256: String(r.Sha256).trim(),
      updatedUtc: toIso(r.UpdatedUtc)
    }));
  }

  async readImageContent(name: string): Promise<Buffer | null> {
    const pool = await this.connection();
    const result = await pool.request()
      .input('name', sql.NVarChar(260), name)
      .query<{ Content: Buffer }>('SELECT Content FROM Images WHERE Name = @name');
    const row = result.recordset[0];
    return row ? row.Content : null;
  }

  async readPermissions(): Promise<LoginPermissions> {
    const [row] = await this.query<any>(permissionsQuery());
    const writable: string[] = [];
    for (const key of Object.keys(row)) {
      if (key !== 'LoginName' && key !== 'UserName' && row[key] === 1) {
        writable.push(key);
      }
    }
    return { readOnly: writable.length === 0, login: `${row.LoginName} (user ${row.UserName})`, writable };
  }

  async close() {
    const pool = this.pool;
    this.pool = null;
    if (pool) {
      await pool.close();
    }
  }
}

function toIso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}
