import { Component, inject, OnInit } from '@angular/core';
import { RouterOutlet, RouterModule, Router, NavigationEnd } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent, MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { MatInputModule } from '@angular/material/input';
import { FormControl } from '@angular/forms';
import { Observable, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, filter, map, startWith, switchMap } from 'rxjs/operators';
import { ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { IProduct } from '../../../shared/i-product';
import { ProductsService } from './shared/products-service';
import { FadeOutTextComponent } from "./fade-out-text/fade-out-text.component";
import { ShoppingCartService } from './shared/shopping-cart-service';


@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterModule,
    FormsModule,
    MatAutocompleteModule,
    MatInputModule,
    ReactiveFormsModule,
    CommonModule,
    FadeOutTextComponent
],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
  title = 'GigaGarageSale';
  txtSearch = new FormControl<string | IProduct>('');
  filteredOptions: Observable<IProduct[]>;
  router: Router = inject(Router);
  productsSvc: ProductsService = inject(ProductsService);
  cartSvc: ShoppingCartService = inject(ShoppingCartService);

  ngOnInit() {
    // Suggestions come from the server (search runs there), so the catalog is never
    // downloaded in full.
    this.filteredOptions = this.txtSearch.valueChanges.pipe(
      startWith(''),
      map(value => typeof value === 'string' ? value.trim() : ''),
      debounceTime(150),
      distinctUntilChanged(),
      switchMap(text => this.productsSvc.search(text).pipe(
        catchError(err => {
          console.error('Could not load search suggestions.', err);
          return of([] as IProduct[]);
        })
      ))
    );

    // Reset search text box after navigating (to a product, or to search results)
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe({
      next: () => {
        this.txtSearch.setValue('');
      }
    });
  }

  displayTitle(product: IProduct | string | null): string {
    return typeof product === 'string' ? product : product?.title ?? '';
  }

  /** Choosing a suggestion opens that product. */
  public selectSuggestion(event: MatAutocompleteSelectedEvent) {
    this.navigateProduct((event.option.value as IProduct).id);
  }

  public navigateProduct(id: number) {
    this.router.navigate(['/product-detail', id]);
  }

  /** Enter without a highlighted suggestion shows every match on the shop page (page 1). */
  public searchAll(trigger: MatAutocompleteTrigger) {
    const value = this.txtSearch.value;
    if (trigger.activeOption || typeof value !== 'string') {
      return;
    }
    trigger.closePanel();
    // A header search starts a fresh result list: filters and page reset, but the
    // shopper's sort and page-size choices are kept if they are already on the shop.
    const current = this.router.parseUrl(this.router.url);
    const onShop = current.root.children['primary']?.segments[0]?.path === 'shop';
    const queryParams: Record<string, string> = {};
    for (const key of onShop ? ['sort', 'pageSize'] : []) {
      if (current.queryParams[key]) {
        queryParams[key] = current.queryParams[key];
      }
    }
    const q = value.trim();
    if (q) {
      queryParams['q'] = q;
    }
    this.router.navigate(['/shop'], { queryParams });
  }
}
