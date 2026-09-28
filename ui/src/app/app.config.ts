import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';

import { routes } from './app.routes';
import { provideHttpClient } from '@angular/common/http';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }), 
    // Scroll handling is done by AppComponent (see its Scroll event handler), so the shop's
    // URL-synced filters don't jump to the top on every change.
    provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'disabled' })),
    provideHttpClient(),
    provideAnimations()
  ]
};
