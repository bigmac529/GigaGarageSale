import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

export type IconName =
  'search' | 'cart' | 'cart-plus' | 'filter' | 'x' | 'plus' | 'minus' | 'check' | 'chevron-down' |
  'chevron-left' | 'chevron-right' | 'arrow-left' | 'trash' | 'star' | 'alert' | 'github' | 'globe' |
  'external' | 'refresh' | 'tag' | 'package';

/**
 * Small inline SVG icon set (stroke icons on a 24px grid, drawn in the current text color),
 * so the UI needs no icon font or image requests. Icons are decorative (aria-hidden);
 * give the surrounding button or link an accessible name.
 */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'icon', 'aria-hidden': 'true' },
  styles: [':host { display: inline-flex; flex: none; line-height: 0; } svg { display: block; }'],
  template: `
    <svg [attr.width]="size" [attr.height]="size" viewBox="0 0 24 24" focusable="false"
         [attr.fill]="filled ? 'currentColor' : 'none'" stroke="currentColor" [attr.stroke-width]="stroke"
         stroke-linecap="round" stroke-linejoin="round">
      @switch (name) {
        @case ('search') { <svg:circle cx="11" cy="11" r="7" /><svg:path d="m20 20-3.5-3.5" /> }
        @case ('cart') { <svg:circle cx="8" cy="21" r="1" /><svg:circle cx="19" cy="21" r="1" /><svg:path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" /> }
        @case ('cart-plus') { <svg:circle cx="8" cy="21" r="1" /><svg:circle cx="19" cy="21" r="1" /><svg:path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12M13 7.5v5M10.5 10h5" /> }
        @case ('filter') { <svg:path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4" /> }
        @case ('x') { <svg:path d="M18 6 6 18M6 6l12 12" /> }
        @case ('plus') { <svg:path d="M12 5v14M5 12h14" /> }
        @case ('minus') { <svg:path d="M5 12h14" /> }
        @case ('check') { <svg:path d="M20 6 9 17l-5-5" /> }
        @case ('chevron-down') { <svg:path d="m6 9 6 6 6-6" /> }
        @case ('chevron-left') { <svg:path d="m15 18-6-6 6-6" /> }
        @case ('chevron-right') { <svg:path d="m9 18 6-6-6-6" /> }
        @case ('arrow-left') { <svg:path d="M19 12H5M12 19l-7-7 7-7" /> }
        @case ('trash') { <svg:path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" /> }
        @case ('star') { <svg:path d="M12 2.5l2.94 5.96 6.56.95-4.75 4.63 1.12 6.53L12 17.5l-5.87 3.07 1.12-6.53L2.5 9.41l6.56-.95L12 2.5z" /> }
        @case ('alert') { <svg:circle cx="12" cy="12" r="10" /><svg:path d="M12 8v4M12 16h.01" /> }
        @case ('github') { <svg:path stroke="none" fill="currentColor" d="M12 1.5a10.5 10.5 0 0 0-3.32 20.46c.53.1.72-.23.72-.5v-1.96c-2.92.63-3.54-1.24-3.54-1.24-.48-1.22-1.17-1.54-1.17-1.54-.95-.65.07-.64.07-.64 1.06.07 1.61 1.09 1.61 1.09.94 1.6 2.46 1.14 3.06.87.1-.68.37-1.14.66-1.4-2.33-.27-4.78-1.17-4.78-5.18 0-1.14.41-2.08 1.08-2.81-.11-.27-.47-1.33.1-2.78 0 0 .88-.28 2.89 1.08a10 10 0 0 1 5.25 0c2-1.36 2.88-1.08 2.88-1.08.58 1.45.22 2.51.11 2.78.67.73 1.08 1.67 1.08 2.81 0 4.02-2.46 4.9-4.8 5.16.38.33.72.97.72 1.96v2.9c0 .28.19.61.73.5A10.5 10.5 0 0 0 12 1.5z" /> }
        @case ('globe') { <svg:circle cx="12" cy="12" r="9" /><svg:path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" /> }
        @case ('external') { <svg:path d="M7 17 17 7M8 7h9v9" /> }
        @case ('refresh') { <svg:path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><svg:path d="M3 3v5h5" /> }
        @case ('tag') { <svg:path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z" /><svg:circle cx="7.5" cy="7.5" r="1.5" /> }
        @case ('package') { <svg:path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73zM12 22V12M3.3 7 12 12l8.7-5M7.5 4.27l9 5.15" /> }
      }
    </svg>
  `
})
export class IconComponent {
  @Input({ required: true }) name!: IconName;
  @Input() size = 20;
  @Input() stroke = 2;
  @Input() filled = false;
}
