import { registerUser } from "./endpoints/RegisterUser";
import { loginUser } from "./endpoints/Login";
import { refreshTokenHandler } from "./endpoints/Refresh";
import { logoutHandler } from "./endpoints/Logout";
import { confirmVerificationToken } from "./endpoints/confirmVerificationToken";
import { resendVerificationCode } from "./endpoints/resendVerificationToken";
import { requestPasswordReset } from "./endpoints/requestPasswordReset";
import { resetPassword } from "./endpoints/resetPassword";

import type { Env } from "./types/Env";

function getCorsHeaders(env: Env) {
  return {
    "Access-Control-Allow-Origin": env.SITE_DNS,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: getCorsHeaders(env) });
    }

    if (request.method === "POST" && url.pathname === "/auth/register") {
      const res = await registerUser(request, env);
      res.headers.set("Access-Control-Allow-Origin", env.SITE_DNS);
      return res;
    }

    if (request.method === "POST" && url.pathname === "/auth/confirm-verification") {
      const res = await confirmVerificationToken(request, env);
      res.headers.set("Access-Control-Allow-Origin", env.SITE_DNS);
      return res;
    }

    if (request.method === "POST" && url.pathname === "/auth/resend-verification") {
      const res = await resendVerificationCode(request, env);
      res.headers.set("Access-Control-Allow-Origin", env.SITE_DNS);
      return res;
    }

    if (request.method === "POST" && url.pathname === "/auth/login") {
      const res = await loginUser(request, env);
      res.headers.set("Access-Control-Allow-Origin", env.SITE_DNS);
      return res;
    }

    if (request.method === "POST" && url.pathname === "/auth/refresh") {
      const res = await refreshTokenHandler(request, env);
      res.headers.set("Access-Control-Allow-Origin", env.SITE_DNS);
      return res;
    }

    if (request.method === "POST" && url.pathname === "/auth/logout") {
      const res = await logoutHandler(request, env);
      res.headers.set("Access-Control-Allow-Origin", env.SITE_DNS);
      return res;
    }

    if (request.method === "POST" && url.pathname === "/auth/request-reset") {
      const res = await requestPasswordReset(request, env);
      res.headers.set("Access-Control-Allow-Origin", env.SITE_DNS);
      return res;
    }

    if (request.method === "POST" && url.pathname === "/auth/reset-password") {
      const res = await resetPassword(request, env);
      res.headers.set("Access-Control-Allow-Origin", env.SITE_DNS);
      return res;
    }

    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  },
};
