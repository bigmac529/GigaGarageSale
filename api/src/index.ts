import { IProduct } from '../../shared/i-product';
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
const PRODUCTS_FILE = path.join(__dirname, 'products.json');

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.text());

app.use(cors({
  origin: [
    'http://localhost:4200',
    'https://gigagaragesale.socha3.com',
    'http://gigagaragesale.socha3.com'
  ]
}));

app.use('/images', express.static(path.join(PUBLIC_DIR, 'images')));
app.use(express.static(PUBLIC_DIR));
if (fs.existsSync(SPA_DIR)) {
  app.use(express.static(SPA_DIR));
}

let products: IProduct[] = [];

function resetProducts() {
  try {
    const raw = fs.readFileSync(PRODUCTS_FILE, 'utf8');
    products = JSON.parse(raw);
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

app.get('/api/products', (_req, res) => {
  return res.status(200).json(products);
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
