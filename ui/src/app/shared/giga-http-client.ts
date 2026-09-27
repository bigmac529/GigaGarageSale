import { HttpClient, HttpParams } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { IProduct } from "../../../../shared/i-product";
import { IProductFacets, IProductPage, IProductQuery } from "../../../../shared/i-product-page";
import { Observable } from "rxjs";

@Injectable({ providedIn: 'root' })
export class GigaHttpClient {

  readonly hostUrl: string = '';
  readonly apiBaseUrl: string = `${this.hostUrl}/api`;

  httpClient: HttpClient = inject(HttpClient);

  /**
   * Retrieve one page of products. Search, filters and sort are applied on the server
   * before paginating.
   */
  getProductPage(query: IProductQuery): Observable<IProductPage> {
    const url = `${this.apiBaseUrl}/products`;
    let params = new HttpParams()
      .set('page', String(query.page ?? 1));
    for (const key of ['pageSize', 'q', 'merchant', 'brand', 'category', 'sort'] as const) {
      const value = query[key];
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    }
    return this.httpClient.get<IProductPage>(url, { params });
  }

  /** Distinct merchants, brands and categories for the shop filters. */
  getProductFacets(): Observable<IProductFacets> {
    return this.httpClient.get<IProductFacets>(`${this.apiBaseUrl}/products/facets`);
  }

  /**
   * Retrieve and individual product's details
   * @param productId 
   * @returns 
   */
  getProduct(productId: number): Observable<IProduct> {
    let url = `${this.apiBaseUrl}/products/${productId}`;
    console.log(`Getting product from ${url}`);
    return this.httpClient.get<IProduct>(url);
  }

  resetProducts(): Observable<void> {
    const url = `${this.apiBaseUrl}/products/reset`;
    console.log(`Resetting products at ${url}`);
    return this.httpClient.post<void>(url, null);
  }
}
