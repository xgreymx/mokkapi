// Zone.js must be imported before bootstrapping
import 'zone.js';
import './styles.css';

import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './src/app/app.component';
import { appConfig } from './src/app/app.config';

bootstrapApplication(AppComponent, appConfig).catch(console.error);
