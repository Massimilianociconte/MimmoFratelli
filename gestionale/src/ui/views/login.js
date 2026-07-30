import { getTenantConfig, isLocalDemo } from '../../config/tenant.js';
import { signInAdmin } from '../../lib/auth.js';

function errorMessage(error) {
  if (error?.message === 'not_admin') {
    return 'Questo account non ha il ruolo amministratore.';
  }
  if (error?.message === 'Invalid login credentials') {
    return 'Email o password non corrette.';
  }
  return 'Accesso non riuscito. Controlla la connessione e riprova.';
}

export function renderLogin(container) {
  const config = getTenantConfig();

  container.innerHTML = `
    <main class="login-view">
      <section class="login-panel" aria-labelledby="login-title">
        <div class="brand-lockup" aria-label="CaricoFacile">
          <span class="brand-mark" aria-hidden="true">CF</span>
          <span>${config.appName}</span>
        </div>
        <div>
          <h1 id="login-title">Accedi al gestionale</h1>
          <p class="muted">${config.storeName}</p>
        </div>
        <form class="form-grid" id="login-form">
          <div class="field">
            <label for="login-email">Email</label>
            <input
              id="login-email"
              name="email"
              type="email"
              autocomplete="username"
              inputmode="email"
              required
            />
          </div>
          <div class="field">
            <label for="login-password">Password</label>
            <input
              id="login-password"
              name="password"
              type="password"
              autocomplete="current-password"
              required
            />
          </div>
          <p class="form-error visually-stable" id="login-error" role="alert"></p>
          <button class="btn btn-primary" type="submit">Accedi</button>
          ${
            isLocalDemo()
              ? '<button class="btn btn-quiet" id="demo-login" type="button">Apri anteprima locale</button>'
              : ''
          }
        </form>
      </section>
    </main>
  `;

  const form = container.querySelector('#login-form');
  const errorElement = container.querySelector('#login-error');
  const submitButton = form.querySelector('[type="submit"]');

  async function completeLogin(email = '', password = '') {
    errorElement.textContent = '';
    submitButton.disabled = true;
    submitButton.textContent = 'Accesso…';

    try {
      await signInAdmin(email, password);
      window.location.hash = '#/home';
    } catch (error) {
      errorElement.textContent = errorMessage(error);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Accedi';
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    completeLogin(String(formData.get('email')), String(formData.get('password')));
  });

  container.querySelector('#demo-login')?.addEventListener('click', () => completeLogin());
}
