import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { IProduct } from '../../../../shared/i-product';
import { IProductPage } from '../../../../shared/i-product-page';

import { ShopComponent } from './shop.component';
import { ShopMemoryService } from '../shared/shop-memory.service';
import { ShoppingCartService } from '../shared/shopping-cart-service';

function product(id: number): IProduct {
  return {
    id, title: `Product ${id}`, name: `Product ${id}`, brand: 'ASUS', merchant: 'Dan F', category: 'GPU',
    price: 10, imageUrl: `/images/${id}.jpg`, descriptions: [], rating: 4, available: 3
  };
}

describe('ShopComponent', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'shop', component: ShopComponent }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations()
      ]
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => http.verify());

  function flushStartup() {
    http.expectOne('/api/products/reset').flush(null);
    http.expectOne('/api/products/facets').flush({ merchants: ['Dan F'], brands: ['ASUS'], categories: ['GPU'] });
  }

  function flushPage(page: Partial<IProductPage>) {
    const req = http.expectOne(r => r.url === '/api/products');
    req.flush({ items: [], total: 0, page: 1, pageSize: 24, totalPages: 1, ...page });
    return req;
  }

  it('requests the page, filters and sort from the URL', async () => {
    const shop = await harness.navigateByUrl('/shop?page=2&brand=ASUS&sort=price-asc&pageSize=48', ShopComponent);
    flushStartup();
    const req = http.expectOne(r => r.url === '/api/products');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('48');
    expect(req.request.params.get('brand')).toBe('ASUS');
    expect(req.request.params.get('sort')).toBe('price-asc');
    req.flush({ items: [product(49)], total: 49, page: 2, pageSize: 48, totalPages: 2 });
    harness.detectChanges();

    expect(shop.products.length).toBe(1);
    const el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelector('app-pager .summary')?.textContent).toContain('Showing 49–49 of 49');
  });

  it('resets to page 1 when a filter changes', async () => {
    const shop = await harness.navigateByUrl('/shop?page=3', ShopComponent);
    flushStartup();
    flushPage({ items: [product(1)], total: 100, page: 3, totalPages: 5 });

    shop.setFilter('category', 'GPU');
    await harness.fixture.whenStable();
    const req = flushPage({ items: [product(1)], total: 1 });
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('category')).toBe('GPU');
    expect(TestBed.inject(Router).url).toBe('/shop?category=GPU');
  });

  it('shows the empty state when nothing matches', async () => {
    await harness.navigateByUrl('/shop?q=zzz', ShopComponent);
    flushStartup();
    flushPage({ total: 0 });
    harness.detectChanges();
    const el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelector('.notice-title')?.textContent).toContain('No products found');
    expect(el.querySelector('app-pager')).toBeNull();
  });

  it('filters when a merchant name is clicked', async () => {
    await harness.navigateByUrl('/shop', ShopComponent);
    flushStartup();
    flushPage({ items: [product(1)], total: 1 });
    harness.detectChanges();
    const el = harness.routeNativeElement as HTMLElement;
    const merchants = Array.from(el.querySelectorAll('details.filter-group')).find(d => d.querySelector('summary')?.textContent?.includes('Merchants')) as HTMLDetailsElement;
    merchants.querySelector('summary')!.click();
    harness.detectChanges();
    expect(merchants.open).toBeTrue();

    const name = merchants.querySelector('.filterOption .filterText') as HTMLElement;
    expect(name.textContent).toBe('Dan F');
    const rect = name.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, clientX: rect.left + 2, clientY: rect.top + 2, button: 0, detail: 1 };
    name.dispatchEvent(new MouseEvent('mousedown', at));
    document.dispatchEvent(new MouseEvent('mouseup', at));
    name.dispatchEvent(new MouseEvent('click', at));
    await harness.fixture.whenStable();

    const req = flushPage({ items: [product(1)], total: 1 });
    expect(req.request.params.get('merchant')).toBe('Dan F');
    expect(TestBed.inject(Router).url).toBe('/shop?merchant=Dan%20F');
  });

  it('shows skeleton cards until the first page arrives', async () => {
    await harness.navigateByUrl('/shop', ShopComponent);
    flushStartup();
    harness.detectChanges();
    const el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelectorAll('.product-skeleton').length).toBeGreaterThan(0);
    flushPage({ items: [product(1), product(2)], total: 2 });
    harness.detectChanges();
    expect(el.querySelectorAll('.product-skeleton').length).toBe(0);
    expect(el.querySelectorAll('app-product-card').length).toBe(2);
  });

  it('describes the results and counts active filters', async () => {
    const shop = await harness.navigateByUrl('/shop?brand=ASUS&category=GPU&merchant=Dan%20F', ShopComponent);
    flushStartup();
    flushPage({ items: [product(1)], total: 1 });
    harness.detectChanges();
    const el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelector('#resultsTitle')?.textContent?.trim()).toBe('ASUS GPU');
    expect(shop.activeFilterCount).toBe(3);
    expect(el.querySelector('#openFilters .badge')?.textContent?.trim()).toBe('3');
    expect(el.querySelectorAll('.chips .chip').length).toBe(3);
    // Groups with an active filter start expanded.
    expect(Array.from(el.querySelectorAll('details.filter-group')).every(d => (d as HTMLDetailsElement).open)).toBeTrue();
  });

  it('remembers the shop query so product pages can link back to it', async () => {
    await harness.navigateByUrl('/shop?category=GPU&sort=price-asc', ShopComponent);
    flushStartup();
    flushPage({ items: [product(1)], total: 1 });
    expect(TestBed.inject(ShopMemoryService).lastParams).toEqual({ category: 'GPU', sort: 'price-asc' });
  });

  it('opens the filter drawer, traps focus there and closes on Escape', async () => {
    const shop = await harness.navigateByUrl('/shop', ShopComponent);
    flushStartup();
    flushPage({ items: [product(1)], total: 1 });
    shop.isDrawer = true; // as below the drawer breakpoint
    harness.detectChanges();
    const el = harness.routeNativeElement as HTMLElement;
    const openBtn = el.querySelector('#openFilters') as HTMLButtonElement;
    openBtn.focus();
    openBtn.click();
    harness.detectChanges();
    await new Promise(resolve => setTimeout(resolve, 80));

    const panel = el.querySelector('#filterPanel') as HTMLElement;
    expect(shop.filtersOpen).toBeTrue();
    expect(panel.classList).toContain('open');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(openBtn.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close filters');
    expect(document.body.classList).toContain('no-scroll');
    expect(el.querySelectorAll('.cdk-focus-trap-anchor').length).toBeGreaterThan(0);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    harness.detectChanges();
    expect(shop.filtersOpen).toBeFalse();
    expect(panel.classList).not.toContain('open');
    expect(document.activeElement).toBe(openBtn);
    expect(document.body.classList).not.toContain('no-scroll');
  });

  it('quick add on a card puts the product in the cart', async () => {
    await harness.navigateByUrl('/shop', ShopComponent);
    flushStartup();
    const p = product(7);
    flushPage({ items: [p], total: 1 });
    harness.detectChanges();
    const el = harness.routeNativeElement as HTMLElement;
    (el.querySelector('.quick-add') as HTMLButtonElement).click();
    expect(TestBed.inject(ShoppingCartService).numItems).toBe(1);
  });
});
