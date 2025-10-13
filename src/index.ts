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
import { listDietPlansHandler } from "./endpoints/diet/listDietPlans";
import { createDietPlanHandler } from "./endpoints/diet/createDietPlan";
import { reviseDietPlanHandler } from "./endpoints/diet/reviseDietPlan";
import { getDietPlanHandler } from "./endpoints/diet/getDietPlan";
import { getDietPlanFileHandler } from "./endpoints/diet/getDietPlanFile";
import { updateDietPlanHandler } from "./endpoints/diet/updateDietPlan";
import { createWaterLogHandler } from "./endpoints/water/createWaterLog";
import { listWaterLogsHandler } from "./endpoints/water/listWaterLogs";
import { getWaterGoalHandler } from "./endpoints/water/goal/getWaterGoal";
import { updateWaterGoalHandler } from "./endpoints/water/goal/updateWaterGoal";
import { updateWaterSettingsHandler } from "./endpoints/water/goal/updateWaterSettings";
import {
  createWeightLogHandler,
  patchWeightLogHandler,
} from "./endpoints/weight/createWeightLog";
import { listWeightLogsHandler } from "./endpoints/weight/listWeightLogs";
import { updateWeightGoalHandler } from "./endpoints/weight/updateWeightGoal";
import {
  createMealLogHandler,
  listMealLogsHandler,
  summaryMealLogsHandler,
  patchMealLogHandler,
  deleteMealLogHandler,
  updateMealGoalsHandler,
} from "./endpoints/meal/createMealLog";
import { updateProfileHandler } from "./endpoints/user/updateProfile";
import { entitlementsHandler } from "./endpoints/utils/entitlements";

