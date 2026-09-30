import { IProduct } from '../../../shared/i-product';

/** The CatalogInfo row written by the seed script. */
export interface CatalogInfo {
  version: string;
  productCount: number;
  imageCount: number;
  seededUtc: string;
  seededBy: string;
}

/** Image metadata (everything except the bytes). */
export interface ImageMeta {
  name: string;
  contentType: string;
  byteLength: number;
  sha256: string;
  updatedUtc: string;
}

export interface LoginPermissions {
  /** True when the connection cannot change data or schema. */
  readOnly: boolean;
  /** Login / user the database sees. */
  login: string;
  /** Write-type permissions the login does have (empty when readOnly). */
  writable: string[];
}

/**
 * Read-only access to the catalog database. This is the ONLY database interface the
 * running API uses, and it deliberately has no method that writes: every implementation
 * runs a fixed set of SELECT statements. Writing (schema + seed) lives in api/scripts/,
 * which the API never imports.
 */
export interface CatalogReader {
  readonly provider: 'sqlserver' | 'sqlite';
  /** null when the database has never been seeded. */
  readCatalogInfo(): Promise<CatalogInfo | null>;
  readProducts(): Promise<IProduct[]>;
  readImageIndex(): Promise<ImageMeta[]>;
  /** null when there is no image with that name. */
  readImageContent(name: string): Promise<Buffer | null>;
  readPermissions(): Promise<LoginPermissions>;
  close(): Promise<void>;
}

/** Method names a CatalogReader may expose; tests assert nothing else exists. */
export const READER_METHODS = [
  'readCatalogInfo', 'readProducts', 'readImageIndex', 'readImageContent', 'readPermissions', 'close'
];

/** Tables the reader selects from (also used for permission checks). */
export const CATALOG_TABLES = ['Products', 'ProductDescriptions', 'Images', 'CatalogInfo'];

export interface ProductRow {
  Id: number;
  Name: string;
  Title: string;
  Brand: string;
  Price: number;
  ImageUrl: string;
  Category: string;
  Rating: number;
  Merchant: string;
  Available: number;
}

export interface DescriptionRow {
  ProductId: number;
  Ordinal: number;
  Text: string;
}

/**
 * Builds IProduct objects with the same key order as products.json, so the JSON the API
 * sends is byte-for-byte what JSON mode sends.
 */
export function assembleProducts(rows: ProductRow[], descriptions: DescriptionRow[]): IProduct[] {
  const byProduct = new Map<number, string[]>();
  for (const d of descriptions) {
    let list = byProduct.get(d.ProductId);
    if (!list) {
      list = [];
      byProduct.set(d.ProductId, list);
    }
    list.push(d.Text);
  }
  return rows.map(r => ({
    id: Number(r.Id),
    name: r.Name,
    title: r.Title,
    brand: r.Brand,
    price: Number(r.Price),
    imageUrl: r.ImageUrl,
    category: r.Category,
    descriptions: byProduct.get(Number(r.Id)) || [],
    rating: Number(r.Rating),
    merchant: r.Merchant,
    available: Number(r.Available)
  }));
}

// The complete list of statements the API runs. SELECT only.
export const SELECT_PRODUCTS =
  'SELECT Id, Name, Title, Brand, Price, ImageUrl, Category, Rating, Merchant, Available FROM Products ORDER BY Id';
export const SELECT_DESCRIPTIONS =
  'SELECT ProductId, Ordinal, Text FROM ProductDescriptions ORDER BY ProductId, Ordinal';
export const SELECT_IMAGE_INDEX =
  'SELECT Name, ContentType, ByteLength, Sha256, UpdatedUtc FROM Images ORDER BY Name';
export const SELECT_CATALOG_INFO =
  'SELECT Version, ProductCount, ImageCount, SeededUtc, SeededBy FROM CatalogInfo WHERE Id = 1';
