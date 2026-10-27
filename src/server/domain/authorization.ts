import type { Role } from "@prisma/client";
import { AppError } from "@/server/http/errors";

export interface Principal {
  id: string;
  role: Role;
}

/**
 * Ownership rule for learner data: only the owner may read or modify it.
 * Administrators manage accounts through dedicated, audited admin endpoints;
 * they do not get implicit access to learners' transcripts.
 *
 * Returns 404 (not 403) so resource identifiers cannot be probed.
 */
export function assertOwner<T extends { userId: string } | null | undefined>(
  principal: Principal,
  resource: T,
  what = "Resource",
): asserts resource is NonNullable<T> {
  if (!resource || resource.userId !== principal.id) {
    throw new AppError("not_found", `${what} not found`);
  }
}

export function assertRole(principal: Principal, roles: Role[]): void {
  if (!roles.includes(principal.role)) {
    throw new AppError("forbidden", "You do not have permission to do that.");
  }
}
