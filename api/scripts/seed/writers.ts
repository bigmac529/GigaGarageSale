// Schema + seed writers. ADMIN TOOLING ONLY: used by scripts/db-seed.ts with a login that
// may write (ggs_app). The running API never imports anything from api/scripts/.
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as sql from 'mssql';
import type BetterSqlite3 from 'better-sqlite3';
import { SqlServerSettings } from '../../src/catalog/config';
import { loadBetterSqlite3 } from '../../src/catalog/sqlite-reader';
import { connectPool } from '../../src/catalog/sqlserver-reader';
import { SeedData, SeedImage } from './seed-data';

export const DB_DIR = path.resolve(__dirname, '..', '..', '..', 'db');

export interface SeedResult {
  changed: boolean;
  previousVersion: string | null;
  version: string;
  products: number;
  descriptions: number;
  imagesInserted: number;
  imagesUpdated: number;
  imagesDeleted: number;
  imagesUnchanged: number;
}

export interface CatalogWriter {
  readonly description: string;
  /** Creates missing tables (idempotent, never drops anything). */
  applySchema(): Promise<void>;
  readVersion(): Promise<string | null>;
  /** Replaces the whole catalog in one transaction. Images are diffed by SHA-256. */
  replaceCatalog(data: SeedData, force: boolean): Promise<SeedResult>;
  counts(): Promise<{ products: number; descriptions: number; images: number }>;
  close(): Promise<void>;
}

function descriptionRows(data: SeedData) {
  const rows: { productId: number; ordinal: number; text: string }[] = [];
  for (const p of data.products) {
    p.descriptions.forEach((text, i) => rows.push({ productId: p.id, ordinal: i + 1, text }));
  }
  return rows;
}

interface ImageDiff { insert: SeedImage[]; update: SeedImage[]; remove: string[]; unchanged: number }

function diffImages(existing: Map<string, string>, images: SeedImage[]): ImageDiff {
  const diff: ImageDiff = { insert: [], update: [], remove: [], unchanged: 0 };
  const seen = new Set<string>();
  for (const img of images) {
    seen.add(img.name);
    const sha = existing.get(img.name);
    if (sha === undefined) diff.insert.push(img);
    else if (sha !== img.sha256) diff.update.push(img);
    else diff.unchanged++;
  }
  existing.forEach((_sha, name) => { if (!seen.has(name)) diff.remove.push(name); });
  return diff;
}

// ---------------------------------------------------------------------------------- SQLite

export class SqliteCatalogWriter implements CatalogWriter {
  private readonly db: BetterSqlite3.Database;
  readonly description: string;

  constructor(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const Database = loadBetterSqlite3();
    this.db = new Database(file);
    this.db.pragma('journal_mode = DELETE');
    this.db.pragma('foreign_keys = ON');
    this.description = `SQLite ${file}`;
  }

  async applySchema() {
    this.db.exec(fs.readFileSync(path.join(DB_DIR, 'schema.sqlite.sql'), 'utf8'));
  }

  async readVersion() {
    const row = this.db.prepare('SELECT Version FROM CatalogInfo WHERE Id = 1').get() as any;
    return row ? row.Version : null;
  }

