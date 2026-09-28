import { Component, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { RouterModule } from '@angular/router';

/** The slim banner at the top of the shop. */
@Component({
  selector: 'app-shop-hero',
  imports: [RouterModule],
  templateUrl: './shop-hero.component.html',
  styleUrl: './shop-hero.component.scss'
})
export class ShopHeroComponent {
  private document = inject(DOCUMENT);

  /** Call to action: scroll to the product list. */
  jumpToResults(event: Event) {
    event.preventDefault();
    const target = this.document.getElementById('results');
    if (target) {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }
  }
}
