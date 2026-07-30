import { getTenantConfig } from '../../config/tenant.js';
import { listProducts } from '../../lib/products.js';
import { icon } from '../icons.js';
import { esc, escAttr, safeImageUrl } from '../shell.js';

function formatPrice(value, config) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return new Intl.NumberFormat(config.locale, {
    style: 'currency',
    currency: config.currency,
  }).format(numeric);
}

function productRows(products, config) {
  return products
    .map((product) => {
      const imageUrl = safeImageUrl(product.images?.[0]);
      return `
        <div
          class="data-row product-row"
          data-search="${escAttr(String(product.name || '').toLocaleLowerCase('it-IT'))}"
        >
          <span class="product-identity">
            ${
              imageUrl
                ? `<img src="${escAttr(imageUrl)}" alt="" />`
                : `<span class="product-thumb-placeholder">${icon('product')}</span>`
            }
            <strong>${esc(product.name || 'Senza nome')}</strong>
          </span>
          <span>${esc(formatPrice(product.price, config))}</span>
          <span class="row-state ${product.is_active ? 'ok' : 'muted'}">
            ${product.is_active ? 'Attivo' : 'Non attivo'}
          </span>
        </div>
      `;
    })
    .join('');
}

export async function renderProducts(container) {
  const config = getTenantConfig();
  let products = [];
  let loadError = false;
  try {
    products = await listProducts();
  } catch {
    loadError = true;
  }

  container.innerHTML = `
    <section class="data-view" aria-labelledby="products-title">
      <div class="view-header">
        <div>
          <h1 id="products-title">Prodotti</h1>
          <p>Catalogo pubblicato</p>
        </div>
        ${
          config.adminUrl
            ? `<a class="btn header-action" href="${escAttr(config.adminUrl)}" target="_blank" rel="noopener">Modifica sull’admin</a>`
            : ''
        }
      </div>
      ${
        loadError
          ? `
            <div class="empty-state">
              ${icon('alert')}
              <h2>Catalogo non disponibile</h2>
              <p>Controlla la connessione e riprova.</p>
              <button class="btn" id="retry-products" type="button">Riprova</button>
            </div>
          `
          : products.length
            ? `
              <label class="search-field product-search">
                <span class="sr-only">Cerca un prodotto</span>
                ${icon('search')}
                <input id="product-search" type="search" placeholder="Cerca un prodotto" />
              </label>
              <div class="data-list product-list">
                <div class="data-header product-data-header" aria-hidden="true">
                  <span>Prodotto</span><span>Prezzo</span><span>Stato</span>
                </div>
                ${productRows(products, config)}
              </div>
              <div class="empty-state" id="product-filter-empty" hidden>
                ${icon('search')}
                <h2>Nessun prodotto trovato</h2>
              </div>
            `
            : `
              <div class="empty-state">
                ${icon('product')}
                <h2>Nessun prodotto pubblicato</h2>
                <p>I prodotti pubblicati da CaricoFacile appariranno qui.</p>
                <a class="btn btn-primary" href="#/home">Carica un prodotto</a>
              </div>
            `
      }
    </section>
  `;

  container.querySelector('#retry-products')?.addEventListener('click', () => {
    renderProducts(container);
  });

  const search = container.querySelector('#product-search');
  const empty = container.querySelector('#product-filter-empty');
  search?.addEventListener('input', () => {
    const query = search.value.trim().toLocaleLowerCase('it-IT');
    let visible = 0;
    container.querySelectorAll('.product-row').forEach((row) => {
      const matches = !query || row.dataset.search.includes(query);
      row.hidden = !matches;
      if (matches) visible += 1;
    });
    empty.hidden = visible > 0;
  });
}
