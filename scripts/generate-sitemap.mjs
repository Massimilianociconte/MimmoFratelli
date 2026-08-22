#!/usr/bin/env node
/**
 * Genera sitemap.xml interrogando il catalogo attivo su Supabase.
 *
 * Chiude il gap SEO principale rilevato dall'audit: prima i singoli prodotti
 * non erano scopribili dai motori (sitemap statica con solo product.html
 * generico e catalogo client-rendered).
 *
 * Uso:
 *   npm run build:sitemap
 *
 * La chiave anon è pubblica by-design: la query filtra is_active=true tramite
 * le policy RLS in sola lettura.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Estrae SUPABASE_URL e ANON_KEY direttamente da js/config.js (fonte unica).
const configSource = readFileSync(join(root, 'js', 'config.js'), 'utf8');
function extractConfigValue(key) {
  const match = configSource.match(new RegExp(`${key}:\\s*'([^']+)'`));
  if (!match) throw new Error(`Chiave ${key} non trovata in js/config.js`);
  return match[1];
}

const SUPABASE_URL = extractConfigValue('SUPABASE_URL');
const SUPABASE_ANON_KEY = extractConfigValue('SUPABASE_ANON_KEY');
const SITE = 'https://www.mimmofratelli.com';
const SITEMAP_PATH = join(root, 'sitemap.xml');

async function fetchAllActiveProducts() {
  const products = [];
  const pageSize = 1000;
  let from = 0;

  for (;;) {
    const url =
      `${SUPABASE_URL}/rest/v1/products` +
      `?select=slug,id,name,updated_at,images,price,sale_price` +
      `&is_active=eq.true&order=updated_at.desc` +
      `&limit=${pageSize}&offset=${from}`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    if (!res.ok) {
      throw new Error(`Supabase REST error ${res.status}: ${await res.text()}`);
    }
    const rows = await res.json();
    products.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return products;
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function productUrl(product) {
  const identifier = product.slug || product.id;
  return `${SITE}/product.html?slug=${encodeURIComponent(identifier)}`;
}

function buildProductEntry(product) {
  const loc = productUrl(product);
  const lastmod = product.updated_at ? new Date(product.updated_at).toISOString() : null;
  const image = Array.isArray(product.images) && product.images.length > 0
    ? product.images[0]
    : null;

  return [
    '  <url>',
    `    <loc>${escapeXml(loc)}</loc>`,
    ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
    '    <changefreq>daily</changefreq>',
    '    <priority>0.8</priority>',
    ...(image
      ? [
          '    <image:image>',
          `      <image:loc>${escapeXml(image)}</image:loc>`,
          `      <image:title>${escapeXml(product.name)}</image:title>`,
          '    </image:image>',
        ]
      : []),
    '  </url>',
  ].join('\n');
}

const STATIC_ENTRIES = [
  { loc: `${SITE}/`, priority: '1.0', changefreq: 'weekly', image: `${SITE}/Images/logo_mimmofratelli_verde.png`, title: 'Mimmo Fratelli - Frutta e Verdura Fresca' },
  { loc: `${SITE}/collection.html?gender=frutta`, priority: '0.9', changefreq: 'daily' },
  { loc: `${SITE}/collection.html?gender=verdura`, priority: '0.9', changefreq: 'daily' },
  { loc: `${SITE}/collection.html?gender=conserve`, priority: '0.9', changefreq: 'daily' },
  { loc: `${SITE}/collection.html?gender=secchi-estratti`, priority: '0.9', changefreq: 'daily' },
  { loc: `${SITE}/about.html`, priority: '0.7', changefreq: 'monthly' },
  { loc: `${SITE}/contacts.html`, priority: '0.8', changefreq: 'monthly' },
  { loc: `${SITE}/promos.html`, priority: '0.8', changefreq: 'daily' },
  { loc: `${SITE}/trasparenza-ai.html`, priority: '0.7', changefreq: 'monthly' },
  { loc: `${SITE}/privacy-policy.html`, priority: '0.6', changefreq: 'monthly' },
  { loc: `${SITE}/termini-servizio.html`, priority: '0.6', changefreq: 'monthly' },
];

async function main() {
  console.log('Fetch catalogo attivo da Supabase...');
  const products = await fetchAllActiveProducts();
  console.log(`Trovati ${products.length} prodotti attivi`);

  const withSlug = products.filter(p => p.slug);
  const withoutSlug = products.length - withSlug.length;
  if (withoutSlug > 0) {
    console.warn(`⚠️  ${withoutSlug} prodotti senza slug esclusi (usano ?id=): valorizzare slug per l'indicizzazione`);
  }

  // Dedup per slug: il primo (updated_at più recente) vince.
  const seen = new Set();
  const uniqueProducts = [];
  for (const p of withSlug) {
    if (seen.has(p.slug)) continue;
    seen.add(p.slug);
    uniqueProducts.push(p);
  }

  const nowIso = new Date().toISOString();

  const xmlParts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    '',
    '  <!-- Generato automaticamente: npm run build:sitemap -->',
    `  <!-- Ultima generazione: ${nowIso} -->`,
    '',
    ...STATIC_ENTRIES.map(entry =>
      [
        '  <url>',
        `    <loc>${entry.loc}</loc>`,
        `    <lastmod>${nowIso.slice(0, 10)}</lastmod>`,
        `    <changefreq>${entry.changefreq}</changefreq>`,
        `    <priority>${entry.priority}</priority>`,
        ...(entry.image
          ? [
              '    <image:image>',
              `      <image:loc>${entry.image}</image:loc>`,
              `      <image:title>${escapeXml(entry.title)}</image:title>`,
              '    </image:image>',
            ]
          : []),
        '  </url>',
      ].join('\n')
    ),
    '',
    '  <!-- Prodotti attivi -->',
    ...uniqueProducts.map(buildProductEntry),
    '</urlset>',
    '',
  ];

  writeFileSync(SITEMAP_PATH, xmlParts.join('\n'), 'utf8');
  console.log(`✅ sitemap.xml rigenerato: ${STATIC_ENTRIES.length + uniqueProducts.length} URL (${uniqueProducts.length} prodotti)`);
}

main().catch(err => {
  console.error('❌ Generazione sitemap fallita:', err.message);
  process.exit(1);
});
