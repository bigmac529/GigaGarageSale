import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SiteFooterComponent } from './site-footer.component';

describe('SiteFooterComponent', () => {
  it('links to GitHub and socha3.com, shows the copyright and emits reset', async () => {
    await TestBed.configureTestingModule({ imports: [SiteFooterComponent], providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(SiteFooterComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const hrefs = Array.from(el.querySelectorAll('a')).map(a => a.getAttribute('href'));
    expect(hrefs).toContain('https://github.com/bigmac529/GigaGarageSale');
    expect(hrefs).toContain('https://socha3.com');
    expect(el.textContent).toContain('© 2025 GigaGarageSale. All rights reserved.');

    let resets = 0;
    fixture.componentInstance.resetInventory.subscribe(() => resets++);
    (el.querySelector('#resetInventory') as HTMLButtonElement).click();
    expect(resets).toBe(1);
  });
});
