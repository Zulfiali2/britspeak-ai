import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionCookieName, validateSessionToken, type SessionUser } from "./session";

/**
 * Data-access-layer entry point for Server Components. Memoised per request.
 * Route Handlers use `apiHandler` instead, which reads the cookie from the Request.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  return validateSessionToken(store.get(sessionCookieName())?.value);
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/dashboard");
  return user;
}
