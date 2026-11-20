import { createApp } from 'vue';
import { createPinia } from 'pinia';

// Selbst gehostete Schriften (SIL OFL, siehe public/fonts/OFL-*.txt).
// Keine externen Font-Requests.
import '@fontsource/fraunces/latin-400.css';
import '@fontsource/fraunces/latin-500.css';
import '@fontsource/fraunces/latin-600.css';
import '@fontsource/fraunces/latin-700.css';
import '@fontsource/fraunces/latin-800.css';
import '@fontsource/fraunces/latin-400-italic.css';
import '@fontsource/fraunces/latin-500-italic.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';

import App from './App.vue';
import { router } from './router';
import './styles/main.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
