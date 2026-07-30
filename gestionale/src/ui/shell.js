import { getTenantConfig } from '../config/tenant.js';
import { signOut } from '../lib/auth.js';
import { icon } from './icons.js';

export function esc(value) {
  const node = document.createElement('span');
  node.textContent = String(value ?? '');
  return node.innerHTML;
}

export function escAttr(value) {
  return esc(value).replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function safeImageUrl(value) {
  const url = typeof value === 'string' ? value : value?.dataUrl;
  if (!url) return '';
  if (/^(?:https?:|blob:|data:image\/(?:png|jpeg|webp|gif);base64,)/i.test(url)) {
    return url;
  }
  return '';
}

export function toast(message, type = 'ok', duration = 3_500) {
  let region = document.querySelector('.toast-region');
  if (!region) {
    region = document.createElement('div');
    region.className = 'toast-region';
    region.setAttribute('aria-live', 'polite');
    document.body.append(region);
  }

  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.setAttribute('role', type === 'error' ? 'alert' : 'status');
  item.textContent = message;
  region.append(item);

  window.setTimeout(() => item.remove(), duration);
  return item;
}

function navLink(path, label, iconName, active) {
  const selected = active === path;
  return `
    <a href="#/${path}" ${selected ? 'aria-current="page"' : ''}>
      ${icon(iconName)}
      <span>${label}</span>
    </a>
  `;
}

export function mountShell(container, active = 'home') {
  const config = getTenantConfig();
  container.innerHTML = `
    <div class="app-layout">
      <aside class="app-sidebar">
        <div class="sidebar-brand">
          <span class="brand-mark" aria-hidden="true">CF</span>
          <strong>${esc(config.storeName)}</strong>
        </div>
        <nav class="bottom-nav" aria-label="Navigazione principale">
          ${navLink('home', 'Carica', 'upload', active)}
          ${navLink('drafts', 'Bozze', 'drafts', active)}
          ${navLink('products', 'Prodotti', 'product', active)}
          <button class="sidebar-logout" id="shell-signout-desktop" type="button">
            ${icon('logout')}
            <span>Esci</span>
          </button>
        </nav>
      </aside>
      <main class="app-main">
        <header class="mobile-brand-header">
          <div class="brand-lockup">
            <span class="brand-mark" aria-hidden="true">CF</span>
            <strong>${esc(config.storeName)}</strong>
          </div>
          <button
            class="btn btn-icon btn-quiet"
            id="shell-signout-mobile"
            type="button"
            aria-label="Esci"
          >
            ${icon('logout')}
          </button>
        </header>
        <div id="view-outlet"></div>
      </main>
    </div>
  `;

  async function handleSignOut() {
    await signOut();
    window.location.hash = '#/login';
  }

  container
    .querySelector('#shell-signout-desktop')
    ?.addEventListener('click', handleSignOut);
  container
    .querySelector('#shell-signout-mobile')
    ?.addEventListener('click', handleSignOut);

  return container.querySelector('#view-outlet');
}

export function renderFocusedHeader(title, { progress = '', back = '#/home' } = {}) {
  return `
    <header class="focused-header">
      <a class="btn btn-icon btn-quiet" href="${escAttr(back)}" aria-label="Indietro">
        ${icon('back')}
      </a>
      <strong>${esc(title)}</strong>
      <span class="focused-progress">${esc(progress)}</span>
    </header>
  `;
}
