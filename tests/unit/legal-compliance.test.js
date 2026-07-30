import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const root = process.cwd();
const read = (file) => readFileSync(join(root, file), 'utf8');
const legalPages = [
  'privacy-policy.html',
  'termini-servizio.html',
  'trasparenza-ai.html',
];

describe('public legal pages', () => {
  for (const page of legalPages) {
    it(`${page} is indexable, canonical and internally navigable`, () => {
      const dom = new JSDOM(read(page));
      const { document } = dom.window;

      expect(document.documentElement.lang).toBe('it');
      expect(document.title.length).toBeGreaterThan(20);
      expect(document.querySelector('meta[name="description"]')?.content.length).toBeGreaterThan(80);
      expect(document.querySelector('meta[name="robots"]')?.content).toContain('index');
      expect(document.querySelector('link[rel="canonical"]')?.href).toBe(
        `https://www.mimmofratelli.com/${page}`,
      );
      expect(document.querySelectorAll('h1')).toHaveLength(1);
      expect(document.querySelector('main')).not.toBeNull();

      const links = [...document.querySelectorAll('a')].map((link) => link.getAttribute('href'));
      expect(links).toContain('privacy-policy.html');
      expect(links).toContain('termini-servizio.html');
      expect(links).toContain('trasparenza-ai.html');
      expect(links).toContain('contacts.html');

      const jsonLd = document.querySelector('script[type="application/ld+json"]')?.textContent;
      expect(() => JSON.parse(jsonLd)).not.toThrow();
      expect(JSON.parse(jsonLd)['@type']).toBe('WebPage');
      expect(document.body.textContent).not.toMatch(/\[\[|DA CONFERMARE|LOREM IPSUM/i);
    });
  }
});

describe('crawler discovery and privacy boundaries', () => {
  it('publishes all legal URLs in sitemap and llms.txt', () => {
    const sitemap = read('sitemap.xml');
    const llms = read('llms.txt');

    for (const page of legalPages) {
      expect(sitemap).toContain(`https://www.mimmofratelli.com/${page}`);
      expect(llms).toContain(`https://www.mimmofratelli.com/${page}`);
    }
  });

  it('allows public legal pages while excluding private and transactional areas', () => {
    const robots = read('robots.txt');

    for (const page of legalPages) {
      expect(robots).toContain(`Allow: /${page}`);
    }
    for (const privatePath of ['/admin/', '/gestionale/', '/checkout.html', '/orders.html']) {
      expect(robots).toContain(`Disallow: ${privatePath}`);
    }
    expect(robots).not.toContain('checkout-success.html022');
  });

  it('does not load Google Maps before an explicit click', () => {
    const contacts = read('contacts.html');
    expect(contacts).not.toContain('google.com/maps/embed');
    expect(contacts).toContain('La mappa non viene caricata automaticamente');
  });

  it('does not expose gift-card bearer tokens to a public QR service', () => {
    const sourceFiles = [
      'settings.html',
      'checkout-success.html',
      'admin/admin.js',
      'js/services/giftcard.js',
      'js/components/profile-drawer.js',
    ];
    for (const file of sourceFiles) {
      expect(read(file)).not.toContain('api.qrserver.com');
    }

    const qrFunction = read('supabase/functions/generate-giftcard-qr/index.ts');
    expect(qrFunction).toContain('purchased_by');
    expect(qrFunction).toContain('redeemed_by');
    expect(qrFunction).toContain('is_admin');
    expect(qrFunction).toContain('Cache-Control');
  });
});

describe('Stripe terms acceptance evidence', () => {
  it('requires terms acceptance for normal and gift-card Checkout', () => {
    for (const file of [
      'supabase/functions/create-checkout-session/index.ts',
      'supabase/functions/create-giftcard-checkout/index.ts',
    ]) {
      const source = read(file);
      expect(source).toContain('terms_of_service: "required"');
      expect(source).toContain('termsVersion: TERMS_VERSION');
      expect(source).toContain('privacyVersion: PRIVACY_VERSION');
    }
  });

  it('verifies Stripe consent before persisting an accepted version', () => {
    const webhook = read('supabase/functions/stripe-webhook/index.ts');
    expect(webhook).toContain('session.consent?.terms_of_service !== "accepted"');
    expect(webhook).toContain('.from("checkout_legal_acceptances")');
    expect(webhook).toContain('onConflict: "stripe_session_id"');
  });

  it('uses RLS and least privilege for acceptance records', () => {
    const migration = read('supabase/migrations/20260730210000_checkout_legal_acceptances.sql');
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('GRANT SELECT ON TABLE');
    expect(migration).not.toContain('GRANT ALL ON TABLE');
    expect(migration).toContain('ON DELETE SET NULL');
  });
});