  async replaceCatalog(data: SeedData, force: boolean): Promise<SeedResult> {
    const previousVersion = await this.readVersion();
    const existing = new Map<string, string>(
      (this.db.prepare('SELECT Name, Sha256 FROM Images').all() as any[]).map(r => [r.Name, r.Sha256] as [string, string]));
    const diff = diffImages(existing, data.images);
    const descriptions = descriptionRows(data);
    const result: SeedResult = {
      changed: false, previousVersion, version: data.version, products: data.products.length,
      descriptions: descriptions.length, imagesInserted: diff.insert.length, imagesUpdated: diff.update.length,
      imagesDeleted: diff.remove.length, imagesUnchanged: diff.unchanged
    };
    if (previousVersion === data.version && !force) {
      return result;
    }
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const insertProduct = this.db.prepare(`INSERT INTO Products (Id, Name, Title, Brand, Price, ImageUrl, Category, Rating, Merchant, Available)
      VALUES (@id, @name, @title, @brand, @price, @imageUrl, @category, @rating, @merchant, @available)`);
    const insertDescription = this.db.prepare('INSERT INTO ProductDescriptions (ProductId, Ordinal, Text) VALUES (?, ?, ?)');
    const upsertImage = this.db.prepare(`INSERT INTO Images (Name, ContentType, ByteLength, Sha256, Content, UpdatedUtc)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (Name) DO UPDATE SET ContentType = excluded.ContentType, ByteLength = excluded.ByteLength,
        Sha256 = excluded.Sha256, Content = excluded.Content, UpdatedUtc = excluded.UpdatedUtc`);
    const deleteImage = this.db.prepare('DELETE FROM Images WHERE Name = ?');
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM ProductDescriptions').run();
      this.db.prepare('DELETE FROM Products').run();
      for (const p of data.products) {
        const { descriptions: _d, ...row } = p;
        insertProduct.run(row);
      }
      for (const d of descriptions) insertDescription.run(d.productId, d.ordinal, d.text);
      for (const img of diff.insert.concat(diff.update)) {
        upsertImage.run(img.name, img.contentType, img.byteLength, img.sha256, img.content, now);
      }
      for (const name of diff.remove) deleteImage.run(name);
      this.db.prepare(`INSERT INTO CatalogInfo (Id, Version, ProductCount, ImageCount, SeededUtc, SeededBy)
        VALUES (1, ?, ?, ?, ?, ?)
        ON CONFLICT (Id) DO UPDATE SET Version = excluded.Version, ProductCount = excluded.ProductCount,
          ImageCount = excluded.ImageCount, SeededUtc = excluded.SeededUtc, SeededBy = excluded.SeededBy`)
        .run(data.version, data.products.length, data.images.length, now, os.userInfo().username);
    })();
    result.changed = true;
    return result;
  }

  async counts() {
    const one = (q: string) => (this.db.prepare(q).get() as any).n as number;
    return {
      products: one('SELECT COUNT(*) AS n FROM Products'),
      descriptions: one('SELECT COUNT(*) AS n FROM ProductDescriptions'),
      images: one('SELECT COUNT(*) AS n FROM Images')
    };
  }

  async close() {
    this.db.close();
  }
}

// ------------------------------------------------------------------------------ SQL Server

/** Splits a sqlcmd-style script into batches on lines that contain only GO. */
export function splitBatches(script: string): string[] {
  return script.replace(/^\uFEFF/, '').split(/^\s*GO\s*$/im).map(b => b.trim()).filter(b => b !== '');
}

interface Column<T> { name: string; type: sql.ISqlType | (() => sql.ISqlType); value: (row: T) => unknown }

/** Multi-row INSERTs, chunked to stay under SQL Server's 2100-parameter limit. */
async function insertRows<T>(tx: sql.Transaction, table: string, columns: Column<T>[], rows: T[]) {
  const perStatement = Math.max(1, Math.min(1000, Math.floor(2000 / columns.length)));
  for (let start = 0; start < rows.length; start += perStatement) {
    const chunk = rows.slice(start, start + perStatement);
    const request = new sql.Request(tx);
    const values = chunk.map((row, r) => {
      const names = columns.map((c, i) => {
        const param = `p${r}_${i}`;
        request.input(param, c.type as any, c.value(row));
        return '@' + param;
      });
      return `(${names.join(', ')})`;
    });
    await request.query(`INSERT INTO ${table} (${columns.map(c => c.name).join(', ')}) VALUES ${values.join(', ')}`);
  }
}

