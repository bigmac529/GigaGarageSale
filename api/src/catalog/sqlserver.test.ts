// Integration tests against a real SQL Server. Skipped unless GGS_TEST_SQLSERVER_WRITER_USER is set.
//
//   GGS_TEST_SQLSERVER_SERVER=localhost  GGS_TEST_SQLSERVER_PORT=1433  GGS_TEST_SQLSERVER_NAME=GigaGarageSale
//   GGS_TEST_SQLSERVER_WRITER_USER=ggs_app     GGS_TEST_SQLSERVER_WRITER_PASSWORD=...
//   GGS_TEST_SQLSERVER_READER_USER=ggs_reader  GGS_TEST_SQLSERVER_READER_PASSWORD=...
//   npm test
//
// The writer seeds the database (like an admin running npm run db:seed); the API reads with
// the reader login, which must be read-only (db/reader-login.sql).
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as sql from 'mssql';
import { createApp } from '../app';
import { loadSeedData } from '../../scripts/seed/seed-data';
import { SqlServerCatalogWriter } from '../../scripts/seed/writers';
import { DbCatalog, JsonCatalog } from './catalog';
import { DEFAULT_IMAGES_DIR, DEFAULT_PRODUCTS_FILE, SqlServerSettings } from './config';
import { SqlServerCatalogReader, connectPool } from './sqlserver-reader';
import { COMPARED_URLS, Running, capture, listen, rawGet } from './test-support';

const env = process.env;
const enabled = !!env.GGS_TEST_SQLSERVER_WRITER_USER;

function settings(role: 'WRITER' | 'READER'): SqlServerSettings {
  return {
    server: env.GGS_TEST_SQLSERVER_SERVER || 'localhost',
    port: Number(env.GGS_TEST_SQLSERVER_PORT || 1433),
    database: env.GGS_TEST_SQLSERVER_NAME || 'GigaGarageSale',
    user: env[`GGS_TEST_SQLSERVER_${role}_USER`],
    password: env[`GGS_TEST_SQLSERVER_${role}_PASSWORD`],
    encrypt: true,
    trustServerCertificate: true
  };
}

async function fingerprint(pool: sql.ConnectionPool) {
  const r = await pool.request().query(`SELECT
    (SELECT CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM dbo.Products) AS products,
    (SELECT CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM dbo.ProductDescriptions) AS descriptions,
    (SELECT CHECKSUM_AGG(CHECKSUM(Name, Sha256, ByteLength, HASHBYTES('SHA2_256', Content))) FROM dbo.Images) AS images,
    (SELECT CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM dbo.CatalogInfo) AS info,
    (SELECT COUNT(*) FROM sys.tables) AS tables`);
  return r.recordset[0];
}

