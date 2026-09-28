import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StarRatingComponent } from './star-rating.component';

describe('StarRatingComponent', () => {
  let component: StarRatingComponent;
  let fixture: ComponentFixture<StarRatingComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StarRatingComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(StarRatingComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows filled stars for the rating and announces it', () => {
    fixture.componentRef.setInput('product', { rating: 3 });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Rated 3 out of 5');
    expect(el.querySelectorAll('.star').length).toBe(5);
    expect(el.querySelectorAll('.star.on').length).toBe(3);
  });
});
