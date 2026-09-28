import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createApp } from '../app';
import { loadSeedData } from '../../scripts/seed/seed-data';
import { SqliteCatalogWriter } from '../../scripts/seed/writers';
import { Catalog, DbCatalog, JsonCatalog } from './catalog';
import { CatalogConfig, DEFAULT_IMAGES_DIR, DEFAULT_PRODUCTS_FILE } from './config';
import { CatalogReader, LoginPermissions, READER_METHODS } from './reader';
import { SqliteCatalogReader, loadBetterSqlite3 } from './sqlite-reader';
import { COMPARED_URLS, Running, capture, listen, rawGet } from './test-support';

const jsonConfig: CatalogConfig = {
  source: 'json', productsFile: DEFAULT_PRODUCTS_FILE, imagesDir: DEFAULT_IMAGES_DIR, reason: 'test'
};

const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

async function seed(file: string, productsFile = DEFAULT_PRODUCTS_FILE) {
  const writer = new SqliteCatalogWriter(file);
  try {
    await writer.applySchema();
    return await writer.replaceCatalog(loadSeedData(productsFile, DEFAULT_IMAGES_DIR), false);
  } finally {
    await writer.close();
  }
}

/** Everything that could change if something wrote to the database. */
function dbFingerprint(file: string) {
  const Database = loadBetterSqlite3();
  const db = new Database(file, { readonly: true });
  try {
    const tables: Record<string, string> = {};
    for (const t of ['Products', 'ProductDescriptions', 'Images', 'CatalogInfo']) {
      const rows = db.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).raw().all();
      tables[t] = crypto.createHash('sha256').update(JSON.stringify(rows, (_k, v) =>
        v && v.type === 'Buffer' ? sha256(Buffer.from(v.data)) : v)).digest('hex');
    }
    return { file: sha256(fs.readFileSync(file)), mtimeMs: fs.statSync(file).mtimeMs, tables };
  } finally {
    db.close();
  }
}

