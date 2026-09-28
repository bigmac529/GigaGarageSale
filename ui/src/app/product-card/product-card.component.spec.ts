import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { IProduct } from '../../../../shared/i-product';
import { ShoppingCartService } from '../shared/shopping-cart-service';
import { ProductCardComponent } from './product-card.component';

describe('ProductCardComponent', () => {
  let fixture: ComponentFixture<ProductCardComponent>;
  let el: HTMLElement;
  let product: IProduct;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProductCardComponent],
      providers: [provideRouter([])]
    }).compileComponents();
    product = {
      id: 42, title: 'ASUS TUF RTX 3080', name: 'ASUS TUF Gaming GeForce RTX 3080', brand: 'ASUS', merchant: 'Dan F',
      category: 'GPU', price: 268.52, imageUrl: '/images/42.jpg', descriptions: [], rating: 4, available: 1
    };
    fixture = TestBed.createComponent(ProductCardComponent);
    fixture.componentRef.setInput('product', product);
    fixture.detectChanges();
    el = fixture.nativeElement;
  });

  it('shows the category, title link, brand, merchant and price', () => {
    expect(el.querySelector('.kicker')?.textContent).toBe('GPU');
    const link = el.querySelector('a.product-link') as HTMLAnchorElement;
    expect(link.textContent?.trim()).toBe('ASUS TUF RTX 3080');
    expect(link.getAttribute('href')).toBe('/product-detail/42');
    expect(el.querySelector('.meta')?.textContent).toContain('ASUS');
    expect(el.querySelector('.merchant')?.textContent).toBe('Dan F');
    expect(el.querySelector('.price')?.textContent).toContain('$268.52');
    expect(el.querySelector('img')?.getAttribute('src')).toBe('/images/42.jpg');
  });

  it('quick add moves one unit into the cart and disables itself when sold out', () => {
    const button = el.querySelector('.quick-add') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Add ASUS TUF RTX 3080 to cart');
    button.click();
    fixture.detectChanges();
    expect(TestBed.inject(ShoppingCartService).numItems).toBe(1);
    expect(product.available).toBe(0);
    expect(button.disabled).toBeTrue();
    expect(el.querySelector('.stock-flag')?.textContent).toContain('Out of stock');
    expect(button.getAttribute('aria-label')).toContain('out of stock');
  });
});
