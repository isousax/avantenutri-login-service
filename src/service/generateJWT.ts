
function base64UrlEncode(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function generateJWT(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSec = 3600
) {
  const header = { alg: "HS256", typ: "JWT" };
  const exp = Math.floor(Date.now() / 1000) + expiresInSec;
  const fullPayload = { ...payload, exp };

  const encoder = new TextEncoder();
  const headerBase64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadBase64 = base64UrlEncode(encoder.encode(JSON.stringify(fullPayload)));

  const unsignedToken = `${headerBase64}.${payloadBase64}`;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(unsignedToken));
  const signatureBase64 = base64UrlEncode(new Uint8Array(signature));

  return `${unsignedToken}.${signatureBase64}`;
}
