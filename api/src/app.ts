import {
  QueryError,
  isPagedQuery,
  filterProducts,
  pageProducts,
  parseProductQuery
} from './product-query';
import { Catalog, DbCatalog } from './catalog';
import path from 'path';
import fs from 'fs';
import express from 'express';
import cors from 'cors';

const ROOT = path.resolve(__dirname, '..');
export const PUBLIC_DIR = path.join(ROOT, 'public');
const SPA_DIR = path.join(PUBLIC_DIR, 'spa');

/**
 * Images from the database are served with a strong ETag (the SHA-256 of the bytes), so a
 * revalidation costs a 304 without touching the database. Image URLs are not versioned
 * (/images/12.jpg), so the max-age is a week rather than a year: a re-seeded image
 * reaches every browser within a week, sooner on a hard refresh.
 */
export const IMAGE_CACHE_CONTROL = 'public, max-age=604800';

export interface AppOptions {
  catalog: Catalog;
  port: number;
}

export function createApp({ catalog, port }: AppOptions) {
  const app = express();

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

  if (catalog.servesImages) {
    // Database mode: /images/<name> comes from the Images table only. The files that are
    // still shipped in api/public/images (the seed input and JSON-mode fallback) are never
    // served, so the database is the single source of truth.
    const db = catalog as DbCatalog;
    app.use('/images', async (req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return next();
      }
      let name: string;
      try {
        name = decodeURIComponent(req.path.replace(/^\//, ''));
      } catch {
        return next();
      }
      const meta = db.imageMeta(name);
      if (!meta) {
        return next(); // -> 404, like a missing file in JSON mode
      }
      res.setHeader('Content-Type', meta.contentType);
      res.setHeader('Cache-Control', IMAGE_CACHE_CONTROL);
      res.setHeader('ETag', `"${meta.sha256}"`);
      res.setHeader('Last-Modified', new Date(meta.updatedUtc).toUTCString());
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.fresh) {
        return res.status(304).end();
      }
      const image = await catalog.image(name);
      if (!image) {
        res.removeHeader('ETag');
        res.removeHeader('Last-Modified');
        res.removeHeader('Cache-Control');
        return next();
      }
      res.setHeader('Content-Length', String(image.content.length));
      return res.status(200).end(req.method === 'HEAD' ? undefined : image.content);
    });
  } else {
    app.use('/images', express.static(path.join(PUBLIC_DIR, 'images')));
  }
  const publicFiles = express.static(PUBLIC_DIR);
  app.use((req, res, next) => {
    // In database mode the /images/* files on disk must not leak through the generic
    // static handler either.
    if (catalog.servesImages && req.path.startsWith('/images/')) {
      return next();
    }
    return publicFiles(req, res, next);
  });
  if (fs.existsSync(SPA_DIR)) {
    app.use(express.static(SPA_DIR));
  }

  const unavailable = (res: express.Response) =>
    res.status(503).json({ message: 'The product catalog is not available right now. Try again shortly.' });

  /**
   * GET /api/health: 200 when the app can serve the catalog. In database mode it also
   * checks the connection, that the database is seeded and that the login is read-only,
   * and answers 503 (ok: false, with db.problems) if any of that fails.
   */
  app.get('/api/health', async (_req, res) => {
    const health = await catalog.health();
    res.status(health.ok ? 200 : 503).json({
      ok: health.ok,
      app: 'GigaGarageSale',
      node: process.version,
      port,
      time: new Date().toISOString(),
      catalog: health.catalog,
      db: health.db
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
    const snapshot = catalog.current();
    if (!snapshot) {
      return unavailable(res);
    }
    if (isPagedQuery(query)) {
      return res.status(200).json(pageProducts(snapshot.products, query));
    }
    return res.status(200).json(filterProducts(snapshot.products, query));
  });

  /** GET /api/products/facets: distinct merchants, brands and categories for the filter panel. */
  app.get('/api/products/facets', (_req, res) => {
    const snapshot = catalog.current();
    if (!snapshot) {
      return unavailable(res);
    }
    return res.status(200).json(snapshot.facets);
  });

  app.get('/api/products/:id', (req, res) => {
    const snapshot = catalog.current();
    if (!snapshot) {
      return unavailable(res);
    }
    const id = Number.parseInt(req.params.id, 10);
    const product = snapshot.products.find(p => p.id === id);
    if (product) {
      return res.status(200).json(product);
    }
    return res.status(404).json({ message: `Product with id: ${id} not found.` });
  });

  /**
   * POST /api/products/reset: the UI's "reset inventory" (also sent on every app load).
   * The server holds no stock or cart state, so this only re-syncs the in-memory catalog
   * with its source: JSON mode re-reads products.json, database mode re-reads the catalog
   * if a newer seed has been committed. It never writes anything, least of all to the database.
   */
  app.post('/api/products/reset', async (_req, res) => {
    await catalog.reset();
    console.log('Product inventory reset.');
    res.sendStatus(204);
  });

  app.get('/{*splat}', (req, res, next) => {
    // A missing API route or image (e.g. /images/1.jpg for a removed product) is a real 404,
    // not the SPA shell.
    if (req.path.startsWith('/api/') || req.path.startsWith('/images/')) {
      return next();
    }
    const indexPath = path.join(SPA_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      return res.sendFile(indexPath);
    }
    return res.status(404).send('GigaGarageSale UI not built yet. Run post-deploy / ng build.');
  });

  return app;
}
