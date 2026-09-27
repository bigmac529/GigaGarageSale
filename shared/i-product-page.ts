import { IProduct } from './i-product';

/** Sort orders understood by GET /api/products (`featured` is catalog/id order). */
export type ProductSort = 'featured' | 'price-asc' | 'price-desc' | 'rating-desc' | 'title-asc';

/** Query-string parameters accepted by GET /api/products. */
export interface IProductQuery {
  /** Free-text search; every whitespace-separated term must appear in the title, name, brand, merchant or category. */
  q?: string;
  merchant?: string;
  brand?: string;
  category?: string;
  sort?: ProductSort;
  /** 1-based page number. */
  page?: number;
  pageSize?: number;
}

/** GET /api/products response when page and/or pageSize is supplied. */
export interface IProductPage {
  items: IProduct[];
  /** Number of products matching the filters, across every page. */
  total: number;
  /** The page actually returned (a page past the end is clamped to the last page). */
  page: number;
  pageSize: number;
  /** Always at least 1, even when nothing matches. */
  totalPages: number;
}

/** GET /api/products/facets response: distinct filter values for the whole catalog. */
export interface IProductFacets {
  merchants: string[];
  brands: string[];
  categories: string[];
}
