import type { Env } from '../types/Env';

interface VerifyResult { valid: boolean; payload?: any; reason?: string }

let jwksCache: { fetchedAt: number; keys: any[] } | null = null;
const JWKS_TTL_MS = 5 * 60 * 1000;

async function fetchJwks(env: Env) {
  if (!env.JWT_PUBLIC_KEY_PEM) return null; // using direct key
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
  try {
    // We also can build local jwks from PEM (already served by jwks endpoint) but fetch real endpoint for rotation.
    const url = `https://${env.SITE_DNS.replace(/^https?:\/\//,'')}/auth/.well-known/jwks.json`;
    const r = await fetch(url, { method: 'GET' });
    if (!r.ok) return null;
    const data: any = await r.json();
    if (data && Array.isArray(data.keys)) {
      jwksCache = { fetchedAt: Date.now(), keys: data.keys };
      return jwksCache.keys;
    }
  } catch {}
  return null;
}

function b64UrlToBytes(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + pad).replace(/-/g,'+').replace(/_/g,'/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));
}

async function importRsaPublicFromJwk(jwk: any) {
  if (!jwk.n || !jwk.e) return null;
  return await crypto.subtle.importKey('jwk', { ...jwk, kty: 'RSA', alg: 'RS256', ext: true }, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['verify']);
}

async function verifyRS(token: string, env: Env): Promise<any | null> {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return null;
  try {
    const header = JSON.parse(atob(h.replace(/-/g,'+').replace(/_/g,'/')));
    if (header.alg !== 'RS256') return null;
    const payload = JSON.parse(atob(p.replace(/-/g,'+').replace(/_/g,'/')));
    if (payload.exp && payload.exp < Math.floor(Date.now()/1000)) return null;
    const data = new TextEncoder().encode(`${h}.${p}`);
    const sig = b64UrlToBytes(s);
    // Direct PEM path
    if (env.JWT_PUBLIC_KEY_PEM) {
      const spki = env.JWT_PUBLIC_KEY_PEM.replace(/-----BEGIN PUBLIC KEY-----/g,'').replace(/-----END PUBLIC KEY-----/g,'').replace(/\s+/g,'');
      const der = b64UrlToBytes(spki.replace(/-/g,'+').replace(/_/g,'/')); // though spki is base64 standard not url
      // convert base64 (not url) properly
      const der2 = Uint8Array.from(atob(spki), c=>c.charCodeAt(0));
      const key = await crypto.subtle.importKey('spki', der2, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['verify']);
      const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data);
      return ok ? payload : null;
    }
    // JWKS path (not strictly needed if we always have PEM)
    const jwks = await fetchJwks(env);
    if (!jwks) return null;
    const jwk = jwks.find((k: any) => k.kid === header.kid) || jwks[0];
    if (!jwk) return null;
    const key = await importRsaPublicFromJwk(jwk);
    if (!key) return null;
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data);
    return ok ? payload : null;
  } catch {
    return null;
  }
}

export async function verifyAccessToken(env: Env, token: string, { issuer, audience }: { issuer?: string; audience?: string } = {}): Promise<VerifyResult> {
  if (!token) return { valid: false, reason: 'missing' };
  // Only RS256 accepted once RSA present
  const payload = await verifyRS(token, env);
  if (!payload) return { valid: false, reason: 'invalid_signature_or_exp' };
  if (issuer && payload.iss !== issuer) return { valid: false, reason: 'bad_iss' };
  if (audience && payload.aud !== audience) return { valid: false, reason: 'bad_aud' };
  // Revogação por jti
  if (payload.jti) {
    try {
      const row = await env.DB.prepare(`SELECT jti FROM revoked_jti WHERE jti = ? LIMIT 1`).bind(payload.jti).first<any>();
      if (row) return { valid: false, reason: 'revoked' };
    } catch {}
  }
  return { valid: true, payload };
}
