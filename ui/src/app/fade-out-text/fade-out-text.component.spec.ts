import { ComponentFixture, TestBed } from '@angular/core/testing';

import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { FadeOutTextComponent } from './fade-out-text.component';

describe('FadeOutTextComponent', () => {
  let component: FadeOutTextComponent;
  let fixture: ComponentFixture<FadeOutTextComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FadeOutTextComponent],
      providers: [provideNoopAnimations()]
    })
    .compileComponents();

    fixture = TestBed.createComponent(FadeOutTextComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
