const QUOTA_TTL_SECONDS = 172_800;

export function quotaKey(tenant, date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  return `quota:${tenant}:${day}`;
}

export async function checkQuota(kv, tenant, requestedLimit = 100, now = new Date()) {
  const limit = Math.min(10_000, Math.max(1, Number(requestedLimit) || 100));
  const key = quotaKey(tenant, now);
  const stored = await kv.get(key);
  const current = Math.max(0, Number.parseInt(stored || '0', 10) || 0);

  if (current >= limit) {
    return { allowed: false, count: current, remaining: 0, limit };
  }

  const count = current + 1;
  await kv.put(key, String(count), { expirationTtl: QUOTA_TTL_SECONDS });
  return {
    allowed: true,
    count,
    remaining: Math.max(0, limit - count),
    limit,
  };
}
