import type { Env } from '../types/Env';

// Build a dynamic sitemap using database content.
// Includes static core routes plus dynamic blog posts (published only).
// Mirrors logic of frontend build script but served on-demand.

interface SitemapEntry {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: number;
  image?: { loc: string; title?: string; caption?: string } | null;
}

const BASE = 'https://avantenutri.com.br';

// Static routes with associated changefreq/priority heuristics
interface StaticRoute { path: string; changefreq?: string; priority?: number }
const STATIC_ROUTES: StaticRoute[] = [
  { path: '/', changefreq: 'daily', priority: 1.0 },
  { path: '/blog', changefreq: 'daily', priority: 0.9 },
  // '/planos' removido após migração para créditos
  { path: '/pricing', changefreq: 'weekly', priority: 0.8 },
  { path: '/termos', changefreq: 'yearly', priority: 0.4 },
  { path: '/privacidade', changefreq: 'yearly', priority: 0.4 },
  { path: '/login', changefreq: 'monthly', priority: 0.2 },
  { path: '/register', changefreq: 'monthly', priority: 0.2 },
  { path: '/recuperar-senha', changefreq: 'monthly', priority: 0.1 },
  { path: '/agendar-consulta', changefreq: 'monthly', priority: 0.5 },
];

function esc(str: string = ''): string {
  return str.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  } as const)[c] || c);
}

export async function buildDynamicSitemap(env: Env): Promise<string> {
  // Fetch dynamic blog posts (published only). Limit generously (pagination not needed unless huge volumes)
  const rows = await env.DB.prepare(`SELECT slug, title, excerpt, cover_image_url, published_at, updated_at FROM blog_posts WHERE status='published' ORDER BY published_at DESC LIMIT 5000`).all<any>();
  const blogEntries: SitemapEntry[] = (rows.results || []).map((r: any) => ({
    loc: `${BASE}/blog/${r.slug}`,
    lastmod: (r.updated_at || r.published_at || '').slice(0,10) || undefined,
    changefreq: 'weekly',
    priority: 0.7,
    image: r.cover_image_url ? { loc: r.cover_image_url, title: r.title, caption: r.excerpt } : null,
  }));

  const staticEntries: SitemapEntry[] = STATIC_ROUTES.map(r => ({ loc: BASE + r.path, changefreq: r.changefreq, priority: r.priority }));

  const all = [...staticEntries, ...blogEntries];

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">');
  for (const e of all) {
    lines.push('  <url>');
    lines.push(`    <loc>${esc(e.loc)}</loc>`);
    if (e.lastmod) lines.push(`    <lastmod>${esc(e.lastmod)}</lastmod>`);
    if (e.changefreq) lines.push(`    <changefreq>${esc(e.changefreq)}</changefreq>`);
    if (typeof e.priority === 'number') lines.push(`    <priority>${e.priority.toFixed(1)}</priority>`);
    if (e.image) {
      lines.push('    <image:image>');
      lines.push(`      <image:loc>${esc(e.image.loc)}</image:loc>`);
      if (e.image.title) lines.push(`      <image:title>${esc(e.image.title).slice(0,200)}</image:title>`);
      if (e.image.caption) lines.push(`      <image:caption>${esc(e.image.caption).slice(0,300)}</image:caption>`);
      lines.push('    </image:image>');
    }
    lines.push('  </url>');
  }
  lines.push('</urlset>');
  return lines.join('\n');
}
