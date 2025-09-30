import type { Env } from "../../types/Env";
import {
  findSessionByRefreshToken,
  rotateSession,
  generateRefreshToken,
} from "../../service/sessionManager";
import { generateJWT } from "../../service/generateJWT";
import { clearAttempts } from "../../service/authAttempts";

// helpers
const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

function jsonResponse(body: unknown, status = 200, requestId?: string) {
  const headers: Record<string, string> = { ...JSON_HEADERS };
  if (requestId) headers["X-Request-Id"] = requestId;
  return new Response(JSON.stringify(body), { status, headers });
}

function short(v?: string | null): string {
  if (!v) return "";
  if (v.length <= 8) return v;
  return `${v.slice(0, 6)}…`;
}

function nowMs() {
  return Date.now();
}

/**
 * Log estruturado helper.
 * stage: string breve indicando a etapa
 * meta: qualquer info adicional (será serializada)
 */
function logInfo(requestId: string, stage: string, meta: Record<string, unknown> = {}) {
  console.info(JSON.stringify({ level: "info", requestId, stage, ...meta }));
}
function logWarn(requestId: string, stage: string, meta: Record<string, unknown> = {}) {
  console.warn(JSON.stringify({ level: "warn", requestId, stage, ...meta }));
}
function logError(requestId: string, stage: string, meta: Record<string, unknown> = {}) {
  console.error(JSON.stringify({ level: "error", requestId, stage, ...meta }));
}

interface RefreshRequestBody {
  refresh_token: string;
}

interface DBUserProfile {
  email?: string | null;
  full_name?: string | null;
  phone?: string | null;
  birth_date?: string | null;
  role?: string | null;
  email_confirmed?: number | null;
  session_version?: number | null;
  display_name?: string | null;
}

