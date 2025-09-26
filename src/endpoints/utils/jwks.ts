import type { Env } from "../../types/Env";

// Decodifica base64 DER SPKI e extrai modulus (n) e exponent (e) do RSA public key
// Estrutura esperada (simplificada): SubjectPublicKeyInfo -> BIT STRING -> RSAPublicKey SEQUENCE { modulus INTEGER, exponent INTEGER }
function extractModExpFromSpki(
  spkiDer: Uint8Array
): { n: string; e: string } | null {
  // Parser ASN.1 extremamente minimalista apenas para este caso comum.
  let offset = 0;
  function readLen(): number {
    let len = spkiDer[offset++];
    if (len & 0x80) {
      const bytes = len & 0x7f;
      len = 0;
      for (let i = 0; i < bytes; i++) len = (len << 8) | spkiDer[offset++];
    }
    return len;
  }
  function expect(tag: number) {
    if (spkiDer[offset++] !== tag) throw new Error("ASN.1 tag mismatch");
  }
  try {
    expect(0x30); // SEQUENCE (SubjectPublicKeyInfo)
    readLen();
    expect(0x30); // SEQUENCE (alg id)
    readLen();
    // skip algorithm oid + params (expect OID tag 0x06 then maybe NULL)
    if (spkiDer[offset] === 0x06) {
      // OID
      offset++;
      const l = readLen();
      offset += l; // skip OID value
    }
    if (spkiDer[offset] === 0x05) {
      // NULL
      offset++;
      readLen();
    }
    // Public key bit string
    if (spkiDer[offset++] !== 0x03) throw new Error("Expected BIT STRING");
    const pkLen = readLen();
    offset++; // skip unused bits count
    // Inside: RSAPublicKey SEQUENCE
    if (spkiDer[offset++] !== 0x30)
      throw new Error("Expected RSAPublicKey SEQUENCE");
    readLen();
    // modulus
    if (spkiDer[offset++] !== 0x02)
      throw new Error("Expected INTEGER (modulus)");
    let modLen = readLen();
    // Remove optional leading 0x00
    if (spkiDer[offset] === 0x00) {
      offset++;
      modLen--;
    }
    const modulus = spkiDer.slice(offset, offset + modLen);
    offset += modLen;
    // exponent
    if (spkiDer[offset++] !== 0x02)
      throw new Error("Expected INTEGER (exponent)");
    const expLen = readLen();
    const exponent = spkiDer.slice(offset, offset + expLen);
    offset += expLen;
    const b64Url = (buf: Uint8Array) =>
      btoa(String.fromCharCode(...buf))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    return { n: b64Url(modulus), e: b64Url(exponent) };
  } catch {
    return null;
  }
}

function buildJwks(publicPem: string, kid: string) {
  const lines = publicPem.trim().split(/\r?\n/);
  const b64 = lines
    .filter((l) => !l.includes("BEGIN") && !l.includes("END"))
    .join("");
  let n: string | undefined;
  let e: string | undefined;
  try {
    const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const ne = extractModExpFromSpki(der);
    if (ne) {
      n = ne.n;
      e = ne.e;
    }
  } catch {
    /* ignore */
  }
  return {
    keys: [
      {
        kty: "RSA",
        use: "sig",
        alg: "RS256",
        kid,
        x5c: [b64],
        ...(n && e ? { n, e } : {}),
      },
    ],
  };
}

export async function jwksHandler(env: Env): Promise<Response> {
  if (!env.JWT_PUBLIC_KEY_PEM) {
    return new Response(JSON.stringify({ error: "JWKS unavailable" }), {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  }
  const kid = env.JWT_JWKS_KID || "k1";
  const body = JSON.stringify(buildJwks(env.JWT_PUBLIC_KEY_PEM, kid));
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
}
