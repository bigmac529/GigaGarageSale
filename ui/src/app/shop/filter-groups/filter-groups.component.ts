import { Component, EventEmitter, Input, Output } from '@angular/core';
import { OverflowTextDirective } from '../../shared/overflow-text.directive';
import { IconComponent } from '../../shared/icon/icon.component';

export type FilterKey = 'merchant' | 'brand' | 'category';

export interface FilterGroup {
  key: FilterKey;
  label: string;
  options: string[];
}

/**
 * The shop's filter lists: one collapsible group per facet, each a radio list. Long names
 * stay on one line, clipped, with a tooltip and drag-to-reveal (OverflowTextDirective).
 */
@Component({
  selector: 'app-filter-groups',
  imports: [OverflowTextDirective, IconComponent],
  templateUrl: './filter-groups.component.html',
  styleUrl: './filter-groups.component.scss'
})
export class FilterGroupsComponent {
  @Input({ required: true }) groups: FilterGroup[] = [];
  /** Current value per facet ('' when unfiltered). */
  @Input({ required: true }) selected: Record<FilterKey, string> = { merchant: '', brand: '', category: '' };
  /** Which groups are expanded. */
  @Input() open: Record<FilterKey, boolean> = { merchant: false, brand: false, category: false };

  @Output() pick = new EventEmitter<{ key: FilterKey, value: string }>();
  @Output() openChange = new EventEmitter<{ key: FilterKey, open: boolean }>();

  toggled(key: FilterKey, event: Event) {
    this.openChange.emit({ key, open: (event.target as HTMLDetailsElement).open });
  }

  /** Case-insensitive comparison, matching how the API applies filters. */
  same(a: string, b: string): boolean {
    return (a || '').toLowerCase() === b.toLowerCase();
  }
}
