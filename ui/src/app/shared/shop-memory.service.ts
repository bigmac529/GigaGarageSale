import { Injectable } from '@angular/core';
import { Params } from '@angular/router';

/**
 * Remembers the query string of the last shop view (filters, sort, page), so links back
 * to the shop from a product page return the shopper to the same results.
 */
@Injectable({ providedIn: 'root' })
export class ShopMemoryService {
  lastParams: Params = {};

  /** Scroll position to restore once the shop has rendered its results (back/forward). */
  pendingScroll: [number, number] | null = null;
}
