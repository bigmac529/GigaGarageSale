import { Component, Input } from '@angular/core';
import { IProduct } from '../../../../shared/i-product';
import { IconComponent } from '../shared/icon/icon.component';

/** Five-star rating display (1-5), announced as "Rated N out of 5". */
@Component({
  selector: 'app-star-rating',
  imports: [IconComponent],
  templateUrl: './star-rating.component.html',
  styleUrl: './star-rating.component.scss'
})
export class StarRatingComponent {

  readonly stars = [1, 2, 3, 4, 5];

  _product: IProduct = {} as IProduct;
  get product(): IProduct {
    return this._product;
  }
  @Input()
  set product(value: IProduct) {
    this._product = value;
  }

  get rating(): number {
    return Math.max(0, Math.min(5, Math.round(this._product?.rating ?? 0)));
  }
}
