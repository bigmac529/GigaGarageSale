import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { IProduct } from '../../../shared/i-product';

export interface SeedImage {
  name: string;
  contentType: string;
  byteLength: number;
  sha256: string;
  content: Buffer;
}

export interface SeedData {
  products: IProduct[];
  images: SeedImage[];
  /** SHA-256 over every product and image; stored in CatalogInfo.Version. */
  version: string;
  warnings: string[];
}

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml'
};

const sha256 = (data: Buffer | string) => crypto.createHash('sha256').update(data).digest('hex');

function check(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Invalid seed data: ${message}`);
  }
}

/** Validates one product from products.json and returns it with the canonical key order. */
function normalizeProduct(p: any, index: number): IProduct {
  const where = `product #${index + 1}${p && p.id !== undefined ? ` (id ${p.id})` : ''}`;
  check(p && typeof p === 'object', `${where} is not an object`);
  check(Number.isInteger(p.id) && p.id > 0, `${where}: id must be a positive integer`);
  for (const f of ['name', 'title', 'brand', 'imageUrl', 'category', 'merchant']) {
    check(typeof p[f] === 'string' && p[f].trim() !== '', `${where}: ${f} must be a non-empty string`);
  }
  check(typeof p.price === 'number' && p.price >= 0 && Math.round(p.price * 100) / 100 === p.price,
    `${where}: price must be a non-negative number with at most 2 decimals`);
  check(typeof p.rating === 'number' && p.rating >= 0 && p.rating <= 5 && Math.round(p.rating * 100) / 100 === p.rating,
    `${where}: rating must be a number from 0 to 5 with at most 2 decimals`);
  check(Number.isInteger(p.available) && p.available >= 0, `${where}: available must be a non-negative integer`);
  check(Array.isArray(p.descriptions) && p.descriptions.every((d: unknown) => typeof d === 'string'),
    `${where}: descriptions must be an array of strings`);
  const lengths: Record<string, number> = { name: 400, title: 200, brand: 100, imageUrl: 400, category: 100, merchant: 100 };
  for (const f of Object.keys(lengths)) {
    check(p[f].length <= lengths[f], `${where}: ${f} is longer than ${lengths[f]} characters`);
  }
  check(p.descriptions.every((d: string) => d.length <= 1000), `${where}: a description is longer than 1000 characters`);
  return {
    id: p.id,
    name: p.name,
    title: p.title,
    brand: p.brand,
    price: p.price,
    imageUrl: p.imageUrl,
    category: p.category,
    descriptions: p.descriptions.slice(),
    rating: p.rating,
    merchant: p.merchant,
    available: p.available
  };
}

/** Reads and validates the seed input: products.json and every image file in imagesDir. */
export function loadSeedData(productsFile: string, imagesDir: string): SeedData {
  const warnings: string[] = [];
  const raw = JSON.parse(fs.readFileSync(productsFile, 'utf8'));
  check(Array.isArray(raw), `${productsFile} must contain a JSON array`);
  const products = (raw as unknown[]).map(normalizeProduct).sort((a, b) => a.id - b.id);
  const ids = new Set<number>();
  for (const p of products) {
    check(!ids.has(p.id), `duplicate product id ${p.id}`);
    ids.add(p.id);
  }

  const images: SeedImage[] = [];
  for (const name of fs.readdirSync(imagesDir).sort()) {
    const full = path.join(imagesDir, name);
    const contentType = CONTENT_TYPES[path.extname(name).toLowerCase()];
    if (!contentType || !fs.statSync(full).isFile()) {
      warnings.push(`skipped ${full} (not an image file)`);
      continue;
    }
    check(name.length <= 260, `image file name ${name} is longer than 260 characters`);
    const content = fs.readFileSync(full);
    images.push({ name, contentType, byteLength: content.length, sha256: sha256(content), content });
  }

  const imageNames = new Set(images.map(i => i.name));
  for (const p of products) {
    const m = /^\/images\/(.+)$/.exec(p.imageUrl);
    if (!m) {
      warnings.push(`product ${p.id}: imageUrl ${p.imageUrl} is not under /images/, so it is not served from the database`);
    } else if (!imageNames.has(m[1])) {
      warnings.push(`product ${p.id}: image ${m[1]} not found in ${imagesDir} (it will 404)`);
    }
  }

  const version = sha256(JSON.stringify(products) + '\n' + images.map(i => `${i.name}:${i.contentType}:${i.sha256}`).join('\n'));
  return { products, images, version, warnings };
}
