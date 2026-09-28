import { AfterViewInit, Component, Input } from '@angular/core';
import { fadeOut } from '../shared/fade-animations';

/** A short status message that fades away on its own after `duration` ms. */
@Component({
  selector: 'app-fade-out-text',
  templateUrl: './fade-out-text.component.html',
  styleUrl: './fade-out-text.component.scss',
  animations: [fadeOut(600)]
})
export class FadeOutTextComponent implements AfterViewInit {

  @Input()
  text: string;

  /** How long the message stays fully visible. */
  @Input()
  duration = 1500;

  isVisible: boolean = true;

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.isVisible = false;
    }, this.duration);
  }
}
