import { IProduct } from '../../shared/i-product';
import { IProductFacets } from '../../shared/i-product-page';
import {
  QueryError,
  isPagedQuery,
  filterProducts,
  pageProducts,
  parseProductQuery,
  productFacets
} from './product-query';
import path from 'path';
import fs from 'fs';
import http from 'http';
import dns from 'dns';
import express from 'express';
import cors from 'cors';

const app = express();

const PORT = Number(process.env.PORT) || 3106;
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SPA_DIR = path.join(PUBLIC_DIR, 'spa');
// PRODUCTS_FILE lets you point a local API at a different catalog (for example a large
// generated one when testing pagination) without touching the committed products.json.
const PRODUCTS_FILE = process.env.PRODUCTS_FILE
  ? path.resolve(process.env.PRODUCTS_FILE)
  : path.join(__dirname, 'products.json');

// In production the UI and API share one origin (IIS/ARR -> Node), and in local dev
// `ng serve` proxies /api and /images to this server (ui/proxy.conf.json), so CORS is
// not normally needed. The ng serve origin is still allowed outside production so a
// build that calls http://localhost:3106 directly keeps working. Registered before the
// body parsers so even a 400 from a malformed body carries the CORS headers.
const corsOrigins = [
  'https://gigagaragesale.socha3.com',
  'http://gigagaragesale.socha3.com'
];
if (process.env.NODE_ENV !== 'production') {
  corsOrigins.push('http://localhost:4200');
}
app.use(cors({ origin: corsOrigins }));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.text());

app.use('/images', express.static(path.join(PUBLIC_DIR, 'images')));
app.use(express.static(PUBLIC_DIR));
if (fs.existsSync(SPA_DIR)) {
  app.use(express.static(SPA_DIR));
}

let products: IProduct[] = [];
let facets: IProductFacets = { merchants: [], brands: [], categories: [] };

function resetProducts() {
  try {
    const raw = fs.readFileSync(PRODUCTS_FILE, 'utf8');
    products = JSON.parse(raw);
    facets = productFacets(products);
  } catch (err) {
    console.error(`Unable to read file: ${PRODUCTS_FILE}`, err);
  }
}

resetProducts();

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    app: 'GigaGarageSale',
    node: process.version,
    port: PORT,
    time: new Date().toISOString()
  });
});

/**
 * GET /api/products
 *
 * Optional filters: q (search), merchant, brand, category, sort
 * (featured | price-asc | price-desc | rating-desc | title-asc).
 *
 * With page and/or pageSize (default 24, max 100) the response is a page:
 *   { items, total, page, pageSize, totalPages }
 * Pagination applies after filtering and sorting. Without either parameter the response
 * is the plain array of every matching product, as before, so older callers keep working.
 */
app.get('/api/products', (req, res) => {
  let query;
  try {
    query = parseProductQuery(req.query as Record<string, unknown>);
  } catch (err) {
    if (err instanceof QueryError) {
      return res.status(400).json({ message: err.message });
    }
    throw err;
  }
  if (isPagedQuery(query)) {
    return res.status(200).json(pageProducts(products, query));
  }
  return res.status(200).json(filterProducts(products, query));
});

/** GET /api/products/facets: distinct merchants, brands and categories for the filter panel. */
app.get('/api/products/facets', (_req, res) => {
  return res.status(200).json(facets);
});

app.get('/api/products/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const product = products.find(p => p.id === id);
  if (product) {
    return res.status(200).json(product);
  }
  return res.status(404).json({ message: `Product with id: ${id} not found.` });
});

app.post('/api/products/reset', (_req, res) => {
  resetProducts();
  console.log('Product inventory reset.');
  res.sendStatus(204);
});

app.get('/{*splat}', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }
  const indexPath = path.join(SPA_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  return res.status(404).send('GigaGarageSale UI not built yet. Run post-deploy / ng build.');
});

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
