import fs from 'fs';
import type BetterSqlite3 from 'better-sqlite3';
import {
  CatalogInfo, CatalogReader, DescriptionRow, ImageMeta, LoginPermissions, ProductRow,
  SELECT_CATALOG_INFO, SELECT_DESCRIPTIONS, SELECT_IMAGE_INDEX, SELECT_PRODUCTS, assembleProducts
} from './reader';

/** Loads better-sqlite3 (an optional dependency) with a helpful message when it's missing. */
export function loadBetterSqlite3(): typeof BetterSqlite3 {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('better-sqlite3');
  } catch (err) {
    throw new Error('SQLite mode needs the optional "better-sqlite3" package, which is not installed ' +
      `(${(err as Error).message}). Run npm install in api/ on a platform with prebuilt binaries.`);
  }
}

/**
 * SQLite implementation for local development and tests. The file is opened read-only
 * (SQLITE_OPEN_READONLY) with query_only on, so even a stray write statement fails with
 * SQLITE_READONLY instead of changing the file.
 */
export class SqliteCatalogReader implements CatalogReader {
  readonly provider = 'sqlite' as const;
  private readonly db: BetterSqlite3.Database;

  constructor(readonly file: string) {
    if (!fs.existsSync(file)) {
      throw new Error(`SQLite catalog ${file} does not exist. Create it with: npm run db:seed -- --provider sqlite`);
    }
    const Database = loadBetterSqlite3();
    this.db = new Database(file, { readonly: true, fileMustExist: true });
    this.db.pragma('query_only = ON');
  }

  async readCatalogInfo(): Promise<CatalogInfo | null> {
    const row = this.db.prepare(SELECT_CATALOG_INFO).get() as any;
    if (!row) {
      return null;
    }
    return {
      version: row.Version,
      productCount: row.ProductCount,
      imageCount: row.ImageCount,
      seededUtc: row.SeededUtc,
      seededBy: row.SeededBy
    };
  }

  async readProducts() {
    const rows = this.db.prepare(SELECT_PRODUCTS).all() as ProductRow[];
    const descriptions = this.db.prepare(SELECT_DESCRIPTIONS).all() as DescriptionRow[];
    return assembleProducts(rows, descriptions);
  }

  async readImageIndex(): Promise<ImageMeta[]> {
    return (this.db.prepare(SELECT_IMAGE_INDEX).all() as any[]).map(r => ({
      name: r.Name,
      contentType: r.ContentType,
      byteLength: r.ByteLength,
      sha256: r.Sha256,
      updatedUtc: r.UpdatedUtc
    }));
  }

  async readImageContent(name: string): Promise<Buffer | null> {
    const row = this.db.prepare('SELECT Content FROM Images WHERE Name = ?').get(name) as any;
    return row ? Buffer.from(row.Content) : null;
  }

  async readPermissions(): Promise<LoginPermissions> {
    // Touch the database so a missing/corrupt file shows up as "not connected".
    this.db.prepare('SELECT 1 FROM CatalogInfo LIMIT 1').get();
    const queryOnly = this.db.pragma('query_only', { simple: true }) === 1;
    const readOnly = this.db.readonly && queryOnly;
    return { readOnly, login: `sqlite:${this.file}`, writable: readOnly ? [] : ['file'] };
  }

  async close() {
    this.db.close();
  }
}
