import { PrismaClient, UserRole, UserStatus, BranchType, ProductCategoryStatus, PaymentDirection, PaymentMethod, PaymentRecordStatus, PaymentStatus, SaleStatus, SaleType, ShiftStatus } from "@prisma/client";

import { hashPassword } from "../src/lib/password.js";

const prisma = new PrismaClient();

const main = async () => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Seed is disabled in production.");
  }

  const organization = await prisma.organization.upsert({
    where: {
      id: "org_pulse_perfumes"
    },
    update: {},
    create: {
      id: "org_pulse_perfumes",
      legalName: "Pulse Perfumes Limited",
      tradingName: "Pulse Perfumes",
      email: "info@pulseperfumes.test",
      phone: "+254700000000",
      city: "Nairobi",
      country: "Kenya",
      currencyCode: "KES",
      timezone: "Africa/Nairobi",
      status: "ACTIVE"
    }
  });

  await prisma.organizationSetting.upsert({
    where: {
      organizationId: organization.id
    },
    update: {},
    create: {
      organizationId: organization.id,
      defaultCurrency: "KES",
      timezone: "Africa/Nairobi",
      saleRequiresOpenShift: true,
      inventoryCostingMethod: "FIFO",
      maximumAttendantDiscount: 5,
      maximumBranchManagerDiscount: 15
    }
  });

  const branchPayloads = [
    { id: "br_nbi_cbd", code: "NBI-CBD", name: "Nairobi CBD", branchType: BranchType.RETAIL_STORE, isHeadOffice: true },
    { id: "br_nbi_west", code: "NBI-WEST", name: "Westlands", branchType: BranchType.RETAIL_STORE },
    { id: "br_nbi_emb", code: "NBI-EMB", name: "Embakasi", branchType: BranchType.RETAIL_STORE },
    { id: "br_msa_nyali", code: "MSA-NYALI", name: "Nyali", branchType: BranchType.RETAIL_STORE },
    { id: "br_msa_cbd", code: "MSA-CBD", name: "Mombasa CBD", branchType: BranchType.WHOLESALE_STORE },
    { id: "br_wh_main", code: "NBI-WH", name: "Central Warehouse", branchType: BranchType.WAREHOUSE, isWarehouse: true }
  ];

  for (const branch of branchPayloads) {
    await prisma.branch.upsert({
      where: {
        organizationId_code: {
          organizationId: organization.id,
          code: branch.code
        }
      },
      update: {},
      create: {
        organizationId: organization.id,
        code: branch.code,
        name: branch.name,
        branchType: branch.branchType,
        isHeadOffice: branch.isHeadOffice ?? false,
        isWarehouse: branch.isWarehouse ?? false
      }
    });
  }

  const branches = await prisma.branch.findMany({
    where: { organizationId: organization.id }
  });
  const branchMap = Object.fromEntries(branches.map((branch) => [branch.code, branch]));
  const nairobiCbdBranch = branchMap["NBI-CBD"]!;
  const centralWarehouse = branchMap["NBI-WH"]!;

  const gmPasswordHash = await hashPassword("General123!");
  const bmPasswordHash = await hashPassword("Manager123!");
  const attendantPasswordHash = await hashPassword("Attendant123!");

  const generalManager = await prisma.user.upsert({
    where: {
      email: "gm@pulseperfumes.test"
    },
    update: {},
    create: {
      organizationId: organization.id,
      firstName: "Grace",
      lastName: "Mwangi",
      email: "gm@pulseperfumes.test",
      passwordHash: gmPasswordHash,
      role: UserRole.GENERAL_MANAGER,
      status: UserStatus.ACTIVE,
      mustChangePassword: false
    }
  });

  for (const [index, branch] of branches.entries()) {
    const manager = await prisma.user.upsert({
      where: {
        email: `manager${index + 1}@pulseperfumes.test`
      },
      update: {},
      create: {
        organizationId: organization.id,
        firstName: `Manager${index + 1}`,
        lastName: branch.name,
        email: `manager${index + 1}@pulseperfumes.test`,
        passwordHash: bmPasswordHash,
        role: UserRole.BRANCH_MANAGER,
        status: UserStatus.ACTIVE,
        mustChangePassword: false
      }
    });

    const attendant = await prisma.user.upsert({
      where: {
        email: `attendant${index + 1}@pulseperfumes.test`
      },
      update: {},
      create: {
        organizationId: organization.id,
        firstName: `Attendant${index + 1}`,
        lastName: branch.name,
        email: `attendant${index + 1}@pulseperfumes.test`,
        passwordHash: attendantPasswordHash,
        role: UserRole.SALES_ATTENDANT,
        status: UserStatus.ACTIVE,
        mustChangePassword: false
      }
    });

    await prisma.userBranchAssignment.upsert({
      where: {
        userId_branchId: {
          userId: manager.id,
          branchId: branch.id
        }
      },
      update: {
        activeUntil: null,
        isPrimary: true
      },
      create: {
        userId: manager.id,
        branchId: branch.id,
        isPrimary: true
      }
    });

    await prisma.userBranchAssignment.upsert({
      where: {
        userId_branchId: {
          userId: attendant.id,
          branchId: branch.id
        }
      },
      update: {
        activeUntil: null,
        isPrimary: true
      },
      create: {
        userId: attendant.id,
        branchId: branch.id,
        isPrimary: true
      }
    });
  }

  // Assign General Manager to all branches
  for (const branch of branches) {
    await prisma.userBranchAssignment.upsert({
      where: {
        userId_branchId: {
          userId: generalManager.id,
          branchId: branch.id
        }
      },
      update: {
        activeUntil: null,
        isPrimary: branch.code === "NBI-CBD"
      },
      create: {
        userId: generalManager.id,
        branchId: branch.id,
        isPrimary: branch.code === "NBI-CBD"
      }
    });
  }

  const brand = await prisma.brand.upsert({
    where: {
      organizationId_name: {
        organizationId: organization.id,
        name: "Maison Amani"
      }
    },
    update: {},
    create: {
      organizationId: organization.id,
      name: "Maison Amani",
      description: "Premium fine fragrances",
      countryOfOrigin: "France",
      status: ProductCategoryStatus.ACTIVE
    }
  });

  const categoriesData = [
    {
      name: "Perfume",
      slug: "perfume",
      sortOrder: 1,
      attributes: [
        { key: "fragranceFamily", label: "Fragrance Family", dataType: "DROPDOWN", dropdownOptions: "WOODY,FLORAL,ORIENTAL,FRESH,CITRUS,GOURMAND,AQUATIC,SPICY,MUSKY,LEATHER,OTHER", isRequired: false, displayOrder: 1 },
        { key: "genderTarget", label: "Target Audience", dataType: "DROPDOWN", dropdownOptions: "MEN,WOMEN,UNISEX,KIDS,NOT_APPLICABLE", isRequired: true, displayOrder: 2 },
        { key: "concentrationType", label: "Concentration Type", dataType: "DROPDOWN", dropdownOptions: "PARFUM,EDP,EDT,EDC,BODY_MIST,PERFUME_OIL,OTHER", isRequired: false, displayOrder: 3 }
      ]
    },
    {
      name: "Oud",
      slug: "oud",
      sortOrder: 2,
      attributes: [
        { key: "oudType", label: "Oud Type", dataType: "DROPDOWN", dropdownOptions: "OIL,WOOD_CHIPS,OTHER", isRequired: true, displayOrder: 1 },
        { key: "fragranceProfile", label: "Fragrance Profile", dataType: "TEXT", isRequired: false, displayOrder: 2 },
        { key: "grade", label: "Grade", dataType: "TEXT", isRequired: false, displayOrder: 3 }
      ]
    },
    {
      name: "Bakhoor",
      slug: "bakhoor",
      sortOrder: 3,
      attributes: [
        { key: "bakhoorType", label: "Bakhoor Type", dataType: "TEXT", isRequired: false, displayOrder: 1 },
        { key: "fragranceProfile", label: "Fragrance Profile", dataType: "TEXT", isRequired: false, displayOrder: 2 },
        { key: "weightPackSize", label: "Weight or Pack Size", dataType: "TEXT", isRequired: false, displayOrder: 3 }
      ]
    },
    {
      name: "Body Lotion",
      slug: "body-lotion",
      sortOrder: 4,
      attributes: [
        { key: "scentVariant", label: "Scent or Variant", dataType: "TEXT", isRequired: true, displayOrder: 1 },
        { key: "genderTarget", label: "Target Audience", dataType: "DROPDOWN", dropdownOptions: "MEN,WOMEN,UNISEX,KIDS,NOT_APPLICABLE", isRequired: false, displayOrder: 2 },
        { key: "sizeVolume", label: "Size or Volume", dataType: "TEXT", isRequired: false, displayOrder: 3 }
      ]
    },
    {
      name: "Body Spray",
      slug: "body-spray",
      sortOrder: 5,
      attributes: [
        { key: "scentVariant", label: "Scent or Variant", dataType: "TEXT", isRequired: true, displayOrder: 1 },
        { key: "genderTarget", label: "Target Audience", dataType: "DROPDOWN", dropdownOptions: "MEN,WOMEN,UNISEX,KIDS,NOT_APPLICABLE", isRequired: false, displayOrder: 2 },
        { key: "sizeVolume", label: "Size or Volume", dataType: "TEXT", isRequired: false, displayOrder: 3 }
      ]
    },
    {
      name: "Air Freshener",
      slug: "air-freshener",
      sortOrder: 6,
      attributes: [
        { key: "scentVariant", label: "Scent or Variant", dataType: "TEXT", isRequired: true, displayOrder: 1 },
        { key: "format", label: "Product Format", dataType: "TEXT", isRequired: false, displayOrder: 2 },
        { key: "sizeVolume", label: "Size or Volume", dataType: "TEXT", isRequired: false, displayOrder: 3 }
      ]
    },
    {
      name: "Burner",
      slug: "burner",
      sortOrder: 7,
      attributes: [
        { key: "burnerType", label: "Burner Type", dataType: "TEXT", isRequired: false, displayOrder: 1 },
        { key: "material", label: "Material", dataType: "TEXT", isRequired: false, displayOrder: 2 },
        { key: "size", label: "Size", dataType: "TEXT", isRequired: false, displayOrder: 3 }
      ]
    },
    {
      name: "Gift Set",
      slug: "gift-set",
      sortOrder: 8,
      attributes: [
        { key: "genderTarget", label: "Target Audience", dataType: "DROPDOWN", dropdownOptions: "MEN,WOMEN,UNISEX,KIDS,NOT_APPLICABLE", isRequired: false, displayOrder: 1 },
        { key: "setContents", label: "Set Contents", dataType: "LONG_TEXT", isRequired: true, displayOrder: 2 },
        { key: "numItems", label: "Number of Items", dataType: "NUMBER", isRequired: false, displayOrder: 3 }
      ]
    },
    {
      name: "Accessories",
      slug: "accessories",
      sortOrder: 9,
      attributes: [
        { key: "accessoryType", label: "Accessory Type", dataType: "TEXT", isRequired: true, displayOrder: 1 },
        { key: "material", label: "Material", dataType: "TEXT", isRequired: false, displayOrder: 2 }
      ]
    },
    {
      name: "Other",
      slug: "other",
      sortOrder: 10,
      attributes: [
        { key: "customProductType", label: "Custom Product Type", dataType: "TEXT", isRequired: false, displayOrder: 1 }
      ]
    }
  ];

  let perfumeCategory: any = null;

  for (const cat of categoriesData) {
    const createdCat = await prisma.productCategory.upsert({
      where: {
        organizationId_slug: {
          organizationId: organization.id,
          slug: cat.slug
        }
      },
      update: {
        sortOrder: cat.sortOrder,
        status: ProductCategoryStatus.ACTIVE
      },
      create: {
        organizationId: organization.id,
        name: cat.name,
        slug: cat.slug,
        sortOrder: cat.sortOrder,
        status: ProductCategoryStatus.ACTIVE
      }
    });

    if (cat.slug === "perfume") {
      perfumeCategory = createdCat;
    }

    for (const attr of cat.attributes) {
      await prisma.productAttributeDefinition.upsert({
        where: {
          organizationId_categoryId_key: {
            organizationId: organization.id,
            categoryId: createdCat.id,
            key: attr.key
          }
        },
        update: {
          label: attr.label,
          dataType: attr.dataType,
          dropdownOptions: attr.dropdownOptions ?? null,
          isRequired: attr.isRequired,
          displayOrder: attr.displayOrder,
          isActive: true
        },
        create: {
          organizationId: organization.id,
          categoryId: createdCat.id,
          key: attr.key,
          label: attr.label,
          dataType: attr.dataType,
          dropdownOptions: attr.dropdownOptions ?? null,
          isRequired: attr.isRequired,
          displayOrder: attr.displayOrder,
          isActive: true
        }
      });
    }
  }

  const product = await prisma.product.upsert({
    where: {
      organizationId_slug: {
        organizationId: organization.id,
        slug: "amani-noir"
      }
    },
    update: {},
    create: {
      organizationId: organization.id,
      brandId: brand.id,
      categoryId: perfumeCategory.id,
      name: "Amani Noir",
      slug: "amani-noir",
      description: "Woody evening perfume",
      isStockTracked: true
    }
  });

  const variant = await prisma.productVariant.upsert({
    where: {
      organizationId_sku: {
        organizationId: organization.id,
        sku: "AMANI-NOIR-100ML"
      }
    },
    update: {},
    create: {
      organizationId: organization.id,
      productId: product.id,
      sku: "AMANI-NOIR-100ML",
      barcode: "100000000001",
      volumeValue: 100,
      volumeUnit: "ML",
      retailPrice: 8500,
      wholesalePrice: 7200,
      defaultCost: 4800,
      reorderLevel: 10,
      minimumWholesaleQuantity: 6
    }
  });

  const retailPriceList = await prisma.priceList.upsert({
    where: {
      organizationId_name: {
        organizationId: organization.id,
        name: "Standard Retail"
      }
    },
    update: {},
    create: {
      organizationId: organization.id,
      name: "Standard Retail",
      type: "RETAIL",
      currencyCode: "KES",
      isDefault: true
    }
  });

  await prisma.priceListItem.upsert({
    where: {
      priceListId_productVariantId_minimumQuantity: {
        priceListId: retailPriceList.id,
        productVariantId: variant.id,
        minimumQuantity: 1
      }
    },
    update: {},
    create: {
      priceListId: retailPriceList.id,
      productVariantId: variant.id,
      minimumQuantity: 1,
      unitPrice: 8500
    }
  });

  // Seed ERP Supplier
  const supplier = await prisma.supplier.upsert({
    where: {
      organizationId_code: {
        organizationId: organization.id,
        code: "SUP-GLOBAL-FRAG"
      }
    },
    update: {},
    create: {
      organizationId: organization.id,
      code: "SUP-GLOBAL-FRAG",
      name: "Global Fragrance Ltd",
      legalName: "Global Fragrance Ltd",
      email: "orders@globalfragrance.test",
      phone: "+33140000000",
      country: "France",
      currencyCode: "EUR",
      currentBalance: 0,
      createdById: generalManager.id,
      updatedById: generalManager.id
    }
  });

  for (const branch of branches) {
    await prisma.inventoryBalance.upsert({
      where: {
        organizationId_branchId_productVariantId: {
          organizationId: organization.id,
          branchId: branch.id,
          productVariantId: variant.id
        }
      },
      update: {},
      create: {
        organizationId: organization.id,
        branchId: branch.id,
        productVariantId: variant.id,
        quantityOnHand: branch.branchType === BranchType.WAREHOUSE ? 100 : 24,
        quantityAvailable: branch.branchType === BranchType.WAREHOUSE ? 100 : 24,
        averageUnitCost: 4800
      }
    });

    // Seed FIFO Inventory Batch records
    await prisma.inventoryBatch.create({
      data: {
        organizationId: organization.id,
        branchId: branch.id,
        productVariantId: variant.id,
        batchNumber: `BAT-${branch.code}-001`,
        quantityOnHand: branch.branchType === BranchType.WAREHOUSE ? 100 : 24,
        quantityReserved: 0,
        unitCost: 4800,
        landedUnitCost: 4800,
        status: "ACTIVE"
      }
    });
  }

  const walkInCustomer = await prisma.customer.upsert({
    where: {
      organizationId_customerNumber: {
        organizationId: organization.id,
        customerNumber: "WALK-IN"
      }
    },
    update: {},
    create: {
      organizationId: organization.id,
      customerNumber: "WALK-IN",
      customerType: "WALK_IN",
      businessName: "Walk In",
      preferredBranchId: nairobiCbdBranch.id
    }
  });

  const attendant = await prisma.user.findFirstOrThrow({
    where: {
      email: "attendant1@pulseperfumes.test",
      organizationId: organization.id
    }
  });

  const shift = await prisma.shift.upsert({
    where: {
      organizationId_shiftNumber: {
        organizationId: organization.id,
        shiftNumber: "NBI-2026-SHF-000001"
      }
    },
    update: {},
    create: {
      organizationId: organization.id,
      branchId: nairobiCbdBranch.id,
      userId: attendant.id,
      shiftNumber: "NBI-2026-SHF-000001",
      openingCash: 10000,
      expectedCash: 10000,
      status: ShiftStatus.OPEN,
      openedAt: new Date()
    }
  });

  // Seed Sales Target
  await prisma.salesTarget.create({
    data: {
      organizationId: organization.id,
      branchId: nairobiCbdBranch.id,
      targetType: "BRANCH",
      targetValue: 500000,
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    }
  });

  // SEED ADDITIONAL RICH OPERATIONAL DATA FOR GM DASHBOARD VISUALS
  console.log("Seeding rich operational data for GM Dashboard...");
  
  // Idempotency: clean up existing seeded entries
  await prisma.payment.deleteMany({
    where: {
      organizationId: organization.id,
      paymentNumber: { startsWith: "PAY-" }
    }
  });
  await prisma.saleItem.deleteMany({
    where: {
      sale: {
        organizationId: organization.id,
        saleNumber: { startsWith: "SAL-" }
      }
    }
  });
  await prisma.sale.deleteMany({
    where: {
      organizationId: organization.id,
      saleNumber: { startsWith: "SAL-" }
    }
  });
  await prisma.dailyBranchReconciliation.deleteMany({
    where: {
      organizationId: organization.id,
      notes: "End of day branch reconciliation seed"
    }
  });
  await prisma.notification.deleteMany({
    where: {
      organizationId: organization.id,
      message: { contains: "Oud Wood Premium" }
    }
  });

  const now = new Date();
  
  // Seed Sales and Payments over the last 15 days
  if (variant) {
    const paymentMethodsList = [PaymentMethod.CASH, PaymentMethod.MPESA, PaymentMethod.CARD];
    
    for (let i = 0; i < 15; i++) {
      const saleDate = new Date();
      saleDate.setDate(now.getDate() - i);
      
      for (const branch of branches) {
        if (branch.branchType === BranchType.WAREHOUSE) continue;
        
        const unitPrice = 8500; // Retail price is KES 8500
        const quantity = Math.floor(Math.random() * 4) + 1;
        const subtotal = unitPrice * quantity;
        const discount = 0;
        const tax = subtotal * 0.16;
        const total = subtotal + tax;
        const costOfGoodsSold = 4800 * quantity;
        const grossProfit = total - costOfGoodsSold;
        
        const invoiceNumber = `INV-${saleDate.getFullYear()}-${(saleDate.getMonth() + 1).toString().padStart(2, '0')}-${saleDate.getDate().toString().padStart(2, '0')}-${branch.code}-${i}`;
        const saleNumber = `SAL-${saleDate.getFullYear()}-${(saleDate.getMonth() + 1).toString().padStart(2, '0')}-${saleDate.getDate().toString().padStart(2, '0')}-${branch.code}-${i}`;
        
        const sale = await prisma.sale.create({
          data: {
            organizationId: organization.id,
            branchId: branch.id,
            saleNumber,
            saleType: SaleType.RETAIL,
            status: SaleStatus.COMPLETED,
            customerId: null,
            attendantId: attendant.id,
            currencyCode: "KES",
            paymentStatus: PaymentStatus.PAID,
            subtotal,
            lineDiscountAmount: discount,
            orderDiscountAmount: 0,
            taxAmount: tax,
            totalAmount: total,
            amountPaid: total,
            amountDue: 0,
            costOfGoodsSold,
            grossProfit,
            completedAt: saleDate,
            createdAt: saleDate,
            updatedAt: saleDate,
            items: {
              create: {
                productVariantId: variant.id,
                skuSnapshot: variant.sku,
                productNameSnapshot: "Amani Noir",
                variantSnapshot: "100ML",
                quantity,
                unitPrice,
                originalUnitPrice: unitPrice,
                discountAmount: 0,
                taxRate: 16,
                taxAmount: tax,
                unitCost: 4800,
                lineCost: 4800 * quantity,
                lineSubtotal: subtotal,
                lineTotal: subtotal,
                grossProfit: subtotal - (4800 * quantity),
                createdAt: saleDate,
                updatedAt: saleDate
              }
            }
          }
        });
        
        const method = paymentMethodsList[Math.floor(Math.random() * paymentMethodsList.length)] ?? PaymentMethod.CASH;
        const paymentNumber = `PAY-${saleDate.getFullYear()}-${(saleDate.getMonth() + 1).toString().padStart(2, '0')}-${saleDate.getDate().toString().padStart(2, '0')}-${branch.code}-${i}`;

        await prisma.payment.create({
          data: {
            organizationId: organization.id,
            branchId: branch.id,
            paymentNumber,
            saleId: sale.id,
            direction: PaymentDirection.INCOMING,
            paymentMethod: method,
            amount: total,
            currencyCode: "KES",
            status: PaymentRecordStatus.COMPLETED,
            reference: `REF-${Math.floor(Math.random() * 1000000)}`,
            createdAt: saleDate,
            updatedAt: saleDate
          }
        });
      }
    }
  }

  // Seed DailyBranchReconciliation for yesterday
  for (const branch of branches) {
    if (branch.branchType === BranchType.WAREHOUSE) continue;
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    
    const statuses = ["APPROVED", "SUBMITTED", "REVIEW_REQUIRED"];
    const status = statuses[Math.floor(Math.random() * statuses.length)] as any;
    
    await prisma.dailyBranchReconciliation.upsert({
      where: {
        organizationId_branchId_reconciliationDate: {
          organizationId: organization.id,
          branchId: branch.id,
          reconciliationDate: yesterday
        }
      },
      update: {},
      create: {
        organizationId: organization.id,
        branchId: branch.id,
        reconciliationDate: yesterday,
        status,
        totalCompletedSales: 150000,
        cashSales: 80000,
        mpesaSales: 50000,
        cardSales: 20000,
        bankTransferSales: 0,
        creditSales: 0,
        refunds: 0,
        cashRefunds: 0,
        expenses: 5000,
        cashMovements: 0,
        expectedCash: 75000,
        declaredCash: 75000,
        cashVariance: 0,
        notes: "End of day branch reconciliation seed"
      }
    });
  }

  // Seed system notifications / alerts
  const notificationPayloads = [
    {
      type: "CRITICAL",
      title: "Low Inventory Alert",
      message: "Nyali Store (MSA-NYALI) is low on Oud Wood Premium 100ml (5 remaining).",
    },
    {
      type: "WARNING",
      title: "Variance Detected",
      message: "Cashier Shift #199 reported a KES -250.00 variance at Embakasi.",
    },
    {
      type: "INFO",
      title: "Shift Opened",
      message: "Shift NBI-2026-SHF-000001 has been successfully opened by attendant.",
    }
  ];

  for (const notif of notificationPayloads) {
    await prisma.notification.create({
      data: {
        organizationId: organization.id,
        branchId: nairobiCbdBranch.id,
        type: notif.type,
        title: notif.title,
        message: notif.message,
        isRead: false,
        createdAt: new Date()
      }
    });
  }

  // Seed default delivery zones
  const deliveryZonesPayload = [
    { name: "Nairobi Express", description: "Within Nairobi CBD and surrounding environs", fee: 350, minAmountForFreeDelivery: 10000 },
    { name: "Nairobi Suburbs", description: "Outskirts of Nairobi (Karen, Runda, etc.)", fee: 500, minAmountForFreeDelivery: 15000 },
    { name: "Mombasa Express", description: "Within Mombasa town and Nyali", fee: 300, minAmountForFreeDelivery: 10000 },
    { name: "Upcountry / Rest of Kenya", description: "Sent via G4S or reliable courier service", fee: 800, minAmountForFreeDelivery: null }
  ];

  for (const zone of deliveryZonesPayload) {
    await prisma.deliveryZone.upsert({
      where: {
        organizationId_name: {
          organizationId: organization.id,
          name: zone.name
        }
      },
      update: {
        description: zone.description,
        fee: zone.fee,
        minAmountForFreeDelivery: zone.minAmountForFreeDelivery,
        isActive: true
      },
      create: {
        organizationId: organization.id,
        name: zone.name,
        description: zone.description,
        fee: zone.fee,
        minAmountForFreeDelivery: zone.minAmountForFreeDelivery,
        isActive: true
      }
    });
  }

  console.log("Seed completed successfully.");
};

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
