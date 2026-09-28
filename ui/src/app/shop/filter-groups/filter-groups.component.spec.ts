import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FilterGroupsComponent } from './filter-groups.component';

describe('FilterGroupsComponent', () => {
  let fixture: ComponentFixture<FilterGroupsComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FilterGroupsComponent] }).compileComponents();
    fixture = TestBed.createComponent(FilterGroupsComponent);
    fixture.componentRef.setInput('groups', [
      { key: 'category', label: 'Categories', options: ['CPU', 'GPU'] },
      { key: 'merchant', label: 'Merchants', options: ["Heather's Hard Drive Hideout"] }
    ]);
    fixture.componentRef.setInput('selected', { merchant: '', brand: '', category: 'gpu' });
    fixture.componentRef.setInput('open', { merchant: false, brand: false, category: true });
    fixture.detectChanges();
    el = fixture.nativeElement;
  });

  it('renders one collapsible radio group per facet', () => {
    const groups = el.querySelectorAll('details.filter-group');
    expect(groups.length).toBe(2);
    expect((groups[0] as HTMLDetailsElement).open).toBeTrue();
    expect((groups[1] as HTMLDetailsElement).open).toBeFalse();
    expect(groups[0].querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('Categories');
    expect(el.querySelectorAll('.filterText[appOverflowText]').length).toBe(3);
  });

  it('checks the current value case-insensitively and shows it in the summary', () => {
    const checked = el.querySelector('input:checked') as HTMLInputElement;
    expect(checked.value).toBe('GPU');
    expect(el.querySelector('summary .group-value')?.textContent).toBe('gpu');
  });

  it('emits the picked option', () => {
    const picks: unknown[] = [];
    fixture.componentInstance.pick.subscribe(p => picks.push(p));
    const cpu = el.querySelector('input[value="CPU"]') as HTMLInputElement;
    cpu.click();
    expect(picks).toEqual([{ key: 'category', value: 'CPU' }]);
  });
});
