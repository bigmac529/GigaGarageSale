import fs from 'fs';
import { IProduct } from '../../../shared/i-product';
import { IProductFacets } from '../../../shared/i-product-page';
import { productFacets } from '../product-query';
import { CatalogConfig, CatalogSourceKind } from './config';
import { CatalogInfo, CatalogReader, ImageMeta, LoginPermissions } from './reader';

export interface CatalogSnapshot {
  products: IProduct[];
  facets: IProductFacets;
}

export interface CatalogImage {
  meta: ImageMeta;
  content: Buffer;
}

export interface CatalogHealth {
  ok: boolean;
  catalog: Record<string, unknown>;
  db: Record<string, unknown>;
}

/**
 * The product catalog as the running API sees it: an in-memory, read-only snapshot that
 * the request handlers filter, sort and page (api/src/product-query.ts). Nothing here can
 * write to the source. The server keeps no stock or cart state (the cart and the
 * "available" counters live in the browser); POST /api/products/reset only re-syncs the
 * snapshot with its source.
 */
export interface Catalog {
  readonly source: CatalogSourceKind;
  /** True when /images/* comes from the catalog (database) instead of api/public/images. */
  readonly servesImages: boolean;
  /** Initial load. Database catalogs keep retrying in the background if it fails. */
  start(): Promise<void>;
  /** null until the first successful load. */
  current(): CatalogSnapshot | null;
  /** POST /api/products/reset: re-read the source (a database is only re-read if it changed). */
  reset(): Promise<void>;
  /** null when there is no such image (database catalogs only). */
  image(name: string): Promise<CatalogImage | null>;
  health(): Promise<CatalogHealth>;
  close(): Promise<void>;
}

/** JSON mode: products.json + api/public/images, exactly as before the database existed. */
export class JsonCatalog implements Catalog {
  readonly source = 'json' as const;
  readonly servesImages = false;
  private snapshot: CatalogSnapshot = { products: [], facets: { merchants: [], brands: [], categories: [] } };

  constructor(private readonly config: CatalogConfig) { }

  private load() {
    try {
      const raw = fs.readFileSync(this.config.productsFile, 'utf8');
      const products: IProduct[] = JSON.parse(raw);
      this.snapshot = { products, facets: productFacets(products) };
    } catch (err) {
      console.error(`Unable to read file: ${this.config.productsFile}`, err);
    }
  }

  async start() { this.load(); }
  current() { return this.snapshot; }
  async reset() { this.load(); }
  async image(): Promise<CatalogImage | null> { return null; }

  async health(): Promise<CatalogHealth> {
    return {
      ok: true,
      catalog: { source: 'json', products: this.snapshot.products.length },
      db: { enabled: false }
    };
  }

  async close() { }
}

interface DbSnapshot extends CatalogSnapshot {
  info: CatalogInfo;
  images: Map<string, ImageMeta>;
  loadedUtc: string;
}

/** Small LRU for image bytes, keyed by name + sha256, bounded by total size. */
class ImageCache {
  private readonly entries = new Map<string, Buffer>();
  private bytes = 0;

  constructor(private readonly maxBytes: number) { }

  get(key: string): Buffer | undefined {
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
    }
    return hit;
  }

  set(key: string, value: Buffer) {
    if (value.length > this.maxBytes || this.entries.has(key)) {
      return;
    }
    this.entries.set(key, value);
    this.bytes += value.length;
    while (this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value as string;
      this.bytes -= this.entries.get(oldest).length;
      this.entries.delete(oldest);
    }
  }

  clear() {
    this.entries.clear();
    this.bytes = 0;
  }
}

export interface DbCatalogOptions {
  /** Retry interval while the first load keeps failing. Default 15 s. */
  retryMs?: number;
  /** Image byte cache size. Default 64 MB (the whole seed catalog is ~22 MB). */
  imageCacheBytes?: number;
}

/** Database mode (SQL Server in production, SQLite locally). Read-only by construction. */
export class DbCatalog implements Catalog {
  readonly servesImages = true;
  private snapshot: DbSnapshot | null = null;
  private lastError: string | null = null;
  private syncing: Promise<void> | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private readonly cache: ImageCache;
  private readonly retryMs: number;

  constructor(private readonly reader: CatalogReader, options: DbCatalogOptions = {}) {
    this.retryMs = options.retryMs ?? 15000;
    this.cache = new ImageCache(options.imageCacheBytes ?? 64 * 1024 * 1024);
  }

  get source(): CatalogSourceKind {
    return this.reader.provider;
  }

  async start() {
    try {
      await this.sync();
    } catch (err) {
      this.scheduleRetry();
    }
  }

