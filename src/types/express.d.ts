import type { UserRole } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      requestContext: {
        requestId: string;
      };
      auth?: {
        userId: string;
        organizationId: string;
        role: UserRole;
        sessionId: string;
        tokenVersion: number;
        branchIds: string[];
      };
      customerAuth?: {
        customerAccountId: string;
        customerId: string;
        organizationId: string;
        sessionId: string;
        tokenVersion: number;
      };
    }
  }
}

declare module "express-serve-static-core" {
  interface Request {
    requestContext: {
      requestId: string;
    };
    auth?: {
      userId: string;
      organizationId: string;
      role: UserRole;
      sessionId: string;
      tokenVersion: number;
      branchIds: string[];
    };
    customerAuth?: {
      customerAccountId: string;
      customerId: string;
      organizationId: string;
      sessionId: string;
      tokenVersion: number;
    };
  }
}
