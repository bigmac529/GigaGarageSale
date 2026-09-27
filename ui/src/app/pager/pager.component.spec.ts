import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { PagerComponent, pageItems } from './pager.component';

describe('pageItems', () => {
  it('lists every page when they all fit', () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('adds an ellipsis on the far side near either end', () => {
    expect(pageItems(1, 48)).toEqual([1, 2, 3, 4, 5, 'gap-end', 48]);
    expect(pageItems(4, 48)).toEqual([1, 2, 3, 4, 5, 'gap-end', 48]);
    expect(pageItems(48, 48)).toEqual([1, 'gap-start', 44, 45, 46, 47, 48]);
  });

  it('shows gaps on both sides in the middle', () => {
    expect(pageItems(10, 48)).toEqual([1, 'gap-start', 9, 10, 11, 'gap-end', 48]);
  });

  it('uses fewer slots with no siblings', () => {
    expect(pageItems(10, 48, 0)).toEqual([1, 'gap-start', 10, 'gap-end', 48]);
    expect(pageItems(2, 48, 0)).toEqual([1, 2, 3, 'gap-end', 48]);
  });
});

describe('PagerComponent', () => {
  let fixture: ComponentFixture<PagerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PagerComponent],
      providers: [provideRouter([])]
    }).compileComponents();

    fixture = TestBed.createComponent(PagerComponent);
    fixture.componentRef.setInput('page', 2);
    fixture.componentRef.setInput('pageSize', 24);
    fixture.componentRef.setInput('total', 1137);
    fixture.componentRef.setInput('totalPages', 48);
    fixture.detectChanges();
  });

  it('shows the result range', () => {
    const text = (fixture.nativeElement as HTMLElement).querySelector('.summary')?.textContent;
    expect(text).toContain('Showing 25–48 of 1,137');
  });

  it('marks the current page and links the others with ?page', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[aria-current="page"]')?.textContent?.trim()).toBe('2');
    const next = el.querySelector('a[rel="next"]') as HTMLAnchorElement;
    expect(next.getAttribute('href')).toBe('/?page=3');
    const prev = el.querySelector('a[rel="prev"]') as HTMLAnchorElement;
    expect(prev.getAttribute('href')).toBe('/');
  });

  it('hides the page links when there is a single page', () => {
    fixture.componentRef.setInput('page', 1);
    fixture.componentRef.setInput('total', 5);
    fixture.componentRef.setInput('totalPages', 1);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('ul')).toBeNull();
    expect(el.querySelector('.summary')?.textContent).toContain('Showing 1–5 of 5');
  });
});
