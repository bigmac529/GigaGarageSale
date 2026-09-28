import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnDestroy, inject } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { IProduct } from '../../../../shared/i-product';
import { ShoppingCartService } from '../shared/shopping-cart-service';
import { IconComponent } from '../shared/icon/icon.component';

/** A product tile for the shop grid, with a quick add-to-cart button. */
@Component({
  selector: 'app-product-card',
  imports: [RouterModule, CurrencyPipe, IconComponent],
  templateUrl: './product-card.component.html',
  styleUrl: './product-card.component.scss',
  changeDetection: ChangeDetectionStrategy.Default
})
export class ProductCardComponent implements OnDestroy {
  @Input({ required: true }) product!: IProduct;

  private readonly cartSvc = inject(ShoppingCartService);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly cdr = inject(ChangeDetectorRef);
  private timer?: ReturnType<typeof setTimeout>;

  /** Briefly true after a quick add, to show a check mark. */
  justAdded = false;

  get soldOut(): boolean {
    return this.product.available <= 0;
  }

  /** Same rule as the product page: take one unit from stock and put it in the cart. */
  addToCart(): void {
    if (this.soldOut) {
      return;
    }
    this.product.available--;
    this.cartSvc.addItem(this.product);
    this.announcer.announce(`Added ${this.product.title} to your cart`);
    this.justAdded = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.justAdded = false;
      this.cdr.markForCheck();
    }, 1400);
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }
}
