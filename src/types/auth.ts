import type { UserRole } from "@prisma/client";

export type AuthContext = {
  userId: string;
  organizationId: string;
  role: UserRole;
  sessionId: string;
  tokenVersion: number;
  branchIds: string[];
};
