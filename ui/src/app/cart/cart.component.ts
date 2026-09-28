import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { ShoppingCartService } from '../shared/shopping-cart-service';
import { IShoppingCartItem } from '../shared/i-shopping-cart-item';
import { ShopMemoryService } from '../shared/shop-memory.service';
import { IconComponent } from '../shared/icon/icon.component';

@Component({
  selector: 'app-cart',
  imports: [CurrencyPipe, RouterModule, IconComponent],
  templateUrl: './cart.component.html',
  styleUrl: './cart.component.scss'
})
export class CartComponent {
  readonly cartSvc: ShoppingCartService = inject(ShoppingCartService);
  readonly router = inject(Router);
  private readonly memory = inject(ShopMemoryService);

  @ViewChild('checkoutDialog') checkoutDialog?: ElementRef<HTMLDialogElement>;

  /** Confirmation number shown in the checkout dialog. */
  orderConfirmationNumber = '';

  /** Query params of the last shop view, so "Continue shopping" returns to it. */
  get shopParams() {
    return this.memory.lastParams;
  }

  /** Adds one more of the item, respecting stock (same rule as the product page). */
  increase(item: IShoppingCartItem): void {
    if (item.product.available > 0) {
      item.product.available--;
      this.cartSvc.addItem(item.product);
    }
  }

  /** Removes one unit; the line disappears when it reaches zero. */
  decrease(item: IShoppingCartItem): void {
    this.cartSvc.removeItem(item.product);
  }

  /** Removes the whole line, returning every unit to stock. */
  removeLine(item: IShoppingCartItem): void {
    for (let i = item.quantity; i > 0; i--) {
      this.cartSvc.removeItem(item.product);
    }
  }

  /** Shows the order confirmation; closing it (OK, Escape) empties the cart and returns to the shop. */
  checkout(): void {
    this.orderConfirmationNumber = Math.floor(Math.random() * 1000000).toString();
    const dialog = this.checkoutDialog?.nativeElement;
    if (dialog?.showModal) {
      dialog.showModal();
    } else {
      this.finishCheckout();
    }
  }

  finishCheckout(): void {
    this.cartSvc.clearCart();
    this.router.navigate(['/shop']);
  }
}
