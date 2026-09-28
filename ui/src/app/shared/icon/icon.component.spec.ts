import { TestBed } from '@angular/core/testing';
import { IconComponent } from './icon.component';

describe('IconComponent', () => {
  it('renders a decorative SVG of the requested size', () => {
    const fixture = TestBed.createComponent(IconComponent);
    fixture.componentRef.setInput('name', 'cart');
    fixture.componentRef.setInput('size', 24);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const svg = host.querySelector('svg')!;
    expect(host.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.querySelectorAll('path, circle').length).toBeGreaterThan(0);
    expect(svg.querySelector('path')!.namespaceURI).toBe('http://www.w3.org/2000/svg');
  });
});
