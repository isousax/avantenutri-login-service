import type { D1Database } from "@cloudflare/workers-types";
import type { R2Bucket } from "@cloudflare/workers-types";

export interface Env {
  SITE_DNS: string;
  DB: D1Database;
  R2: R2Bucket;
  WORKER_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    return new Response(
      JSON.stringify({ status: 404, message: "Not Found." }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  },
};
