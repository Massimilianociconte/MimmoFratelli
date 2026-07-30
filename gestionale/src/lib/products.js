import { getTenantConfig, isLocalDemo } from '../config/tenant.js';
import { getClient } from './supabase.js';

const DEMO_PRODUCTS_PREFIX = 'caricofacile:demo-products:';

function demoKey() {
  return `${DEMO_PRODUCTS_PREFIX}${getTenantConfig().slug}`;
}

function readDemoProducts() {
  try {
    return JSON.parse(localStorage.getItem(demoKey()) || '[]');
  } catch {
    return [];
  }
}

export async function addDemoProduct(parsed) {
  const products = readDemoProducts();
  const now = new Date().toISOString();
  const product = {
    id: crypto.randomUUID(),
    name: parsed.name,
    price: parsed.price / 100,
    sale_price: parsed.sale_price ? parsed.sale_price / 100 : null,
    is_active: true,
    images: parsed.images
      .map((image) => (typeof image === 'string' ? image : image?.dataUrl))
      .filter(Boolean),
    created_at: now,
    isDemo: true,
  };
  products.unshift(product);
  localStorage.setItem(demoKey(), JSON.stringify(products));
  return product;
}

export async function listProducts() {
  if (isLocalDemo()) return readDemoProducts();

  const client = getClient();
  const { data, error } = await client
    .from('products')
    .select('id,name,price,sale_price,is_active,images,created_at')
    .order('created_at', { ascending: false })
    .limit(250);

  if (error) throw error;
  return data || [];
}
