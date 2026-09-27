import { Component, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatExpansionModule } from '@angular/material/expansion';
import { ActivatedRoute, ParamMap, Params, Router, RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, map, of, startWith, switchMap } from 'rxjs';
import { IProduct } from '../../../../shared/i-product';
import { IProductFacets, IProductPage, ProductSort } from '../../../../shared/i-product-page';
import { ProductsService } from '../shared/products-service';
import { PagerComponent } from '../pager/pager.component';

export const DEFAULT_PAGE_SIZE = 24;
export const PAGE_SIZES = [12, 24, 48, 96];

export type FilterKey = 'merchant' | 'brand' | 'category';

/** Everything that decides what the shop shows. Lives in the URL query string. */
export interface ShopState {
  q: string;
  merchant: string;
  brand: string;
  category: string;
  sort: ProductSort;
  page: number;
  pageSize: number;
}

export const SORTS: { value: ProductSort, label: string }[] = [
  { value: 'featured', label: 'Featured' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
  { value: 'rating-desc', label: 'Top rated' },
  { value: 'title-asc', label: 'Name: A to Z' }
];

/** Reads the shop state from query params, falling back to defaults for anything invalid. */
export function readShopState(params: ParamMap): ShopState {
  const text = (key: string) => (params.get(key) || '').trim();
  const page = Number(params.get('page'));
  const pageSize = Number(params.get('pageSize'));
  const sort = text('sort') as ProductSort;
  return {
    q: text('q'),
    merchant: text('merchant'),
    brand: text('brand'),
    category: text('category'),
    sort: SORTS.some(s => s.value === sort) ? sort : 'featured',
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    pageSize: PAGE_SIZES.indexOf(pageSize) !== -1 ? pageSize : DEFAULT_PAGE_SIZE
  };
}

@Component({
  selector: 'app-shop',
  imports: [
    CommonModule,
    MatExpansionModule,
    RouterModule,
    PagerComponent
  ],
  templateUrl: './shop.component.html',
  styleUrl: './shop.component.scss'
})
export class ShopComponent {

  private productSvc: ProductsService = inject(ProductsService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  readonly sorts = SORTS;
  readonly pageSizes = PAGE_SIZES;

  state: ShopState = readShopState(this.route.snapshot.queryParamMap);
  result: IProductPage | null = null;
  loading = true;
  error = false;

  merchants: string[] = [];
  brands: string[] = [];
  categories: string[] = [];

  private retry$ = new Subject<void>();

  get products(): IProduct[] {
    return this.result?.items ?? [];
  }

  get hasFilters(): boolean {
    return !!(this.state.q || this.state.merchant || this.state.brand || this.state.category);
  }

  constructor() {
    const destroyRef = inject(DestroyRef);

    this.productSvc.getFacets().pipe(takeUntilDestroyed(destroyRef)).subscribe({
      next: (facets: IProductFacets) => {
        this.merchants = facets.merchants;
        this.brands = facets.brands;
        this.categories = facets.categories;
      },
      error: err => console.error('Error fetching filters:', err)
    });

    // The URL is the single source of truth: every control navigates, and this reacts.
    this.route.queryParamMap.pipe(
      map(readShopState),
      switchMap(state => this.retry$.pipe(startWith(undefined), map(() => state))),
      switchMap(state => {
        const previous = this.state;
        this.state = state;
        this.loading = true;
        this.error = false;
        if (this.result && this.onlyPageChanged(previous, state)) {
          this.scrollToTop();
        }
        return this.productSvc.getPage(state).pipe(
          catchError(err => {
            console.error('Error fetching products:', err);
            return of(null);
          })
        );
      }),
      takeUntilDestroyed(destroyRef)
    ).subscribe(result => {
      this.loading = false;
      if (!result) {
        this.error = true;
        return;
      }
      this.result = result;
      // A page past the end comes back clamped to the last page; show that in the URL.
      if (result.page !== this.state.page) {
        this.navigate({ page: result.page === 1 ? null : result.page }, true);
      }
    });
  }

  setFilter(key: FilterKey | 'q', value: string) {
    this.navigate({ [key]: value || null, page: null });
  }

  setSort(sort: string) {
    this.navigate({ sort: sort === 'featured' ? null : sort, page: null });
  }

  /** Changes the page size, staying on the page that contains the first product shown. */
  setPageSize(value: string) {
    const pageSize = Number(value);
    const firstIndex = (this.state.page - 1) * this.state.pageSize;
    const page = Math.floor(firstIndex / pageSize) + 1;
    this.navigate({
      pageSize: pageSize === DEFAULT_PAGE_SIZE ? null : pageSize,
      page: page === 1 ? null : page
    });
  }

  clearFilters() {
    this.navigate({ q: null, merchant: null, brand: null, category: null, page: null });
  }

  /** Case-insensitive comparison, matching how the API applies filters. */
  same(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
  }

  reload() {
    this.retry$.next();
  }

  private navigate(queryParams: Params, replaceUrl = false) {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl
    });
  }

  private onlyPageChanged(a: ShopState, b: ShopState): boolean {
    return (a.page !== b.page || a.pageSize !== b.pageSize) &&
      a.q === b.q && a.merchant === b.merchant && a.brand === b.brand &&
      a.category === b.category && a.sort === b.sort;
  }

  /** Jump (not smooth-scroll) to the top so the new page starts at its first row. */
  private scrollToTop() {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }
}
