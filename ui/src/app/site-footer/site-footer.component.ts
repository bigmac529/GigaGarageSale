import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterModule } from '@angular/router';
import { IconComponent } from '../shared/icon/icon.component';

/** Site footer: links, copyright and the (demo) inventory reset action. */
@Component({
  selector: 'app-site-footer',
  imports: [RouterModule, IconComponent],
  templateUrl: './site-footer.component.html',
  styleUrl: './site-footer.component.scss'
})
export class SiteFooterComponent {
  /** True while a reset request is in flight. */
  @Input() resetting = false;
  @Output() resetInventory = new EventEmitter<void>();
}
