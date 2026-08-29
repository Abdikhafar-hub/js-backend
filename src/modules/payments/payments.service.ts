import { Prisma, PaymentStatus, PaymentDirection, PaymentRecordStatus, PaymentMethod, CreditNoteStatus, DebitNoteStatus, SaleStatus, SaleType, InventoryMovementType, InvoiceType, InvoiceSource } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import type { Request } from "express";
import crypto from "crypto";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../errors/app-error.js";
import { ERROR_CODES } from "../../errors/error-codes.js";
import { auditService } from "../../services/audit.service.js";
import { inventoryWriteService } from "../../services/inventory-write.service.js";
import type { AuthContext } from "../../types/auth.js";
import { assertBranchAccess, buildUserScope } from "../../lib/scope.js";
import { prepareCheckout } from "../sales/sales.service.js";
import { reserveInvoiceDocumentNumber } from "../sales/invoice-numbering.js";
import { postCustomerBalanceEntry } from "../../services/customer-ledger.service.js";
import { encrypt, decrypt } from "../../utils/crypto.js";
import { refundWorkflowService } from "./refund-workflow.service.js";
import { reserveRefundNumber, reserveReturnNumber } from "./refund-numbering.js";

const callbackMetadata = (stkCallback: Record<string, any>) => {
  const entries = stkCallback.CallbackMetadata?.Item;
  if (!Array.isArray(entries)) return new Map<string, unknown>();
  return new Map(entries.map((entry: Record<string, unknown>) => [String(entry.Name), entry.Value]));
};

const parseMpesaDate = (value: unknown) => {
  const raw = String(value ?? "");
  if (!/^\d{14}$/.test(raw)) return new Date();
  return new Date(
    Number(raw.slice(0, 4)), Number(raw.slice(4, 6)) - 1, Number(raw.slice(6, 8)),
    Number(raw.slice(8, 10)), Number(raw.slice(10, 12)), Number(raw.slice(12, 14))
  );
};

const validateIncomingPayment = async (
  tx: Prisma.TransactionClient,
  auth: AuthContext,
  input: Record<string, any>,
  branchId: string,
  saleId: string
) => {
  const activeShift = await tx.shift.findFirst({
    where: { organizationId: auth.organizationId, branchId, userId: auth.userId, status: "OPEN" }
  });
  if (input.paymentMethod === "CASH" && !activeShift) {
    throw new AppError(ERROR_CODES.SHIFT_NOT_OPEN, "Cash payment requires an open shift", StatusCodes.CONFLICT);
  }
  if (input.reference) {
    const duplicate = await tx.payment.findFirst({
      where: {
        organizationId: auth.organizationId,
        paymentMethod: input.paymentMethod,
        reference: input.reference,
        status: { notIn: ["FAILED", "CANCELLED", "REVERSED"] }
      }
    });
    if (duplicate) {
      throw new AppError(ERROR_CODES.DUPLICATE_IDEMPOTENCY_KEY, "Payment reference has already been used", StatusCodes.CONFLICT);
    }
  }
  const mpesa = input.paymentMethod === "MPESA"
    ? await tx.mpesaTransaction.findFirst({
        where: {
          organizationId: auth.organizationId, branchId, saleId, status: "SUCCESS",
          mpesaReceiptNumber: input.reference, amount: Number(input.amount), paymentId: null
        }
      })
    : null;
  if (input.paymentMethod === "MPESA" && !mpesa) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "M-Pesa payment has not been verified", StatusCodes.CONFLICT);
  }
  return { activeShift, mpesa };
};

