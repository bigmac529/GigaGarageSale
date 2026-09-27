import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { IProduct } from "../../../../shared/i-product";
import { Observable } from "rxjs/internal/Observable";

@Injectable({ providedIn: 'root' })
export class GigaHttpClient {

  readonly hostUrl: string = '';
  readonly apiBaseUrl: string = `${this.hostUrl}/api`;

  httpClient: HttpClient = inject(HttpClient);
  constructor() {
  }

  getProducts(): Observable<IProduct[]> {
    const url = `${this.apiBaseUrl}/products`;
    console.log(`Getting products from ${url}`);
    return this.httpClient.get<IProduct[]>(url);
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
