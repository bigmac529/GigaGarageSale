import { createApp } from './app';
import { ConfigError, createCatalog, describeCatalogConfig, readCatalogConfig } from './catalog';
import http from 'http';
import dns from 'dns';

const PORT = Number(process.env.PORT) || 3106;

// Where the catalog comes from (docs/DATABASE.md). Without GGS_DB_ENABLED=true this is the
// JSON file + image folder, exactly as before. PRODUCTS_FILE lets you point a local API at
// a different catalog file (for example a large generated one when testing pagination).
let catalogConfig;
try {
  catalogConfig = readCatalogConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`Catalog configuration error: ${err.message} See docs/DATABASE.md.`);
    process.exit(1);
  }
  throw err;
}
console.log(`Catalog source: ${describeCatalogConfig(catalogConfig)}`);
if (catalogConfig.source === 'json' && process.env.NODE_ENV === 'production') {
  console.log('Catalog: database mode is off, serving products.json and api/public/images. ' +
    'Set GGS_DB_ENABLED=true once the database is seeded (docs/DATABASE.md).');
}

let catalog;
try {
  catalog = createCatalog(catalogConfig);
} catch (err) {
  console.error(`Catalog could not be opened: ${(err as Error).message}`);
  process.exit(1);
}
// Database mode: a failed first load is logged and retried in the background; /api/health
// answers 503 until the catalog is loaded.
catalog.start();

const app = createApp({ catalog, port: PORT });

// Listen on every address HOST resolves to. For "localhost" that is normally both
// the IPv6 (::1) and IPv4 loopback, so IIS/ARR and health checks work whichever one
// Windows picks when it resolves "localhost". Loopback only: not reachable from
// other machines.
const HOST = process.env.HOST || 'localhost';

dns.lookup(HOST, { all: true }, (err, results) => {
  if (err || !results || results.length === 0) {
    console.error(`Could not resolve ${HOST}`, err);
    process.exit(1);
  }

  const seen = new Set<string>();
  const addresses = results.filter(r => !seen.has(r.address) && seen.add(r.address));
  let pending = addresses.length;
  let listening = 0;

  const done = () => {
    if (--pending === 0 && listening === 0) {
      console.error(`GigaGarageSale API could not listen on ${HOST}:${PORT}`);
      process.exit(1);
    }
  };

  for (const { address, family } of addresses) {
    const label = family === 6 ? `[${address}]` : address;
    const server = http.createServer(app);
    server.on('error', (e: NodeJS.ErrnoException) => {
      // A missing address family (e.g. IPv6 disabled) is fine as long as one address works;
      // anything else, such as the port already being in use, is fatal.
      if (e.code === 'EADDRNOTAVAIL' || e.code === 'EAFNOSUPPORT') {
        console.warn(`Skipping ${label}:${PORT} (${e.code})`);
        return done();
      }
      console.error(`Could not listen on ${label}:${PORT}`, e);
      process.exit(1);
    });
    server.listen({ port: PORT, host: address, ipv6Only: family === 6 }, () => {
      listening++;
      console.log(`GigaGarageSale API listening on http://${label}:${PORT} (${HOST})`);
      done();
    });
  }
});
