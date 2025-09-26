import type { Env } from "../../types/Env";
import { comparePassword, hashPassword } from "../../service/managerPassword";
import { generateJWT } from "../../service/generateJWT";
import { verifyAccessToken } from "../../service/tokenVerify";

// Verificação simples de JWT suportando HS256 (fallback) e RS256 quando chave pública estiver disponível.
async function verifyJwtFlexible(token: string, env: Env): Promise<any | null> {
  try {
    const [rawHeader, rawPayload, rawSig] = token.split(".");
    if (!rawHeader || !rawPayload || !rawSig) return null;
    const header = JSON.parse(
      atob(rawHeader.replace(/-/g, "+").replace(/_/g, "/"))
    );
    const payload = JSON.parse(
      atob(rawPayload.replace(/-/g, "+").replace(/_/g, "/"))
    );
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    const alg = header.alg;
    const data = new TextEncoder().encode(`${rawHeader}.${rawPayload}`);
    const sigBytes = Uint8Array.from(
      atob(rawSig.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0)
    );

    if (alg === "RS256" && env.JWT_PUBLIC_KEY_PEM) {
      const spki = env.JWT_PUBLIC_KEY_PEM.replace(
        /-----BEGIN PUBLIC KEY-----/g,
        ""
      )
        .replace(/-----END PUBLIC KEY-----/g, "")
        .replace(/\s+/g, "");
      const der = Uint8Array.from(atob(spki), (c) => c.charCodeAt(0));
      const key = await crypto.subtle.importKey(
        "spki",
        der,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"]
      );
      const ok = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        key,
        sigBytes,
        data
      );
      return ok ? payload : null;
    }
    if (alg === "HS256" && env.JWT_SECRET) {
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(env.JWT_SECRET),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"]
      );
      const ok = await crypto.subtle.verify("HMAC", key, sigBytes, data);
      return ok ? payload : null;
    }
    return null;
  } catch {
    return null;
  }
}

interface Body {
  current_password?: string;
  new_password?: string;
}

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

// Política de senha (mesma usada no front — mantenha sincronizada)
const PASSWORD_POLICY =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-={}\[\]:";'<>?,.\/]).{8,64}$/;

export async function changePasswordHandler(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "Method Not Allowed" }, 405);
  }
  const auth = request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)/i);
  if (!m) return json({ error: "Missing bearer token" }, 401);
  const token = m[1];

  const { valid, payload } = await verifyAccessToken(env, token, {
    issuer: env.SITE_DNS,
    audience: env.SITE_DNS,
  });
  if (!valid || !payload || !payload.sub) {
    return json({ error: "Invalid token" }, 401);
  }
  const userId = payload.sub;

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const { current_password, new_password } = body;
  if (!current_password || !new_password)
    return json({ error: "current_password and new_password required" }, 400);
  if (!PASSWORD_POLICY.test(new_password))
    return json({ error: "Password does not meet complexity policy" }, 400);

  try {
    const row = await env.DB.prepare(
      `SELECT password_hash, email, role FROM users WHERE id = ?`
    )
      .bind(userId)
      .first<{ password_hash: string; email: string; role: string }>();
    if (!row) return json({ error: "User not found" }, 404);

    const ok = await comparePassword(current_password, row.password_hash);
    if (!ok) return json({ error: "Invalid current password" }, 401);

    // Se nova senha igual a atual (comparando hash) rejeitar
    const same = await comparePassword(new_password, row.password_hash);
    if (same)
      return json(
        { error: "New password must be different from current password" },
        400
      );

    const newHash = await hashPassword(new_password);
    // Incrementa session_version para invalidar todos os access tokens anteriores (mesmo não revogados explicitamente)
    await env.DB.prepare(
      `UPDATE users SET password_hash = ?, session_version = session_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    )
      .bind(newHash, userId)
      .first();

    // Auditoria: registrar alteração (sem armazenar senha).
    await env.DB.prepare(
      `INSERT INTO password_change_log (user_id, changed_at, ip) VALUES (?, CURRENT_TIMESTAMP, ? )`
    )
      .bind(userId, request.headers.get("CF-Connecting-IP") || "unknown")
      .first();

    // Revogar JTI anterior explicitamente (para impedir reuso em janelas muito curtas)
    if (payload.jti && payload.exp) {
      const expIso = new Date(payload.exp * 1000).toISOString();
      await env.DB.prepare(
        `INSERT OR IGNORE INTO revoked_jti (jti, user_id, reason, expires_at) VALUES (?, ?, 'password_change', ?)`
      )
        .bind(payload.jti, userId, expIso)
        .first();
    }

    // Opcional: invalidar sessões de refresh existentes (rotacionar). Simples: marcar revoked todas as sessions.
    await env.DB.prepare(
      `UPDATE user_sessions SET revoked = 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`
    )
      .bind(userId)
      .first();

    // Gerar novo access token curto (qualquer token existente idealmente será trocado no front via fluxo refresh/login).
    const expSec = env.JWT_EXPIRATION_SEC
      ? Number(env.JWT_EXPIRATION_SEC)
      : 3600;
    // Recuperar display_name para manter consistência das claims
    let dName: string | null = null;
    try {
      const dRow = await env.DB.prepare(
        "SELECT display_name, session_version FROM users WHERE id = ?"
      )
        .bind(userId)
        .first<{ display_name?: string | null; session_version?: number }>();
      if (dRow) dName = dRow.display_name ?? null;
    } catch {}
    const newToken = await generateJWT(
      {
        sub: userId,
        email: row.email,
        role: row.role,
        display_name: dName ?? undefined,
        iss: env.SITE_DNS,
        aud: env.SITE_DNS,
        session_version: (payload.session_version ?? 0) + 1,
      },
      env.JWT_SECRET,
      expSec,
      env.JWT_PRIVATE_KEY_PEM
        ? {
            privateKeyPem: env.JWT_PRIVATE_KEY_PEM,
            kid: env.JWT_JWKS_KID || "k1",
          }
        : undefined
    );

    const res = json({
      success: true,
      access_token: newToken,
      token_type: "Bearer",
      display_name: dName,
    });
    res.headers.set("X-Password-Changed", "1");
    return res;
  } catch (err: any) {
    return json({ error: "Internal Server Error", detail: err?.message }, 500);
  }
}
