// Lightweight in-memory cache for /admin/users listing within a single worker instance.
// Not persistent across cold starts – acceptable for micro caching.

interface CacheEntry { expires: number; payload: any }
const TTL_MS = 30_000; // 30 seconds
const store = new Map<string, CacheEntry>();

function key(parts: Record<string, unknown>): string {
  return Object.entries(parts)
    .filter(([,v]) => v !== undefined && v !== null && v !== '')
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([k,v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
}

export function getUserListCache(params: { page: number; pageSize: number; q?: string; user_id?: string }) {
  const k = key(params);
  const now = Date.now();
  const entry = store.get(k);
  if (entry && entry.expires > now) {
    return { hit: true as const, data: entry.payload };
  }
  if (entry) store.delete(k);
  return { hit: false as const };
}

export function setUserListCache(params: { page: number; pageSize: number; q?: string; user_id?: string }, payload: any) {
  const k = key(params);
  store.set(k, { expires: Date.now() + TTL_MS, payload });
}

export function invalidateUserListCache() {
  store.clear();
}
