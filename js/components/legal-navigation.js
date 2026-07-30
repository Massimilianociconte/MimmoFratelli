/**
 * Shared legal navigation and checkout/account notices.
 *
 * Static legal pages remain the crawlable source of truth. This component adds
 * consistent links to the existing legacy footers without duplicating edits in
 * every page template.
 */

const SITE_ROOT = (() => {
  const source = document.currentScript?.src;
  if (!source) return new URL('/', window.location.href);
  return new URL('../../', source);
})();

const LEGAL_LINKS = [
  ['Privacy', 'privacy-policy.html'],
  ['Termini di servizio', 'termini-servizio.html'],
  ['Trasparenza AI', 'trasparenza-ai.html'],
  ['Contatti e assistenza', 'contacts.html'],
];

const LEGAL_NAME = 'ELHEFNAWI AHMED ABDELAZIZ ABOUKHALIL ABDELMOTY';
const VAT_NUMBER = '10580930963';

function siteUrl(relativePath) {
  return new URL(relativePath, SITE_ROOT).href;
}

function createLegalLinks() {
  const wrapper = document.createElement('nav');
  wrapper.className = 'footer-legal-links';
  wrapper.setAttribute('aria-label', 'Informazioni legali');

  for (const [label, path] of LEGAL_LINKS) {
    const anchor = document.createElement('a');
    anchor.href = siteUrl(path);
    anchor.textContent = label;
    wrapper.append(anchor);
  }

  return wrapper;
}

function installFooterLinks() {
  document.querySelectorAll('.site-footer .footer-content').forEach((footer) => {
    if (footer.querySelector('.footer-legal-links')) return;

    const copy = footer.querySelector('.footer-copy');
    const links = createLegalLinks();
    const identity = document.createElement('p');
    identity.className = 'footer-legal-identity';
    identity.textContent =
      `“Mimmo Fratelli” è il nome commerciale di ${LEGAL_NAME}, ` +
      `impresa individuale · P. IVA ${VAT_NUMBER}.`;

    if (copy) {
      copy.insertAdjacentElement('afterend', links);
      links.insertAdjacentElement('afterend', identity);
      copy.textContent = `© ${new Date().getFullYear()} Mimmo Fratelli. Tutti i diritti riservati.`;
    } else {
      footer.append(links, identity);
    }
  });
}

function installCheckoutNotice() {
  const paymentButton = document.getElementById('payStripe');
  if (!paymentButton || document.querySelector('.checkout-legal-note')) return;

  const notice = document.createElement('p');
  notice.className = 'checkout-legal-note';
  notice.innerHTML =
    `Su Stripe ti verrà chiesto di accettare i ` +
    `<a href="${siteUrl('termini-servizio.html')}" target="_blank" rel="noopener">Termini di servizio</a>. ` +
    `Consulta anche la <a href="${siteUrl('privacy-policy.html')}" target="_blank" rel="noopener">Privacy policy</a>.`;
  paymentButton.insertAdjacentElement('afterend', notice);
}

function installRegistrationNotice() {
  const registerForm = document.getElementById('registerForm');
  if (!registerForm || registerForm.querySelector('.auth-legal-notice')) return;

  const notice = document.createElement('p');
  notice.className = 'auth-legal-notice';
  notice.innerHTML =
    `Creando l’account confermi di aver letto la ` +
    `<a href="${siteUrl('privacy-policy.html')}" target="_blank" rel="noopener">Privacy policy</a> ` +
    `e i <a href="${siteUrl('termini-servizio.html')}" target="_blank" rel="noopener">Termini di servizio</a>.`;

  const submit = registerForm.querySelector('[type="submit"]');
  if (submit) submit.insertAdjacentElement('afterend', notice);
  else registerForm.append(notice);
}

function installPaymentBadges() {
  const methods = ['Visa', 'Mastercard', 'American Express', 'Apple Pay', 'Google Pay', 'Klarna', 'Satispay', 'Link'];

  document.querySelectorAll('.footer-payment-icons, .payment-logos').forEach((container) => {
    if (container.classList.contains('payment-method-text-badges')) return;
    container.replaceChildren();
    container.classList.add('payment-method-text-badges');

    for (const method of methods) {
      const badge = document.createElement('span');
      badge.textContent = method;
      container.append(badge);
    }
  });
}

function installLegalUi() {
  if (
    window.location.pathname.startsWith('/admin/') ||
    window.location.pathname.startsWith('/gestionale/')
  ) {
    return;
  }

  installFooterLinks();
  installCheckoutNotice();
  installRegistrationNotice();
  installPaymentBadges();

  const observer = new MutationObserver(() => {
    installRegistrationNotice();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installLegalUi, { once: true });
} else {
  installLegalUi();
}
