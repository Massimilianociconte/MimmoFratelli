import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workerDirectory = resolve(scriptDirectory, '..');
const projectDirectory = resolve(workerDirectory, '..', '..');
const templatePath = resolve(
  workerDirectory,
  'config',
  'tenant.mimmo.example.json',
);
const siteConfigPath = resolve(projectDirectory, 'js', 'config.js');
const outputPath = resolve(
  workerDirectory,
  process.argv[2] || 'config/tenant.mimmo.local.json',
);

function extract(source, name) {
  const match = source.match(
    new RegExp(`${name}\\s*:\\s*['"]([^'"]+)['"]`),
  );
  if (!match?.[1]) throw new Error(`Missing ${name} in js/config.js`);
  return match[1];
}

function decodeJwtPayload(token) {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('The public Supabase key is not a JWT');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

const [templateSource, siteConfigSource] = await Promise.all([
  readFile(templatePath, 'utf8'),
  readFile(siteConfigPath, 'utf8'),
]);

const config = JSON.parse(templateSource);
const supabaseUrl = extract(siteConfigSource, 'SUPABASE_URL');
const anonKey = extract(siteConfigSource, 'SUPABASE_ANON_KEY');
const url = new URL(supabaseUrl);
const projectRef = url.hostname.split('.')[0];
const claims = decodeJwtPayload(anonKey);

if (
  url.protocol !== 'https:' ||
  !url.hostname.endsWith('.supabase.co') ||
  claims.role !== 'anon' ||
  claims.ref !== projectRef
) {
  throw new Error('Supabase public configuration does not match the linked project');
}

config.public.supabaseUrl = url.origin;
config.public.anonKey = anonKey;

await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, {
  mode: 0o600,
});

console.log(`Tenant config rendered: ${outputPath}`);
