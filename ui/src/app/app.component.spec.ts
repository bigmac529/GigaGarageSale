import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { AppComponent } from './app.component';
import { ShoppingCartService } from './shared/shopping-cart-service';
import { IProduct } from '../../../shared/i-product';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations()]
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it(`should have the 'GigaGarageSale' title`, () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app.title).toEqual('GigaGarageSale');
  });

  it('should render the header search', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('#txtSearch')).toBeTruthy();
    expect(compiled.querySelector('label[for="txtSearch"]')?.textContent).toContain('Search products');
  });

  it('has landmarks, a skip link and the inventory reset notice', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('header nav[aria-label="Main"]')).toBeTruthy();
    expect(el.querySelector('main#main')).toBeTruthy();
    expect(el.querySelector('footer')).toBeTruthy();
    expect(el.querySelector('a.skip-link')?.getAttribute('href')).toBe('#main');
    expect(el.querySelector('app-fade-out-text')?.textContent).toContain('Product inventory reset');
  });

  it('labels the cart link with the item count and hides the badge when empty', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const link = el.querySelector('a.cart-link') as HTMLAnchorElement;
    expect(link.getAttribute('aria-label')).toBe('Cart, 0 items');
    expect(el.querySelector('#numCartItems')?.classList).toContain('empty');

    TestBed.inject(ShoppingCartService).addItem({ id: 1, price: 5, available: 1 } as IProduct);
    fixture.detectChanges();
    expect(link.getAttribute('aria-label')).toBe('Cart, 1 item');
    expect(el.querySelector('#numCartItems')?.textContent?.trim()).toBe('1');
    expect(el.querySelector('#numCartItems')?.classList).not.toContain('empty');
  });

  it('footer reset empties the cart and resets the server inventory', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const cart = TestBed.inject(ShoppingCartService);
    cart.addItem({ id: 1, price: 5, available: 1 } as IProduct);
    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('#resetInventory') as HTMLButtonElement).click();
    TestBed.inject(HttpTestingController).expectOne(r => r.method === 'POST' && r.url === '/api/products/reset').flush(null);
    fixture.detectChanges();
    expect(cart.numItems).toBe(0);
    expect(el.querySelector('app-fade-out-text')?.textContent).toContain('Your cart was emptied');
  });
});
