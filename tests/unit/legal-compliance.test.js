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
    // The consent check lives in the shared fulfillment module imported by the
    // webhook, both fallback functions and the reconciler: the evidence trail
    // is enforced on EVERY fulfillment path, not only on the webhook.
    const shared = read('supabase/functions/_shared/fulfillment.ts');
    expect(shared).toContain('session.consent?.terms_of_service !== "accepted"');
    expect(shared).toContain('.from("checkout_legal_acceptances")');
    expect(shared).toContain('onConflict: "stripe_session_id"');

    for (const consumer of [
      'supabase/functions/stripe-webhook/index.ts',
      'supabase/functions/complete-order-purchase/index.ts',
      'supabase/functions/complete-giftcard-purchase/index.ts',
    ]) {
      expect(read(consumer)).toContain('recordCheckoutLegalAcceptance');
    }
  });

  it('uses RLS and least privilege for acceptance records', () => {
    const migration = read('supabase/migrations/20260730210000_checkout_legal_acceptances.sql');
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('GRANT SELECT ON TABLE');
    expect(migration).not.toContain('GRANT ALL ON TABLE');
    expect(migration).toContain('ON DELETE SET NULL');
  });

  it('removes Supabase default grants from legal evidence and price history', () => {
    const hardening = read(
      'supabase/migrations/20260731003000_tighten_legal_and_price_history_privileges.sql',
    );

    expect(hardening).toContain(
      'REVOKE ALL ON TABLE public.checkout_legal_acceptances',
    );
    expect(hardening).toContain(
      'GRANT SELECT, INSERT, UPDATE ON TABLE public.checkout_legal_acceptances TO service_role',
    );
    expect(hardening).toContain(
      'REVOKE ALL ON TABLE public.product_price_history',
    );
    expect(hardening).toContain(
      'REVOKE ALL ON SEQUENCE public.product_price_history_id_seq',
    );
    expect(hardening).not.toContain(
      'GRANT ALL ON TABLE public.checkout_legal_acceptances',
    );
    expect(hardening).not.toContain(
      'GRANT ALL ON TABLE public.product_price_history',
    );
    expect(hardening).not.toContain(
      'GRANT ALL ON SEQUENCE public.product_price_history_id_seq',
    );
  });
});

describe('food information and advertised-price safeguards', () => {
  it('blocks prepared foods until mandatory information is human-verified', () => {
    const migration = read(
      'supabase/migrations/20260731000000_omnibus_food_info_compliance.sql',
    );
    const checkout = read('supabase/functions/create-checkout-session/index.ts');
    const product = read('product.html');

    expect(migration).toContain('food_information_required');
    expect(migration).toContain('food_information_verified_at');
    expect(migration).toContain('products_verified_food_information_complete');
    expect(migration).toContain('products_prepared_food_requires_information');
    expect(migration).toContain("gender IN ('conserve', 'secchi-estratti')");
    expect(checkout).toContain(
      'product.food_information_required && !product.food_information_verified_at',
    );
    expect(product).toContain('isFoodInformationBlocked');
    expect(product).toContain('Temporaneamente non acquistabile');
  });

  it('provides an admin verification workflow without inventing product data', () => {
    const admin = read('admin/index.html');
    const adminLogic = read('admin/admin.js');

    for (const field of [
      'productIngredients',
      'productAllergens',
      'productNetQuantity',
      'productFoodOperator',
      'productStorage',
      'productNutritionDeclaration',
      'productFoodInfoVerified',
    ]) {
      expect(admin).toContain(`id="${field}"`);
    }
    expect(adminLogic).toContain('food_information_verified_at');
    expect(adminLogic).toContain('new Date().toISOString()');
  });

  it('records the prior 30-day price for announced discounts', () => {
    const migration = read(
      'supabase/migrations/20260731000000_omnibus_food_info_compliance.sql',
    );

    expect(migration).toContain('product_price_history');
    expect(migration).toContain('set_omnibus_reference_price');
    expect(migration).toContain('lowest_price_30d');
    expect(read('product.html')).toContain('Prezzo più basso negli ultimi 30 giorni');
  });
});
