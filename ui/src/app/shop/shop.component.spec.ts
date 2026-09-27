import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { IProduct } from '../../../../shared/i-product';
import { IProductPage } from '../../../../shared/i-product-page';

import { ShopComponent } from './shop.component';

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
    (el.querySelector('mat-expansion-panel-header') as HTMLElement).click();
    harness.detectChanges();

    const name = el.querySelector('.filterOption .filterText') as HTMLElement;
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
});
