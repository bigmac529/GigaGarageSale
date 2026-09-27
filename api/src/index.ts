import { IProduct } from '../../shared/i-product';
import path from 'path';
import fs from 'fs';
import http from 'http';
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

const server = http.createServer(app);
server.listen(PORT, '127.0.0.1', () => {
  console.log(`GigaGarageSale API listening on http://127.0.0.1:${PORT}`);
});
