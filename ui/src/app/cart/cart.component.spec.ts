import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { IProduct } from '../../../../shared/i-product';
import { ShoppingCartService } from '../shared/shopping-cart-service';
import { CartComponent } from './cart.component';

function product(id: number, available = 2): IProduct {
  return {
    id, title: `Product ${id}`, name: `Product ${id}`, brand: 'ASUS', merchant: 'Dan F', category: 'GPU',
    price: 10 * id, imageUrl: `/images/${id}.jpg`, descriptions: [], rating: 4, available
  };
}

describe('CartComponent', () => {
  let component: CartComponent;
  let fixture: ComponentFixture<CartComponent>;
  let cart: ShoppingCartService;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CartComponent],
      providers: [provideRouter([])]
    })
    .compileComponents();

    cart = TestBed.inject(ShoppingCartService);
    fixture = TestBed.createComponent(CartComponent);
    component = fixture.componentInstance;
    el = fixture.nativeElement;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows the empty state with no items', () => {
    expect(el.querySelector('.empty .notice-title')?.textContent).toContain('Your cart is empty');
    expect(el.querySelector('.cart-items')).toBeNull();
  });

  function addTwo() {
    const a = product(1), b = product(2);
    a.available--; cart.addItem(a);
    b.available--; cart.addItem(b);
    fixture.detectChanges();
    return [a, b];
  }

  it('lists items with quantities and an order summary', () => {
    addTwo();
    expect(el.querySelectorAll('.cart-item').length).toBe(2);
    expect(el.querySelector('.page-head .count')?.textContent).toContain('2 items');
    expect(el.querySelector('.row.total')?.textContent).toContain('$30.00');
  });

  it('steps quantities within stock and removes lines', () => {
    const [a] = addTwo();
    const first = () => el.querySelectorAll('.cart-item')[0] as HTMLElement;
    const plus = () => first().querySelector('button[aria-label^="Increase"]') as HTMLButtonElement;
    plus().click(); fixture.detectChanges();
    expect(first().querySelector('.qty')?.textContent?.trim()).toBe('2');
    expect(a.available).toBe(0);
    expect(plus().disabled).toBeTrue();

    (first().querySelector('button[aria-label^="Decrease"]') as HTMLButtonElement).click(); fixture.detectChanges();
    expect(first().querySelector('.qty')?.textContent?.trim()).toBe('1');
    expect(a.available).toBe(1);

    (first().querySelector('.remove') as HTMLButtonElement).click(); fixture.detectChanges();
    expect(el.querySelectorAll('.cart-item').length).toBe(1);
    expect(a.available).toBe(2);
    expect(cart.numItems).toBe(1);
  });

  it('checkout shows a confirmation; closing it empties the cart and returns to the shop', async () => {
    addTwo();
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    (el.querySelector('#checkout') as HTMLButtonElement).click();
    fixture.detectChanges();
    const dialog = el.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBeTrue();
    expect(dialog.textContent).toMatch(/Order confirmation #\d+/);

    dialog.close();
    await new Promise(resolve => setTimeout(resolve, 20)); // the close event is queued
    expect(cart.numItems).toBe(0);
    expect(navigate).toHaveBeenCalledWith(['/shop']);
  });
});