export async function refreshTokenHandler(request: Request, env: Env): Promise<Response> {
  // requestId: usa cabeçalho se presente para correlação, senão gera.
  const headerReqId = request.headers.get("x-request-id") || request.headers.get("X-Request-Id");
  const requestId = headerReqId || (typeof crypto !== "undefined" && (crypto as any).randomUUID ? (crypto as any).randomUUID() : `rid-${nowMs()}`);

  const start = nowMs();
  logInfo(requestId, "start", { msg: "[refreshTokenHandler] solicitação recebida", method: request.method, url: request.url });

  // parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch (err: any) {
    logWarn(requestId, "parse_body_failed", { msg: "corpo JSON inválido", err: err?.message || String(err) });
    return jsonResponse({ error: "Invalid JSON body" }, 400, requestId);
  }

  const { refresh_token } = (body as RefreshRequestBody) || {};
  // não logar token completo; só prefixo
  const rtPreview = short(refresh_token);

  if (!refresh_token) {
    logWarn(requestId, "missing_refresh_token", { msg: "refresh_token ausente" });
    return jsonResponse({ error: "refresh_token required" }, 400, requestId);
  }

  if (!env.JWT_SECRET) {
    logError(requestId, "env_misconfig", { msg: "JWT_SECRET ausente no ambiente" });
    return jsonResponse({ error: "Server misconfiguration" }, 500, requestId);
  }

  // Step: find session
  let session: any = null;
  try {
    logInfo(requestId, "find_session", { msg: "procurando sessão para refresh_token", refresh_token_preview: rtPreview });
    session = await findSessionByRefreshToken(env.DB, refresh_token);
  } catch (err: any) {
    // erro em DB/consulta: log detalhado (stack) e 500
    logError(requestId, "find_session_failed", { msg: "findSessionByRefreshToken falhou", error: err?.message || String(err), stack: err?.stack });
    return jsonResponse({ error: "Internal Server Error" }, 500, requestId);
  }

  if (!session) {
    // invalido -> 401
    logWarn(requestId, "session_not_found", { msg: "sessão não encontrada para token", refresh_token_preview: rtPreview });
    return jsonResponse({ error: "Invalid refresh token" }, 401, requestId);
  }

  // basic checks
  if (session.revoked) {
    logWarn(requestId, "session_revoked", { msg: "sessão revogada", session_id: session.id, user_id: session.user_id });
    return jsonResponse({ error: "Refresh token revoked" }, 401, requestId);
  }

  const expiresAt = new Date(session.expires_at).getTime();
  if (isNaN(expiresAt) || expiresAt < Date.now()) {
    logWarn(requestId, "session_expired", { msg: "token de atualização expirado", session_id: session.id, user_id: session.user_id, expires_at: session.expires_at });
    return jsonResponse({ error: "Refresh token expired" }, 401, requestId);
  }

  // fetch user profile by user_id (safer than depender do findSession)
  let userProfile: DBUserProfile | undefined;
  try {
    logInfo(requestId, "fetch_user", { msg: "buscando perfil de usuário", user_id: session.user_id });
    userProfile = await env.DB.prepare(
      `SELECT u.email, u.role, u.email_confirmed, u.session_version, u.display_name,
              p.full_name, p.phone, p.birth_date
         FROM users u
         LEFT JOIN user_profiles p ON p.user_id = u.id
         WHERE u.id = ?`
    )
      .bind(session.user_id)
      .first<DBUserProfile>();
  } catch (err: any) {
    logError(requestId, "fetch_user_failed", { msg: "consulta do usuário falhou", user_id: session.user_id, error: err?.message || String(err), stack: err?.stack });
    return jsonResponse({ error: "Internal Server Error" }, 500, requestId);
  }

  if (userProfile && (userProfile as any).email_confirmed !== 1) {
    logWarn(requestId, "email_not_confirmed", { msg: "email não confirmado", user_id: session.user_id, email: userProfile.email ? short(userProfile.email) : null });
    return jsonResponse({ error: "E-mail não verificado." }, 403, requestId);
  }

  // generate JWT
  let access_token: string;
  try {
    const jwtExp = env.JWT_EXPIRATION_SEC ? Number(env.JWT_EXPIRATION_SEC) : 3600;
    logInfo(requestId, "generate_jwt_start", { msg: "gerando JWT", user_id: session.user_id, expires_in: jwtExp });
    access_token = await generateJWT(
      {
        sub: session.user_id,
        email: userProfile?.email ?? undefined,
        role: userProfile?.role ?? undefined,
        full_name: userProfile?.full_name ?? undefined,
        phone: userProfile?.phone ?? undefined,
        birth_date: userProfile?.birth_date ?? undefined,
        display_name: userProfile?.display_name ?? undefined,
        session_version: userProfile?.session_version ?? 0,
        iss: env.SITE_DNS,
        aud: env.SITE_DNS,
      },
      env.JWT_SECRET,
      env.JWT_EXPIRATION_SEC ? Number(env.JWT_EXPIRATION_SEC) : 3600,
      env.JWT_PRIVATE_KEY_PEM
        ? {
            privateKeyPem: env.JWT_PRIVATE_KEY_PEM,
            kid: env.JWT_JWKS_KID || "k1",
          }
        : undefined
    );
    logInfo(requestId, "generate_jwt_success", { msg: "JWT gerado", user_id: session.user_id });
  } catch (err: any) {
    // jwt generation failure is severe
    logError(requestId, "generate_jwt_failed", { msg: "Falha ao gerar JWT", user_id: session.user_id, error: err?.message || String(err), stack: err?.stack });
    return jsonResponse({ error: "Internal Server Error" }, 500, requestId);
  }

  // rotate refresh token
  let newPlain: string;
  try {
    newPlain = await generateRefreshToken(64);
    const newExpires = session.expires_at; // preserve expiry as design
    logInfo(requestId, "rotate_session_start", { msg: "rotacionando sessão", session_id: session.id, user_id: session.user_id });
    await rotateSession(env.DB, session.id, newPlain, newExpires);
    logInfo(requestId, "rotate_session_success", { msg: "sessão rotacionada", session_id: session.id });
  } catch (err: any) {
    logError(requestId, "rotate_session_failed", { msg: "Falha ao rotacionar sessão", session_id: session.id, user_id: session.user_id, error: err?.message || String(err), stack: err?.stack });
    return jsonResponse({ error: "Internal Server Error" }, 500, requestId);
  }

  // clear attempts (best-effort)
  try {
    if (userProfile?.email) {
      await clearAttempts(env.DB, userProfile.email);
      logInfo(requestId, "clear_attempts_success", { msg: "clearAttempts executado", email_preview: short(userProfile.email) });
    }
  } catch (err: any) {
    logWarn(requestId, "clear_attempts_failed", { msg: "clearAttempts falhou (não fatal)", error: err?.message || String(err) });
    // continue — não falha o fluxo
  }

  const durationMs = nowMs() - start;
  logInfo(requestId, "success", { msg: "refresh token concluído", user_id: session.user_id, durationMs });

  // retorno: NÃO incluir tokens sensíveis nos logs; incluir requestId no header para correlação
  return jsonResponse(
    {
      access_token, // access token is returned to client
      token_type: "Bearer",
      refresh_token: newPlain,
      expires_at: session.expires_at,
      display_name: userProfile?.display_name ?? null,
    },
    200,
    requestId
  );
}