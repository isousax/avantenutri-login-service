import { registerUser } from "./endpoints/auth/RegisterUser";
import { loginUser } from "./endpoints/auth/Login";
import { refreshTokenHandler } from "./endpoints/auth/Refresh";
import { logoutHandler } from "./endpoints/auth/Logout";
import { confirmVerificationToken } from "./endpoints/auth/confirmVerificationToken";
import { resendVerificationCode } from "./endpoints/auth/resendVerificationToken";
import { requestPasswordReset } from "./endpoints/auth/requestPasswordReset";
import { resetPassword } from "./endpoints/auth/resetPassword";
import { jwksHandler } from "./endpoints/utils/jwks";
import { changePasswordHandler } from "./endpoints/auth/changePassword";
import { adminAuditHandler } from "./endpoints/admin/adminAudit";
import { adminChangeRoleHandler } from "./endpoints/admin/adminChangeRole";
import { adminListUsersHandler } from "./endpoints/admin/adminListUsers";
import { adminForceLogoutHandler } from "./endpoints/admin/adminForceLogout";
import { updateProfileHandler } from "./endpoints/user/updateProfile";
import { entitlementsHandler } from "./endpoints/utils/entitlements";

import type { Env } from "./types/Env";
import { meHandler } from "./endpoints/user/me";
import { ensureRequestId } from "./middleware/requestId";
function getCorsHeaders(env: Env, requestId?: string) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Request-Id, X-Api-Key",
    ...(requestId ? { "X-Request-Id": requestId } : {}),
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const requestId = ensureRequestId(request);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: getCorsHeaders(env, requestId) });
    }

    if (request.method === 'GET' && url.pathname === '/auth/.well-known/jwks.json') {
      const r = await jwksHandler(env);
      r.headers.set('Access-Control-Allow-Origin', env.SITE_DNS);
      r.headers.set('X-Request-Id', requestId);
      return r;
    }

    if (request.method === "POST" && url.pathname === "/auth/register") {
      const res = await registerUser(request, env);
      res.headers.set("Access-Control-Allow-Origin", env.SITE_DNS);
      res.headers.set("X-Request-Id", requestId);
      return res;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/auth/confirm-verification"
    ) {
      const res = await confirmVerificationToken(request, env);
      res.headers.set("Access-Control-Allow-Origin", env.SITE_DNS);
      res.headers.set("X-Request-Id", requestId);
      return res;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/auth/resend-verification"
    ) {
      const res = await resendVerificationCode(request, env);
      res.headers.set("Access-Control-Allow-Origin", env.SITE_DNS);
      res.headers.set("X-Request-Id", requestId);
      return res;
    }

    if (request.method === "POST" && url.pathname === "/auth/login") {
      const res = await loginUser(request, env);
      res.headers.set("Access-Control-Allow-Origin", "*");
      res.headers.set("X-Request-Id", requestId);
      return res;
    }

    if (request.method === "POST" && url.pathname === "/auth/me") {
      const res = await meHandler(request, env);
      res.headers.set("Access-Control-Allow-Origin", env.SITE_DNS);
      res.headers.set("X-Request-Id", requestId);
      return res;
    }

    if (request.method === "POST" && url.pathname === "/auth/refresh") {
      const res = await refreshTokenHandler(request, env);
      res.headers.set("Access-Control-Allow-Origin", env.SITE_DNS);
      res.headers.set("X-Request-Id", requestId);
      return res;
    }

    if (request.method === "POST" && url.pathname === "/auth/logout") {
      const res = await logoutHandler(request, env);
      res.headers.set("Access-Control-Allow-Origin", env.SITE_DNS);
      res.headers.set("X-Request-Id", requestId);
      return res;
    }

    if (request.method === "POST" && url.pathname === "/auth/request-reset") {
      const res = await requestPasswordReset(request, env);
      res.headers.set("Access-Control-Allow-Origin", env.SITE_DNS);
      res.headers.set("X-Request-Id", requestId);
      return res;
    }

    if (request.method === "POST" && url.pathname === "/auth/reset-password") {
      const res = await resetPassword(request, env);
      res.headers.set("Access-Control-Allow-Origin", env.SITE_DNS);
      res.headers.set("X-Request-Id", requestId);
      return res;
    }

    if (request.method === "POST" && url.pathname === "/auth/change-password") {
      const res = await changePasswordHandler(request, env);
      res.headers.set("Access-Control-Allow-Origin", env.SITE_DNS);
      res.headers.set("X-Request-Id", requestId);
      return res;
    }

    if (request.method === 'PATCH' && url.pathname === '/auth/profile') {
      const res = await updateProfileHandler(request, env);
      res.headers.set("Access-Control-Allow-Origin", env.SITE_DNS);
      res.headers.set("X-Request-Id", requestId);
      return res;
    }

    if (request.method === 'GET' && url.pathname === '/admin/audit') {
      const res = await adminAuditHandler(request, env);
      res.headers.set("Access-Control-Allow-Origin", env.SITE_DNS);
      res.headers.set("X-Request-Id", requestId);
      return res;
    }

    if (request.method === 'GET' && url.pathname === '/auth/entitlements') {
      const res = await entitlementsHandler(request, env);
      res.headers.set("Access-Control-Allow-Origin", env.SITE_DNS);
      res.headers.set("X-Request-Id", requestId);
      return res;
    }

    if (request.method === 'PATCH' && url.pathname.startsWith('/admin/users/') && url.pathname.endsWith('/role')) {
      const res = await adminChangeRoleHandler(request, env);
      res.headers.set("Access-Control-Allow-Origin", env.SITE_DNS);
      res.headers.set("X-Request-Id", requestId);
      return res;
    }

    if (request.method === 'GET' && url.pathname === '/admin/users') {
      const res = await adminListUsersHandler(request, env);
      res.headers.set("Access-Control-Allow-Origin", env.SITE_DNS);
      res.headers.set("X-Request-Id", requestId);
      return res;
    }

    if (request.method === 'POST' && url.pathname.startsWith('/admin/users/') && url.pathname.endsWith('/force-logout')) {
      const res = await adminForceLogoutHandler(request, env);
      res.headers.set("Access-Control-Allow-Origin", env.SITE_DNS);
      res.headers.set("X-Request-Id", requestId);
      return res;
    }

    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
    });
  },
};
