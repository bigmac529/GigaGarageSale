// Helpers shared by the catalog tests (not used by the running API).
import http from 'http';
import { AddressInfo } from 'net';
import express from 'express';

export interface Running {
  base: string;
  close(): Promise<void>;
}

export function listen(app: express.Express): Promise<Running> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>(done => {
          server.closeAllConnections?.();
          server.close(() => done());
        })
      });
    });
  });
}

/** Read-only endpoints whose responses must be identical in JSON and database mode. */
export const COMPARED_URLS = [
  '/api/products',
  '/api/products?page=1',
  '/api/products?page=3&pageSize=50&sort=price-asc',
  '/api/products?pageSize=100&sort=price-desc&page=2',
  '/api/products?q=monitor&sort=title-asc&pageSize=100',
  '/api/products?q=lg%20monitor',
  '/api/products?brand=LG',
  '/api/products?merchant=Pixel%20Pete&category=Speaker',
  '/api/products?category=gpu&sort=rating-desc&page=999',
  '/api/products?sort=title-asc',
  '/api/products?page=0',
  '/api/products?sort=cheapest',
  '/api/products/facets',
  '/api/products/12',
  '/api/products/1089',
  '/api/products/999999',
  '/api/products/abc',
  '/api/nope',
  '/images/999999.jpg',
  '/images/',
  '/images/..%2Fsrc%2Fproducts.json',
  '/images/../src/products.json'
];

export interface Captured {
  status: number;
  contentType: string | null;
  body: string;
}

export async function capture(base: string, url: string, init?: RequestInit): Promise<Captured> {
  const res = await fetch(base + url, init);
  const body = await res.text();
  const type = res.headers.get('content-type');
  // Express's 404 page embeds the path; that is the same in both modes too.
  return { status: res.status, contentType: type, body };
}

/** GET without fetch()'s automatic headers. */
export function rawGet(url: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}
