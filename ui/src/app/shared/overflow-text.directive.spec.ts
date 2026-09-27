import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OverflowTextDirective, isTruncated, updateTruncationTitle } from './overflow-text.directive';

@Component({
  imports: [OverflowTextDirective],
  template: `
    <div style="width: 120px; font: 16px/1.2 sans-serif">
      <label id="long"><input type="radio" name="r" value="long" /><span class="text" appOverflowText>Heather's Hard Drive Hideout and Then Some</span></label>
      <label id="short"><input type="radio" name="r" value="short" /><span class="text" appOverflowText>Dan F</span></label>
    </div>
  `,
  styles: [`
    label { display: flex; }
    input { flex: none; margin: 0 4px 0 0; }
    .text { flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; }
  `]
})
class HostComponent {}

function mouse(target: EventTarget, type: string, x: number, y: number, detail = 1): MouseEvent {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, detail });
  target.dispatchEvent(e);
  return e;
}

describe('isTruncated / updateTruncationTitle', () => {
  let box: HTMLElement;

  beforeEach(() => {
    box = document.createElement('span');
    box.style.cssText = 'display: inline-block; width: 60px; white-space: nowrap; overflow: hidden;';
    document.body.appendChild(box);
  });

  afterEach(() => box.remove());

  it('sets the full text as the title only while the text is clipped', () => {
    box.textContent = 'A name that is far too long for sixty pixels';
    expect(isTruncated(box)).toBeTrue();
    updateTruncationTitle(box);
    expect(box.getAttribute('title')).toBe('A name that is far too long for sixty pixels');

    box.textContent = 'Hi';
    expect(isTruncated(box)).toBeFalse();
    updateTruncationTitle(box);
    expect(box.hasAttribute('title')).toBeFalse();
  });

  it('drops a stale title once the box is wide enough', () => {
    box.textContent = 'A name that is far too long for sixty pixels';
    updateTruncationTitle(box);
    box.style.width = '1000px';
    updateTruncationTitle(box);
    expect(box.hasAttribute('title')).toBeFalse();
  });
});

describe('OverflowTextDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let el: HTMLElement;
  let longText: HTMLElement;
  let shortText: HTMLElement;
  let longRadio: HTMLInputElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    el = fixture.nativeElement;
    document.body.appendChild(el);
    longText = el.querySelector('#long .text')!;
    shortText = el.querySelector('#short .text')!;
    longRadio = el.querySelector('#long input')!;
  });

  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    el.remove();
  });

  it('gives only the clipped name a tooltip on hover', () => {
    mouse(longText, 'mouseenter', 0, 0);
    mouse(shortText, 'mouseenter', 0, 0);
    expect(longText.getAttribute('title')).toBe("Heather's Hard Drive Hideout and Then Some");
    expect(shortText.hasAttribute('title')).toBeFalse();
  });

  it('checks the radio on a plain click', () => {
    const r = longText.getBoundingClientRect();
    const x = r.left + 10, y = r.top + r.height / 2;
    mouse(longText, 'mousedown', x, y);
    mouse(document, 'mouseup', x, y);
    const click = mouse(longText, 'click', x, y);
    expect(click.defaultPrevented).toBeFalse();
    expect(longRadio.checked).toBeTrue();
  });

  it('drag-selecting past the right edge reveals and selects the tail without checking the radio', () => {
    const r = longText.getBoundingClientRect();
    const y = r.top + r.height / 2;
    const down = mouse(longText, 'mousedown', r.left + 1, y);
    expect(down.defaultPrevented).toBeTrue();

    mouse(document, 'mousemove', r.right + 20, y);
    mouse(document, 'mousemove', r.right + 2000, y);
    expect(longText.scrollLeft).toBe(longText.scrollWidth - longText.clientWidth);
    expect(longText.scrollLeft).toBeGreaterThan(0);
    expect(window.getSelection()!.toString()).toBe("Heather's Hard Drive Hideout and Then Some");

    mouse(document, 'mouseup', r.right + 2000, y);
    const click = mouse(longText, 'click', r.right - 1, y);
    expect(click.defaultPrevented).toBeTrue();
    expect(longRadio.checked).toBeFalse();
  });

  it('selects a partial range from where the drag started', () => {
    const r = longText.getBoundingClientRect();
    const y = r.top + r.height / 2;
    // Start roughly in the middle of the visible part.
    mouse(longText, 'mousedown', r.left + r.width / 2, y);
    mouse(document, 'mousemove', r.right + 2000, y);
    const selected = window.getSelection()!.toString();
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.length).toBeLessThan(longText.textContent!.length);
    expect(longText.textContent!.endsWith(selected)).toBeTrue();
    mouse(document, 'mouseup', r.right + 2000, y);
  });

  it('scrolls back to the start once the selection is cleared', async () => {
    const r = longText.getBoundingClientRect();
    const y = r.top + r.height / 2;
    mouse(longText, 'mousedown', r.left + 1, y);
    mouse(document, 'mousemove', r.right + 2000, y);
    mouse(document, 'mouseup', r.right + 2000, y);
    expect(longText.scrollLeft).toBeGreaterThan(0);

    // Leaving while the selection is still there keeps the tail visible.
    mouse(longText, 'mouseleave', r.right + 2000, y);
    expect(longText.scrollLeft).toBeGreaterThan(0);

    window.getSelection()!.removeAllRanges();
    await new Promise(resolve => setTimeout(resolve, 50)); // selectionchange is async
    expect(longText.scrollLeft).toBe(0);
  });

  it('resets on mouseleave when nothing is selected', () => {
    longText.scrollLeft = 30;
    mouse(longText, 'mouseleave', 0, 0);
    expect(longText.scrollLeft).toBe(0);
  });

  it('treats a tiny wobble between mousedown and mouseup as a click', () => {
    const r = longText.getBoundingClientRect();
    const x = r.left + 10, y = r.top + r.height / 2;
    mouse(longText, 'mousedown', x, y);
    mouse(document, 'mousemove', x + 1, y + 1);
    mouse(document, 'mouseup', x + 1, y + 1);
    const click = mouse(longText, 'click', x + 1, y + 1);
    expect(click.defaultPrevented).toBeFalse();
    expect(longRadio.checked).toBeTrue();
  });
});
