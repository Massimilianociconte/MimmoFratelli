import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import { loadTenantConfig } from './config/tenant.js';
import { getAdminSession, subscribeToAuth } from './lib/auth.js';
import { processPublicationQueue } from './lib/publish.js';
import { initDraftSync } from './lib/store.js';
import { mountShell } from './ui/shell.js';
import { renderLogin } from './ui/views/login.js';

const app = document.querySelector('#app');
let routeSequence = 0;
let stopDraftSync = null;

async function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('./sw.js', { scope: './' });
  } catch (error) {
    console.warn('Service worker non registrato', error.message);
  }
}

function loading(message = 'Caricamento di CaricoFacile…') {
  app.innerHTML = `
    <main class="loading-screen">
      <div class="spinner" aria-hidden="true"></div>
      <p>${message}</p>
    </main>
  `;
}

function renderFatalError() {
  app.innerHTML = `
    <main class="loading-screen">
      <h1>Configurazione non disponibile</h1>
      <p>Controlla la connessione e riprova.</p>
      <button class="btn" id="retry-bootstrap" type="button">Riprova</button>
    </main>
  `;
  app.querySelector('#retry-bootstrap')?.addEventListener('click', bootstrap);
}

function renderRouteError(error) {
  app.innerHTML = `
    <main class="loading-screen">
      <h1>Qualcosa non ha funzionato</h1>
      <p>La bozza è al sicuro. Torna alla schermata principale e riprova.</p>
      <a class="btn" href="#/home">Torna a Carica</a>
    </main>
  `;
  console.error('Route rendering failed', error);
}

function parseRoute() {
  const raw = (window.location.hash || '#/home').replace(/^#\/?/, '');
  const [name = 'home', value = ''] = raw.split('/');
  return { name, value };
}

async function route() {
  const sequence = ++routeSequence;
  const session = await getAdminSession();
  if (sequence !== routeSequence) return;
  const current = parseRoute();

  if (!session || current.name === 'login') {
    if (session && current.name === 'login') {
      window.location.hash = '#/home';
      return;
    }
    renderLogin(app);
    return;
  }

  try {
    if (current.name === 'review' && current.value) {
      loading('Apro la bozza…');
      const { renderReview } = await import('./ui/views/review.js');
      if (sequence !== routeSequence) return;
      await renderReview(app, current.value);
      return;
    }

    if (current.name === 'channel' && current.value) {
      const channelLoaders = {
        manual: () => import('./channels/manual.js'),
        csv: () => import('./channels/csv.js'),
        barcode: () => import('./channels/barcode.js'),
        photo: () => import('./channels/photo.js'),
        voice: () => import('./channels/voice.js'),
      };
      const loader = channelLoaders[current.value];
      if (!loader) {
        window.location.hash = '#/home';
        return;
      }
      loading('Preparo il canale…');
      const module = await loader();
      if (sequence !== routeSequence) return;
      const rendererName = `render${current.value.charAt(0).toUpperCase()}${current.value.slice(1)}`;
      await module[rendererName](app);
      return;
    }

    const standardViews = {
      home: {
        load: () => import('./ui/views/home.js'),
        render: 'renderHome',
        nav: 'home',
      },
      drafts: {
        load: () => import('./ui/views/drafts.js'),
        render: 'renderDrafts',
        nav: 'drafts',
      },
      products: {
        load: () => import('./ui/views/products.js'),
        render: 'renderProducts',
        nav: 'products',
      },
    };
    const view = standardViews[current.name] || standardViews.home;
    const module = await view.load();
    if (sequence !== routeSequence) return;
    const outlet = mountShell(app, view.nav);
    await module[view.render](outlet);
  } catch (error) {
    renderRouteError(error);
  }
}

async function bootstrap() {
  loading();
  try {
    await loadTenantConfig();
    subscribeToAuth(() => route());
    stopDraftSync?.();
    stopDraftSync = initDraftSync();
    window.addEventListener('hashchange', route);
    await route();
    processPublicationQueue().catch(() => {});
    registerServiceWorker();
  } catch {
    renderFatalError();
  }
}

bootstrap();