describe('database mode (SQLite)', () => {
  let dir: string;
  let dbFile: string;
  let jsonCatalog: Catalog;
  let dbCatalog: DbCatalog;
  let jsonApi: Running;
  let dbApi: Running;
  let dbApp: ReturnType<typeof createApp>;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ggs-catalog-'));
    dbFile = path.join(dir, 'catalog.sqlite');
    const r = await seed(dbFile);
    assert.equal(r.changed, true);
    jsonCatalog = new JsonCatalog(jsonConfig);
    await jsonCatalog.start();
    dbCatalog = new DbCatalog(new SqliteCatalogReader(dbFile));
    await dbCatalog.start();
    jsonApi = await listen(createApp({ catalog: jsonCatalog, port: 0 }));
    dbApp = createApp({ catalog: dbCatalog, port: 0 });
    dbApi = await listen(dbApp);
  });

  after(async () => {
    await jsonApi?.close();
    await dbApi?.close();
    await dbCatalog?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('every read endpoint answers exactly like JSON mode', async () => {
    for (const url of COMPARED_URLS) {
      const [a, b] = await Promise.all([capture(jsonApi.base, url), capture(dbApi.base, url)]);
      assert.deepEqual(b, a, `response differs for ${url}`);
    }
    const all = JSON.parse((await capture(dbApi.base, '/api/products')).body);
    assert.equal(all.length, 1089);
    const page = JSON.parse((await capture(dbApi.base, '/api/products?page=2&pageSize=10')).body);
    assert.deepEqual(Object.keys(page), ['items', 'total', 'page', 'pageSize', 'totalPages']);
    assert.deepEqual(Object.keys(page.items[0]),
      ['id', 'name', 'title', 'brand', 'price', 'imageUrl', 'category', 'descriptions', 'rating', 'merchant', 'available']);
  });

  test('every image is served from the database, byte-for-byte, with caching headers', async () => {
    const files = fs.readdirSync(DEFAULT_IMAGES_DIR);
    assert.ok(files.length > 1000);
    for (let i = 0; i < files.length; i += 50) {
      await Promise.all(files.slice(i, i + 50).map(async name => {
        const res = await fetch(`${dbApi.base}/images/${name}`);
        assert.equal(res.status, 200, name);
        const body = Buffer.from(await res.arrayBuffer());
        const original = fs.readFileSync(path.join(DEFAULT_IMAGES_DIR, name));
        assert.ok(body.equals(original), `bytes differ for ${name}`);
        assert.equal(res.headers.get('content-type'), 'image/jpeg');
        assert.equal(res.headers.get('content-length'), String(original.length));
        assert.equal(res.headers.get('etag'), `"${sha256(original)}"`);
        assert.equal(res.headers.get('cache-control'), 'public, max-age=604800');
        assert.ok(res.headers.get('last-modified'));
      }));
    }
  });

  test('images: conditional GET, HEAD, 404 and no fallback to files on disk', async () => {
    const original = fs.readFileSync(path.join(DEFAULT_IMAGES_DIR, '12.jpg'));
    const etag = `"${sha256(original)}"`;
    // Plain http.get: fetch() adds "Cache-Control: no-cache" to conditional requests, which
    // (correctly) disables 304s. Browsers revalidating a cached image don't.
    const notModified = await rawGet(`${dbApi.base}/images/12.jpg`, { 'If-None-Match': etag });
    assert.equal(notModified.status, 304);
    assert.equal(notModified.body.length, 0);
    assert.equal((await rawGet(`${dbApi.base}/images/12.jpg`, { 'If-None-Match': '"other"' })).status, 200);

    const head = await fetch(`${dbApi.base}/images/12.jpg`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), String(original.length));

    for (const url of ['/images/999999.jpg', '/images/12.JPG', '/images/12.jpg.bak', '/images/sub/12.jpg']) {
      assert.equal((await fetch(dbApi.base + url)).status, 404, url);
    }
    assert.equal((await fetch(`${dbApi.base}/images/12.jpg`, { method: 'POST' })).status, 404);

    // A file that exists on disk but not in the database must 404 in database mode.
    const stray = path.join(DEFAULT_IMAGES_DIR, 'zz-not-in-db-test.jpg');
    fs.writeFileSync(stray, original);
    try {
      assert.equal((await fetch(`${dbApi.base}/images/zz-not-in-db-test.jpg`)).status, 404);
      assert.equal((await fetch(`${jsonApi.base}/images/zz-not-in-db-test.jpg`)).status, 200);
    } finally {
      fs.unlinkSync(stray);
    }
  });

  test('health reports a connected, read-only, loaded database', async () => {
    const res = await fetch(`${dbApi.base}/api/health`);
    assert.equal(res.status, 200);
    const h = await res.json() as any;
    assert.equal(h.ok, true);
    assert.equal(h.catalog.source, 'sqlite');
    assert.equal(h.catalog.products, 1089);
    assert.equal(h.catalog.images, 1089);
    assert.equal(h.db.connected, true);
    assert.equal(h.db.readOnly, true);

    const json = await (await fetch(`${jsonApi.base}/api/health`)).json() as any;
    assert.equal(json.ok, true);
    assert.deepEqual(json.db, { enabled: false });
    assert.equal(json.catalog.source, 'json');
  });

  test('no route writes to the database: every non-GET request leaves it unchanged', async () => {
    const routes: { method: string; path: string }[] = [];
    for (const layer of (dbApp as any).router.stack) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) {
          routes.push({ method: method.toUpperCase(), path: layer.route.path });
        }
      }
    }
    const writeRoutes = routes.filter(r => r.method !== 'GET' && r.method !== 'HEAD');
    // If this list grows, the new route must be reviewed against the read-only rule
    // (docs/DATABASE.md) and added here deliberately.
    assert.deepEqual(writeRoutes.map(r => `${r.method} ${r.path}`), ['POST /api/products/reset']);

    const before = dbFingerprint(dbFile);
    const paths = new Set<string>(['/api/products/reset', '/api/products', '/api/products/12', '/api/products/facets',
      '/api/health', '/images/12.jpg', '/api/cart', '/api/checkout', '/api/products/12/stock', '/']);
    const bodies: { type: string; body: string }[] = [
      { type: 'application/json', body: JSON.stringify({ id: 12, available: 0, quantity: 99, price: 0 }) },
      { type: 'text/plain', body: 'DELETE FROM Products' },
      { type: 'application/x-www-form-urlencoded', body: 'id=12&available=0' }
    ];
    let requests = 0;
    for (const p of Array.from(paths)) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        for (const b of bodies) {
          const res = await fetch(dbApi.base + p, { method, headers: { 'Content-Type': b.type }, body: b.body });
          await res.arrayBuffer();
          assert.ok(res.status === 204 || res.status === 404, `${method} ${p} -> ${res.status}`);
          requests++;
        }
      }
    }
    assert.ok(requests >= 100);
    assert.deepEqual(dbFingerprint(dbFile), before);
    // ...and the API still serves the same catalog afterwards.
    const product = await (await fetch(`${dbApi.base}/api/products/12`)).json() as any;
    assert.equal(product.available, 5);
  });

  test('the API only ever runs SELECT statements against the database', async () => {
    const Database = loadBetterSqlite3() as any;
    const seen: string[] = [];
    const proto = Database.prototype;
    const original = { prepare: proto.prepare, exec: proto.exec };
    proto.prepare = function (source: string) { seen.push(source); return original.prepare.call(this, source); };
    proto.exec = function (source: string) { seen.push(source); return original.exec.call(this, source); };
    try {
      // Force a full reload too (a new reader + catalog), then exercise every endpoint.
      const catalog = new DbCatalog(new SqliteCatalogReader(dbFile));
      await catalog.start();
      const api = await listen(createApp({ catalog, port: 0 }));
      try {
        for (const url of COMPARED_URLS.concat(['/images/12.jpg', '/images/13.jpg', '/api/health'])) {
          await (await fetch(api.base + url)).arrayBuffer();
        }
        await (await fetch(`${api.base}/api/products/reset`, { method: 'POST' })).arrayBuffer();
      } finally {
        await api.close();
        await catalog.close();
      }
    } finally {
      proto.prepare = original.prepare;
      proto.exec = original.exec;
    }
    assert.ok(seen.length >= 6);
    for (const s of seen) {
      assert.match(s, /^\s*SELECT\b/i, `non-SELECT statement: ${s}`);
    }
  });

  test('the runtime code has no write SQL and never loads the seed tooling', () => {
    const srcDir = path.resolve(__dirname, '..');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) && e.name !== 'test-support.ts') files.push(full);
      }
    };
    walk(srcDir);
    assert.ok(files.length >= 8);
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      assert.doesNotMatch(text, /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|(CREATE|ALTER|DROP|TRUNCATE)\s+TABLE\s+[\w\[]|MERGE\s+INTO)/i, f);
      assert.doesNotMatch(text, /from\s+['"][^'"]*scripts\//, `${f} imports admin tooling`);
    }
  });

  test('the reader has read methods only and its connection rejects writes', async () => {
    const reader = new SqliteCatalogReader(dbFile);
    try {
      const methods = Object.getOwnPropertyNames(SqliteCatalogReader.prototype).filter(m => m !== 'constructor').sort();
      assert.deepEqual(methods, READER_METHODS.slice().sort());
      const db = (reader as any).db;
      assert.equal(db.readonly, true);
      for (const stmt of ['DELETE FROM Products', "UPDATE Products SET Price = 0", 'INSERT INTO CatalogInfo (Id) VALUES (2)',
        'CREATE TABLE Evil (x)', 'DROP TABLE Images']) {
        assert.throws(() => db.exec(stmt), (err: any) => /readonly|read-only|query_only/i.test(`${err.code} ${err.message}`), stmt);
      }
      assert.equal((await reader.readPermissions()).readOnly, true);
    } finally {
      await reader.close();
    }
  });

  test('a new seed (by the admin tool) is picked up by POST /api/products/reset', async () => {
    const products = JSON.parse(fs.readFileSync(DEFAULT_PRODUCTS_FILE, 'utf8'));
    const changed = products.map((p: any) => p.id === 12 ? { ...p, price: 12.34, title: 'Changed title' } : p);
    const changedFile = path.join(dir, 'products.json');
    fs.writeFileSync(changedFile, JSON.stringify(changed));
    try {
      const r = await seed(dbFile, changedFile);
      assert.equal(r.changed, true);
      assert.equal(r.imagesUnchanged, 1089);
      let health = await (await fetch(`${dbApi.base}/api/health`)).json() as any;
      assert.equal(health.catalog.newerVersionAvailable, true);
      assert.equal((await (await fetch(`${dbApi.base}/api/products/12`)).json() as any).price, 47.58);

      assert.equal((await fetch(`${dbApi.base}/api/products/reset`, { method: 'POST' })).status, 204);
      const p = await (await fetch(`${dbApi.base}/api/products/12`)).json() as any;
      assert.equal(p.price, 12.34);
      assert.equal(p.title, 'Changed title');
      health = await (await fetch(`${dbApi.base}/api/health`)).json() as any;
      assert.equal(health.catalog.newerVersionAvailable, false);
    } finally {
      assert.equal((await seed(dbFile)).changed, true);
      await fetch(`${dbApi.base}/api/products/reset`, { method: 'POST' });
    }
    assert.equal((await seed(dbFile)).changed, false, 're-running the seed with the same input is a no-op');
  });

  test('a missing SQLite file is a clear error', () => {
    assert.throws(() => new SqliteCatalogReader(path.join(dir, 'missing.sqlite')), /npm run db:seed/);
  });
});

