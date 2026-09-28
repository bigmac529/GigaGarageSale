import { Component, DestroyRef, ElementRef, HostListener, ViewChild, inject } from '@angular/core';
import { DOCUMENT, DecimalPipe } from '@angular/common';
import { A11yModule } from '@angular/cdk/a11y';
import { BreakpointObserver } from '@angular/cdk/layout';
import { ActivatedRoute, ParamMap, Params, Router, RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, map, of, startWith, switchMap } from 'rxjs';
import { IProduct } from '../../../../shared/i-product';
import { IProductFacets, IProductPage, ProductSort } from '../../../../shared/i-product-page';
import { ProductsService } from '../shared/products-service';
import { PagerComponent } from '../pager/pager.component';
import { FilterGroup, FilterGroupsComponent, FilterKey } from './filter-groups/filter-groups.component';
import { ShopHeroComponent } from './hero/shop-hero.component';
import { ProductCardComponent } from '../product-card/product-card.component';
import { IconComponent } from '../shared/icon/icon.component';
import { ShopMemoryService } from '../shared/shop-memory.service';

export const DEFAULT_PAGE_SIZE = 24;
export const PAGE_SIZES = [12, 24, 48, 96];

export type { FilterKey } from './filter-groups/filter-groups.component';

/** Below this width the filter sidebar becomes a slide-out drawer / bottom sheet. */
export const DRAWER_QUERY = '(max-width: 1002.98px)';

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
    DecimalPipe,
    A11yModule,
    RouterModule,
    PagerComponent,
    FilterGroupsComponent,
    ShopHeroComponent,
    ProductCardComponent,
    IconComponent
  ],
  templateUrl: './shop.component.html',
  styleUrl: './shop.component.scss'
})
export class ShopComponent {

  private productSvc: ProductsService = inject(ProductsService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private memory = inject(ShopMemoryService);
  private document = inject(DOCUMENT);

  readonly sorts = SORTS;
  readonly pageSizes = PAGE_SIZES;
  /** Placeholder tiles shown while the first page loads. */
  readonly skeletons = Array.from({ length: 8 }, (_, i) => i);

  /** True below the drawer breakpoint (phones and tablets). */
  isDrawer = false;
  /** Whether the filter drawer is open (only meaningful when isDrawer). */
  filtersOpen = false;
  /** Which filter groups are expanded; groups with an active filter always start open. */
  openGroups: Record<FilterKey, boolean> = { merchant: false, brand: false, category: true };

  @ViewChild('openFiltersBtn') private openFiltersBtn?: ElementRef<HTMLButtonElement>;
  @ViewChild('closeFiltersBtn') private closeFiltersBtn?: ElementRef<HTMLButtonElement>;

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

  /** Heading above the grid, describing what is shown. */
  get resultsTitle(): string {
    if (this.state.q) {
      return `Results for “${this.state.q}”`;
    }
    return [this.state.brand, this.state.category].filter(v => !!v).join(' ') || this.state.merchant || 'All products';
  }

  /** Number of sidebar filters (merchant / brand / category) in use; search is separate. */
  get activeFilterCount(): number {
    return [this.state.merchant, this.state.brand, this.state.category].filter(v => !!v).length;
  }

  get filterGroups(): FilterGroup[] {
    return [
      { key: 'category', label: 'Categories', options: this.categories },
      { key: 'brand', label: 'Brands', options: this.brands },
      { key: 'merchant', label: 'Merchants', options: this.merchants }
    ];
  }

  constructor() {
    const destroyRef = inject(DestroyRef);

    this.loadFacets(destroyRef);
    for (const key of ['merchant', 'brand', 'category'] as FilterKey[]) {
      if (this.state[key]) {
        this.openGroups[key] = true;
      }
    }

    inject(BreakpointObserver).observe(DRAWER_QUERY).pipe(takeUntilDestroyed(destroyRef)).subscribe(bp => {
      this.isDrawer = bp.matches;
      if (!bp.matches && this.filtersOpen) {
        this.closeFilters(false);
      }
    });

    // The demo "Reset inventory" action forgets cached products; fetch the page again.
    this.productSvc.inventoryReset$.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => {
      this.loadFacets(destroyRef);
      this.reload();
    });
    destroyRef.onDestroy(() => this.lockScroll(false));

    // The URL is the single source of truth: every control navigates, and this reacts.
    this.route.queryParamMap.pipe(
      map(readShopState),
      switchMap(state => this.retry$.pipe(startWith(undefined), map(() => state))),
      switchMap(state => {
        const previous = this.state;
        this.state = state;
        this.memory.lastParams = { ...this.route.snapshot.queryParams };
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
      this.restoreScroll();
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

  openFilters() {
    this.filtersOpen = true;
    this.lockScroll(true);
    // Wait for the drawer to become visible before moving focus into it.
    setTimeout(() => this.closeFiltersBtn?.nativeElement.focus(), 50);
  }

  closeFilters(restoreFocus = true) {
    if (!this.filtersOpen) {
      return;
    }
    this.filtersOpen = false;
    this.lockScroll(false);
    if (restoreFocus) {
      this.openFiltersBtn?.nativeElement.focus();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.filtersOpen) {
      this.closeFilters();
    }
  }

  private loadFacets(destroyRef: DestroyRef) {
    this.productSvc.getFacets().pipe(takeUntilDestroyed(destroyRef)).subscribe({
      next: (facets: IProductFacets) => {
        this.merchants = facets.merchants;
        this.brands = facets.brands;
        this.categories = facets.categories;
      },
      error: err => console.error('Error fetching filters:', err)
    });
  }

  /** After back/forward to the shop, return to where the shopper was once results render. */
  private restoreScroll() {
    const position = this.memory.pendingScroll;
    if (position) {
      this.memory.pendingScroll = null;
      setTimeout(() => window.scrollTo({ left: position[0], top: position[1], behavior: 'instant' }));
    }
  }

  private lockScroll(lock: boolean) {
    this.document.body.classList.toggle('no-scroll', lock);
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
