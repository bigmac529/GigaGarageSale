import { Injectable, inject } from "@angular/core";
import { IProduct } from "../../../../shared/i-product";
import { IProductFacets, IProductPage, IProductQuery } from "../../../../shared/i-product-page";
import { GigaHttpClient } from "./giga-http-client";
import { Observable, Subject, catchError, defer, firstValueFrom, map, of, shareReplay, switchMap, tap } from "rxjs";

/**
 * Singleton service providing access to products.
 *
 * The catalog is fetched a page at a time from the server (search, filters and sort run
 * there too), so the UI never has to download every product. Products are kept in an
 * identity map: whichever page, search or detail request returns a product, callers get
 * the same object. Stock changes made in the browser (adding to / removing from the cart
 * adjusts `available`) therefore show up everywhere, as they did when the whole catalog
 * was loaded once.
 */
@Injectable({ providedIn: 'root' })
export class ProductsService {

  gigaHttpClient: GigaHttpClient = inject(GigaHttpClient);

  private readonly known = new Map<number, IProduct>();

  /**
   * Resets the server inventory once per lifetime of this singleton; every product request
   * waits for it so it never sees pre-reset data.
   */
  private readonly ready$: Observable<void> = defer(() => this.gigaHttpClient.resetProducts()).pipe(
    catchError(err => {
      console.error('Could not reset product inventory.', err);
      return of(undefined);
    }),
    map(() => undefined),
    shareReplay(1)
  );

  private facets$: Observable<IProductFacets>;

  /** Emits after a manual inventory reset (see resetInventory) so views can reload. */
  readonly inventoryReset$ = new Subject<void>();

  /** One page of products matching the query (defaults: page 1, 24 per page). */
  getPage(query: IProductQuery): Observable<IProductPage> {
    return this.ready$.pipe(
      switchMap(() => this.gigaHttpClient.getProductPage(query)),
      map(page => ({ ...page, items: page.items.map(p => this.intern(p)) }))
    );
  }

  /** Up to `limit` products whose title/brand/etc. match the search text (for suggestions). */
  search(text: string, limit = 8): Observable<IProduct[]> {
    const q = text.trim();
    if (!q) {
      return of([]);
    }
    return this.getPage({ q, page: 1, pageSize: limit }).pipe(map(page => page.items));
  }

  /** Filter values (merchants, brands, categories) for the whole catalog. Cached. */
  getFacets(): Observable<IProductFacets> {
    if (!this.facets$) {
      this.facets$ = this.ready$.pipe(
        switchMap(() => this.gigaHttpClient.getProductFacets()),
        shareReplay(1)
      );
    }
    return this.facets$;
  }

  /** A single product, from memory if it has already been loaded. */
  getProduct(id: number): Promise<IProduct> {
    const cached = this.known.get(id);
    if (cached) {
      return Promise.resolve(cached);
    }
    return firstValueFrom(this.ready$.pipe(
      switchMap(() => this.gigaHttpClient.getProduct(id)),
      map(p => this.intern(p))
    ));
  }

  /**
   * Demo tool: restores the server catalog (POST /api/products/reset) and forgets every
   * product held in memory, so the next request returns fresh stock levels. The caller
   * should empty the cart first, since cart lines hold stock taken from those products.
   */
  resetInventory(): Observable<void> {
    return this.gigaHttpClient.resetProducts().pipe(
      map(() => undefined),
      tap(() => {
        this.known.clear();
        this.facets$ = undefined;
        this.inventoryReset$.next();
      })
    );
  }

  private intern(product: IProduct): IProduct {
    const existing = this.known.get(product.id);
    if (existing) {
      return existing;
    }
    this.known.set(product.id, product);
    return product;
  }
}
