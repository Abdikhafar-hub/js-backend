import { prisma } from "../../lib/prisma.js";
import { buildUserScope } from "../../lib/scope.js";
import type { AuthContext } from "../../types/auth.js";

export const notificationsService = {
  async list(auth: AuthContext, query: Record<string, any>) {
    const scope = buildUserScope(auth);
    const where: any = {
      organizationId: scope.organizationId,
      ...(scope.branchIds ? { OR: [{ branchId: null }, { branchId: { in: scope.branchIds } }] } : {}),
      AND: [{
      OR: [
        { userId: auth.userId },
        { userId: null, role: auth.role },
        { userId: null, role: null }
      ]
      }]
    };
    if (query.unread === "true") where.AND.push({ reads: { none: { userId: auth.userId } } });

    const notifications = await prisma.notification.findMany({
      where,
      include: { reads: { where: { userId: auth.userId }, select: { readAt: true } } },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    return notifications.map(({ reads, ...notification }) => ({
      ...notification,
      isRead: reads.length > 0,
      readAt: reads[0]?.readAt ?? null
    }));
  },

  async markRead(auth: AuthContext, id: string) {
    const visible = (await this.list(auth, {})).some((notification) => notification.id === id);
    if (!visible) return { count: 0 };
    await prisma.notificationRead.upsert({
      where: { notificationId_userId: { notificationId: id, userId: auth.userId } },
      update: { readAt: new Date() },
      create: { notificationId: id, userId: auth.userId }
    });
    return { count: 1 };
  },

  async markAllRead(auth: AuthContext) {
    const unread = await this.list(auth, { unread: "true" });
    if (!unread.length) return { count: 0 };
    await prisma.notificationRead.createMany({
      data: unread.map((notification) => ({ notificationId: notification.id, userId: auth.userId })),
      skipDuplicates: true
    });
    return { count: unread.length };
  }
};
