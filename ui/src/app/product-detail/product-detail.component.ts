import { Component, DestroyRef, inject } from '@angular/core';
import { ActivatedRoute, Params, RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CurrencyPipe } from '@angular/common';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { IProduct } from '../../../../shared/i-product';
import { ProductsService } from '../shared/products-service';
import { StarRatingComponent } from '../star-rating/star-rating.component';
import { ShoppingCartService } from '../shared/shopping-cart-service';
import { ShopMemoryService } from '../shared/shop-memory.service';
import { IconComponent } from '../shared/icon/icon.component';

@Component({
  selector: 'app-product-detail',
  imports: [RouterModule, CurrencyPipe, StarRatingComponent, IconComponent],
  templateUrl: './product-detail.component.html',
  styleUrl: './product-detail.component.scss'
})
export class ProductDetailComponent {

  activatedRoute: ActivatedRoute = inject(ActivatedRoute);
  productSvc: ProductsService = inject(ProductsService);
  cartSvc: ShoppingCartService = inject(ShoppingCartService);
  private memory = inject(ShopMemoryService);
  private announcer = inject(LiveAnnouncer);

  product: IProduct = null;

  /** Set when the API has no product with the requested id (e.g. an old link to a removed item). */
  notFound: boolean = false;

  /** How many units the next "Add to cart" adds. */
  quantity: number = 1;

  /** Units added by the last "Add to cart" on this page (drives the confirmation). */
  lastAdded: number = 0;

  private id = 0;

  /** Query params of the shop view the shopper came from (filters, sort, page). */
  get shopParams(): Params {
    return this.memory.lastParams;
  }

  get maxQuantity(): number {
    return Math.max(1, this.product?.available ?? 1);
  }

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.activatedRoute.params.pipe(takeUntilDestroyed(destroyRef)).subscribe({
      next: (params: Params) => this.load(parseInt(params['id'])),
      error: (error) => {
        console.error('Error fetching route params:', error);
      }
    });
    // After the demo inventory reset, show fresh stock for this product.
    this.productSvc.inventoryReset$.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => this.load(this.id));
  }

  private load(id: number) {
    this.id = id;
    this.product = null;
    this.notFound = false;
    this.quantity = 1;
    this.lastAdded = 0;
    this.productSvc.getProduct(id)
      .then(product => {
        this.product = product;
      })
      .catch(error => {
        this.notFound = true;
        console.error(`Product with id ${id} not found`, error);
      });
  }

  setQuantity(value: number): void {
    this.quantity = Math.min(Math.max(1, value), this.maxQuantity);
  }

  /** Moves `quantity` units (never more than are in stock) from stock into the cart. */
  addToCart(): void {
    if (!this.product || this.product.available <= 0) {
      return;
    }
    const units = Math.min(this.quantity, this.product.available);
    for (let i = 0; i < units; i++) {
      this.product.available--;
      this.cartSvc.addItem(this.product);
    }
    this.lastAdded = units;
    this.quantity = 1;
    this.announcer.announce(`Added ${units} × ${this.product.title} to your cart`);
  }
}
