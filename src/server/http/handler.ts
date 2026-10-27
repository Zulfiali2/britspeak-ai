import "server-only";
import { randomUUID } from "node:crypto";
import type { Role } from "@prisma/client";
import { z } from "zod";
import { getConfig } from "@/server/config/env";
import { log } from "@/server/log";
import { readCookie, sessionCookieName, validateSessionToken, type SessionUser } from "@/server/auth/session";
import { sha256 } from "@/server/auth/crypto";
import { AppError } from "./errors";
import { enforceRateLimit, RATE_LIMITS, type RateLimitRule } from "./rate-limit";

export interface HandlerOptions {
  /** "required" (default) rejects anonymous requests; "optional" resolves the user if present; "none" skips. */
  auth?: "required" | "optional" | "none";
  roles?: Role[];
  /** Require a verified email (in addition to REQUIRE_EMAIL_VERIFICATION). */
  requireVerifiedEmail?: boolean;
  /** Extra rate limit, keyed by user id when authenticated, otherwise by client IP hash. */
  rateLimit?: RateLimitRule;
  /** Skip same-origin enforcement (only for server-to-server webhooks with their own signature checks). */
  skipOriginCheck?: boolean;
}

export interface HandlerContext<P = Record<string, string>> {
  req: Request;
  user: SessionUser | null;
  requestId: string;
  clientKey: string;
  params: P;
}

export interface AuthedContext<P = Record<string, string>> extends HandlerContext<P> {
  user: SessionUser;
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function clientIpHash(req: Request): string {
  const forwarded = getConfig().TRUST_PROXY_HEADERS ? req.headers.get("x-forwarded-for") : null;
  const ip = forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  return sha256(`ip:${ip}`).slice(0, 32);
}

/**
 * CSRF defence for cookie-authenticated requests: unsafe methods must come
 * from our own origin. SameSite=Lax cookies are the first layer; this check is
 * the second (it also blocks cross-site form posts in older browsers).
 */
function assertSameOrigin(req: Request): void {
  const allowed = new URL(getConfig().APP_URL).origin;
  const requestOrigin = new URL(req.url).origin;
  const origin = req.headers.get("origin");
  if (origin) {
    if (origin !== allowed && origin !== requestOrigin) {
      throw new AppError("forbidden", "Cross-origin request rejected");
    }
    return;
  }
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new AppError("forbidden", "Cross-site request rejected");
  }
  const referer = req.headers.get("referer");
  if (referer) {
    const refererOrigin = new URL(referer).origin;
    if (refererOrigin !== allowed && refererOrigin !== requestOrigin) {
      throw new AppError("forbidden", "Cross-origin request rejected");
    }
  }
}

export function json(data: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(error: AppError, requestId: string): Response {
  const headers: Record<string, string> = { "x-request-id": requestId };
  const retryAfter = error.details?.retryAfterSeconds;
  if (typeof retryAfter === "number") headers["retry-after"] = String(retryAfter);
  return json(
    { error: { code: error.code, message: error.message, details: error.details, requestId } },
    { status: error.status, headers },
  );
}

type Handler<P, U> = (ctx: U) => Promise<Response>;
type RouteContext<P> = { params: Promise<P> };

export function apiHandler<P = Record<string, string>>(
  options: HandlerOptions & { auth: "none" | "optional" },
  handler: Handler<P, HandlerContext<P>>,
): (req: Request, routeCtx: RouteContext<P>) => Promise<Response>;
export function apiHandler<P = Record<string, string>>(
  options: HandlerOptions,
  handler: Handler<P, AuthedContext<P>>,
): (req: Request, routeCtx: RouteContext<P>) => Promise<Response>;
export function apiHandler<P = Record<string, string>>(
  options: HandlerOptions,
  handler: Handler<P, HandlerContext<P>> | Handler<P, AuthedContext<P>>,
) {
  const authMode = options.auth ?? "required";
  return async (req: Request, routeCtx: RouteContext<P>): Promise<Response> => {
    const requestId = req.headers.get("x-request-id")?.slice(0, 64) || randomUUID();
    const started = Date.now();
    const path = new URL(req.url).pathname;
    let userId: string | undefined;
    try {
      if (UNSAFE_METHODS.has(req.method) && !options.skipOriginCheck) assertSameOrigin(req);

      let user: SessionUser | null = null;
      if (authMode !== "none") {
        user = await validateSessionToken(readCookie(req.headers.get("cookie"), sessionCookieName()));
        if (!user && authMode === "required") {
          throw new AppError("unauthenticated", "Please sign in to continue.");
        }
      }
      userId = user?.id;
      if (user && options.roles && !options.roles.includes(user.role)) {
        throw new AppError("forbidden", "You do not have permission to do that.");
      }
      if (
        user &&
        !user.emailVerified &&
        (options.requireVerifiedEmail || getConfig().REQUIRE_EMAIL_VERIFICATION) &&
        authMode === "required"
      ) {
        throw new AppError("email_not_verified", "Please verify your email address first.");
      }

      const clientKey = user ? `user:${user.id}` : `ip:${clientIpHash(req)}`;
      await enforceRateLimit(RATE_LIMITS.api, clientKey);
      if (options.rateLimit) await enforceRateLimit(options.rateLimit, clientKey);

      const params = ((await routeCtx?.params) ?? {}) as P;
      const response = await (handler as Handler<P, HandlerContext<P>>)({
        req,
        user,
        requestId,
        clientKey,
        params,
      });
      response.headers.set("x-request-id", requestId);
      log.info("http.request", {
        requestId,
        method: req.method,
        path,
        status: response.status,
        durationMs: Date.now() - started,
        userId,
      });
      return response;
    } catch (error) {
      const appError =
        error instanceof AppError
          ? error
          : error instanceof z.ZodError
            ? new AppError("validation_failed", "Some fields are invalid.", {
                issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
              })
            : new AppError("internal_error", "Something went wrong on our side. Please try again.");
      const level = appError.status >= 500 ? "error" : "warn";
      log[level]("http.request", {
        requestId,
        method: req.method,
        path,
        status: appError.status,
        code: appError.code,
        durationMs: Date.now() - started,
        userId,
        ...(appError.code === "internal_error" ? { error } : {}),
      });
      return errorResponse(appError, requestId);
    }
  };
}

/** Parse a JSON body with a size limit and a zod schema. */
export async function readJson<T extends z.ZodType>(
  req: Request,
  schema: T,
  maxBytes = 64 * 1024,
): Promise<z.infer<T>> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new AppError("unsupported_media_type", "Expected a JSON request body.");
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new AppError("payload_too_large", "Request body is too large.");
  const text = await req.text();
  if (Buffer.byteLength(text) > maxBytes) {
    throw new AppError("payload_too_large", "Request body is too large.");
  }
  let raw: unknown;
  try {
    raw = text.length ? JSON.parse(text) : {};
  } catch {
    throw new AppError("bad_request", "Request body is not valid JSON.");
  }
  return schema.parse(raw);
}

export function readQuery<T extends z.ZodType>(req: Request, schema: T): z.infer<T> {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  return schema.parse(params);
}
