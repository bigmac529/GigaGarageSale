import { Component, Input, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

/** A page number, or a gap ('gap-start' / 'gap-end') rendered as an ellipsis. */
export type PageItem = number | 'gap-start' | 'gap-end';

/**
 * The page links to show: always the first and last page, the current page with
 * `siblings` pages either side, and an ellipsis for any gap. The list length stays
 * constant (2 * siblings + 5) once there are enough pages, so the pager doesn't jump
 * around as you move through it.
 */
export function pageItems(page: number, totalPages: number, siblings = 1): PageItem[] {
  const slots = 2 * siblings + 5;
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

  if (totalPages <= slots) {
    return range(1, totalPages);
  }

  const current = Math.min(Math.max(page, 1), totalPages);
  const leftSibling = Math.max(current - siblings, 1);
  const rightSibling = Math.min(current + siblings, totalPages);
  const showStartGap = leftSibling > 3;
  const showEndGap = rightSibling < totalPages - 2;
  const edgeCount = slots - 2; // pages shown on the side without a gap, including the boundary page

  if (!showStartGap) {
    return [...range(1, edgeCount), 'gap-end', totalPages];
  }
  if (!showEndGap) {
    return [1, 'gap-start', ...range(totalPages - edgeCount + 1, totalPages)];
  }
  return [1, 'gap-start', ...range(leftSibling, rightSibling), 'gap-end', totalPages];
}

/**
 * Pager for a server-paged list. Every control is a link that only changes the `page`
 * query parameter (other query parameters are kept), so pages can be bookmarked,
 * refreshed and navigated with back/forward.
 */
@Component({
  selector: 'app-pager',
  imports: [RouterModule, DecimalPipe],
  templateUrl: './pager.component.html',
  styleUrl: './pager.component.scss'
})
export class PagerComponent {
  @Input({ required: true }) page = 1;
  @Input({ required: true }) pageSize = 24;
  @Input({ required: true }) total = 0;
  @Input({ required: true }) totalPages = 1;

  /** Narrow phones get one fewer page link either side of the current page. */
  private readonly narrow = toSignal(
    inject(BreakpointObserver).observe('(max-width: 479.98px)').pipe(map(state => state.matches)),
    { initialValue: false }
  );

  get items(): PageItem[] {
    return pageItems(this.page, this.totalPages, this.narrow() ? 0 : 1);
  }

  get firstShown(): number {
    return this.total === 0 ? 0 : (this.page - 1) * this.pageSize + 1;
  }

  get lastShown(): number {
    return Math.min(this.page * this.pageSize, this.total);
  }

  /** Query params for a page link; page 1 drops the parameter to keep the URL clean. */
  params(page: number) {
    return { page: page === 1 ? null : page };
  }
}
