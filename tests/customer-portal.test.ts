import { expect, test, describe, beforeAll, afterAll } from "vitest";
import { CustomerAccountStatus, CustomerStatus, CustomerType } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { customerAuthService } from "../src/modules/customer-auth/customer-auth.service.js";
import { storefrontAccountService } from "../src/modules/storefront-account/storefront-account.service.js";

const ORG_ID = "test-portal-org";

describe("Storefront Customer Portal & Auth", () => {
  beforeAll(async () => {
    // Setup test organization
    await prisma.organization.upsert({
      where: { id: ORG_ID },
      update: {},
      create: {
        id: ORG_ID,
        legalName: "Test Portal Corp",
        tradingName: "Test Portal Store"
      }
    });

    // Run clean up before starting tests in case previous runs failed
    await prisma.customerSession.deleteMany({
      where: { customerAccount: { organizationId: ORG_ID } }
    });
    await prisma.customerPasswordResetToken.deleteMany({
      where: { organizationId: ORG_ID }
    });
    await prisma.customerAddress.deleteMany({
      where: { customer: { organizationId: ORG_ID } }
    });
    await prisma.customerAccount.deleteMany({
      where: { organizationId: ORG_ID }
    });
    await prisma.loyaltyLedgerEntry.deleteMany({
      where: { customer: { organizationId: ORG_ID } }
    });
    await prisma.onlineOrder.deleteMany({
      where: { organizationId: ORG_ID }
    });
    await prisma.customer.deleteMany({
      where: { organizationId: ORG_ID }
    });
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.customerSession.deleteMany({
      where: { customerAccount: { organizationId: ORG_ID } }
    });
    await prisma.customerPasswordResetToken.deleteMany({
      where: { organizationId: ORG_ID }
    });
    await prisma.customerAddress.deleteMany({
      where: { customer: { organizationId: ORG_ID } }
    });
    await prisma.customerAccount.deleteMany({
      where: { organizationId: ORG_ID }
    });
    await prisma.loyaltyLedgerEntry.deleteMany({
      where: { customer: { organizationId: ORG_ID } }
    });
    await prisma.onlineOrder.deleteMany({
      where: { organizationId: ORG_ID }
    });
    await prisma.customer.deleteMany({
      where: { organizationId: ORG_ID }
    });
    await prisma.organization.delete({ where: { id: ORG_ID } });
  });

  test("Registration creates a new Customer and CustomerAccount", async () => {
    const email = "customer@portal.com";
    const phone = "0711223344";

    const result = await customerAuthService.register(
      ORG_ID,
      {
        firstName: "Jane",
        lastName: "Doe",
        email,
        phone,
        password: "securepassword123"
      },
      { ipAddress: "127.0.0.1", userAgent: "Vitest" }
    );

    expect(result).toHaveProperty("accessToken");
    expect(result).toHaveProperty("refreshToken");
    expect(result.account.firstName).toBe("Jane");
    expect(result.account.email).toBe(email);
    expect(result.account.phone).toBe(phone);

    // Verify DB records
    const account = await prisma.customerAccount.findUnique({
      where: { id: result.account.id },
      include: { customer: true }
    });
    expect(account).toBeDefined();
    expect(account?.normalizedEmail).toBe("customer@portal.com");
    expect(account?.normalizedPhoneNumber).toBe("0711223344");
    expect(account?.customer.firstName).toBe("Jane");
  });

  test("Registration matches existing Customer by phone or email", async () => {
    const matchedPhone = "0799887766";
    // Create pre-existing Customer in ERP
    const existingCustomer = await prisma.customer.create({
      data: {
        organizationId: ORG_ID,
        customerNumber: "CUST-PRE999",
        customerType: CustomerType.RETAIL,
        firstName: "Pre-existing",
        lastName: "Customer",
        phone: matchedPhone,
        status: CustomerStatus.ACTIVE
      }
    });

    const result = await customerAuthService.register(
      ORG_ID,
      {
        firstName: "Pre-existing",
        lastName: "Customer",
        phone: matchedPhone,
        password: "anotherpassword456"
      },
      { ipAddress: "127.0.0.1", userAgent: "Vitest" }
    );

    expect(result.account.customerId).toBe(existingCustomer.id);
  });

  test("Login validates password hash and issues session", async () => {
    const result = await customerAuthService.login(
      ORG_ID,
      {
        identifier: "customer@portal.com",
        password: "securepassword123"
      },
      { ipAddress: "127.0.0.1", userAgent: "Vitest" }
    );

    expect(result).toHaveProperty("accessToken");
    expect(result.account.email).toBe("customer@portal.com");
  });

  test("Address operations enforce ownership and single-default rule", async () => {
    const account = await prisma.customerAccount.findFirst({
      where: { organizationId: ORG_ID, normalizedEmail: "customer@portal.com" }
    });
    const customerId = account!.customerId;

    // Create address 1
    const addr1 = await storefrontAccountService.createAddress(customerId, {
      addressLine1: "123 Main St",
      city: "Nairobi",
      isPrimaryShipping: true
    });
    expect(addr1.isPrimaryShipping).toBe(true);

    // Create address 2 set as primary shipping
    const addr2 = await storefrontAccountService.createAddress(customerId, {
      addressLine1: "456 Side Ave",
      city: "Mombasa",
      isPrimaryShipping: true
    });
    expect(addr2.isPrimaryShipping).toBe(true);

    // Verify first address is no longer primary shipping
    const check1 = await prisma.customerAddress.findUnique({ where: { id: addr1.id } });
    expect(check1?.isPrimaryShipping).toBe(false);

    // Clean up addresses
    await storefrontAccountService.deleteAddress(customerId, addr1.id);
    await storefrontAccountService.deleteAddress(customerId, addr2.id);
  });

  test("Guest order linking works for matching email/phone within 90 days", async () => {
    const account = await prisma.customerAccount.findFirst({
      where: { organizationId: ORG_ID, normalizedEmail: "customer@portal.com" }
    });
    const customerId = account!.customerId;

    // Create a temporary customer record to hold the guest order
    const guestCustomer = await prisma.customer.create({
      data: {
        organizationId: ORG_ID,
        customerNumber: "CUST-GUEST1",
        customerType: CustomerType.RETAIL,
        firstName: "Guest",
        lastName: "User",
        phone: "0711223344",
        email: "customer@portal.com",
        status: CustomerStatus.ACTIVE
      }
    });

    // Create guest order linked to that customer, but with customerAccountId = null
    const guestOrder = await prisma.onlineOrder.create({
      data: {
        organizationId: ORG_ID,
        orderNumber: "ORD-GUEST-001",
        customerId: guestCustomer.id,
        customerAccountId: null,
        totalAmount: 12000,
        taxAmount: 1920,
        deliveryMethod: "PICKUP",
        publicToken: "guest-token-123"
      }
    });

    const linkResult = await storefrontAccountService.linkGuestOrders(
      customerId,
      ORG_ID,
      "0711223344",
      "customer@portal.com"
    );

    expect(linkResult.linkedCount).toBe(1);

    const updatedOrder = await prisma.onlineOrder.findUnique({ where: { id: guestOrder.id } });
    expect(updatedOrder?.customerId).toBe(customerId);
  });
});
