// Only public, aggregate snapshots may use this shared cache. Never cache tokens or inboxes.
export async function cachedStatistics<T>(origin: string, compute: () => Promise<T>): Promise<T> {
  const key = new Request(origin + '/__statistics_cache/v1');
  let cache: Cache | undefined;
  try {
    cache = await caches.open('agentlife-statistics-v1');
    const hit = await cache.match(key);
    if (hit) {
      const saved = await hit.json() as { expiresAt: number; value: T };
      if (saved.expiresAt > Date.now()) return saved.value;
    }
  } catch {
    console.warn('Statistics cache read unavailable');
  }
  const value = await compute(); // Failed queries are never cached as valid statistics.
  if (cache) {
    try {
      await cache.put(key, Response.json({ expiresAt: Date.now() + 300_000, value }, {
        headers: { 'Cache-Control': 'public, max-age=300' },
      }));
    } catch {
      console.warn('Statistics cache write unavailable');
    }
  }
  return value;
}
