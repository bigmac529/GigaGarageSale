import { ComponentFixture, TestBed } from '@angular/core/testing';

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { ProductDetailComponent } from './product-detail.component';
import { ShopMemoryService } from '../shared/shop-memory.service';
import { ShoppingCartService } from '../shared/shopping-cart-service';

describe('ProductDetailComponent', () => {
  let component: ProductDetailComponent;
  let fixture: ComponentFixture<ProductDetailComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProductDetailComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ProductDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

describe('ProductDetailComponent with a missing product', () => {
  it('shows a not-found message instead of an empty product page', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'product-detail/:id', component: ProductDetailComponent }]),
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });
    const http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/product-detail/1', ProductDetailComponent);

    http.expectOne('/api/products/reset').flush(null);
    http.expectOne('/api/products/1').flush({ message: 'Product with id: 1 not found.' }, { status: 404, statusText: 'Not Found' });
    await new Promise(resolve => setTimeout(resolve)); // let the rejected getProduct() promise settle
    harness.detectChanges();

    const el: HTMLElement = harness.routeNativeElement!;
    expect(el.querySelector('.not-found')?.textContent).toContain('Product not found');
    expect(el.querySelector('#addToCart')).toBeNull();
    http.verify();
  });
});

describe('ProductDetailComponent with a product', () => {
  const product = () => ({
    id: 5, title: 'Test GPU', name: 'Test GPU 8GB', brand: 'ASUS', merchant: 'Dan F', category: 'GPU',
    price: 100, imageUrl: '/images/5.jpg', descriptions: ['Works great'], rating: 4, available: 3
  });

  async function open() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'product-detail/:id', component: ProductDetailComponent }]),
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });
    TestBed.inject(ShopMemoryService).lastParams = { category: 'GPU', page: '2' };
    const http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    const detail = await harness.navigateByUrl('/product-detail/5', ProductDetailComponent);
    http.expectOne('/api/products/reset').flush(null);
    http.expectOne('/api/products/5').flush(product());
    await new Promise(resolve => setTimeout(resolve));
    harness.detectChanges();
    return { harness, detail, el: harness.routeNativeElement as HTMLElement };
  }

  it('shows the product with a breadcrumb back to the last shop view', async () => {
    const { el } = await open();
    expect(el.querySelector('h1')?.textContent).toContain('Test GPU 8GB');
    expect(el.querySelector('#price')?.textContent).toContain('$100.00');
    expect((el.querySelector('#backToShop') as HTMLAnchorElement).getAttribute('href')).toBe('/shop?category=GPU&page=2');
    expect(el.querySelector('app-star-rating [role="img"]')?.getAttribute('aria-label')).toBe('Rated 4 out of 5');
  });

  it('adds the chosen quantity, capped by stock', async () => {
    const { harness, detail, el } = await open();
    const cart = TestBed.inject(ShoppingCartService);
    detail.setQuantity(10);
    expect(detail.quantity).toBe(3);
    detail.setQuantity(2);
    (el.querySelector('#addToCart') as HTMLButtonElement).click();
    harness.detectChanges();
    expect(cart.numItems).toBe(2);
    expect(detail.product.available).toBe(1);
    expect(el.querySelector('.added')?.textContent).toContain('Added 2');
    expect(detail.quantity).toBe(1);

    (el.querySelector('#addToCart') as HTMLButtonElement).click();
    harness.detectChanges();
    expect(cart.numItems).toBe(3);
    expect((el.querySelector('#addToCart') as HTMLButtonElement).disabled).toBeTrue();
    expect(el.querySelector('.stock')?.textContent).toContain('Out of stock');
  });
});
