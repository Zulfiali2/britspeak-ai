import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";

/** Append-only audit trail for sensitive and administrative operations. */
export async function audit(
  actorId: string | null,
  action: string,
  target: { type: string; id?: string | null },
  metadata: Prisma.InputJsonObject = {},
  tx: Prisma.TransactionClient = db,
): Promise<void> {
  await tx.auditLog.create({
    data: { actorId, action, targetType: target.type, targetId: target.id ?? null, metadata },
  });
}
