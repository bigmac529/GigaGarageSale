import { Component, inject, OnInit } from '@angular/core';
import { RouterOutlet, RouterModule, Router, NavigationEnd, Scroll } from '@angular/router';
import { ViewportScroller } from '@angular/common';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent, MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Observable, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, filter, map, startWith, switchMap } from 'rxjs/operators';
import { AsyncPipe, CurrencyPipe } from '@angular/common';
import { IProduct } from '../../../shared/i-product';
import { ProductsService } from './shared/products-service';
import { FadeOutTextComponent } from './fade-out-text/fade-out-text.component';
import { ShoppingCartService } from './shared/shopping-cart-service';
import { ShopMemoryService } from './shared/shop-memory.service';
import { IconComponent } from './shared/icon/icon.component';
import { SiteFooterComponent } from './site-footer/site-footer.component';

interface Toast { id: number; text: string; }

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterModule,
    MatAutocompleteModule,
    ReactiveFormsModule,
    AsyncPipe,
    CurrencyPipe,
    FadeOutTextComponent,
    IconComponent,
    SiteFooterComponent
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
  private scroller = inject(ViewportScroller);
  private shopMemory = inject(ShopMemoryService);
  private lastPath = '';

  /** Short-lived status messages; the inventory is reset on every app load. */
  toasts: Toast[] = [{ id: 0, text: 'Product inventory reset' }];
  resetting = false;

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

    // Going to a different page starts at the top; back/forward restores the old position
    // (the shop restores it itself once its results have loaded). Query-string-only
    // changes, such as shop filters, keep the current position.
    this.router.events.pipe(filter((e): e is Scroll => e instanceof Scroll)).subscribe(e => {
      const url = e.routerEvent instanceof NavigationEnd ? e.routerEvent.urlAfterRedirects : e.routerEvent.url;
      const path = url.split(/[?#]/)[0];
      if (e.position) {
        if (path === '/shop') {
          this.shopMemory.pendingScroll = e.position;
        } else {
          const position = e.position;
          setTimeout(() => this.scroller.scrollToPosition(position));
        }
      } else if (path !== this.lastPath) {
        this.scroller.scrollToPosition([0, 0]);
      }
      this.lastPath = path;
    });

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

  /** Demo tool (footer): restore every product's stock on the server and empty the cart. */
  resetInventory() {
    if (this.resetting) {
      return;
    }
    this.resetting = true;
    const hadItems = this.cartSvc.numItems > 0;
    this.cartSvc.clearCart();
    this.productsSvc.resetInventory().subscribe({
      next: () => this.toast(hadItems ? 'Product inventory reset. Your cart was emptied.' : 'Product inventory reset'),
      error: err => {
        console.error('Could not reset product inventory.', err);
        this.toast('Could not reset the inventory. Try again.');
        this.resetting = false;
      },
      complete: () => this.resetting = false
    });
  }

  /** Moves focus to the main region (the router outlet) for keyboard users. */
  skipToMain(event: Event) {
    event.preventDefault();
    document.getElementById('main')?.focus();
  }

  private toast(text: string) {
    const id = (this.toasts[this.toasts.length - 1]?.id ?? 0) + 1;
    this.toasts = [{ id, text }];
  }
}