describe('SQL Server (writer seeds, read-only reader serves)', { skip: !enabled && 'set GGS_TEST_SQLSERVER_* to run' }, () => {
  let jsonApi: Running;
  let dbApi: Running;
  let catalog: DbCatalog;
  let readerPool: sql.ConnectionPool;

  before(async () => {
    const writer = new SqlServerCatalogWriter(settings('WRITER'));
    try {
      await writer.applySchema();
      await writer.applySchema(); // idempotent
      await writer.replaceCatalog(loadSeedData(DEFAULT_PRODUCTS_FILE, DEFAULT_IMAGES_DIR), false);
    } finally {
      await writer.close();
    }
    const json = new JsonCatalog({ source: 'json', productsFile: DEFAULT_PRODUCTS_FILE, imagesDir: DEFAULT_IMAGES_DIR, reason: 'test' });
    await json.start();
    jsonApi = await listen(createApp({ catalog: json, port: 0 }));
    catalog = new DbCatalog(new SqlServerCatalogReader(settings('READER')));
    await catalog.start();
    dbApi = await listen(createApp({ catalog, port: 0 }));
    readerPool = await connectPool(settings('READER'), 'test reader');
  });

  after(async () => {
    await jsonApi?.close();
    await dbApi?.close();
    await catalog?.close();
    await readerPool?.close();
  });

  test('responses are identical to JSON mode', async () => {
    for (const url of COMPARED_URLS) {
      const [a, b] = await Promise.all([capture(jsonApi.base, url), capture(dbApi.base, url)]);
      assert.deepEqual(b, a, `response differs for ${url}`);
    }
  });

  test('images come from the database byte-for-byte', async () => {
    const files = fs.readdirSync(DEFAULT_IMAGES_DIR);
    for (const name of files.filter((_f, i) => i % 10 === 0)) {
      const res = await fetch(`${dbApi.base}/images/${name}`);
      assert.equal(res.status, 200);
      const body = Buffer.from(await res.arrayBuffer());
      const original = fs.readFileSync(path.join(DEFAULT_IMAGES_DIR, name));
      assert.ok(body.equals(original), name);
      assert.equal(res.headers.get('etag'), `"${crypto.createHash('sha256').update(original).digest('hex')}"`);
    }
    const etag = (await rawGet(`${dbApi.base}/images/12.jpg`)).headers.etag as string;
    assert.equal((await rawGet(`${dbApi.base}/images/12.jpg`, { 'If-None-Match': etag })).status, 304);
    assert.equal((await fetch(`${dbApi.base}/images/nope.jpg`)).status, 404);
  });

  test('health: connected, seeded, read-only login', async () => {
    const res = await fetch(`${dbApi.base}/api/health`);
    const h = await res.json() as any;
    assert.equal(res.status, 200, JSON.stringify(h));
    assert.equal(h.db.connected, true);
    assert.equal(h.db.readOnly, true);
    assert.match(h.db.login, /reader/);
    assert.equal(h.catalog.products, 1089);
  });

  test('the reader login cannot write, alter or execute anything', async () => {
    const attempts = [
      'INSERT INTO dbo.CatalogInfo (Id, Version, ProductCount, ImageCount, SeededUtc, SeededBy) VALUES (2, \'x\', 0, 0, SYSUTCDATETIME(), \'x\')',
      'UPDATE dbo.Products SET Price = 0 WHERE Id = 12',
      'DELETE FROM dbo.Images WHERE Name = \'12.jpg\'',
      'TRUNCATE TABLE dbo.ProductDescriptions',
      'CREATE TABLE dbo.Evil (x int)',
      'ALTER TABLE dbo.Products ADD Evil int NULL',
      'DROP TABLE dbo.CatalogInfo',
      'EXEC(\'CREATE PROCEDURE dbo.EvilProc AS SELECT 1\')'
    ];
    for (const statement of attempts) {
      await assert.rejects(readerPool.request().query(statement),
        (err: any) => /permission|denied|does not exist or you do not have/i.test(err.message), statement);
    }
  });

  test('non-GET routes leave the database unchanged', async () => {
    const writerPool = await connectPool(settings('WRITER'), 'test writer');
    try {
      const before = await fingerprint(writerPool);
      for (const p of ['/api/products/reset', '/api/products', '/api/products/12', '/images/12.jpg', '/api/checkout']) {
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
          const res = await fetch(dbApi.base + p, { method, headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: 12, available: 0 }) });
          await res.arrayBuffer();
        }
      }
      assert.deepEqual(await fingerprint(writerPool), before);
    } finally {
      await writerPool.close();
    }
  });

  test('health is 503 when the service is given the writer login', async () => {
    const writerCatalog = new DbCatalog(new SqlServerCatalogReader(settings('WRITER')));
    await writerCatalog.start();
    try {
      const h = await writerCatalog.health();
      assert.equal(h.ok, false);
      assert.equal(h.db.readOnly, false);
      assert.ok((h.db.writablePermissions as string[]).length > 0);
    } finally {
      await writerCatalog.close();
    }
  });
});