export const paymentsService = {
  async recordPayment(auth: AuthContext, input: Record<string, any>, request: Request) {
    return prisma.$transaction(async (tx) => {
      // Find either an Invoice or a Sale depending on context
      const invoice = await tx.invoice.findFirst({
        where: { id: input.invoiceId, organizationId: auth.organizationId },
        include: { sale: { select: { id: true, branchId: true, attendantId: true, amountPaid: true, amountDue: true, totalAmount: true } } }
      });

      if (invoice) {
        if (!invoice.sale && auth.role !== "GENERAL_MANAGER") {
          throw new AppError(ERROR_CODES.ACCESS_DENIED, "Branch-scoped users cannot pay an unscoped invoice", StatusCodes.FORBIDDEN);
        }
        if (invoice.sale) assertBranchAccess(auth, invoice.sale.branchId);
        if (!invoice.sale) {
          throw new AppError(ERROR_CODES.BAD_REQUEST, "Invoice is not linked to a branch sale", StatusCodes.BAD_REQUEST);
        }
        if (auth.role === "SALES_ATTENDANT" && invoice.sale.attendantId !== auth.userId) {
          throw new AppError(ERROR_CODES.ACCESS_DENIED, "You can only pay your own sale", StatusCodes.FORBIDDEN);
        }
        if (Number(input.amount) > Number(invoice.amountDue) + 0.01) {
          throw new AppError(ERROR_CODES.BAD_REQUEST, "Payment cannot exceed the invoice amount due", StatusCodes.BAD_REQUEST);
        }
        const validated = await validateIncomingPayment(tx, auth, input, invoice.sale.branchId, invoice.sale.id);
        const totalPaid = Number(invoice.amountPaid) + input.amount;
        const balanceDue = Math.max(0, Number(invoice.totalAmount) - totalPaid);

        let status = "PAID";
        if (balanceDue > 0) {
          status = "PARTIALLY_PAID";
        }

        // Update invoice
        const updatedInvoice = await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            amountPaid: totalPaid,
            amountDue: balanceDue,
            status: status as any
          }
        });

        // Get branchId from Sale relation or auth context
        const branchId = invoice.sale.branchId;

        const payCount = await tx.payment.count({
          where: { organizationId: auth.organizationId }
        });
        const paymentNumber = `PMT-${(payCount + 1).toString().padStart(6, "0")}`;

        // Create Payment log
        const payment = await tx.payment.create({
          data: {
            organizationId: auth.organizationId,
            branchId,
            paymentNumber,
            customerId: invoice.customerId,
            saleId: invoice.saleId,
            shiftId: validated.activeShift?.id ?? null,
            direction: PaymentDirection.INCOMING,
            paymentMethod: input.paymentMethod,
            amount: input.amount,
            currencyCode: "KES",
            reference: input.reference || null,
            status: PaymentRecordStatus.COMPLETED,
            receivedById: auth.userId,
            receivedAt: new Date()
          }
        });
        if (input.paymentMethod === "CASH" && validated.activeShift) {
          await tx.shiftCashMovement.create({
            data: { shiftId: validated.activeShift.id, movementType: "CASH_SALE", amount: input.amount, reference: payment.paymentNumber }
          });
        }
        if (validated.mpesa) {
          await tx.mpesaTransaction.update({ where: { id: validated.mpesa.id }, data: { paymentId: payment.id } });
        }

        // Create Invoice payment allocation
        await tx.invoicePaymentAllocation.create({
          data: {
            paymentId: payment.id,
            invoiceId: invoice.id,
            amount: input.amount
          }
        });

        const salePaid = Number(invoice.sale.amountPaid) + Number(input.amount);
        const saleDue = Math.max(0, Number(invoice.sale.totalAmount) - salePaid);
        await tx.sale.update({
          where: { id: invoice.sale.id },
          data: {
            amountPaid: salePaid,
            amountDue: saleDue,
            paymentStatus: saleDue <= 0 ? PaymentStatus.PAID : PaymentStatus.PARTIALLY_PAID
          }
        });

        // Adjust customer outstanding balance
        if (invoice.customerId) {
          await postCustomerBalanceEntry(tx, {
            organizationId: auth.organizationId, branchId, customerId: invoice.customerId,
            amount: -Number(input.amount), entryType: "PAYMENT", referenceType: "Payment", referenceId: payment.id,
            notes: `Payment ${payment.paymentNumber}`, createdById: auth.userId
          });
        }

        await auditService.create({
          organizationId: auth.organizationId,
          branchId,
          userId: auth.userId,
          action: "payment.record",
          entityType: "Payment",
          entityId: payment.id,
          requestId: request.requestContext.requestId,
          ipAddress: request.ip,
          userAgent: request.header("user-agent"),
          afterData: payment
        }, tx);

        return { payment, invoice: updatedInvoice };
      }

      // Check if ID points to a Sale instead
      const sale = await tx.sale.findFirst({
        where: { id: input.invoiceId, organizationId: auth.organizationId }
      });

      if (!sale) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Invoice or Sale not found", StatusCodes.NOT_FOUND);
      }
      assertBranchAccess(auth, sale.branchId);
      if (auth.role === "SALES_ATTENDANT" && sale.attendantId !== auth.userId) {
        throw new AppError(ERROR_CODES.ACCESS_DENIED, "You can only pay your own sale", StatusCodes.FORBIDDEN);
      }
      if (Number(input.amount) > Number(sale.amountDue) + 0.01) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Payment cannot exceed the sale amount due", StatusCodes.BAD_REQUEST);
      }
      const validated = await validateIncomingPayment(tx, auth, input, sale.branchId, sale.id);

      const totalPaid = Number(sale.amountPaid) + input.amount;
      const balanceDue = Math.max(0, Number(sale.totalAmount) - totalPaid);

      let paymentStatus: PaymentStatus = PaymentStatus.PAID;
      if (balanceDue > 0) {
        paymentStatus = totalPaid > 0 ? PaymentStatus.PARTIALLY_PAID : PaymentStatus.UNPAID;
      }

      // Update sale
      const updatedSale = await tx.sale.update({
        where: { id: sale.id },
        data: {
          amountPaid: totalPaid,
          amountDue: balanceDue,
          paymentStatus
        }
      });

      const payCount = await tx.payment.count({
        where: { organizationId: auth.organizationId }
      });
      const paymentNumber = `PMT-${(payCount + 1).toString().padStart(6, "0")}`;

      // Create Payment log
      const payment = await tx.payment.create({
        data: {
          organizationId: auth.organizationId,
          branchId: sale.branchId,
          paymentNumber,
          customerId: sale.customerId,
          saleId: sale.id,
          shiftId: validated.activeShift?.id ?? null,
          direction: PaymentDirection.INCOMING,
          paymentMethod: input.paymentMethod,
          amount: input.amount,
          currencyCode: "KES",
          reference: input.reference || null,
          status: PaymentRecordStatus.COMPLETED,
          receivedById: auth.userId,
          receivedAt: new Date()
        }
      });
      if (input.paymentMethod === "CASH" && validated.activeShift) {
        await tx.shiftCashMovement.create({
          data: { shiftId: validated.activeShift.id, movementType: "CASH_SALE", amount: input.amount, reference: payment.paymentNumber }
        });
      }
      if (validated.mpesa) {
        await tx.mpesaTransaction.update({ where: { id: validated.mpesa.id }, data: { paymentId: payment.id } });
      }

      // Adjust customer outstanding balance
      if (sale.customerId) {
        await postCustomerBalanceEntry(tx, {
          organizationId: auth.organizationId, branchId: sale.branchId, customerId: sale.customerId,
          amount: -Number(input.amount), entryType: "PAYMENT", referenceType: "Payment", referenceId: payment.id,
          notes: `Payment ${payment.paymentNumber}`, createdById: auth.userId
        });
      }

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: sale.branchId,
        userId: auth.userId,
        action: "payment.record",
        entityType: "Payment",
        entityId: payment.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        afterData: payment
      }, tx);

      return { payment, sale: updatedSale };
    });
  },

  async createCreditDebitNote(auth: AuthContext, input: Record<string, any>, request: Request) {
    return prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: input.customerId, organizationId: auth.organizationId }
      });

      if (!customer) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Customer not found", StatusCodes.NOT_FOUND);
      }

      const balanceBefore = Number(customer.currentOutstandingBalance);
      let balanceAfter = balanceBefore;

      if (input.noteType === "CREDIT") {
        const creditNoteNumber = `CRN-${Date.now()}`;
        const creditNote = await tx.creditNote.create({
          data: {
            organizationId: auth.organizationId,
            customerId: customer.id,
            invoiceId: input.invoiceId,
            creditNoteNumber,
            amount: input.amount,
            status: CreditNoteStatus.APPROVED,
            reason: input.reason || "Credit adjustment"
          }
        });

        const ledger = await postCustomerBalanceEntry(tx, {
          organizationId: auth.organizationId, customerId: customer.id,
          amount: -Number(input.amount), entryType: "CREDIT_NOTE", referenceType: "CreditNote", referenceId: creditNote.id,
          notes: input.reason, createdById: auth.userId
        });
        balanceAfter = Number(ledger.balanceAfter);

        await auditService.create({
          organizationId: auth.organizationId,
          userId: auth.userId,
          action: "credit_note.create",
          entityType: "CreditNote",
          entityId: creditNote.id,
          requestId: request.requestContext.requestId,
          ipAddress: request.ip,
          userAgent: request.header("user-agent"),
          afterData: creditNote
        }, tx);

        return { note: creditNote, customerBalance: balanceAfter };
      } else {
        const debitNoteNumber = `DRN-${Date.now()}`;
        const debitNote = await tx.debitNote.create({
          data: {
            organizationId: auth.organizationId,
            customerId: customer.id,
            invoiceId: input.invoiceId,
            debitNoteNumber,
            amount: input.amount,
            status: DebitNoteStatus.APPROVED,
            reason: input.reason || "Debit adjustment"
          }
        });

        const ledger = await postCustomerBalanceEntry(tx, {
          organizationId: auth.organizationId, customerId: customer.id,
          amount: Number(input.amount), entryType: "DEBIT_NOTE", referenceType: "DebitNote", referenceId: debitNote.id,
          notes: input.reason, createdById: auth.userId
        });
        balanceAfter = Number(ledger.balanceAfter);

        await auditService.create({
          organizationId: auth.organizationId,
          userId: auth.userId,
          action: "debit_note.create",
          entityType: "DebitNote",
          entityId: debitNote.id,
          requestId: request.requestContext.requestId,
          ipAddress: request.ip,
          userAgent: request.header("user-agent"),
          afterData: debitNote
        }, tx);

        return { note: debitNote, customerBalance: balanceAfter };
      }
    });
  },

  async createReturnRequest(auth: AuthContext, input: Record<string, any>, request: Request) {
    return prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id: input.invoiceId, organizationId: auth.organizationId },
        include: { items: true }
      });
      const sale = await tx.sale.findFirst({
        where: {
          id: invoice?.saleId ?? input.invoiceId,
          organizationId: auth.organizationId,
          status: { in: [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_RETURNED] },
          ...(auth.role === "SALES_ATTENDANT" ? { attendantId: auth.userId } : {})
        },
        include: { items: true, branch: { select: { code: true } } }
      });
      if (!sale) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Eligible completed sale not found", StatusCodes.NOT_FOUND);
      }
      assertBranchAccess(auth, sale.branchId);

      const returnDeadline = sale.completedAt
        ? new Date(sale.completedAt.getTime() + 30 * 24 * 60 * 60 * 1000)
        : null;
      if (returnDeadline && returnDeadline < new Date() && auth.role !== "GENERAL_MANAGER") {
        throw new AppError(ERROR_CODES.ACCESS_DENIED, "The standard 30-day return window has expired", StatusCodes.FORBIDDEN);
      }

      const items: Array<{
        saleItemId: string;
        productVariantId: string;
        quantity: number;
        originalUnitPrice: number;
        eligibleValue: number;
        condition: string;
      }> = [];
      const seenSaleItems = new Set<string>();

      for (const requested of input.items) {
        const invoiceItem = invoice?.items.find((item) => item.id === requested.invoiceItemId);
        const saleItem = sale.items.find((item) =>
          item.id === requested.invoiceItemId ||
          (invoiceItem && item.productVariantId === invoiceItem.productVariantId)
        );
        if (!saleItem || saleItem.productVariantId !== requested.productVariantId) {
          throw new AppError(ERROR_CODES.BAD_REQUEST, "Return item does not belong to the original sale", StatusCodes.BAD_REQUEST);
        }
        if (seenSaleItems.has(saleItem.id)) {
          throw new AppError(ERROR_CODES.BAD_REQUEST, "Duplicate return lines are not allowed", StatusCodes.BAD_REQUEST);
        }
        seenSaleItems.add(saleItem.id);

        const pending = await tx.returnRequestItem.aggregate({
          where: {
            saleItemId: saleItem.id,
            returnRequest: {
              status: { in: ["REQUESTED", "UNDER_REVIEW", "INSPECTED", "APPROVED"] }
            }
          },
          _sum: { quantity: true }
        });
        const remaining = Number(saleItem.quantity) - Number(saleItem.returnedQuantity) - Number(pending._sum.quantity ?? 0);
        const quantity = Number(requested.quantity);
        if (quantity > remaining + 0.0001) {
          throw new AppError(
            ERROR_CODES.BAD_REQUEST,
            `Return quantity exceeds the ${remaining} units still eligible`,
            StatusCodes.BAD_REQUEST
          );
        }

        const eligibleUnitValue = Number(saleItem.lineTotal) / Number(saleItem.quantity);
        items.push({
          saleItemId: saleItem.id,
          productVariantId: saleItem.productVariantId,
          quantity,
          originalUnitPrice: Number(saleItem.unitPrice),
          eligibleValue: eligibleUnitValue * quantity,
          condition: requested.condition
        });
      }

      const returnNumber = await reserveReturnNumber(tx, {
        organizationId: auth.organizationId,
        branchId: sale.branchId,
        branchCode: sale.branch.code,
        issuedAt: new Date()
      });
      const returnRequest = await tx.returnRequest.create({
        data: {
          organizationId: auth.organizationId,
          branchId: sale.branchId,
          returnNumber,
          saleId: sale.id,
          customerId: sale.customerId,
          reason: input.reason,
          resolution: input.refundMethod === "EXCHANGE" ? "EXCHANGE" : "REFUND",
          requestedRefundMethod: input.refundMethod === "EXCHANGE" ? null : input.refundMethod,
          requestedById: auth.userId,
          items: { create: items as Prisma.ReturnRequestItemUncheckedCreateWithoutReturnRequestInput[] }
        },
        include: { items: true, sale: true, customer: true, branch: true }
      });

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: sale.branchId,
        userId: auth.userId,
        action: "return.request",
        entityType: "ReturnRequest",
        entityId: returnRequest.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        afterData: returnRequest
      }, tx);

      return returnRequest;
    });
  },

  async processReturn(auth: AuthContext, input: Record<string, any>, request: Request) {
    throw new AppError(
      ERROR_CODES.INVALID_STATUS_TRANSITION,
      "Direct return processing is disabled; use the return request workflow",
      StatusCodes.GONE
    );
    /* istanbul ignore next -- retained temporarily only for migration traceability */
    return prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findFirst({
        where: { id: input.invoiceId, organizationId: auth.organizationId },
        include: { items: true }
      });

      if (!sale) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Sale not found", StatusCodes.NOT_FOUND);
      }
      assertBranchAccess(auth, sale.branchId);

      let totalRefund = 0;

      for (const item of input.items) {
        const saleItem = sale.items.find(i => i.id === item.invoiceItemId);
        if (!saleItem) continue;

        // Update returned quantity on SaleItem
        const newReturnedQty = Number(saleItem.returnedQuantity) + item.quantity;
        await tx.saleItem.update({
          where: { id: saleItem.id },
          data: {
            returnedQuantity: newReturnedQty
          }
        });

        // Add back to inventory using receiveStock
        await inventoryWriteService.receiveStock(tx, {
          organizationId: sale.organizationId,
          branchId: sale.branchId,
          productVariantId: item.productVariantId,
          quantity: item.quantity,
          unitCost: Number(saleItem.unitPrice),
          landedUnitCost: Number(saleItem.unitPrice),
          referenceType: "SaleItemReturn",
          referenceId: saleItem.id,
          performedById: auth.userId,
          notes: `Returned items from POS return. Sale ID: ${sale.id}`
        });

        const lineVal = item.quantity * Number(saleItem.unitPrice);
        totalRefund += lineVal;
      }

      // Deduct total sale amount and amount due
      const newTotal = Math.max(0, Number(sale.totalAmount) - totalRefund);
      const newDue = Math.max(0, Number(sale.amountDue) - totalRefund);

      // Check if all items are fully returned
      let allItemsReturned = true;
      const reFetchedSale = await tx.sale.findUnique({
        where: { id: sale.id },
        include: { items: true }
      });
      if (reFetchedSale) {
        for (const i of reFetchedSale.items) {
          if (Number(i.returnedQuantity) < Number(i.quantity)) {
            allItemsReturned = false;
            break;
          }
        }
      }

      const status = allItemsReturned ? SaleStatus.FULLY_RETURNED : SaleStatus.PARTIALLY_RETURNED;

      const updatedSale = await tx.sale.update({
        where: { id: sale.id },
        data: {
          totalAmount: newTotal,
          amountDue: newDue,
          status
        }
      });

      // Apply credit note or refunds
      if (input.refundMethod === "CREDIT_NOTE" && sale.customerId) {
        // Automatically issue credit note (requires an Invoice, so find or create one)
        let invoice = await tx.invoice.findFirst({
          where: { saleId: sale.id }
        });
        if (!invoice) {
          const branch = await tx.branch.findFirstOrThrow({
            where: { id: sale.branchId, organizationId: auth.organizationId },
            select: { id: true, code: true }
          });
          const issueDate = new Date();
          const invoiceNumber = await reserveInvoiceDocumentNumber(tx, {
            organizationId: auth.organizationId,
            branchId: branch.id,
            branchCode: branch.code,
            issuedAt: issueDate,
            kind: "INVOICE"
          });
          invoice = await tx.invoice.create({
            data: {
              organizationId: auth.organizationId,
              branchId: sale.branchId,
              invoiceNumber,
              saleId: sale.id,
              customerId: sale.customerId,
              createdById: auth.userId,
              invoiceType: InvoiceType.STANDARD,
              source: InvoiceSource.COMPLETED_SALE,
              status: "PAID",
              currencyCode: sale.currencyCode,
              paymentTermsDays: 0,
              issueDate,
              dueDate: issueDate,
              issuedAt: issueDate,
              subtotal: sale.subtotal,
              discountAmount: sale.lineDiscountAmount,
              taxAmount: sale.taxAmount,
              totalAmount: sale.totalAmount,
              amountPaid: sale.amountPaid,
              amountDue: sale.amountDue,
              notes: `Auto-generated Invoice for return of sale ${sale.saleNumber}`
            }
          });
        }

        const creditNoteNumber = `CRN-${Date.now()}`;
        const creditNote = await tx.creditNote.create({
          data: {
            organizationId: auth.organizationId,
            customerId: sale.customerId,
            invoiceId: invoice.id,
            creditNoteNumber,
            amount: totalRefund,
            status: CreditNoteStatus.APPROVED,
            reason: `Auto-generated refund from return of sale ${sale.saleNumber}`
          }
        });

        // credit note reduces customer outstanding balance
        const customer = await tx.customer.findUnique({ where: { id: sale.customerId } });
        if (customer) {
          await tx.customer.update({
            where: { id: customer.id },
            data: {
              currentOutstandingBalance: Math.max(0, Number(customer.currentOutstandingBalance) - totalRefund)
            }
          });
        }
      }

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: sale.branchId,
        userId: auth.userId,
        action: "sale.return",
        entityType: "Sale",
        entityId: sale.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        afterData: updatedSale
      }, tx);

      return updatedSale;
    });
  },

  async initiateStkPush(auth: AuthContext, input: Record<string, any>) {
    const invoice = await prisma.invoice.findFirst({
      where: { id: input.invoiceId, organizationId: auth.organizationId },
      include: { sale: true }
    });
    const sale = invoice?.sale ?? await prisma.sale.findFirst({
      where: { id: input.invoiceId, organizationId: auth.organizationId }
    });
    if (!sale) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Invoice or sale not found", StatusCodes.NOT_FOUND);
    }
    assertBranchAccess(auth, sale.branchId);
    if (auth.role === "SALES_ATTENDANT" && sale.attendantId !== auth.userId) {
      throw new AppError(ERROR_CODES.ACCESS_DENIED, "You can only initiate M-Pesa for your own sale", StatusCodes.FORBIDDEN);
    }
    if (Number(input.amount) > Number(invoice?.amountDue ?? sale.amountDue) + 0.01) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "STK amount cannot exceed the outstanding balance", StatusCodes.BAD_REQUEST);
    }

    const config = await prisma.mpesaConfiguration.findUnique({
      where: { organizationId: auth.organizationId }
    });
    if (!config) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "M-Pesa is not configured", StatusCodes.PRECONDITION_FAILED);
    }

    const checkoutRequestID = `STK-${input.idempotencyKey}`;
    const existing = await prisma.mpesaTransaction.findUnique({ where: { checkoutRequestID } });
    if (existing) {
      if (existing.organizationId !== auth.organizationId || existing.saleId !== sale.id) {
        throw new AppError(ERROR_CODES.DUPLICATE_IDEMPOTENCY_KEY, "Idempotency key is already in use", StatusCodes.CONFLICT);
      }
      return {
        accepted: true,
        status: existing.status,
        merchantRequestID: existing.merchantRequestID,
        checkoutRequestID: existing.checkoutRequestID,
        transactionId: existing.id
      };
    }

    // A provider adapter must replace this guard before production credentials are enabled.
    // Importantly, this path never fabricates a provider success or posts a payment.
    if (config.environment === "production") {
      throw new AppError(
        ERROR_CODES.BAD_REQUEST,
        "Production M-Pesa provider adapter is not configured",
        StatusCodes.SERVICE_UNAVAILABLE
      );
    }

    const merchantRequestID = `SANDBOX-${Date.now()}-${auth.organizationId.slice(-6)}`;

    const transaction = await prisma.mpesaTransaction.create({
      data: {
        organizationId: auth.organizationId,
        branchId: sale.branchId,
        saleId: sale.id,
        merchantRequestID,
        checkoutRequestID,
        amount: input.amount,
        phoneNumber: input.phoneNumber,
        status: "PENDING"
      }
    });

    return {
      accepted: true,
      status: "PENDING",
      message: "Sandbox STK request created; payment awaits a verified callback",
      merchantRequestID,
      checkoutRequestID,
      transactionId: transaction.id
    };
  },

  async handleMpesaCallback(payload: Record<string, any>, request: Request) {
    return prisma.$transaction(async (tx) => {
      const body = payload.Body || payload;
      const stkCallback = body.stkCallback;

      if (!stkCallback || typeof stkCallback !== "object") {
        return { accepted: false, status: "INVALID_PAYLOAD" };
      }

      const merchantRequestID = String(stkCallback.MerchantRequestID ?? "");
      const checkoutRequestID = String(stkCallback.CheckoutRequestID ?? "");
      const resultCode = Number(stkCallback.ResultCode);
      if (!merchantRequestID || !checkoutRequestID || !Number.isInteger(resultCode)) {
        return { accepted: false, status: "INVALID_IDENTIFIERS" };
      }

      const txRecord = await tx.mpesaTransaction.findFirst({
        where: { merchantRequestID, checkoutRequestID }
      });

      if (!txRecord) {
        return { accepted: false, status: "UNKNOWN_TRANSACTION" };
      }

      // Check payload hash idempotency to prevent replay attacks
      const payloadString = JSON.stringify(payload);
      const payloadHash = crypto.createHash("sha256").update(payloadString).digest("hex");

      const duplicateCallback = await tx.mpesaCallbackEvent.findUnique({
        where: { payloadHash }
      });
      if (duplicateCallback) {
        return { accepted: true, status: txRecord.status, replay: true };
      }

      const previousEvent = await tx.mpesaCallbackEvent.findFirst({ where: { checkoutRequestID } });
      if (previousEvent) {
        return { accepted: true, status: txRecord.status, replay: true };
      }

      const event = await tx.mpesaCallbackEvent.create({
        data: {
          merchantRequestID,
          checkoutRequestID,
          resultCode,
          resultDesc: String(stkCallback.ResultDesc ?? ""),
          rawPayload: payload as Prisma.InputJsonValue,
          payloadHash,
          processed: false
        }
      });

      if (txRecord.status !== "PENDING") {
        await tx.mpesaCallbackEvent.update({ where: { id: event.id }, data: { processed: true } });
        return { accepted: true, status: txRecord.status, replay: true };
      }

      // BRANCH FOR STOREFRONT ONLINE ORDERS
      if (txRecord.onlineOrderId) {
        const order = await tx.onlineOrder.findUnique({
          where: { id: txRecord.onlineOrderId }
        });

        if (!order) {
          return { accepted: false, status: "UNKNOWN_ORDER" };
        }

        // Find the payment attempt linked to this STK transaction
        const attempt = await tx.onlineOrderPaymentAttempt.findFirst({
          where: {
            onlineOrderId: order.id,
            checkoutRequestId: checkoutRequestID
          },
          orderBy: { createdAt: "desc" }
        });

        if (resultCode === 0) {
          const metadata = callbackMetadata(stkCallback);
          const amount = Number(metadata.get("Amount"));
          const receipt = String(metadata.get("MpesaReceiptNumber") ?? "").trim();
          const callbackPhone = String(metadata.get("PhoneNumber") ?? "").replace(/\D/g, "");
          const expectedPhone = txRecord.phoneNumber.replace(/\D/g, "").slice(-9);

          const duplicateReceipt = receipt
            ? await tx.mpesaTransaction.findFirst({ where: { mpesaReceiptNumber: receipt, id: { not: txRecord.id } } })
            : null;

          if (
            !Number.isFinite(amount) || Math.abs(amount - Number(txRecord.amount)) > 0.01 ||
            !receipt || duplicateReceipt || (callbackPhone && !callbackPhone.endsWith(expectedPhone))
          ) {
            // Mismatch or duplicate receipt -> REVIEW_REQUIRED
            await tx.mpesaTransaction.update({
              where: { id: txRecord.id },
              data: {
                status: "REVIEW_REQUIRED",
                resultDesc: "Callback metadata did not match storefront transaction details",
                rawCallbackPayload: payload as Prisma.InputJsonValue
              }
            });

            if (attempt) {
              await tx.onlineOrderPaymentAttempt.update({
                where: { id: attempt.id },
                data: {
                  status: "FAILED",
                  failedAt: new Date(),
                  failureCode: "METADATA_MISMATCH",
                  failureMessage: "Callback validation failed: amount, phone, or receipt mismatch.",
                  providerReceipt: receipt || null
                }
              });
            }

            await tx.onlineOrder.update({
              where: { id: order.id },
              data: {
                paymentStatus: "REVIEW_REQUIRED"
              }
            });

            await tx.mpesaReconciliationRecord.create({
              data: {
                organizationId: txRecord.organizationId,
                mpesaReceiptNumber: receipt || `UNKNOWN-${checkoutRequestID}`,
                transactionAmount: Number.isFinite(amount) ? amount : 0,
                systemAmount: txRecord.amount,
                status: "MISMATCH",
                notes: "Storefront callback mismatch; no payment posted"
              }
            });

            return { accepted: true, status: "REVIEW_REQUIRED" };
          }

          // Check if order is already cancelled or expired
          const isClosedOrder = order.status === "CANCELLED" || order.status === "EXPIRED";

          // Generate payment number
          const payCount = await tx.payment.count({
            where: { organizationId: txRecord.organizationId }
          });
          const paymentNumber = `PMT-${(payCount + 1).toString().padStart(6, "0")}`;

          // Create completed payment record
          const payment = await tx.payment.create({
            data: {
              organizationId: txRecord.organizationId,
              branchId: txRecord.branchId,
              paymentNumber,
              customerId: order.customerId,
              onlineOrderId: order.id,
              direction: PaymentDirection.INCOMING,
              paymentMethod: PaymentMethod.MPESA,
              amount: txRecord.amount,
              currencyCode: "KES",
              reference: receipt,
              externalTransactionId: receipt,
              status: PaymentRecordStatus.COMPLETED,
              receivedById: null,
              receivedAt: parseMpesaDate(metadata.get("TransactionDate")),
              idempotencyKey: `mpesa:${txRecord.checkoutRequestID}`,
              metadata: {
                mpesaTransactionId: txRecord.id,
                checkoutRequestID: txRecord.checkoutRequestID
              }
            }
          });

          // Update transaction
          await tx.mpesaTransaction.update({
            where: { id: txRecord.id },
            data: {
              status: "SUCCESS",
              mpesaReceiptNumber: receipt,
              transactionDate: payment.receivedAt,
              resultDesc: String(stkCallback.ResultDesc ?? "Success"),
              rawCallbackPayload: payload as Prisma.InputJsonValue,
              paymentId: payment.id,
              customerId: order.customerId
            }
          });

          // Update attempt
          if (attempt) {
            await tx.onlineOrderPaymentAttempt.update({
              where: { id: attempt.id },
              data: {
                status: "COMPLETED",
                completedAt: new Date(),
                paymentId: payment.id,
                providerReceipt: receipt,
                externalReference: receipt
              }
            });
          }

          // Update order status: If closed, mark paymentStatus as REVIEW_REQUIRED, otherwise transition to PAID & PLACED
          await tx.onlineOrder.update({
            where: { id: order.id },
            data: {
              status: isClosedOrder ? order.status : "PLACED",
              paymentStatus: isClosedOrder ? "REVIEW_REQUIRED" : "PAID"
            }
          });

          await tx.mpesaCallbackEvent.update({ where: { id: event.id }, data: { processed: true } });
          
          await auditService.create({
            organizationId: txRecord.organizationId,
            branchId: txRecord.branchId,
            userId: null,
            action: isClosedOrder ? "mpesa.callback.closed_order" : "mpesa.callback.verified",
            entityType: "OnlineOrder",
            entityId: order.id,
            requestId: request.requestContext?.requestId,
            ipAddress: request.ip,
            metadata: { checkoutRequestID, receipt, isClosedOrder }
          }, tx);

          return { accepted: true, status: "SUCCESS" };
        } else {
          // Failed callback (resultCode !== 0)
          await tx.mpesaTransaction.update({
            where: { id: txRecord.id },
            data: {
              status: resultCode === 1032 ? "CANCELLED" : "FAILED",
              resultDesc: String(stkCallback.ResultDesc || "Failed STK Push callback"),
              rawCallbackPayload: payload as Prisma.InputJsonValue
            }
          });

          if (attempt) {
            await tx.onlineOrderPaymentAttempt.update({
              where: { id: attempt.id },
              data: {
                status: resultCode === 1032 ? "CANCELLED" : "FAILED",
                failedAt: new Date(),
                failureCode: String(resultCode),
                failureMessage: String(stkCallback.ResultDesc || "Failed STK Push callback")
              }
            });
          }

          await tx.mpesaCallbackEvent.update({ where: { id: event.id }, data: { processed: true } });

          return { accepted: true, status: resultCode === 1032 ? "CANCELLED" : "FAILED" };
        }
      }

      if (resultCode === 0) {
        const metadata = callbackMetadata(stkCallback);
        const amount = Number(metadata.get("Amount"));
        const receipt = String(metadata.get("MpesaReceiptNumber") ?? "").trim();
        const callbackPhone = String(metadata.get("PhoneNumber") ?? "").replace(/\D/g, "");
        const expectedPhone = txRecord.phoneNumber.replace(/\D/g, "").slice(-9);
        const duplicateReceipt = receipt
          ? await tx.mpesaTransaction.findFirst({ where: { mpesaReceiptNumber: receipt, id: { not: txRecord.id } } })
          : null;

        if (
          !Number.isFinite(amount) || Math.abs(amount - Number(txRecord.amount)) > 0.01 ||
          !receipt || duplicateReceipt || (callbackPhone && !callbackPhone.endsWith(expectedPhone))
        ) {
          await tx.mpesaTransaction.update({
            where: { id: txRecord.id },
            data: {
              status: "REVIEW_REQUIRED",
              resultDesc: "Callback metadata did not match the initiated transaction",
              rawCallbackPayload: payload as Prisma.InputJsonValue
            }
          });
          await tx.mpesaReconciliationRecord.create({
            data: {
              organizationId: txRecord.organizationId,
              mpesaReceiptNumber: receipt || `UNKNOWN-${checkoutRequestID}`,
              transactionAmount: Number.isFinite(amount) ? amount : 0,
              systemAmount: txRecord.amount,
              status: "MISMATCH",
              notes: "Callback mismatch; no payment was posted"
            }
          });
          await auditService.create({
            organizationId: txRecord.organizationId,
            branchId: txRecord.branchId,
            userId: null,
            action: "mpesa.callback.mismatch",
            entityType: "MpesaCallbackEvent",
            entityId: event.id,
            requestId: request.requestContext?.requestId,
            ipAddress: request.ip,
            metadata: { merchantRequestID, checkoutRequestID, resultCode }
          }, tx);
          return { accepted: true, status: "REVIEW_REQUIRED" };
        }

        const payment = await this.recordVerifiedMpesaPayment(
          tx,
          txRecord,
          receipt,
          parseMpesaDate(metadata.get("TransactionDate"))
        );
        if (!payment) {
          await tx.mpesaTransaction.update({
            where: { id: txRecord.id },
            data: { status: "REVIEW_REQUIRED", resultDesc: "No eligible sale balance for payment" }
          });
          await tx.mpesaReconciliationRecord.create({
            data: {
              organizationId: txRecord.organizationId,
              mpesaReceiptNumber: receipt,
              transactionAmount: amount,
              systemAmount: 0,
              status: "MISMATCH",
              notes: "Verified callback has no eligible sale balance; no payment was posted"
            }
          });
          return { accepted: true, status: "REVIEW_REQUIRED" };
        }

        const updated = await tx.mpesaTransaction.update({
          where: { id: txRecord.id },
          data: {
            status: "SUCCESS",
            mpesaReceiptNumber: receipt,
            transactionDate: payment.receivedAt,
            resultDesc: String(stkCallback.ResultDesc ?? "Success"),
            rawCallbackPayload: payload as Prisma.InputJsonValue,
            paymentId: payment.id,
            customerId: payment.customerId
          }
        });
        await tx.mpesaCallbackEvent.update({ where: { id: event.id }, data: { processed: true } });
        await auditService.create({
          organizationId: txRecord.organizationId,
          branchId: txRecord.branchId,
          userId: null,
          action: "mpesa.callback.verified",
          entityType: "MpesaTransaction",
          entityId: txRecord.id,
          requestId: request.requestContext?.requestId,
          ipAddress: request.ip,
          afterData: updated,
          metadata: { merchantRequestID, checkoutRequestID, receipt }
        }, tx);

        return { accepted: true, status: "SUCCESS" };
      } else {
        const updated = await tx.mpesaTransaction.update({
          where: { id: txRecord.id },
          data: {
            status: resultCode === 1032 ? "CANCELLED" : "FAILED",
            resultDesc: String(stkCallback.ResultDesc || "Failed STK Push callback"),
            rawCallbackPayload: payload as Prisma.InputJsonValue
          }
        });
        await tx.mpesaCallbackEvent.update({ where: { id: event.id }, data: { processed: true } });
        await auditService.create({
          organizationId: txRecord.organizationId,
          branchId: txRecord.branchId,
          userId: null,
          action: "mpesa.callback.failed",
          entityType: "MpesaTransaction",
          entityId: txRecord.id,
          requestId: request.requestContext?.requestId,
          ipAddress: request.ip,
          afterData: updated,
          metadata: { merchantRequestID, checkoutRequestID, resultCode }
        }, tx);

        return { accepted: true, status: updated.status };
      }
    });
  },

  async recordVerifiedMpesaPayment(
    tx: Prisma.TransactionClient,
    transaction: { id: string; organizationId: string; branchId: string; saleId: string | null; amount: Prisma.Decimal; checkoutRequestID: string },
    receipt: string,
    receivedAt: Date
  ) {
    if (!transaction.saleId) return null;
    const sale = await tx.sale.findFirst({
      where: { id: transaction.saleId, organizationId: transaction.organizationId }
    });

    const amount = Number(transaction.amount);
    if (!sale || amount > Number(sale.amountDue) + 0.01) return null;

    const totalPaid = Number(sale.amountPaid) + amount;
    const balanceDue = Math.max(0, Number(sale.totalAmount) - totalPaid);

    let paymentStatus: PaymentStatus = PaymentStatus.PAID;
    if (balanceDue > 0) {
      paymentStatus = totalPaid > 0 ? PaymentStatus.PARTIALLY_PAID : PaymentStatus.UNPAID;
    }

    await tx.sale.update({
      where: { id: sale.id },
      data: {
        amountPaid: totalPaid,
        amountDue: balanceDue,
        paymentStatus
      }
    });

    const payCount = await tx.payment.count({
      where: { organizationId: transaction.organizationId }
    });
    const paymentNumber = `PMT-${(payCount + 1).toString().padStart(6, "0")}`;

    const payment = await tx.payment.create({
      data: {
        organizationId: transaction.organizationId,
        branchId: sale.branchId,
        paymentNumber,
        customerId: sale.customerId,
        saleId: sale.id,
        direction: PaymentDirection.INCOMING,
        paymentMethod: PaymentMethod.MPESA,
        amount,
        currencyCode: sale.currencyCode,
        reference: receipt,
        externalTransactionId: receipt,
        status: PaymentRecordStatus.COMPLETED,
        receivedById: null,
        receivedAt,
        idempotencyKey: `mpesa:${transaction.checkoutRequestID}`,
        metadata: {
          mpesaTransactionId: transaction.id,
          checkoutRequestID: transaction.checkoutRequestID
        }
      }
    });

    const invoice = await tx.invoice.findFirst({
      where: { saleId: sale.id, amountDue: { gt: 0 }, status: { not: "VOIDED" } },
      orderBy: { createdAt: "asc" }
    });
    if (invoice) {
      const allocated = Math.min(amount, Number(invoice.amountDue));
      await tx.invoicePaymentAllocation.create({
        data: { paymentId: payment.id, invoiceId: invoice.id, amount: allocated }
      });
      const invoiceDue = Number(invoice.amountDue) - allocated;
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          amountPaid: { increment: allocated },
          amountDue: invoiceDue,
          status: invoiceDue <= 0 ? "PAID" : "PARTIALLY_PAID"
        }
      });
    }

    // Update customer outstanding balance if applicable
    if (sale.customerId) {
      await postCustomerBalanceEntry(tx, {
        organizationId: transaction.organizationId, branchId: sale.branchId, customerId: sale.customerId,
        amount: -amount, entryType: "PAYMENT", referenceType: "Payment", referenceId: payment.id,
        notes: `Verified M-Pesa ${receipt}`
      });
    }

    return payment;
  },

  async listPayments(auth: AuthContext, query: Record<string, any>) {
    const scope = buildUserScope(auth);
    const whereClause: Prisma.PaymentWhereInput = {
      organizationId: scope.organizationId,
    };

    if (scope.branchIds) {
      whereClause.branchId = { in: scope.branchIds };
    }
    if (auth.role === "SALES_ATTENDANT") {
      whereClause.receivedById = auth.userId;
    }

    if (query.customerId) {
      whereClause.customerId = query.customerId;
    }
    if (query.branchId) {
      if (scope.branchIds && !scope.branchIds.includes(query.branchId)) {
        throw new AppError(ERROR_CODES.BRANCH_ACCESS_DENIED, "Branch access denied", StatusCodes.FORBIDDEN);
      }
      whereClause.branchId = query.branchId;
    }
    if (query.paymentMethod) {
      whereClause.paymentMethod = query.paymentMethod;
    }
    if (query.status) {
      whereClause.status = query.status;
    }
    if (query.saleId) {
      whereClause.saleId = query.saleId;
    }

    return prisma.payment.findMany({
      where: whereClause,
      include: {
        customer: {
          select: { id: true, firstName: true, lastName: true, businessName: true }
        },
        sale: {
          select: { id: true, saleNumber: true, totalAmount: true }
        }
      },
      orderBy: { receivedAt: "desc" }
    });
  },

  async getPaymentDetail(auth: AuthContext, id: string) {
    const scope = buildUserScope(auth);
    const payment = await prisma.payment.findFirst({
      where: {
        id,
        organizationId: scope.organizationId,
        branchId: scope.branchIds ? { in: scope.branchIds } : undefined,
        receivedById: auth.role === "SALES_ATTENDANT" ? auth.userId : undefined
      },
      include: {
        customer: true,
        sale: {
          include: {
            branch: true
          }
        },
        allocations: {
          include: {
            invoice: true
          }
        }
      }
    });

    if (!payment) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Payment not found", StatusCodes.NOT_FOUND);
    }

    return payment;
  },

  async reversePayment(auth: AuthContext, id: string, reason: string, request: Request) {
    return prisma.$transaction(async (tx) => {
      const scope = buildUserScope(auth);
      const payment = await tx.payment.findFirst({
        where: {
          id,
          organizationId: scope.organizationId,
          branchId: scope.branchIds ? { in: scope.branchIds } : undefined
        },
        include: {
          allocations: true
        }
      });

      if (!payment) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Payment not found", StatusCodes.NOT_FOUND);
      }

      if (payment.status !== PaymentRecordStatus.COMPLETED) {
        throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Only a completed payment can be reversed", StatusCodes.CONFLICT);
      }
      let reversalShiftId: string | null = null;
      if (payment.paymentMethod === PaymentMethod.CASH) {
        const shift = await tx.shift.findFirst({
          where: { organizationId: auth.organizationId, branchId: payment.branchId, userId: auth.userId, status: "OPEN" }
        });
        if (!shift) throw new AppError(ERROR_CODES.SHIFT_NOT_OPEN, "Cash reversal requires the manager's open shift", StatusCodes.CONFLICT);
        reversalShiftId = shift.id;
      }

      for (const allocation of payment.allocations) {
        const invoice = await tx.invoice.findUnique({
          where: { id: allocation.invoiceId }
        });

        if (invoice) {
          const newPaid = Math.max(0, Number(invoice.amountPaid) - Number(allocation.amount));
          const newDue = Number(invoice.totalAmount) - newPaid;
          let status = "PARTIALLY_PAID";
          if (newPaid === 0) {
            status = "SENT";
          }

          await tx.invoice.update({
            where: { id: invoice.id },
            data: {
              amountPaid: newPaid,
              amountDue: newDue,
              status: status as any
            }
          });
        }
      }

      await tx.invoicePaymentAllocation.deleteMany({
        where: { paymentId: payment.id }
      });

      if (payment.saleId) {
        const sale = await tx.sale.findUnique({
          where: { id: payment.saleId }
        });

        if (sale) {
          const newPaid = Math.max(0, Number(sale.amountPaid) - Number(payment.amount));
          const newDue = Number(sale.totalAmount) - newPaid;
          let paymentStatus: PaymentStatus = PaymentStatus.PARTIALLY_PAID;
          if (newPaid === 0) {
            paymentStatus = PaymentStatus.UNPAID;
          }

          await tx.sale.update({
            where: { id: sale.id },
            data: {
              amountPaid: newPaid,
              amountDue: newDue,
              paymentStatus
            }
          });
        }
      }

      if (payment.customerId) {
        await postCustomerBalanceEntry(tx, {
          organizationId: auth.organizationId, branchId: payment.branchId, customerId: payment.customerId,
          amount: Number(payment.amount), entryType: "PAYMENT_REVERSAL", referenceType: "Payment", referenceId: payment.id,
          notes: reason, createdById: auth.userId
        });
      }

      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentRecordStatus.REVERSED,
          reversedAt: new Date(),
          reversalReason: reason
        }
      });
      const reversalCount = await tx.payment.count({ where: { organizationId: auth.organizationId } });
      const reversal = await tx.payment.create({
        data: {
          organizationId: auth.organizationId, branchId: payment.branchId,
          paymentNumber: `PMT-${(reversalCount + 1).toString().padStart(6, "0")}`,
          customerId: payment.customerId, saleId: payment.saleId, shiftId: reversalShiftId,
          direction: payment.direction === PaymentDirection.INCOMING ? PaymentDirection.OUTGOING : PaymentDirection.INCOMING,
          paymentMethod: payment.paymentMethod, amount: payment.amount, currencyCode: payment.currencyCode,
          reference: `REV-${payment.paymentNumber}`, status: PaymentRecordStatus.COMPLETED,
          receivedById: auth.userId, receivedAt: new Date(), idempotencyKey: `payment-reversal:${payment.id}`,
          metadata: { reversedPaymentId: payment.id, reason }
        }
      });
      if (reversalShiftId) {
        await tx.shiftCashMovement.create({
          data: { shiftId: reversalShiftId, movementType: "CASH_REFUND", amount: payment.amount, reference: reversal.paymentNumber, notes: reason }
        });
      }

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: payment.branchId,
        userId: auth.userId,
        action: "payment.reverse",
        entityType: "Payment",
        entityId: payment.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        afterData: { original: updatedPayment, reversal }
      }, tx);

      return { original: updatedPayment, reversal };
    });
  },

  async listMpesaTransactions(auth: AuthContext, query: Record<string, any>) {
    const scope = buildUserScope(auth);
    const whereClause: Prisma.MpesaTransactionWhereInput = {
      organizationId: scope.organizationId
    };

    if (scope.branchIds) {
      whereClause.branchId = { in: scope.branchIds };
    }
    if (auth.role === "SALES_ATTENDANT") {
      whereClause.OR = [
        { sale: { attendantId: auth.userId } },
        { onlineOrderId: { not: null } }
      ];
    }

    if (query.branchId) {
      if (scope.branchIds && !scope.branchIds.includes(query.branchId)) {
        throw new AppError(ERROR_CODES.BRANCH_ACCESS_DENIED, "Branch access denied", StatusCodes.FORBIDDEN);
      }
      whereClause.branchId = query.branchId;
    }
    if (query.status) {
      whereClause.status = query.status;
    }
    if (query.phoneNumber) {
      whereClause.phoneNumber = { contains: query.phoneNumber };
    }
    if (query.mpesaReceiptNumber) {
      whereClause.mpesaReceiptNumber = query.mpesaReceiptNumber;
    }
    if (query.orderNumber) {
      whereClause.onlineOrder = { orderNumber: { contains: query.orderNumber, mode: "insensitive" } };
    }

    return prisma.mpesaTransaction.findMany({
      where: whereClause,
      include: {
        customer: { select: { id: true, firstName: true, lastName: true } },
        sale: { select: { id: true, saleNumber: true } },
        onlineOrder: { select: { id: true, orderNumber: true } }
      },
      orderBy: { createdAt: "desc" }
    });
  },

  async getMpesaTransactionDetail(auth: AuthContext, id: string) {
    const scope = buildUserScope(auth);
    
    const whereClause: Prisma.MpesaTransactionWhereInput = {
      id,
      organizationId: scope.organizationId,
    };

    if (scope.branchIds) {
      whereClause.branchId = { in: scope.branchIds };
    }

    if (auth.role === "SALES_ATTENDANT") {
      whereClause.OR = [
        { sale: { attendantId: auth.userId } },
        { onlineOrderId: { not: null } }
      ];
    }

    const txRecord = await prisma.mpesaTransaction.findFirst({
      where: whereClause,
      include: {
        customer: true,
        sale: true,
        payment: true,
        onlineOrder: true
      }
    });

    if (!txRecord) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "M-Pesa transaction not found", StatusCodes.NOT_FOUND);
    }

    return txRecord;
  },

  async getMpesaConfig(auth: AuthContext) {
    const scope = buildUserScope(auth);
    const config = await prisma.mpesaConfiguration.findUnique({
      where: { organizationId: scope.organizationId }
    });

    if (!config) {
      return null;
    }

    const { consumerKey: _consumerKey, consumerSecret: _consumerSecret, passkey: _passkey, ...safe } = config;
    return { ...safe, hasConsumerKey: true, hasConsumerSecret: true, hasPasskey: true };
  },

  async saveMpesaConfig(auth: AuthContext, input: Record<string, any>) {
    const scope = buildUserScope(auth);
    const existing = await prisma.mpesaConfiguration.findUnique({ where: { organizationId: scope.organizationId } });
    if (!existing && (!input.consumerKey || !input.consumerSecret || !input.passkey)) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "All credentials are required for initial M-Pesa configuration", StatusCodes.BAD_REQUEST);
    }
    const data = {
      organizationId: scope.organizationId,
      shortcode: input.shortcode as string,
      consumerKey: input.consumerKey ? encrypt(input.consumerKey) : (existing?.consumerKey || ""),
      consumerSecret: input.consumerSecret ? encrypt(input.consumerSecret) : (existing?.consumerSecret || ""),
      passkey: input.passkey ? encrypt(input.passkey) : (existing?.passkey || ""),
      environment: (input.environment || "sandbox") as string,
      callbackUrl: input.callbackUrl as string
    };

    const config = await prisma.mpesaConfiguration.upsert({
      where: { organizationId: scope.organizationId },
      update: data,
      create: data
    });

    const { consumerKey: _consumerKey, consumerSecret: _consumerSecret, passkey: _passkey, ...safe } = config;
    return { ...safe, hasConsumerKey: true, hasConsumerSecret: true, hasPasskey: true };
  },

  async listReconciliations(auth: AuthContext, query: Record<string, any>) {
    const scope = buildUserScope(auth);
    return prisma.mpesaReconciliationRecord.findMany({
      where: {
        organizationId: scope.organizationId,
        status: query.status || undefined
      },
      orderBy: { createdAt: "desc" }
    });
  },

  async resolveReconciliation(auth: AuthContext, input: Record<string, any>, request: Request) {
    return prisma.$transaction(async (tx) => {
      const scope = buildUserScope(auth);
      const record = await tx.mpesaReconciliationRecord.findFirst({
        where: { id: input.reconciliationId, organizationId: scope.organizationId }
      });

      if (!record) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Reconciliation record not found", StatusCodes.NOT_FOUND);
      }

      const updated = await tx.mpesaReconciliationRecord.update({
        where: { id: record.id },
        data: {
          status: input.status,
          notes: input.notes,
          resolvedById: auth.userId,
          resolvedAt: new Date()
        }
      });

      await auditService.create({
        organizationId: auth.organizationId,
        userId: auth.userId,
        action: "mpesa.reconcile",
        entityType: "MpesaReconciliationRecord",
        entityId: record.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        afterData: updated
      }, tx);

      return updated;
    });
  },

  async listReturns(auth: AuthContext, query: Record<string, any>) {
    const scope = buildUserScope(auth);
    const where: Prisma.ReturnRequestWhereInput = {
      organizationId: scope.organizationId
    };
    if (scope.branchIds) where.branchId = { in: scope.branchIds };
    if (auth.role === "SALES_ATTENDANT") where.requestedById = auth.userId;

    if (query.branchId) {
      assertBranchAccess(auth, query.branchId);
      where.branchId = query.branchId;
    }
    if (query.customerId) where.customerId = query.customerId;
    if (query.status) where.status = query.status;

    return prisma.returnRequest.findMany({
      where,
      include: {
        customer: { select: { id: true, firstName: true, lastName: true, businessName: true } },
        branch: { select: { id: true, name: true } },
        sale: { select: { id: true, saleNumber: true, totalAmount: true } },
        items: true,
        refunds: true
      },
      orderBy: { requestedAt: "desc" }
    });
  },

  async getReturnDetail(auth: AuthContext, id: string) {
    const scope = buildUserScope(auth);
    const returnRequest = await prisma.returnRequest.findFirst({
      where: {
        id,
        organizationId: scope.organizationId,
        branchId: scope.branchIds ? { in: scope.branchIds } : undefined,
        requestedById: auth.role === "SALES_ATTENDANT" ? auth.userId : undefined
      },
      include: {
        customer: true,
        branch: true,
        sale: true,
        refunds: true,
        items: {
          include: {
            productVariant: { include: { product: true } },
            saleItem: true
          }
        }
      }
    });

    if (!returnRequest) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Return records not found", StatusCodes.NOT_FOUND);
    }

    return returnRequest;
  },

  async reviewReturn(auth: AuthContext, id: string, notes: string, request: Request) {
    const current = await this.getReturnDetail(auth, id);
    assertBranchAccess(auth, current.branchId);
    if (current.status !== "REQUESTED") {
      throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Only requested returns can enter review", StatusCodes.CONFLICT);
    }
    const updated = await prisma.returnRequest.update({
      where: { id },
      data: { status: "UNDER_REVIEW", reviewedById: auth.userId, reviewedAt: new Date(), reviewNotes: notes }
    });
    await auditService.create({
      organizationId: auth.organizationId, branchId: current.branchId, userId: auth.userId,
      action: "return.review", entityType: "ReturnRequest", entityId: id,
      requestId: request.requestContext.requestId, ipAddress: request.ip,
      userAgent: request.header("user-agent"), beforeData: current, afterData: updated
    });
    return updated;
  },

  async inspectReturn(auth: AuthContext, id: string, input: Record<string, any>, request: Request) {
    return prisma.$transaction(async (tx) => {
      const current = await tx.returnRequest.findFirst({
        where: {
          id,
          organizationId: auth.organizationId,
          ...(auth.branchIds.length ? { branchId: { in: auth.branchIds } } : {})
        },
        include: { items: true }
      });
      if (!current) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Return request not found", StatusCodes.NOT_FOUND);
      assertBranchAccess(auth, current.branchId);
      if (current.status !== "UNDER_REVIEW") {
        throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Return must be under review before inspection", StatusCodes.CONFLICT);
      }
      if (input.items.length !== current.items.length) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Every return item must receive an inspection decision", StatusCodes.BAD_REQUEST);
      }
      for (const decision of input.items) {
        const item = current.items.find((candidate) => candidate.id === decision.itemId);
        if (!item) throw new AppError(ERROR_CODES.BAD_REQUEST, "Unknown return item", StatusCodes.BAD_REQUEST);
        await tx.returnRequestItem.update({
          where: { id: item.id },
          data: {
            disposition: decision.disposition,
            restockEligible: decision.disposition === "RESTOCK" && item.condition === "SEALED",
            inspectionNotes: decision.inspectionNotes ?? null
          }
        });
      }
      const updated = await tx.returnRequest.update({
        where: { id },
        data: {
          status: "INSPECTED", inspectedById: auth.userId, inspectedAt: new Date(), inspectionNotes: input.notes
        },
        include: { items: true }
      });
      await auditService.create({
        organizationId: auth.organizationId, branchId: current.branchId, userId: auth.userId,
        action: "return.inspect", entityType: "ReturnRequest", entityId: id,
        requestId: request.requestContext.requestId, ipAddress: request.ip,
        userAgent: request.header("user-agent"), beforeData: current, afterData: updated
      }, tx);
      return updated;
    });
  },

  async approveReturn(auth: AuthContext, id: string, request: Request) {
    return prisma.$transaction(async (tx) => {
      const current = await tx.returnRequest.findFirst({
        where: {
          id,
          organizationId: auth.organizationId,
          ...(auth.branchIds.length ? { branchId: { in: auth.branchIds } } : {})
        },
        include: { items: true, refunds: true }
      });
      if (!current) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Return request not found", StatusCodes.NOT_FOUND);
      assertBranchAccess(auth, current.branchId);
      if (current.status !== "INSPECTED") {
        throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Return must be inspected before approval", StatusCodes.CONFLICT);
      }
      if (current.requestedById === auth.userId) {
        throw new AppError(ERROR_CODES.ACCESS_DENIED, "A requester cannot approve their own return", StatusCodes.FORBIDDEN);
      }
      const acceptedValue = current.items
        .filter((item) => item.disposition !== "REJECT")
        .reduce((sum, item) => sum + Number(item.eligibleValue), 0);
      if (acceptedValue <= 0) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "No inspected items are eligible for approval", StatusCodes.BAD_REQUEST);
      }

      const updated = await tx.returnRequest.update({
        where: { id },
        data: { status: "APPROVED", approvedById: auth.userId, approvedAt: new Date() }
      });
      if (current.refunds.length === 0 && current.requestedRefundMethod) {
        const branch = await tx.branch.findFirstOrThrow({
          where: { id: current.branchId, organizationId: auth.organizationId },
          select: { code: true }
        });
        const refundNumber = await reserveRefundNumber(tx, {
          organizationId: auth.organizationId,
          branchId: current.branchId,
          branchCode: branch.code,
          issuedAt: new Date()
        });
        await tx.refund.create({
          data: {
            organizationId: auth.organizationId,
            branchId: current.branchId,
            refundNumber,
            returnRequestId: current.id,
            originalSaleId: current.saleId,
            customerId: current.customerId,
            amount: acceptedValue,
            eligibleAmount: acceptedValue,
            approvedAmount: null,
            method: current.requestedRefundMethod,
            status: "PENDING_APPROVAL",
            refundType: "PARTIAL_ITEM",
            reason: current.reason,
            detailedReason: current.reason,
            requestedById: current.requestedById
          }
        });
      }
      await auditService.create({
        organizationId: auth.organizationId, branchId: current.branchId, userId: auth.userId,
        action: "return.approve", entityType: "ReturnRequest", entityId: id,
        requestId: request.requestContext.requestId, ipAddress: request.ip,
        userAgent: request.header("user-agent"), beforeData: current, afterData: updated
      }, tx);
      return updated;
    });
  },

  async rejectReturn(auth: AuthContext, id: string, reason: string, request: Request) {
    const current = await this.getReturnDetail(auth, id);
    assertBranchAccess(auth, current.branchId);
    if (!["REQUESTED", "UNDER_REVIEW", "INSPECTED"].includes(current.status)) {
      throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Return can no longer be rejected", StatusCodes.CONFLICT);
    }
    const updated = await prisma.returnRequest.update({
      where: { id },
      data: {
        status: "REJECTED", rejectedById: auth.userId, rejectedAt: new Date(), rejectionReason: reason
      }
    });
    await auditService.create({
      organizationId: auth.organizationId, branchId: current.branchId, userId: auth.userId,
      action: "return.reject", entityType: "ReturnRequest", entityId: id,
      requestId: request.requestContext.requestId, ipAddress: request.ip,
      userAgent: request.header("user-agent"), beforeData: current, afterData: updated
    });
    return updated;
  },

  async completeReturn(auth: AuthContext, id: string, request: Request) {
    return prisma.$transaction(async (tx) => {
      const current = await tx.returnRequest.findFirst({
        where: {
          id,
          organizationId: auth.organizationId,
          ...(auth.branchIds.length ? { branchId: { in: auth.branchIds } } : {})
        },
        include: { items: { include: { saleItem: true } } }
      });
      if (!current) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Return request not found", StatusCodes.NOT_FOUND);
      assertBranchAccess(auth, current.branchId);
      if (current.status !== "APPROVED") {
        throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Only approved returns can be completed", StatusCodes.CONFLICT);
      }

      for (const item of current.items) {
        if (item.disposition === "RESTOCK") {
          await inventoryWriteService.receiveStock(tx, {
            organizationId: current.organizationId,
            branchId: current.branchId,
            productVariantId: item.productVariantId,
            quantity: Number(item.quantity),
            unitCost: Number(item.saleItem.unitCost),
            landedUnitCost: Number(item.saleItem.unitCost),
            movementType: "CUSTOMER_RETURN",
            referenceType: "ReturnRequestItem",
            referenceId: item.id,
            performedById: auth.userId,
            notes: `Accepted sealed return ${current.returnNumber}`
          });
        } else if (item.disposition === "QUARANTINE") {
          const balance = await inventoryWriteService.lockBalance(
            tx, current.organizationId, current.branchId, item.productVariantId
          );
          const quantity = Number(item.quantity);
          await tx.inventoryBalance.update({
            where: { id: balance.id },
            data: { quantityOnHand: { increment: quantity }, lastMovementAt: new Date(), version: { increment: 1 } }
          });
          const batch = await tx.inventoryBatch.create({
            data: {
              organizationId: current.organizationId,
              branchId: current.branchId,
              productVariantId: item.productVariantId,
              batchNumber: `RETURN-${current.returnNumber}-${item.id.slice(-6)}`,
              quantityOnHand: quantity,
              quantityReserved: 0,
              unitCost: item.saleItem.unitCost,
              landedUnitCost: item.saleItem.unitCost,
              status: "QUARANTINED"
            }
          });
          await tx.inventoryMovement.create({
            data: {
              organizationId: current.organizationId,
              branchId: current.branchId,
              productVariantId: item.productVariantId,
              inventoryBatchId: batch.id,
              movementNumber: `MVT-${Date.now()}-${item.id.slice(-6).toUpperCase()}`,
              movementType: "CUSTOMER_RETURN",
              referenceType: "ReturnRequestItem",
              referenceId: item.id,
              quantity,
              unitCost: item.saleItem.unitCost,
              totalCost: Number(item.saleItem.unitCost) * quantity,
              quantityBefore: balance.quantityOnHand,
              quantityAfter: Number(balance.quantityOnHand) + quantity,
              performedById: auth.userId,
              reason: `Quarantined return ${current.returnNumber}`
            }
          });
        }

        if (item.disposition !== "REJECT") {
          await tx.saleItem.update({
            where: { id: item.saleItemId },
            data: { returnedQuantity: { increment: item.quantity } }
          });
        }
      }

      const saleItems = await tx.saleItem.findMany({ where: { saleId: current.saleId } });
      const fullyReturned = saleItems.every((item) => Number(item.returnedQuantity) >= Number(item.quantity));
      await tx.sale.update({
        where: { id: current.saleId },
        data: { status: fullyReturned ? SaleStatus.FULLY_RETURNED : SaleStatus.PARTIALLY_RETURNED }
      });
      const updated = await tx.returnRequest.update({
        where: { id },
        data: { status: "COMPLETED", completedAt: new Date() },
        include: { items: true, refunds: true }
      });
      await auditService.create({
        organizationId: auth.organizationId, branchId: current.branchId, userId: auth.userId,
        action: "return.complete", entityType: "ReturnRequest", entityId: id,
        requestId: request.requestContext.requestId, ipAddress: request.ip,
        userAgent: request.header("user-agent"), beforeData: current, afterData: updated
      }, tx);
      return updated;
    });
  },

  ...refundWorkflowService,

  async listExchanges(auth: AuthContext, query: Record<string, any>) {
    const scope = buildUserScope(auth);
    const where: Prisma.ExchangeWhereInput = { organizationId: scope.organizationId };
    if (scope.branchIds) where.branchId = { in: scope.branchIds };
    if (auth.role === "SALES_ATTENDANT") where.requestedById = auth.userId;
    if (query.branchId) {
      assertBranchAccess(auth, String(query.branchId));
      where.branchId = String(query.branchId);
    }
    if (query.status) where.status = query.status;
    return prisma.exchange.findMany({
      where,
      include: {
        branch: { select: { id: true, name: true } },
        customer: { select: { id: true, firstName: true, lastName: true, businessName: true } },
        returnRequest: { select: { id: true, returnNumber: true } },
        originalSale: { select: { id: true, saleNumber: true } },
        replacementSale: { include: { items: true, payments: true } }
      },
      orderBy: { createdAt: "desc" }
    });
  },

  async getExchange(auth: AuthContext, id: string) {
    const scope = buildUserScope(auth);
    const exchange = await prisma.exchange.findFirst({
      where: {
        id,
        organizationId: scope.organizationId,
        ...(scope.branchIds ? { branchId: { in: scope.branchIds } } : {}),
        ...(auth.role === "SALES_ATTENDANT" ? { requestedById: auth.userId } : {})
      },
      include: {
        branch: true,
        customer: true,
        returnRequest: { include: { items: { include: { productVariant: { include: { product: true } } } } } },
        originalSale: true,
        replacementSale: { include: { items: true, payments: true } }
      }
    });
    if (!exchange) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Exchange not found", StatusCodes.NOT_FOUND);
    return exchange;
  },

  async createExchange(auth: AuthContext, input: Record<string, any>, request: Request) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.sale.findFirst({
        where: { organizationId: auth.organizationId, idempotencyKey: `exchange:${input.idempotencyKey}` },
        include: { replacementExchanges: true }
      });
      if (existing?.replacementExchanges[0]) {
        return tx.exchange.findUnique({
          where: { id: existing.replacementExchanges[0].id },
          include: { returnRequest: true, originalSale: true, replacementSale: { include: { items: true, payments: true } } }
        });
      }

      const returnRequest = await tx.returnRequest.findFirst({
        where: {
          id: input.returnRequestId,
          organizationId: auth.organizationId,
          status: "COMPLETED",
          resolution: "EXCHANGE",
          ...(auth.branchIds.length ? { branchId: { in: auth.branchIds } } : {}),
          ...(auth.role === "SALES_ATTENDANT" ? { requestedById: auth.userId } : {})
        },
        include: { items: true, exchanges: true, refunds: true, sale: true }
      });
      if (!returnRequest) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Completed exchange return not found", StatusCodes.NOT_FOUND);
      }
      assertBranchAccess(auth, returnRequest.branchId);
      if (returnRequest.exchanges.some((exchange) => exchange.status !== "REJECTED")) {
        throw new AppError(ERROR_CODES.DUPLICATE_IDEMPOTENCY_KEY, "This return credit has already been exchanged", StatusCodes.CONFLICT);
      }
      if (returnRequest.refunds.some((refund) => refund.status !== "REJECTED" && refund.status !== "FAILED")) {
        throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "A refunded return cannot also be exchanged", StatusCodes.CONFLICT);
      }

      const prepared = await prepareCheckout(tx, auth, {
        branchId: returnRequest.branchId,
        customerId: returnRequest.customerId,
        saleType: SaleType.RETAIL,
        items: input.items.map((item: Record<string, any>) => ({ ...item, discountAmount: 0 })),
        payments: []
      }, false);
      const originalValue = returnRequest.items
        .filter((item) => item.disposition !== "REJECT")
        .reduce((sum, item) => sum + Number(item.eligibleValue), 0);
      const difference = Number((prepared.totalAmount - originalValue).toFixed(2));
      const paymentDue = Math.max(0, difference);
      if (paymentDue > 0) {
        if (!input.paymentMethod) {
          throw new AppError(ERROR_CODES.BAD_REQUEST, `A difference payment of ${paymentDue.toFixed(2)} is required`, StatusCodes.BAD_REQUEST);
        }
        if (input.paymentAmount != null && Math.abs(Number(input.paymentAmount) - paymentDue) > 0.01) {
          throw new AppError(ERROR_CODES.BAD_REQUEST, "The submitted payment does not match the server-calculated difference", StatusCodes.BAD_REQUEST);
        }
        if (["MPESA", "CARD", "BANK_TRANSFER"].includes(input.paymentMethod) && !input.paymentReference) {
          throw new AppError(ERROR_CODES.BAD_REQUEST, "A verified payment reference is required", StatusCodes.BAD_REQUEST);
        }
      } else if (input.paymentAmount) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "No difference payment is due", StatusCodes.BAD_REQUEST);
      }

      const count = await tx.exchange.count({ where: { organizationId: auth.organizationId } });
      const exchange = await tx.exchange.create({
        data: {
          organizationId: auth.organizationId,
          branchId: returnRequest.branchId,
          exchangeNumber: `EXC-${(count + 1).toString().padStart(6, "0")}`,
          returnRequestId: returnRequest.id,
          originalSaleId: returnRequest.saleId,
          customerId: returnRequest.customerId,
          originalValue,
          replacementValue: prepared.totalAmount,
          differenceAmount: difference,
          status: "PROCESSING",
          requestedById: auth.userId,
          approvedById: auth.userId,
          reason: input.reason
        }
      });

      const saleCount = await tx.sale.count({ where: { organizationId: auth.organizationId } });
      const creditApplied = Math.min(originalValue, prepared.totalAmount);
      const replacementSale = await tx.sale.create({
        data: {
          organizationId: auth.organizationId,
          branchId: returnRequest.branchId,
          saleNumber: `SAL-${(saleCount + 1).toString().padStart(6, "0")}`,
          saleType: SaleType.RETAIL,
          customerId: returnRequest.customerId,
          attendantId: auth.userId,
          shiftId: prepared.activeShift?.id ?? null,
          currencyCode: returnRequest.sale.currencyCode,
          status: SaleStatus.COMPLETED,
          fulfillmentStatus: "COMPLETED",
          paymentStatus: difference <= 0 || paymentDue > 0 ? PaymentStatus.PAID : PaymentStatus.PARTIALLY_PAID,
          subtotal: prepared.subtotal,
          lineDiscountAmount: prepared.totalDiscount,
          taxAmount: prepared.totalTax,
          totalAmount: prepared.totalAmount,
          amountPaid: creditApplied + paymentDue,
          amountDue: 0,
          costOfGoodsSold: 0,
          grossProfit: prepared.totalAmount,
          notes: `Replacement sale for ${returnRequest.returnNumber}`,
          originalSaleId: returnRequest.saleId,
          idempotencyKey: `exchange:${input.idempotencyKey}`,
          completedAt: new Date()
        }
      });

      let totalCost = 0;
      for (const line of prepared.items) {
        const saleItem = await tx.saleItem.create({
          data: {
            saleId: replacementSale.id,
            productVariantId: line.productVariantId,
            skuSnapshot: line.variant.sku,
            productNameSnapshot: line.variant.product.name,
            variantSnapshot: `${line.variant.volumeValue ?? ""} ${line.variant.volumeUnit ?? ""}`.trim(),
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            originalUnitPrice: line.unitPrice,
            discountAmount: line.discountAmount,
            taxRate: line.taxRate,
            taxAmount: line.taxAmount,
            lineSubtotal: line.lineSubtotal,
            lineTotal: line.lineTotal,
            unitCost: 0,
            lineCost: 0,
            grossProfit: line.lineTotal
          }
        });
        const deduction = await inventoryWriteService.deductStock(tx, {
          organizationId: auth.organizationId,
          branchId: returnRequest.branchId,
          productVariantId: line.productVariantId,
          quantity: line.quantity,
          referenceType: "Exchange",
          referenceId: exchange.id,
          movementType: InventoryMovementType.SALE,
          performedById: auth.userId,
          notes: `Replacement issued for ${returnRequest.returnNumber}`
        });
        for (const allocation of deduction.allocations) {
          const allocationCost = allocation.quantityAllocated * allocation.landedUnitCost;
          totalCost += allocationCost;
          await tx.saleItemBatch.create({
            data: {
              saleItemId: saleItem.id,
              inventoryBatchId: allocation.batchId,
              quantity: allocation.quantityAllocated,
              unitCost: allocation.landedUnitCost,
              lineCost: allocationCost
            }
          });
        }
        const lineCost = deduction.allocations.reduce(
          (sum, allocation) => sum + allocation.quantityAllocated * allocation.landedUnitCost,
          0
        );
        await tx.saleItem.update({
          where: { id: saleItem.id },
          data: { unitCost: lineCost / line.quantity, lineCost, grossProfit: line.lineTotal - lineCost }
        });
      }
      await tx.sale.update({
        where: { id: replacementSale.id },
        data: { costOfGoodsSold: totalCost, grossProfit: prepared.totalAmount - totalCost }
      });

      const paymentCount = await tx.payment.count({ where: { organizationId: auth.organizationId } });
      if (creditApplied > 0) {
        await tx.payment.create({
          data: {
            organizationId: auth.organizationId,
            branchId: returnRequest.branchId,
            paymentNumber: `PMT-${(paymentCount + 1).toString().padStart(6, "0")}`,
            customerId: returnRequest.customerId,
            saleId: replacementSale.id,
            direction: "INCOMING",
            paymentMethod: "STORE_CREDIT",
            amount: creditApplied,
            currencyCode: returnRequest.sale.currencyCode,
            reference: exchange.exchangeNumber,
            status: "COMPLETED",
            receivedById: auth.userId,
            receivedAt: new Date(),
            idempotencyKey: `exchange-credit:${exchange.id}`
          }
        });
      }
      if (paymentDue > 0) {
        const validated = await validateIncomingPayment(tx, auth, {
          paymentMethod: input.paymentMethod,
          amount: paymentDue,
          reference: input.paymentReference
        }, returnRequest.branchId, replacementSale.id);
        const payment = await tx.payment.create({
          data: {
            organizationId: auth.organizationId,
            branchId: returnRequest.branchId,
            paymentNumber: `PMT-${(paymentCount + 2).toString().padStart(6, "0")}`,
            customerId: returnRequest.customerId,
            saleId: replacementSale.id,
            shiftId: validated.activeShift?.id ?? null,
            direction: "INCOMING",
            paymentMethod: input.paymentMethod,
            amount: paymentDue,
            currencyCode: returnRequest.sale.currencyCode,
            reference: input.paymentReference ?? null,
            status: "COMPLETED",
            receivedById: auth.userId,
            receivedAt: new Date(),
            idempotencyKey: `exchange-difference:${exchange.id}`
          }
        });
        if (validated.mpesa) {
          await tx.mpesaTransaction.update({ where: { id: validated.mpesa.id }, data: { paymentId: payment.id } });
        }
      }

      if (difference < 0) {
        const branch = await tx.branch.findFirstOrThrow({
          where: { id: returnRequest.branchId, organizationId: auth.organizationId },
          select: { code: true }
        });
        const refundNumber = await reserveRefundNumber(tx, {
          organizationId: auth.organizationId,
          branchId: returnRequest.branchId,
          branchCode: branch.code,
          issuedAt: new Date()
        });
        await tx.refund.create({
          data: {
            organizationId: auth.organizationId,
            branchId: returnRequest.branchId,
            refundNumber,
            returnRequestId: returnRequest.id,
            originalSaleId: returnRequest.saleId,
            customerId: returnRequest.customerId,
            amount: Math.abs(difference),
            eligibleAmount: Math.abs(difference),
            approvedAmount: null,
            method: "STORE_CREDIT",
            status: "PENDING_APPROVAL",
            refundType: "PARTIAL_AMOUNT",
            reason: `Exchange difference for ${exchange.exchangeNumber}`,
            detailedReason: `Exchange difference for ${exchange.exchangeNumber}`,
            requestedById: auth.userId
          }
        });
      }

      for (const returnedItem of returnRequest.items.filter((item) => item.disposition !== "REJECT")) {
        await tx.saleItem.update({
          where: { id: returnedItem.saleItemId },
          data: { exchangedQuantity: { increment: returnedItem.quantity } }
        });
      }

      const completedNow = difference >= 0;
      const updated = await tx.exchange.update({
        where: { id: exchange.id },
        data: {
          replacementSaleId: replacementSale.id,
          status: completedNow ? "COMPLETED" : "PROCESSING",
          completedById: completedNow ? auth.userId : null,
          completedAt: completedNow ? new Date() : null
        },
        include: { returnRequest: true, originalSale: true, replacementSale: { include: { items: true, payments: true } } }
      });
      await auditService.create({
        organizationId: auth.organizationId,
        branchId: returnRequest.branchId,
        userId: auth.userId,
        action: "exchange.complete",
        entityType: "Exchange",
        entityId: exchange.id,
        requestId: request.requestContext.requestId,
        ipAddress: request.ip,
        userAgent: request.header("user-agent"),
        afterData: updated
      }, tx);
      return updated;
    });
  }
};
