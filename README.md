# Perfume ERP Backend

Production-oriented backend foundation for a multi-branch perfume retail and wholesale ERP. This repository currently delivers the core Phase 1 platform and the Phase 2 catalog and inventory-read foundation in a greenfield `Backend/` service.

## Stack

- Node.js 20
- Express.js
- TypeScript
- PostgreSQL
- Prisma ORM
- JWT access and refresh tokens
- Zod validation
- Pino structured logging
- Cloudinary-backed media storage provider
- Vitest and Supertest
- Swagger UI at `/docs`

## Implemented in this pass

- Environment validation and structured logging
- Health and readiness endpoints
- JWT authentication with refresh token rotation
- Session listing and revocation
- Organization management
- Branch management and branch dashboard aggregation
- User management and branch assignments
- RBAC permission mapping
- Audit logging
- Catalog foundation: brands, categories, products, variants, barcodes, price lists
- Inventory foundation: balances, movements, valuation, low-stock reads
- PostgreSQL-ready Prisma schema covering the core ERP backbone
- Development seed data and Docker compatibility
- Cloudinary media provider with legacy `/uploads` compatibility for existing records

## Not yet complete

- Procurement workflows
- Goods receiving
- Stock transfers
- Sales completion workflow with FIFO deduction
- Payments and M-Pesa workflows
- Returns, refunds, reconciliation, reports, and background jobs
- Full OpenAPI route documentation
- Full integration and concurrency coverage

The current state should be treated as `PARTIALLY COMPLETE`, not production-ready.

## Local setup

1. Copy `.env.example` to `.env`.
2. Start PostgreSQL with Docker:

```bash
docker compose up -d db
```

3. Install dependencies:

```bash
npm install
```

4. Generate Prisma client and run migrations:

```bash
npx prisma format
npx prisma validate
npx prisma generate
npx prisma migrate dev --name init
```

5. Seed development data:

```bash
npm run prisma:seed
```

6. Start the API:

```bash
npm run dev
```

## Media storage

- Set `STORAGE_PROVIDER=cloudinary` for production-grade media uploads.
- Required backend env vars when Cloudinary is enabled:
  - `CLOUDINARY_CLOUD_NAME`
  - `CLOUDINARY_API_KEY`
  - `CLOUDINARY_API_SECRET`
  - `CLOUDINARY_FOLDER` defaults to `js-system`
  - `CLOUDINARY_SECURE` defaults to `true`
- Legacy `/uploads` static serving is still mounted for existing records during migration.
- Migrate legacy product media records with:

```bash
npm run media:migrate:cloudinary -- --dry-run
npm run media:migrate:cloudinary
```

## Test commands

```bash
npm run test
npm run typecheck
npm run lint
```

## Development seed accounts

- General Manager: `gm@pulseperfumes.test` / `General123!`
- Branch Managers: `manager1@pulseperfumes.test` to `manager6@pulseperfumes.test` / `Manager123!`
- Sales Attendants: `attendant1@pulseperfumes.test` to `attendant6@pulseperfumes.test` / `Attendant123!`

## Selected routes

### Health

- `GET /health`
- `GET /health/ready`

### Auth

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/logout-all`
- `POST /api/v1/auth/forgot-password`
- `POST /api/v1/auth/reset-password`
- `POST /api/v1/auth/change-password`
- `GET /api/v1/auth/me`
- `GET /api/v1/auth/sessions`
- `DELETE /api/v1/auth/sessions/:sessionId`

### Organization and branches

- `GET /api/v1/organization`
- `PATCH /api/v1/organization`
- `GET /api/v1/branches`
- `POST /api/v1/branches`
- `GET /api/v1/branches/:branchId`
- `PATCH /api/v1/branches/:branchId`
- `POST /api/v1/branches/:branchId/activate`
- `POST /api/v1/branches/:branchId/deactivate`
- `GET /api/v1/branches/:branchId/dashboard`

### Users

- `GET /api/v1/users`
- `POST /api/v1/users`
- `GET /api/v1/users/:userId`
- `PATCH /api/v1/users/:userId`
- `POST /api/v1/users/:userId/assign-branches`
- `POST /api/v1/users/:userId/reset-password`
- `POST /api/v1/users/:userId/activate`
- `POST /api/v1/users/:userId/suspend`
- `GET /api/v1/users/me/profile`

### Catalog

- `GET /api/v1/brands`
- `POST /api/v1/brands`
- `PATCH /api/v1/brands/:id`
- `GET /api/v1/categories`
- `POST /api/v1/categories`
- `PATCH /api/v1/categories/:id`
- `GET /api/v1/products`
- `POST /api/v1/products`
- `GET /api/v1/products/:id`
- `PATCH /api/v1/products/:id`
- `POST /api/v1/products/:id/variants`
- `PATCH /api/v1/product-variants/:variantId`
- `GET /api/v1/product-variants/:variantId/stock`
- `GET /api/v1/product-variants/barcode/:barcode`
- `POST /api/v1/product-variants/:variantId/barcodes`
- `GET /api/v1/price-lists`
- `POST /api/v1/price-lists`
- `PATCH /api/v1/price-lists/:id`
- `POST /api/v1/price-lists/:id/items`

### Inventory and audit

- `GET /api/v1/inventory`
- `GET /api/v1/inventory/branch/:branchId`
- `GET /api/v1/inventory/product/:variantId`
- `GET /api/v1/inventory/movements`
- `GET /api/v1/inventory/low-stock`
- `GET /api/v1/inventory/valuation`
- `GET /api/v1/audit-logs`
- `GET /api/v1/audit-logs/:id`