  private scheduleRetry() {
    if (this.closed || this.retryTimer) {
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.sync().catch(() => this.scheduleRetry());
    }, this.retryMs);
    this.retryTimer.unref();
  }

  current(): CatalogSnapshot | null {
    return this.snapshot;
  }

  /** Reloads the snapshot if the database's catalog version differs (one sync at a time). */
  private sync(): Promise<void> {
    if (!this.syncing) {
      this.syncing = this.doSync().then(
        () => { this.syncing = null; },
        err => {
          this.syncing = null;
          this.lastError = err instanceof Error ? err.message : String(err);
          console.error(`Catalog database: ${this.lastError}`);
          throw err;
        }
      );
    }
    return this.syncing;
  }

  private async doSync() {
    let info = await this.reader.readCatalogInfo();
    if (!info) {
      throw new Error('the database has not been seeded (no CatalogInfo row). Run npm run db:seed as an admin.');
    }
    if (this.snapshot && this.snapshot.info.version === info.version) {
      this.lastError = null;
      return;
    }
    // Read everything, then make sure no seed committed in between (retry once if one did).
    for (let attempt = 1; ; attempt++) {
      const products = await this.reader.readProducts();
      const images = await this.reader.readImageIndex();
      const after = await this.reader.readCatalogInfo();
      if (after && after.version === info.version) {
        const previous = this.snapshot;
        this.snapshot = {
          info,
          products,
          facets: productFacets(products),
          images: new Map(images.map(i => [i.name, i] as [string, ImageMeta])),
          loadedUtc: new Date().toISOString()
        };
        this.cache.clear();
        this.lastError = null;
        console.log(`Catalog loaded from ${this.reader.provider}: ${products.length} products, ${images.length} images, ` +
          `version ${info.version.slice(0, 12)} (seeded ${info.seededUtc})` + (previous ? ' - replaced the previous version' : ''));
        return;
      }
      if (attempt >= 3) {
        throw new Error('the catalog kept changing while it was being read; try again after the seed finishes.');
      }
      if (!after) {
        throw new Error('the CatalogInfo row disappeared while the catalog was being read.');
      }
      info = after;
    }
  }

  async reset() {
    try {
      await this.sync();
    } catch {
      // Logged in sync(); keep serving the previous snapshot, like JSON mode does.
      if (!this.snapshot) {
        this.scheduleRetry();
      }
    }
  }

  async image(name: string): Promise<CatalogImage | null> {
    const snapshot = this.snapshot;
    const meta = snapshot && snapshot.images.get(name);
    if (!meta) {
      return null;
    }
    const key = `${meta.name}\u0000${meta.sha256}`;
    let content = this.cache.get(key);
    if (!content) {
      content = await this.reader.readImageContent(name);
      if (!content) {
        return null;
      }
      this.cache.set(key, content);
    }
    return { meta, content };
  }

  /** Peeks at the image metadata without loading bytes (for conditional requests). */
  imageMeta(name: string): ImageMeta | null {
    return (this.snapshot && this.snapshot.images.get(name)) || null;
  }

  async health(): Promise<CatalogHealth> {
    let perms: LoginPermissions | null = null;
    let info: CatalogInfo | null = null;
    let error: string | null = null;
    try {
      perms = await this.reader.readPermissions();
      info = await this.reader.readCatalogInfo();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const s = this.snapshot;
    const problems: string[] = [];
    if (error) problems.push(`database unreachable: ${error}`);
    if (!error && !info) problems.push('database has not been seeded');
    if (!s) problems.push(`catalog not loaded${this.lastError ? `: ${this.lastError}` : ''}`);
    if (perms && !perms.readOnly) {
      problems.push(`the database login ${perms.login} can write (${perms.writable.length} write permissions, ` +
        'see db.writablePermissions); the API must use a read-only login such as ggs_reader (db/reader-login.sql)');
    }
    return {
      ok: problems.length === 0,
      catalog: {
        source: this.reader.provider,
        loaded: !!s,
        products: s ? s.products.length : 0,
        images: s ? s.images.size : 0,
        version: s ? s.info.version : null,
        seededUtc: s ? s.info.seededUtc : null,
        loadedUtc: s ? s.loadedUtc : null,
        // A newer seed is picked up by the next POST /api/products/reset (every UI page load) or a restart.
        newerVersionAvailable: !!(s && info && info.version !== s.info.version)
      },
      db: {
        enabled: true,
        provider: this.reader.provider,
        connected: !error,
        readOnly: perms ? perms.readOnly : null,
        login: perms ? perms.login : null,
        ...(perms && !perms.readOnly ? { writablePermissions: perms.writable } : {}),
        ...(problems.length ? { problems } : {})
      }
    };
  }

  async close() {
    this.closed = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    await this.reader.close();
  }
}
