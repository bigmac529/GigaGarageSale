import test from 'node:test';
import assert from 'node:assert/strict';
import { IProduct } from '../../shared/i-product';
import {
  MAX_PAGE_SIZE,
  QueryError,
  filterProducts,
  isPagedQuery,
  pageProducts,
  parseProductQuery,
  productFacets
} from './product-query';

const catalog: IProduct[] = Array.from({ length: 50 }, (_, i) => ({
  id: i + 1,
  title: `Item ${String(i + 1).padStart(2, '0')}`,
  name: `Item ${i + 1} full name`,
  brand: i % 2 === 0 ? 'ASUS' : 'MSI',
  merchant: i % 5 === 0 ? "Bob's Code Cave" : 'Dan F',
  category: i < 20 ? 'GPU' : 'RAM',
  price: 100 - i,
  imageUrl: `/images/${(i % 11) + 1}.jpg`,
  descriptions: [],
  rating: (i % 5) + 1,
  available: 5
}));

test('parses and validates query parameters', () => {
  assert.deepEqual(parseProductQuery({ page: '2', pageSize: '10', q: '  rtx ', brand: '' }), {
    q: 'rtx', merchant: undefined, brand: undefined, category: undefined, sort: undefined, page: 2, pageSize: 10
  });
  assert.equal(parseProductQuery({ page: ['1', '3'] }).page, 3);
  for (const bad of [{ page: '0' }, { page: '-1' }, { page: 'abc' }, { pageSize: '2.5' }, { sort: 'cheapest' }]) {
    assert.throws(() => parseProductQuery(bad), QueryError);
  }
});

test('legacy (unpaged) queries are recognised', () => {
  assert.equal(isPagedQuery(parseProductQuery({})), false);
  assert.equal(isPagedQuery(parseProductQuery({ brand: 'ASUS' })), false);
  assert.equal(isPagedQuery(parseProductQuery({ page: '1' })), true);
  assert.equal(isPagedQuery(parseProductQuery({ pageSize: '5' })), true);
});

test('pages the catalog with defaults', () => {
  const first = pageProducts(catalog, { page: 1 });
  assert.equal(first.items.length, 24);
  assert.equal(first.total, 50);
  assert.equal(first.totalPages, 3);
  assert.equal(first.items[0].id, 1);

  const last = pageProducts(catalog, { page: 3 });
  assert.deepEqual(last.items.map(p => p.id), [49, 50]);
});

test('clamps page past the end and pageSize above the max', () => {
  const past = pageProducts(catalog, { page: 99, pageSize: 20 });
  assert.equal(past.page, 3);
  assert.equal(past.items.length, 10);
  assert.equal(pageProducts(catalog, { pageSize: 1000 }).pageSize, MAX_PAGE_SIZE);
});

test('filters before paginating', () => {
  const result = pageProducts(catalog, { brand: 'asus', category: 'GPU', page: 1, pageSize: 4 });
  assert.equal(result.total, 10);
  assert.equal(result.totalPages, 3);
  assert.ok(result.items.every(p => p.brand === 'ASUS' && p.category === 'GPU'));
});

test('empty results still report one page', () => {
  const result = pageProducts(catalog, { q: 'nothing matches this', page: 1 });
  assert.deepEqual(result, { items: [], total: 0, page: 1, pageSize: 24, totalPages: 1 });
});

test('search matches every term across fields', () => {
  assert.deepEqual(filterProducts(catalog, { q: 'item 07' }).map(p => p.id), [7]);
  assert.equal(filterProducts(catalog, { q: "bob's gpu" }).length, 4);
});

test('sorts with a stable id tie-break', () => {
  assert.equal(filterProducts(catalog, { sort: 'price-asc' })[0].id, 50);
  assert.equal(filterProducts(catalog, { sort: 'price-desc' })[0].id, 1);
  const byRating = filterProducts(catalog, { sort: 'rating-desc' });
  assert.deepEqual(byRating.slice(0, 3).map(p => p.id), [5, 10, 15]);
  assert.equal(filterProducts(catalog, { sort: 'title-asc' })[0].title, 'Item 01');
});

test('does not mutate the source array', () => {
  const before = catalog.map(p => p.id);
  filterProducts(catalog, { sort: 'price-asc' });
  assert.deepEqual(catalog.map(p => p.id), before);
});

test('facets are distinct and sorted', () => {
  assert.deepEqual(productFacets(catalog), {
    merchants: ["Bob's Code Cave", 'Dan F'],
    brands: ['ASUS', 'MSI'],
    categories: ['GPU', 'RAM']
  });
});
