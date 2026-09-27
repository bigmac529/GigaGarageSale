import { Component, Input, inject } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { IProduct } from '../../../../shared/i-product';
import { Params } from '@angular/router';
import { ProductsService } from '../shared/products-service';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StarRatingComponent } from '../star-rating/star-rating.component';
import { ShoppingCartService } from '../shared/shopping-cart-service';

@Component({
  selector: 'app-product-detail',
  imports: [RouterModule, CurrencyPipe, FormsModule, CommonModule, StarRatingComponent],
  templateUrl: './product-detail.component.html',
  styleUrl: './product-detail.component.scss'
})
export class ProductDetailComponent {

  activatedRoute: ActivatedRoute = inject(ActivatedRoute);
  productSvc: ProductsService = inject(ProductsService);
  cartSvc: ShoppingCartService = inject(ShoppingCartService);

  product: IProduct = null;

  /** Set when the API has no product with the requested id (e.g. an old link to a removed item). */
  notFound: boolean = false;

  addQuantity: number = 0;

  constructor() {
    this.activatedRoute.params.subscribe({
      next: (params: Params) => {
        const id = parseInt(params['id']);
        this.product = null;
        this.notFound = false;
        this.productSvc.getProduct(id)
          .then(product => {
            this.product = product;
          })
          .catch(error => {
            this.notFound = true;
            console.error(`Product with id ${id} not found`, error);
          });
      },
      error: (error) => {
        console.error('Error fetching route params:', error);
      }
    });
  }

  addToCart(): void {
    if (this.product && this.product.available > 0) {
      this.product.available--;
      this.cartSvc.addItem(this.product);
    }
  }
}
