import { Prisma, SupplierStatus, SupplierLedgerEntryType } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import type { Request } from "express";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../errors/app-error.js";
import { ERROR_CODES } from "../../errors/error-codes.js";
import { auditService } from "../../services/audit.service.js";
import type { AuthContext } from "../../types/auth.js";

export const suppliersService = {
  lookup(auth: AuthContext) {
    return prisma.supplier.findMany({
      where: { organizationId: auth.organizationId, status: SupplierStatus.ACTIVE },
      select: { id: true, code: true, name: true, currencyCode: true, status: true },
      orderBy: { name: "asc" }
    });
  },

  async list(auth: AuthContext) {
    return prisma.supplier.findMany({
      where: { organizationId: auth.organizationId },
      include: {
        contacts: true
      },
      orderBy: { name: "asc" }
    });
  },

  async get(auth: AuthContext, supplierId: string) {
    const supplier = await prisma.supplier.findFirst({
      where: { id: supplierId, organizationId: auth.organizationId },
      include: {
        contacts: true,
        products: {
          include: {
            productVariant: true
          }
        },
        documents: true
      }
    });

    if (!supplier) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Supplier not found", StatusCodes.NOT_FOUND);
    }

    return supplier;
  },

  async create(auth: AuthContext, input: Record<string, any>, request: Request) {
    const existing = await prisma.supplier.findFirst({
      where: {
        organizationId: auth.organizationId,
        code: input.code
      }
    });

    if (existing) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, `Supplier with code ${input.code} already exists`, StatusCodes.BAD_REQUEST);
    }

    const supplier = await prisma.supplier.create({
      data: {
        organizationId: auth.organizationId,
        code: input.code,
        name: input.name,
        legalName: input.legalName,
        contactPerson: input.contactPerson,
        email: input.email || null,
        phone: input.phone || null,
        alternatePhone: input.alternatePhone || null,
        address: input.address || null,
        city: input.city || null,
        country: input.country || "Kenya",
        taxNumber: input.taxNumber || null,
        paymentTermsDays: input.paymentTermsDays ?? 0,
        currencyCode: input.currencyCode || "KES",
        creditLimit: input.creditLimit ?? 0,
        currentBalance: 0,
        status: SupplierStatus.ACTIVE,
        notes: input.notes || null,
        createdById: auth.userId,
        updatedById: auth.userId
      }
    });

    await auditService.create({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "supplier.create",
      entityType: "Supplier",
      entityId: supplier.id,
      requestId: request.requestContext.requestId,
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
      afterData: supplier
    });

    return supplier;
  },

  async update(auth: AuthContext, supplierId: string, input: Record<string, any>, request: Request) {
    const supplier = await this.get(auth, supplierId);

    const updated = await prisma.supplier.update({
      where: { id: supplier.id },
      data: {
        ...input,
        updatedById: auth.userId
      }
    });

    await auditService.create({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "supplier.update",
      entityType: "Supplier",
      entityId: supplier.id,
      requestId: request.requestContext.requestId,
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
      beforeData: supplier,
      afterData: updated
    });

    return updated;
  },

  async addContact(auth: AuthContext, supplierId: string, input: Record<string, any>) {
    const supplier = await this.get(auth, supplierId);

    const contact = await prisma.supplierContact.create({
      data: {
        supplierId: supplier.id,
        name: input.name,
        role: input.role || null,
        email: input.email || null,
        phone: input.phone || null,
        isPrimary: input.isPrimary || false
      }
    });

    if (input.isPrimary) {
      // Set other contacts to false
      await prisma.supplierContact.updateMany({
        where: {
          supplierId: supplier.id,
          id: { not: contact.id }
        },
        data: {
          isPrimary: false
        }
      });
    }

    return contact;
  },

  async recordPayment(auth: AuthContext, supplierId: string, input: Record<string, any>, request: Request) {
    return prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findFirst({
        where: { id: supplierId, organizationId: auth.organizationId }
      });

      if (!supplier) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Supplier not found", StatusCodes.NOT_FOUND);
      }

      const balanceBefore = Number(supplier.currentBalance);
      const paymentAmount = input.amount;
      const balanceAfter = balanceBefore - paymentAmount;

      const payment = await tx.supplierPayment.create({
        data: {
          supplierId: supplier.id,
          paymentMethod: input.paymentMethod,
          amount: paymentAmount,
          currencyCode: input.currencyCode,
          exchangeRate: input.exchangeRate || 1.0,
          reference: input.reference || null,
          paidAt: new Date(),
          paidById: auth.userId,
          notes: input.notes || null
        }
      });

      const ledger = await tx.supplierLedgerEntry.create({
        data: {
          supplierId: supplier.id,
          entryType: SupplierLedgerEntryType.PAYMENT,
          amount: -paymentAmount,
          balanceBefore,
          balanceAfter,
          referenceType: "SupplierPayment",
          referenceId: payment.id,
          notes: input.notes || "Supplier payment recorded"
        }
      });

      const updatedSupplier = await tx.supplier.update({
        where: { id: supplier.id },
        data: {
          currentBalance: balanceAfter
        }
      });

      await auditService.create({
        organizationId: auth.organizationId,
        userId: auth.userId,
        action: "supplier.record_payment",
        entityType: "SupplierPayment",
        entityId: payment.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        afterData: { payment, ledger }
      }, tx);

      return { payment, supplier: updatedSupplier };
    });
  },

  async getLedger(auth: AuthContext, supplierId: string) {
    const supplier = await this.get(auth, supplierId);

    return prisma.supplierLedgerEntry.findMany({
      where: { supplierId: supplier.id },
      orderBy: { createdAt: "desc" }
    });
  }
};
