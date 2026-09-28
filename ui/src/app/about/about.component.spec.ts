import { ComponentFixture, TestBed } from '@angular/core/testing';

import { provideRouter } from '@angular/router';
import { AboutComponent } from './about.component';

describe('AboutComponent', () => {
  let component: AboutComponent;
  let fixture: ComponentFixture<AboutComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AboutComponent],
      providers: [provideRouter([])]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AboutComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('links to the GitHub repo and the portfolio in a new tab', () => {
    const links: HTMLAnchorElement[] = Array.from(fixture.nativeElement.querySelectorAll('#links a'));
    expect(links.map(a => a.href)).toEqual(['https://github.com/bigmac529/GigaGarageSale', 'https://socha3.com/']);
    for (const a of links) {
      expect(a.target).toBe('_blank');
      expect(a.rel).toBe('noopener noreferrer');
    }
  });

  it('keeps the story, mission and community sections', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('#our-story h2')?.textContent).toBe('Our Story');
    expect(el.querySelector('#our-story')?.textContent).toContain('founded by Michael Socha and Danny Xiong');
    expect(el.querySelectorAll('#mission li').length).toBe(3);
    expect(el.querySelector('#community h2')?.textContent).toBe('Join Our Community');
  });
});