function chunkImages(images: SeedImage[], maxBytes = 4 * 1024 * 1024, maxRows = 200): SeedImage[][] {
  const chunks: SeedImage[][] = [];
  let current: SeedImage[] = [];
  let bytes = 0;
  for (const img of images) {
    if (current.length && (bytes + img.byteLength > maxBytes || current.length >= maxRows)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(img);
    bytes += img.byteLength;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export class SqlServerCatalogWriter implements CatalogWriter {
  readonly description: string;
  private pool: sql.ConnectionPool | null = null;

  constructor(private readonly settings: SqlServerSettings) {
    this.description = `SQL Server ${settings.server}:${settings.port}, database ${settings.database}, login ${settings.user}`;
  }

  private async connection() {
    if (!this.pool) {
      this.pool = await connectPool(this.settings, 'GigaGarageSale seed');
    }
    return this.pool;
  }

  async applySchema() {
    const pool = await this.connection();
    for (const batch of splitBatches(fs.readFileSync(path.join(DB_DIR, 'schema.sql'), 'utf8'))) {
      await pool.request().batch(batch);
    }
  }

  async readVersion() {
    const pool = await this.connection();
    const r = await pool.request().query('SELECT Version FROM dbo.CatalogInfo WHERE Id = 1');
    return r.recordset[0] ? String(r.recordset[0].Version).trim() : null;
  }

  async replaceCatalog(data: SeedData, force: boolean): Promise<SeedResult> {
    const pool = await this.connection();
    const previousVersion = await this.readVersion();
    const existingRows = (await pool.request().query('SELECT Name, Sha256 FROM dbo.Images')).recordset;
    const existing = new Map<string, string>(existingRows.map((r: any) => [r.Name, String(r.Sha256).trim()] as [string, string]));
    const diff = diffImages(existing, data.images);
    const descriptions = descriptionRows(data);
    const result: SeedResult = {
      changed: false, previousVersion, version: data.version, products: data.products.length,
      descriptions: descriptions.length, imagesInserted: diff.insert.length, imagesUpdated: diff.update.length,
      imagesDeleted: diff.remove.length, imagesUnchanged: diff.unchanged
    };
    if (previousVersion === data.version && !force) {
      return result;
    }

    const tx = new sql.Transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      await new sql.Request(tx).batch('DELETE FROM dbo.ProductDescriptions; DELETE FROM dbo.Products;');
      await insertRows(tx, 'dbo.Products', [
        { name: 'Id', type: sql.Int, value: p => p.id },
        { name: 'Name', type: sql.NVarChar(400), value: p => p.name },
        { name: 'Title', type: sql.NVarChar(200), value: p => p.title },
        { name: 'Brand', type: sql.NVarChar(100), value: p => p.brand },
        { name: 'Price', type: sql.Decimal(10, 2), value: p => p.price },
        { name: 'ImageUrl', type: sql.NVarChar(400), value: p => p.imageUrl },
        { name: 'Category', type: sql.NVarChar(100), value: p => p.category },
        { name: 'Rating', type: sql.Decimal(3, 2), value: p => p.rating },
        { name: 'Merchant', type: sql.NVarChar(100), value: p => p.merchant },
        { name: 'Available', type: sql.Int, value: p => p.available }
      ], data.products);
      await insertRows(tx, 'dbo.ProductDescriptions', [
        { name: 'ProductId', type: sql.Int, value: d => d.productId },
        { name: 'Ordinal', type: sql.Int, value: d => d.ordinal },
        { name: 'Text', type: sql.NVarChar(1000), value: d => d.text }
      ], descriptions);
      for (const name of diff.remove) {
        await new sql.Request(tx).input('name', sql.NVarChar(260), name).query('DELETE FROM dbo.Images WHERE Name = @name');
      }
      // Several images per request: one round trip per ~4 MB instead of per image (tedious
      // leaves Nagle on, so every multi-packet request costs a delayed-ACK wait).
      for (const chunk of chunkImages(diff.insert.concat(diff.update))) {
        const request = new sql.Request(tx);
        const statements = chunk.map((img, i) => {
          request.input(`name${i}`, sql.NVarChar(260), img.name);
          request.input(`type${i}`, sql.VarChar(100), img.contentType);
          request.input(`len${i}`, sql.Int, img.byteLength);
          request.input(`sha${i}`, sql.Char(64), img.sha256);
          request.input(`content${i}`, sql.VarBinary(sql.MAX), img.content);
          return diff.insert.indexOf(img) !== -1
            ? `INSERT INTO dbo.Images (Name, ContentType, ByteLength, Sha256, Content, UpdatedUtc)
               VALUES (@name${i}, @type${i}, @len${i}, @sha${i}, @content${i}, SYSUTCDATETIME());`
            : `UPDATE dbo.Images SET ContentType = @type${i}, ByteLength = @len${i}, Sha256 = @sha${i},
               Content = @content${i}, UpdatedUtc = SYSUTCDATETIME() WHERE Name = @name${i};`;
        });
        await request.query(statements.join('\n'));
      }
      await new sql.Request(tx)
        .input('version', sql.Char(64), data.version)
        .input('products', sql.Int, data.products.length)
        .input('images', sql.Int, data.images.length)
        .query(`IF EXISTS (SELECT 1 FROM dbo.CatalogInfo WHERE Id = 1)
                  UPDATE dbo.CatalogInfo SET Version = @version, ProductCount = @products, ImageCount = @images,
                    SeededUtc = SYSUTCDATETIME(), SeededBy = SUSER_SNAME() WHERE Id = 1;
                ELSE
                  INSERT INTO dbo.CatalogInfo (Id, Version, ProductCount, ImageCount, SeededUtc, SeededBy)
                  VALUES (1, @version, @products, @images, SYSUTCDATETIME(), SUSER_SNAME());`);
      await tx.commit();
    } catch (err) {
      await tx.rollback().catch(() => undefined);
      throw err;
    }
    result.changed = true;
    return result;
  }

  async counts() {
    const pool = await this.connection();
    const r = await pool.request().query(`SELECT
      (SELECT COUNT(*) FROM dbo.Products) AS products,
      (SELECT COUNT(*) FROM dbo.ProductDescriptions) AS descriptions,
      (SELECT COUNT(*) FROM dbo.Images) AS images`);
    return r.recordset[0];
  }

  async close() {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
    }
  }
}