import type { Env } from "./types/Env";
import { meHandler } from "./endpoints/user/me";
import { ensureRequestId } from "./middleware/requestId";
import { introspection } from "./endpoints/auth/introspection";
import { createConsultationHandler } from "./endpoints/consultation/createConsultation";
import { listConsultationsHandler } from "./endpoints/consultation/listConsultations";
import { cancelConsultationHandler } from "./endpoints/consultation/cancelConsultation";
import {
  getQuestionnaireHandler,
  upsertQuestionnaireHandler,
  getQuestionnaireStatusHandler,
} from "./endpoints/questionnaire/upsertQuestionnaire";
import { adminGetUserQuestionnaireHandler } from "./endpoints/admin/adminGetUserQuestionnaire";
import { adminQuestionnaireAnalyticsHandler } from "./endpoints/admin/adminQuestionnaireAnalytics";
import { adminSendNotificationHandler } from "./endpoints/admin/adminSendNotification";
import { getUserNotificationsHandler } from "./endpoints/notifications/getUserNotifications";
import { markNotificationReadHandler } from "./endpoints/notifications/markNotificationRead";
import { markAllNotificationsReadHandler } from "./endpoints/notifications/markAllNotificationsRead";
import { adminAuditHandler } from "./endpoints/admin/adminAudit";
import { adminChangeRoleHandler } from "./endpoints/admin/adminChangeRole";
import { adminListUsersHandler } from "./endpoints/admin/adminListUsers";
import { adminForceLogoutHandler } from "./endpoints/admin/adminForceLogout";
import { adminListConsultationsHandler } from "./endpoints/admin/adminListConsultations";
import { adminUpsertAvailabilityRuleHandler } from "./endpoints/admin/adminUpsertAvailabilityRule";
import { adminListAvailabilityHandler } from "./endpoints/admin/adminListAvailability";
import { adminDeleteAvailabilityRuleHandler } from "./endpoints/admin/adminDeleteAvailabilityRule";
import { adminBlockSlotHandler } from "./endpoints/admin/adminBlockSlot";
import { availableConsultationSlotsHandler } from "./endpoints/consultation/availableSlots";
import { billingIntentHandler } from "./endpoints/billing/billingIntent";
import { billingStatusHandler } from "./endpoints/billing/billingStatus";
import { mercadoPagoWebhookHandler } from "./endpoints/billing/mercadoPagoWebhook";
import { listUserPaymentsHandler } from "./endpoints/billing/listUserPayments";
import { getPaymentDetailsHandler } from "./endpoints/billing/getPaymentDetails";
import { downloadReceiptHandler } from "./endpoints/billing/downloadReceipt";
import { listAllPaymentsHandler } from "./endpoints/admin/listAllPayments";
import { adminListConsultationPricingHandler, adminUpsertConsultationPricingHandler, adminPatchConsultationPricingHandler } from './endpoints/admin/consultationPricing';
import { publicConsultationPricingHandler, publicConsultationPricingStatusHandler } from './endpoints/consultation/publicPricing';
import { consultationCreditsSummaryHandler } from './endpoints/consultation/creditsSummary';
import { listConsultationCreditsHandler } from './endpoints/consultation/listCredits';
import { adjustConsultationCreditsHandler } from './endpoints/consultation/adjustCredits';
import {
  listOverridesHandler,
  createOverrideHandler,
  deleteOverrideHandler,
  patchOverrideHandler,
  listOverrideLogsHandler,
} from "./endpoints/admin/adminOverrides";
import { listBlogPostsHandler } from "./endpoints/blog/listPosts";
import { getBlogPostHandler } from "./endpoints/blog/getPost";
import { relatedBlogPostsHandler } from "./endpoints/blog/relatedPosts";
import { adminCreateBlogPostHandler } from "./endpoints/blog/adminCreatePost";
import { adminUpdateBlogPostHandler } from "./endpoints/blog/adminUpdatePost";
import { adminDeleteBlogPostHandler } from "./endpoints/blog/adminDeletePost";
import { listBlogCategoriesHandler } from "./endpoints/blog/listCategories";
import { getBlogPostByIdHandler } from "./endpoints/blog/getPostById";
import { uploadBlogMediaHandler, getBlogMediaHandler } from "./endpoints/blog/media";
// @ts-ignore resolution hint
import { buildDynamicSitemap } from "./sitemap/dynamicSitemap";
import { getDynamicCorsOrigin } from "./utils/getDynamicCorsOrigin";
function getCorsHeaders(env: Env, requestId?: string, origin?: string | null) {
  const allowOrigin = getDynamicCorsOrigin(origin ?? undefined, env);
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, PUT, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Request-Id, X-Api-Key",
    "Content-Security-Policy": "frame-ancestors 'none';",
    ...(requestId ? { "X-Request-Id": requestId } : {}),
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const requestId = ensureRequestId(request);

    if (request.method === "OPTIONS") {
      const origin = request.headers.get("Origin");
      return new Response(null, { headers: getCorsHeaders(env, requestId, origin) });
    }
    // Blog media upload (admin/nutri)
    if (request.method === "POST" && url.pathname === "/blog/media") {
      const res = await uploadBlogMediaHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set("Access-Control-Allow-Origin", getDynamicCorsOrigin(origin, env));
      res.headers.set("X-Request-Id", requestId);
      return res;
    }

    // Blog media get (public)
    if (request.method === "GET" && url.pathname.startsWith("/blog/media/")) {
      const res = await getBlogMediaHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set("Access-Control-Allow-Origin", getDynamicCorsOrigin(origin, env));
      res.headers.set("X-Request-Id", requestId);
      return res;
    }
    // Billing intent (initiate payment)
    if (request.method === "POST" && url.pathname === "/billing/intent") {
      const res = await billingIntentHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    // Billing status (get payment status)
    if (request.method === "GET" && url.pathname === "/billing/status") {
      const res = await billingStatusHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // Public consultation pricing (no auth)
    if (request.method === "GET" && url.pathname === "/consultations/pricing") {
      const res = await publicConsultationPricingHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // Consultation credits summary
    if (request.method === "GET" && url.pathname === "/consultations/credits/summary") {
      const res = await consultationCreditsSummaryHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      return res;
    }
    // Consultation credits list
    if (request.method === "GET" && url.pathname === "/consultations/credits") {
      const res = await listConsultationCreditsHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      return res;
    }
    // Consultation credits adjust (admin)
    if (request.method === "POST" && url.pathname === "/consultations/credits") {
      const res = await adjustConsultationCreditsHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      return res;
    }
    if (request.method === "GET" && url.pathname === "/consultations/pricing/status") {
      const res = await publicConsultationPricingStatusHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set("Access-Control-Allow-Origin", getDynamicCorsOrigin(origin, env));
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // List user payments
    if (request.method === "GET" && url.pathname === "/billing/payments") {
      const res = await listUserPaymentsHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    // Get payment details
    if (request.method === "GET" && url.pathname.startsWith("/billing/payments/") && url.pathname.endsWith("/details")) {
      const res = await getPaymentDetailsHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    // Download receipt
    if (request.method === "GET" && url.pathname.startsWith("/billing/payments/") && url.pathname.endsWith("/receipt")) {
      const res = await downloadReceiptHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      // Não definir CSP para downloads
      return res;
    }

    // Webhook Mercado Pago
    if (
      request.method === "POST" &&
      url.pathname === "/billing/webhook/mercadopago"
    ) {
      const res = await mercadoPagoWebhookHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // Questionnaire upsert
    if (request.method === "POST" && url.pathname === "/questionnaire") {
      const res = await upsertQuestionnaireHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // Questionnaire get
    if (request.method === "GET" && url.pathname === "/questionnaire") {
      const res = await getQuestionnaireHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // Questionnaire status check
    if (request.method === "GET" && url.pathname === "/questionnaire/status") {
      const res = await getQuestionnaireStatusHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    // Get user notifications - GET /notifications
    if (request.method === "GET" && url.pathname === "/notifications") {
      const res = await getUserNotificationsHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    // Mark ALL notifications as read - POST /notifications/read-all
    if (request.method === "POST" && url.pathname === "/notifications/read-all") {
      const res = await markAllNotificationsReadHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    // Mark notification as read - POST /notifications/{id}/read
    if (
      request.method === "POST" &&
      url.pathname.match(/^\/notifications\/[^\/]+\/read$/)
    ) {
      const res = await markNotificationReadHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // Create consultation
    if (request.method === "POST" && url.pathname === "/consultations") {
      const res = await createConsultationHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // List consultations
    if (request.method === "GET" && url.pathname === "/consultations") {
      const res = await listConsultationsHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
      // Admin availability list
    }
    // Public available slots (authenticated not required for preview? could restrict later)
    if (
      request.method === "GET" &&
      url.pathname === "/consultations/available"
    ) {
      const res = await availableConsultationSlotsHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      // Admin availability create
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // Cancel consultation /consultations/:id/cancel
    if (
      request.method === "PATCH" &&
      /\/consultations\/[A-Za-z0-9-]+\/cancel$/.test(url.pathname)
    ) {
      const res = await cancelConsultationHandler(request, env);
      // Admin availability update / patch
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    // Admin availability list
    if (request.method === "GET" && url.pathname === "/admin/consultations/availability") {
      const res = await adminListAvailabilityHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // Admin availability create
    if (request.method === "POST" && url.pathname === "/admin/consultations/availability") {
      const res = await adminUpsertAvailabilityRuleHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // Admin availability patch
    if (request.method === "PATCH" && /\/admin\/consultations\/availability\/[A-Za-z0-9-]+$/.test(url.pathname)) {
      const res = await adminUpsertAvailabilityRuleHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // Admin availability delete (soft delete)
    if (request.method === "DELETE" && /\/admin\/consultations\/availability\/[A-Za-z0-9-]+$/.test(url.pathname)) {
      const res = await adminDeleteAvailabilityRuleHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // Meal logs list
    if (request.method === "GET" && url.pathname === "/meal/logs") {
      const res = await listMealLogsHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // Meal logs summary
    if (request.method === "GET" && url.pathname === "/meal/summary") {
      const res = await summaryMealLogsHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // Meal goals update
    if (request.method === "PUT" && url.pathname === "/meal/goals") {
      const res = await updateMealGoalsHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // Create meal log
    if (request.method === "POST" && url.pathname === "/meal/logs") {
      const res = await createMealLogHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    if (
      request.method === "PATCH" &&
      /\/meal\/logs\/[A-Za-z0-9-]+$/.test(url.pathname)
    ) {
      const res = await patchMealLogHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    if (
      request.method === "DELETE" &&
      /\/meal\/logs\/[A-Za-z0-9-]+$/.test(url.pathname)
    ) {
      const res = await deleteMealLogHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/auth/.well-known/jwks.json"
    ) {
      const res = await jwksHandler(env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    if (request.method === "POST" && url.pathname === "/auth/introspect") {
      const res = await introspection(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    if (request.method === "POST" && url.pathname === "/auth/register") {
      const res = await registerUser(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/auth/confirm-verification"
    ) {
      const res = await confirmVerificationToken(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/auth/resend-verification"
    ) {
      const res = await resendVerificationCode(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    if (request.method === "POST" && url.pathname === "/auth/login") {
      const res = await loginUser(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    if (request.method === "GET" && url.pathname === "/auth/me") {
      const res = await meHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    if (request.method === "POST" && url.pathname === "/auth/refresh") {
      const res = await refreshTokenHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    if (request.method === "POST" && url.pathname === "/auth/logout") {
      const res = await logoutHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    if (request.method === "POST" && url.pathname === "/auth/request-reset") {
      const res = await requestPasswordReset(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    if (request.method === "POST" && url.pathname === "/auth/reset-password") {
      const res = await resetPassword(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    if (request.method === "POST" && url.pathname === "/auth/change-password") {
      const res = await changePasswordHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    if (request.method === "PATCH" && url.pathname === "/auth/profile") {
      const res = await updateProfileHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    if (request.method === "GET" && url.pathname === "/admin/audit") {
      const res = await adminAuditHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    if (request.method === "GET" && url.pathname === "/auth/entitlements") {
      const res = await entitlementsHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    // Admin overrides
    if (request.method === "GET" && url.pathname === "/admin/overrides") {
      const res = await listOverridesHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    if (request.method === "GET" && url.pathname === "/admin/overrides/logs") {
      const res = await listOverrideLogsHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    if (request.method === "POST" && url.pathname === "/admin/overrides") {
      const res = await createOverrideHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    if (
      request.method === "PATCH" &&
      /\/admin\/overrides\/[a-f0-9-]+$/.test(url.pathname)
    ) {
      const res = await patchOverrideHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    if (
      request.method === "DELETE" &&
      /\/admin\/overrides\/[a-f0-9-]+$/.test(url.pathname)
    ) {
      const res = await deleteOverrideHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    // Diet plans list
    if (request.method === "GET" && url.pathname === "/diet/plans") {
      const res = await listDietPlansHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // Create diet plan
    if (request.method === "POST" && url.pathname === "/diet/plans") {
      const res = await createDietPlanHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // Revise diet plan: /diet/plans/:id/revise
    if (
      request.method === "POST" &&
      /\/diet\/plans\/.+\/revise$/.test(url.pathname)
    ) {
      const res = await reviseDietPlanHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // Get single diet plan /diet/plans/:id
    if (
      request.method === "GET" &&
      /\/diet\/plans\/[A-Za-z0-9-]+$/.test(url.pathname)
    ) {
      const res = await getDietPlanHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // Update plan metadata /diet/plans/:id
    if (
      request.method === "PATCH" &&
      /\/diet\/plans\/[A-Za-z0-9-]+$/.test(url.pathname)
    ) {
      const res = await updateDietPlanHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // Download diet plan PDF /diet/plans/:id/version/:vid/file
    if (
      request.method === "GET" &&
      /\/diet\/plans\/[A-Za-z0-9-]+\/version\/[A-Za-z0-9-]+\/file$/.test(url.pathname)
    ) {
      const res = await getDietPlanFileHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      return res;
    }

    // Water logs list
    if (request.method === "GET" && url.pathname === "/water/logs") {
      const res = await listWaterLogsHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // Water logs summary
    if (request.method === "GET" && url.pathname === "/water/summary") {
      const { summaryWaterLogsHandler } = await import(
        "./endpoints/water/summaryWaterLogs"
      );
      const res = await summaryWaterLogsHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // Water goal get
    if (request.method === "GET" && url.pathname === "/water/goal") {
      const res = await getWaterGoalHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // Water goal update
    if (request.method === "PUT" && url.pathname === "/water/goal") {
      const res = await updateWaterGoalHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // Water settings (cup size)
    if (request.method === "PATCH" && url.pathname === "/water/settings") {
      const res = await updateWaterSettingsHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // Create water log
    if (request.method === "POST" && url.pathname === "/water/logs") {
      const res = await createWaterLogHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // Weight logs list
    if (request.method === "GET" && url.pathname === "/weight/logs") {
      const res = await listWeightLogsHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // Create weight log
    if (request.method === "POST" && url.pathname === "/weight/logs") {
      const res = await createWeightLogHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    if (
      request.method === "PATCH" &&
      /\/weight\/logs\/\d{4}-\d{2}-\d{2}$/.test(url.pathname)
    ) {
      const res = await patchWeightLogHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // Weight summary (dynamic import to reduce initial bundle if needed)
    if (request.method === "GET" && url.pathname === "/weight/summary") {
      const { summaryWeightLogsHandler } = await import(
        "./endpoints/weight/summaryWeightLogs"
      );
      const res = await summaryWeightLogsHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    if (request.method === "PUT" && url.pathname === "/weight/goal") {
      const res = await updateWeightGoalHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    if (
      request.method === "PATCH" &&
      url.pathname.startsWith("/admin/users/") &&
      url.pathname.endsWith("/role")
    ) {
      const res = await adminChangeRoleHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }


    if (request.method === "GET" && url.pathname === "/admin/users") {
      const res = await adminListUsersHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    // Admin get user questionnaire - GET /admin/users/{userId}/questionnaire
    if (
      request.method === "GET" &&
      url.pathname.match(/^\/admin\/users\/[^\/]+\/questionnaire$/)
    ) {
      const res = await adminGetUserQuestionnaireHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    // Admin questionnaire analytics - GET /admin/questionnaire/analytics
    if (request.method === "GET" && url.pathname === "/admin/questionnaire/analytics") {
      const res = await adminQuestionnaireAnalyticsHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    // Admin send notification - POST /admin/notifications
    if (request.method === "POST" && url.pathname === "/admin/notifications") {
      const res = await adminSendNotificationHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    
    if (request.method === "GET" && url.pathname === "/admin/payments") {
      const res = await listAllPaymentsHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    // Admin consultation pricing
    if (request.method === 'GET' && url.pathname === '/admin/consultations/pricing') {
      const res = await adminListConsultationPricingHandler(request, env);
      const origin = request.headers.get('Origin');
      res.headers.set('Access-Control-Allow-Origin', getDynamicCorsOrigin(origin, env));
      res.headers.set('X-Request-Id', requestId);
      res.headers.set('Content-Security-Policy', "frame-ancestors 'none';");
      return res;
    }
    if (request.method === 'PUT' && url.pathname === '/admin/consultations/pricing') {
      const res = await adminUpsertConsultationPricingHandler(request, env);
      const origin = request.headers.get('Origin');
      res.headers.set('Access-Control-Allow-Origin', getDynamicCorsOrigin(origin, env));
      res.headers.set('X-Request-Id', requestId);
      res.headers.set('Content-Security-Policy', "frame-ancestors 'none';");
      return res;
    }
    if (request.method === 'PATCH' && url.pathname.startsWith('/admin/consultations/pricing/')) {
      const res = await adminPatchConsultationPricingHandler(request, env);
      const origin = request.headers.get('Origin');
      res.headers.set('Access-Control-Allow-Origin', getDynamicCorsOrigin(origin, env));
      res.headers.set('X-Request-Id', requestId);
      res.headers.set('Content-Security-Policy', "frame-ancestors 'none';");
      return res;
    }
    if (request.method === "GET" && url.pathname === "/admin/consultations") {
      const res = await adminListConsultationsHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    if (
      url.pathname === "/admin/consultations/availability" &&
      request.method === "POST"
    ) {
      const res = await adminUpsertAvailabilityRuleHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    if (
      /\/admin\/consultations\/availability\/.+/.test(url.pathname) &&
      request.method === "PATCH"
    ) {
      const res = await adminUpsertAvailabilityRuleHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/admin/consultations/availability"
    ) {
      const res = await adminListAvailabilityHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/admin/consultations/availability/log"
    ) {
      const { adminListAvailabilityLogHandler } = await import('./endpoints/admin/adminListAvailabilityLog');
      const res = await adminListAvailabilityLogHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/admin/consultations/block-slot"
    ) {
      const res = await adminBlockSlotHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    // ================= BLOG =================
    // Dynamic sitemap (XML) served from worker to remove need for redeploy
    if (request.method === "GET" && url.pathname === "/sitemap.xml") {
      const xml = await buildDynamicSitemap(env);
      const etag = 'W/"s-' + xml.length.toString(16) + '"';
      const origin = request.headers.get("Origin");
      if (request.headers.get("if-none-match") === etag) {
        return new Response(null, {
          status: 304,
          headers: { ...getCorsHeaders(env, requestId, origin), ETag: etag },
        });
      }
      return new Response(xml, {
        status: 200,
        headers: {
          ...getCorsHeaders(env, requestId, origin),
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "public, max-age=300, stale-while-revalidate=300",
          ETag: etag,
        },
      });
    }
    if (request.method === "GET" && url.pathname === "/blog/posts") {
      const res = await listBlogPostsHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    if (
      request.method === "GET" &&
      /\/blog\/posts\/by-id\/[a-f0-9-]+$/.test(url.pathname)
    ) {
      const res = await getBlogPostByIdHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    if (request.method === "GET" && url.pathname === "/blog/categories") {
      const res = await listBlogCategoriesHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    if (
      request.method === "GET" &&
      /\/blog\/posts\/[^/]+$/.test(url.pathname)
    ) {
      const res = await getBlogPostHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    if (
      request.method === "GET" &&
      /\/blog\/posts\/[^/]+\/related$/.test(url.pathname)
    ) {
      const res = await relatedBlogPostsHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    if (request.method === "POST" && url.pathname === "/blog/posts") {
      const res = await adminCreateBlogPostHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    if (
      request.method === "PATCH" &&
      /\/blog\/posts\/[a-f0-9-]+$/.test(url.pathname)
    ) {
      const res = await adminUpdateBlogPostHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }
    if (
      request.method === "DELETE" &&
      /\/blog\/posts\/[a-f0-9-]+$/.test(url.pathname)
    ) {
      const res = await adminDeleteBlogPostHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    if (
      request.method === "POST" &&
      url.pathname.startsWith("/admin/users/") &&
      url.pathname.endsWith("/force-logout")
    ) {
      const res = await adminForceLogoutHandler(request, env);
      const origin = request.headers.get("Origin");
      res.headers.set(
        "Access-Control-Allow-Origin",
        getDynamicCorsOrigin(origin, env)
      );
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none';");
      return res;
    }

    const origin = request.headers.get("Origin");
    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: {
        ...getCorsHeaders(env, requestId, origin),
        "Content-Type": "application/json",
      },
    });
  },
};
