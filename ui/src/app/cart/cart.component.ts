import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { ShoppingCartService } from '../shared/shopping-cart-service';
import { IShoppingCartItem } from '../shared/i-shopping-cart-item';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';

@Component({
  selector: 'app-cart',
  imports: [
    CommonModule,
    RouterModule,
    MatButtonModule
  ],
  templateUrl: './cart.component.html',
  styleUrl: './cart.component.scss'
})
export class CartComponent {
  readonly cartSvc: ShoppingCartService = inject(ShoppingCartService);
  readonly productSvc: ShoppingCartService = inject(ShoppingCartService);
  readonly dialog = inject(MatDialog);
  readonly router = inject(Router);

  /** Adds one more of the item, respecting stock (same rule as the product page). */
  increase(item: IShoppingCartItem): void {
    if (item.product.available > 0) {
      item.product.available--;
      this.cartSvc.addItem(item.product);
    }
  }

  /** Removes one unit; the line disappears when it reaches zero. */
  decrease(item: IShoppingCartItem): void {
    this.cartSvc.removeItem(item.product);
  }

  /** Removes the whole line, returning every unit to stock. */
  removeLine(item: IShoppingCartItem): void {
    for (let i = item.quantity; i > 0; i--) {
      this.cartSvc.removeItem(item.product);
    }
  }

  checkout(): void {
    let enterAnimationDuration = '1000ms';
    let exitAnimationDuration = '1000ms';

    this.dialog.open(CheckoutDialog, {
      width: "250px",
      enterAnimationDuration,
      exitAnimationDuration
    }).afterClosed().subscribe({
      next: () => {
        this.cartSvc.clearCart();
        this.router.navigate(['/shop']);
      }
    });
  }

  
}

@Component({
  selector: 'dialog-animations-example-dialog',
  imports: [MatButtonModule, MatDialogActions, MatDialogClose, MatDialogTitle, MatDialogContent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <h2 mat-dialog-title>Order confirmation #{{orderConfirmationNumber}}</h2>
  <mat-dialog-content>
    Thank you for your order. Your products will be shipped within 3-5 business days.
  </mat-dialog-content>
  <mat-dialog-actions>
    <button mat-button mat-dialog-close cdkFocusInitial>Ok</button>
  </mat-dialog-actions>
  `
})
export class CheckoutDialog {
  readonly dialogRef = inject(MatDialogRef<CheckoutDialog>);

  orderConfirmationNumber: string = this.getOrderConfirmationNumber();

  getOrderConfirmationNumber(): string {
    return this.orderConfirmationNumber = (Math.floor(Math.random() * 1000000)).toString();
  }

  
}
