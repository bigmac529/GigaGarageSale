import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { ConfigError, DEFAULT_SQLITE_PATH, describeCatalogConfig, readCatalogConfig, readSqlServerSettings } from './config';

const serverEnv = {
  GGS_DB_SERVER: 'localhost', GGS_DB_PORT: '1433', GGS_DB_NAME: 'GigaGarageSale',
  GGS_DB_USER: 'ggs_reader', GGS_DB_PASSWORD: 's3cret!', GGS_DB_ENCRYPT: 'true', GGS_DB_TRUST_CERT: 'true'
};

test('without GGS_DB_ENABLED the catalog stays in JSON mode, even with every other DB variable set', () => {
  assert.equal(readCatalogConfig({}).source, 'json');
  assert.equal(readCatalogConfig(serverEnv).source, 'json');
  assert.equal(readCatalogConfig({ ...serverEnv, GGS_DB_ENABLED: 'false' }).source, 'json');
  assert.equal(readCatalogConfig({ ...serverEnv, GGS_DB_ENABLED: '' }).source, 'json');
});

test('GGS_DB_ENABLED=true selects SQL Server with the service variables', () => {
  const c = readCatalogConfig({ ...serverEnv, GGS_DB_ENABLED: 'TRUE' });
  assert.equal(c.source, 'sqlserver');
  assert.deepEqual(c.sqlServer, {
    server: 'localhost', port: 1433, database: 'GigaGarageSale', user: 'ggs_reader', password: 's3cret!',
    encrypt: true, trustServerCertificate: true
  });
  assert.doesNotMatch(describeCatalogConfig(c), /s3cret/);
});

test('SQL Server defaults and validation', () => {
  const c = readCatalogConfig({ GGS_DB_ENABLED: 'true', GGS_DB_USER: 'u', GGS_DB_PASSWORD: 'p' });
  assert.equal(c.sqlServer.server, 'localhost');
  assert.equal(c.sqlServer.port, 1433);
  assert.equal(c.sqlServer.database, 'GigaGarageSale');
  assert.equal(c.sqlServer.encrypt, true);
  assert.equal(c.sqlServer.trustServerCertificate, false);
  assert.throws(() => readCatalogConfig({ GGS_DB_ENABLED: 'true' }), ConfigError);
  assert.throws(() => readCatalogConfig({ GGS_DB_ENABLED: 'true', GGS_DB_USER: 'u' }), /GGS_DB_PASSWORD/);
  assert.throws(() => readCatalogConfig({ ...serverEnv, GGS_DB_ENABLED: 'true', GGS_DB_PORT: 'abc' }), /GGS_DB_PORT/);
  assert.throws(() => readCatalogConfig({ ...serverEnv, GGS_DB_ENABLED: 'true', GGS_DB_ENCRYPT: 'maybe' }), /GGS_DB_ENCRYPT/);
  assert.throws(() => readCatalogConfig({ ...serverEnv, GGS_DB_ENABLED: 'yes please' }), /GGS_DB_ENABLED/);
  assert.throws(() => readCatalogConfig({ ...serverEnv, GGS_DB_ENABLED: 'true', GGS_DB_PROVIDER: 'mysql' }), /GGS_DB_PROVIDER/);
});

test('sqlite provider for local development', () => {
  const c = readCatalogConfig({ GGS_DB_ENABLED: 'true', GGS_DB_PROVIDER: 'sqlite' });
  assert.equal(c.source, 'sqlite');
  assert.equal(c.sqlitePath, DEFAULT_SQLITE_PATH);
  assert.equal(readCatalogConfig({ GGS_DB_ENABLED: 'true', GGS_DB_PROVIDER: 'SQLite', GGS_SQLITE_PATH: 'x.db' }).sqlitePath,
    path.resolve('x.db'));
});

test('seed settings (GGS_SEED_*) fall back to GGS_DB_* per variable', () => {
  const s = readSqlServerSettings({ ...serverEnv, GGS_SEED_USER: 'ggs_app', GGS_SEED_PASSWORD: 'writer' }, 'GGS_SEED_', 'GGS_DB_');
  assert.equal(s.user, 'ggs_app');
  assert.equal(s.password, 'writer');
  assert.equal(s.database, 'GigaGarageSale');
  assert.equal(s.trustServerCertificate, true);
  assert.throws(() => readSqlServerSettings({}, 'GGS_SEED_', 'GGS_DB_'), /GGS_SEED_USER.*GGS_DB_USER/);
});

test('SQL Server host candidates prefer IPv4 (the server only listens on 127.0.0.1)', async () => {
  const { candidateHosts, toMssqlConfig } = await import('./sqlserver-reader');
  assert.deepEqual(await candidateHosts('127.0.0.1'), ['127.0.0.1']);
  const local = await candidateHosts('localhost');
  assert.equal(local[0], '127.0.0.1');
  const cfg = toMssqlConfig({ ...readSqlServerSettings(serverEnv, 'GGS_DB_'), server: '127.0.0.1' }, 'test', 'localhost');
  assert.equal(cfg.server, '127.0.0.1');
  assert.equal(cfg.options.serverName, 'localhost');
  assert.equal(cfg.options.encrypt, true);
  assert.equal(cfg.options.trustServerCertificate, true);
});
