import { getTenantConfig } from '../../config/tenant.js';
import { icon } from '../icons.js';

const channels = [
  { key: 'photo', label: 'Foto', icon: 'camera', requiresAi: true },
  { key: 'voice', label: 'Detta', icon: 'mic', requiresAi: true },
  { key: 'csv', label: 'File', icon: 'file' },
  { key: 'barcode', label: 'Barcode', icon: 'barcode' },
  { key: 'manual', label: 'A mano', icon: 'edit', wide: true },
];

export function renderHome(container) {
  const config = getTenantConfig();
  container.innerHTML = `
    <section class="home-view" aria-labelledby="home-title">
      <h1 id="home-title">Cosa vuoi caricare?</h1>
      <div class="tile-grid">
        ${channels
          .map((channel) => {
            const disabled = channel.requiresAi && config.aiLevel === 'none';
            const classes = `tile${channel.wide ? ' tile-wide' : ''}${
              disabled ? ' tile-disabled' : ''
            }`;
            return `
              <a
                class="${classes}"
                href="${disabled ? '#/home' : `#/channel/${channel.key}`}"
                ${disabled ? 'aria-disabled="true"' : ''}
              >
                ${icon(channel.icon, 'tile-icon')}
                <span>${channel.label}</span>
                ${disabled ? '<small class="tile-note">richiede AI</small>' : ''}
              </a>
            `;
          })
          .join('')}
      </div>
    </section>
  `;
}
