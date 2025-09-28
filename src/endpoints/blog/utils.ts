import type { Env } from "../../types/Env";

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Pragma: 'no-cache' } });
}

export function slugify(base: string): string {
  return base
    .toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export async function ensureUniqueSlug(env: Env, desired: string): Promise<string> {
  let slug = desired;
  let i = 2;
  // loop until unique
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const row = await env.DB.prepare(`SELECT slug FROM blog_posts WHERE slug = ? LIMIT 1`).bind(slug).first<any>();
    if (!row) return slug;
    slug = `${desired}-${i++}`;
  }
}

export function computeReadTime(html: string): number {
  const text = html.replace(/<[^>]+>/g, ' ');
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

export function parseTags(tagsCsv?: string): string[] {
  if (!tagsCsv) return [];
  return tagsCsv.split(',').map(t => t.trim()).filter(Boolean);
}

export function tagsToCsv(tags: string[] | undefined): string | undefined {
  if (!tags || !tags.length) return undefined;
  return tags.map(t => t.trim()).filter(Boolean).join(',');
}

export function requireAdminRole(payload: any): boolean {
  return payload?.role === 'admin' || payload?.role === 'nutri';
}