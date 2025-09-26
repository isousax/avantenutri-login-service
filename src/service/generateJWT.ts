
function b64Url(buf: Uint8Array) {
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function generateJWT(
  payload: Record<string, unknown>,
  legacySecret: string,
  expiresInSec = 3600,
  opts?: { privateKeyPem?: string; kid?: string }
) {
  const exp = Math.floor(Date.now() / 1000) + expiresInSec;
  const jti = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const fullPayload = { ...payload, exp, jti };
  const encoder = new TextEncoder();

  if (opts?.privateKeyPem) {
    // RS256
    const pkcs8 = opts.privateKeyPem
      .replace(/-----BEGIN PRIVATE KEY-----/g, '')
      .replace(/-----END PRIVATE KEY-----/g, '')
      .replace(/\s+/g, '');
    const der = Uint8Array.from(atob(pkcs8), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      'pkcs8',
      der,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const header = { alg: 'RS256', typ: 'JWT', ...(opts.kid ? { kid: opts.kid } : {}) };
    const hB64 = b64Url(encoder.encode(JSON.stringify(header)));
    const pB64 = b64Url(encoder.encode(JSON.stringify(fullPayload)));
    const unsigned = `${hB64}.${pB64}`;
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned));
    return `${unsigned}.${b64Url(new Uint8Array(sig))}`;
  }

  // Fallback HS256 (legacy)
  const header = { alg: 'HS256', typ: 'JWT' };
  const hB64 = b64Url(encoder.encode(JSON.stringify(header)));
  const pB64 = b64Url(encoder.encode(JSON.stringify(fullPayload)));
  const unsigned = `${hB64}.${pB64}`;
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(legacySecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', hmacKey, encoder.encode(unsigned));
  return `${unsigned}.${b64Url(new Uint8Array(sig))}`;
}
