import { IProduct } from '../../shared/i-product';
import { IProductFacets, IProductPage, IProductQuery, ProductSort } from '../../shared/i-product-page';

/** Page size used when the caller asks for a page but not a size. */
export const DEFAULT_PAGE_SIZE = 24;
/** Largest page a caller can ask for; bigger requests are clamped to this. */
export const MAX_PAGE_SIZE = 100;

export const SORT_OPTIONS: ProductSort[] = ['featured', 'price-asc', 'price-desc', 'rating-desc', 'title-asc'];

export class QueryError extends Error { }

function single(value: unknown): string | undefined {
  // Express turns ?a=1&a=2 into an array; use the last value like most frameworks do.
  if (Array.isArray(value)) {
    value = value[value.length - 1];
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function positiveInt(name: string, value: unknown): number | undefined {
  const raw = single(value);
  if (raw === undefined) {
    return undefined;
  }
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    throw new QueryError(`${name} must be a positive integer.`);
  }
  return Number(raw);
}

/**
 * Parses GET /api/products query-string parameters. Throws QueryError (-> 400) for
 * values that can't be interpreted; unknown parameters are ignored.
 */
export function parseProductQuery(query: Record<string, unknown>): IProductQuery {
  const sort = single(query['sort']);
  if (sort !== undefined && SORT_OPTIONS.indexOf(sort as ProductSort) === -1) {
    throw new QueryError(`sort must be one of: ${SORT_OPTIONS.join(', ')}.`);
  }
  return {
    q: single(query['q']),
    merchant: single(query['merchant']),
    brand: single(query['brand']),
    category: single(query['category']),
    sort: sort as ProductSort | undefined,
    page: positiveInt('page', query['page']),
    pageSize: positiveInt('pageSize', query['pageSize'])
  };
}

/** True when the caller asked for the paged envelope rather than the legacy array. */
export function isPagedQuery(query: IProductQuery): boolean {
  return query.page !== undefined || query.pageSize !== undefined;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Applies search and filters, then sorts. Does not paginate. */
export function filterProducts(products: IProduct[], query: IProductQuery): IProduct[] {
  const terms = (query.q || '').toLowerCase().split(/\s+/).filter(t => t !== '');

  const matches = products.filter(p =>
    (!query.merchant || same(p.merchant, query.merchant)) &&
    (!query.brand || same(p.brand, query.brand)) &&
    (!query.category || same(p.category, query.category)) &&
    (terms.length === 0 || (() => {
      const haystack = [p.title, p.name, p.brand, p.merchant, p.category].join(' ').toLowerCase();
      return terms.every(t => haystack.indexOf(t) !== -1);
    })())
  );

  // Ties always fall back to id so the order (and therefore every page) is stable.
  const byId = (a: IProduct, b: IProduct) => a.id - b.id;
  const compare: Record<ProductSort, (a: IProduct, b: IProduct) => number> = {
    'featured': byId,
    'price-asc': (a, b) => a.price - b.price || byId(a, b),
    'price-desc': (a, b) => b.price - a.price || byId(a, b),
    'rating-desc': (a, b) => b.rating - a.rating || byId(a, b),
    'title-asc': (a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }) || byId(a, b)
  };
  return matches.sort(compare[query.sort || 'featured']);
}

/** Filters, sorts and returns one page. */
export function pageProducts(products: IProduct[], query: IProductQuery): IProductPage {
  const matches = filterProducts(products, query);
  const pageSize = Math.min(query.pageSize || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const total = matches.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(query.page || 1, totalPages);
  const start = (page - 1) * pageSize;
  return {
    items: matches.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    totalPages
  };
}

/** Distinct, alphabetically sorted filter values for the whole catalog. */
export function productFacets(products: IProduct[]): IProductFacets {
  const distinct = (values: string[]) =>
    Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  return {
    merchants: distinct(products.map(p => p.merchant)),
    brands: distinct(products.map(p => p.brand)),
    categories: distinct(products.map(p => p.category))
  };
}
