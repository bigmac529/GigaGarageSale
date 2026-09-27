import { ComponentFixture, TestBed } from '@angular/core/testing';

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { ProductDetailComponent } from './product-detail.component';

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
    expect(el.querySelector('main')).toBeNull();
    http.verify();
  });
});