describe('database mode when the database is unavailable or misconfigured', () => {
  class FakeReader implements CatalogReader {
    readonly provider = 'sqlserver' as const;
    down = true;
    perms: LoginPermissions = { readOnly: true, login: 'ggs_reader', writable: [] };
    private check() { if (this.down) throw new Error('connect ECONNREFUSED 127.0.0.1:1433'); }
    async readCatalogInfo() {
      this.check();
      return { version: 'v1', productCount: 1, imageCount: 1, seededUtc: '2026-01-01T00:00:00Z', seededBy: 'ggs_app' };
    }
    async readProducts() {
      this.check();
      return [{ id: 1, name: 'n', title: 't', brand: 'b', price: 1, imageUrl: '/images/1.jpg', category: 'c',
        descriptions: ['d'], rating: 3, merchant: 'm', available: 2 }];
    }
    async readImageIndex() {
      this.check();
      return [{ name: '1.jpg', contentType: 'image/jpeg', byteLength: 3, sha256: 'a'.repeat(64), updatedUtc: '2026-01-01T00:00:00Z' }];
    }
    async readImageContent() { this.check(); return Buffer.from([1, 2, 3]); }
    async readPermissions() { this.check(); return this.perms; }
    async close() { }
  }

  test('health is 503 and catalog endpoints are 503 until the database answers, then recover', async () => {
    const reader = new FakeReader();
    const catalog = new DbCatalog(reader, { retryMs: 60000 });
    await catalog.start();
    const api = await listen(createApp({ catalog, port: 0 }));
    try {
      let res = await fetch(`${api.base}/api/health`);
      assert.equal(res.status, 503);
      let h = await res.json() as any;
      assert.equal(h.ok, false);
      assert.equal(h.db.connected, false);
      assert.match(h.db.problems.join(' '), /ECONNREFUSED/);
      assert.equal((await fetch(`${api.base}/api/products?page=1`)).status, 503);
      assert.equal((await fetch(`${api.base}/api/products/facets`)).status, 503);
      assert.equal((await fetch(`${api.base}/images/1.jpg`)).status, 404);
      assert.equal((await fetch(`${api.base}/api/products/reset`, { method: 'POST' })).status, 204);

      reader.down = false;
      assert.equal((await fetch(`${api.base}/api/products/reset`, { method: 'POST' })).status, 204);
      res = await fetch(`${api.base}/api/health`);
      assert.equal(res.status, 200);
      assert.equal((await (await fetch(`${api.base}/api/products?page=1`)).json() as any).total, 1);
      assert.deepEqual(Buffer.from(await (await fetch(`${api.base}/images/1.jpg`)).arrayBuffer()), Buffer.from([1, 2, 3]));

      // The database going away later keeps the last snapshot serving, but health turns 503.
      reader.down = true;
      assert.equal((await fetch(`${api.base}/api/products/reset`, { method: 'POST' })).status, 204);
      assert.equal((await fetch(`${api.base}/api/products/1`)).status, 200);
      assert.equal((await fetch(`${api.base}/api/health`)).status, 503);

      // A login that can write fails the health check.
      reader.down = false;
      reader.perms = { readOnly: false, login: 'ggs_app', writable: ['Products:INSERT'] };
      res = await fetch(`${api.base}/api/health`);
      assert.equal(res.status, 503);
      h = await res.json() as any;
      assert.equal(h.db.readOnly, false);
      assert.match(h.db.problems.join(' '), /read-only login/);
    } finally {
      await api.close();
      await catalog.close();
    }
  });
});
