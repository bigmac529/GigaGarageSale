import { AfterViewInit, Directive, ElementRef, NgZone, OnDestroy, inject } from '@angular/core';

/** True when the element's content is wider than its box (i.e. some of it is clipped). */
export function isTruncated(el: HTMLElement): boolean {
  return el.scrollWidth > el.clientWidth;
}

/**
 * Sets `title` to the element's full text when (and only when) the text is clipped,
 * so short names don't get a redundant tooltip.
 */
export function updateTruncationTitle(el: HTMLElement): void {
  const text = (el.textContent || '').trim();
  if (text && isTruncated(el)) {
    el.setAttribute('title', text);
  } else {
    el.removeAttribute('title');
  }
}

/** Pixels the pointer may wander between mousedown and mouseup and still count as a click. */
const DRAG_THRESHOLD = 3;

/**
 * For single-line text that is clipped by `overflow: hidden` (no ellipsis), typically the
 * text part of a `<label>` next to a radio button:
 *
 * - Shows the full text as a native tooltip when it is clipped.
 * - Lets the user drag-select the text like a single-line input: pressing on the text and
 *   dragging past the right edge scrolls the hidden tail into view and selects it. The
 *   selection is kept inside this element (it never spills into the rest of the page).
 * - A drag-select does not activate the surrounding label, so it won't pick the radio;
 *   a plain click still does.
 * - Scrolls back to the start once the selection is gone, or when the pointer leaves and
 *   nothing inside is selected.
 */
@Directive({
  selector: '[appOverflowText]'
})
export class OverflowTextDirective implements AfterViewInit, OnDestroy {

  private readonly el: HTMLElement = inject(ElementRef).nativeElement;
  private readonly zone = inject(NgZone);

  private resizeObserver?: ResizeObserver;
  private cleanups: (() => void)[] = [];
  private dragCleanups: (() => void)[] = [];

  private anchorOffset = 0;
  private startX = 0;
  private startY = 0;
  /** Between our mousedown and the matching mouseup. */
  private pressed = false;
  /** The pointer moved far enough while pressed to count as a drag-select. */
  private dragging = false;
  /** Set when a drag-select ends so the click that may follow doesn't choose the radio. */
  private suppressClick = false;
  private watchingSelection = false;
  private stopWatching = () => {};

  ngAfterViewInit(): void {
    // None of this changes Angular state, so keep it out of change detection.
    this.zone.runOutsideAngular(() => {
      this.listen(this.el, 'mouseenter', () => updateTruncationTitle(this.el));
      this.listen(this.el, 'mouseleave', () => this.onMouseLeave());
      this.listen(this.el, 'mousedown', e => this.onMouseDown(e as MouseEvent));
      this.listen(this.el, 'click', e => this.onClick(e as MouseEvent));
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => updateTruncationTitle(this.el));
        this.resizeObserver.observe(this.el);
      }
    });
    updateTruncationTitle(this.el);
  }

  ngOnDestroy(): void {
    this.pressed = false;
    this.endDrag();
    this.stopWatchingSelection();
    this.resizeObserver?.disconnect();
    this.cleanups.forEach(fn => fn());
    this.cleanups = [];
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void, into = this.cleanups) {
    target.addEventListener(type, fn);
    into.push(() => target.removeEventListener(type, fn));
  }

  private get textNode(): Text | null {
    const node = this.el.firstChild;
    return node && node.nodeType === Node.TEXT_NODE ? node as Text : null;
  }

  private onMouseDown(e: MouseEvent) {
    this.suppressClick = false;
    const text = this.textNode;
    // Leave double/triple-click word/line selection and non-primary buttons to the browser.
    if (e.button !== 0 || e.detail > 1 || !text) {
      return;
    }
    // We drive the selection ourselves so it stays inside this element instead of
    // following the pointer into whatever is to the right of the sidebar.
    e.preventDefault();
    this.anchorOffset = this.offsetAtX(text, e.clientX);
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.pressed = true;
    this.dragging = false;
    // Collapse any old selection at the press point (like a text field would).
    window.getSelection()?.collapse(text, this.anchorOffset);

    this.endDrag();
    this.listen(document, 'mousemove', ev => this.onMouseMove(ev as MouseEvent), this.dragCleanups);
    this.listen(document, 'mouseup', () => this.onMouseUp(), this.dragCleanups);
    this.listen(window, 'blur', () => this.onMouseUp(), this.dragCleanups);
  }

  private onMouseMove(e: MouseEvent) {
    const text = this.textNode;
    if (!text) {
      return;
    }
    if (!this.dragging) {
      if (Math.abs(e.clientX - this.startX) < DRAG_THRESHOLD && Math.abs(e.clientY - this.startY) < DRAG_THRESHOLD) {
        return;
      }
      this.dragging = true;
    }
    e.preventDefault();

    const rect = this.el.getBoundingClientRect();
    const maxScroll = this.el.scrollWidth - this.el.clientWidth;
    if (e.clientX > rect.right) {
      // Dragging N px past the right edge reveals N px of the hidden tail.
      this.el.scrollLeft = Math.min(maxScroll, e.clientX - rect.right);
    } else if (e.clientX < rect.left) {
      this.el.scrollLeft = 0;
    }
    if (this.el.scrollLeft > 0) {
      this.watchSelection();
    }

    const x = Math.min(Math.max(e.clientX, rect.left), rect.right);
    const focusOffset = this.offsetAtX(text, x);
    window.getSelection()?.setBaseAndExtent(text, this.anchorOffset, text, focusOffset);
  }

  private onMouseUp() {
    if (this.dragging) {
      this.suppressClick = true;
    }
    this.pressed = false;
    this.dragging = false;
    this.endDrag();
    if (!this.hasSelectionInside()) {
      this.resetScroll();
    }
  }

  private onClick(e: MouseEvent) {
    if (this.suppressClick || this.hasSelectionInside()) {
      // Stops the label from forwarding the click to its radio.
      e.preventDefault();
    }
    this.suppressClick = false;
  }

  private onMouseLeave() {
    if (!this.pressed && !this.hasSelectionInside()) {
      this.resetScroll();
    }
  }

  private endDrag() {
    this.dragCleanups.forEach(fn => fn());
    this.dragCleanups = [];
  }

  /** While scrolled, scroll back to the start as soon as the selection leaves this element. */
  private watchSelection() {
    if (this.watchingSelection) {
      return;
    }
    this.watchingSelection = true;
    const onChange = () => {
      if (!this.pressed && !this.hasSelectionInside()) {
        this.resetScroll();
      }
    };
    document.addEventListener('selectionchange', onChange);
    this.stopWatching = () => document.removeEventListener('selectionchange', onChange);
  }

  private stopWatchingSelection() {
    this.stopWatching();
    this.stopWatching = () => {};
    this.watchingSelection = false;
  }

  private resetScroll() {
    this.el.scrollLeft = 0;
    this.stopWatchingSelection();
  }

  private hasSelectionInside(): boolean {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      return false;
    }
    return this.el.contains(sel.anchorNode) || this.el.contains(sel.focusNode);
  }

  /** The caret offset in `text` nearest to viewport x (accounts for the current scroll). */
  private offsetAtX(text: Text, x: number): number {
    const range = document.createRange();
    const length = text.length;
    for (let i = 0; i < length; i++) {
      range.setStart(text, i);
      range.setEnd(text, i + 1);
      const r = range.getBoundingClientRect();
      if (x < r.left + r.width / 2) {
        return i;
      }
    }
    return length;
  }
}
