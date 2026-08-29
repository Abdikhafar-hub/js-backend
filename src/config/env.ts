import { config } from "dotenv";
import { z } from "zod";

config();

const booleanString = z
  .enum(["true", "false"])
  .optional()
  .transform((value) => value !== "false");

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_ACCESS_EXPIRES_IN: z.string().min(2),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_REFRESH_EXPIRES_IN: z.string().min(2),
  PASSWORD_PEPPER: z.string().min(8),
  CORS_ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),
  APP_BASE_URL: z.string().url(),
  API_BASE_URL: z.string().url(),
  REDIS_URL: z.string().min(1),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  ENCRYPTION_KEY: z.string().min(16),
  MPESA_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  MPESA_CONSUMER_KEY: z.string().min(1),
  MPESA_CONSUMER_SECRET: z.string().min(1),
  MPESA_SHORTCODE: z.string().min(5),
  MPESA_PASSKEY: z.string().min(1),
  MPESA_CALLBACK_URL: z.string().url(),
  STORAGE_PROVIDER: z.enum(["local", "cloudinary"]).default("local"),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_FOLDER: z.string().default("js-system"),
  CLOUDINARY_SECURE: booleanString
});

const parsedBase = baseEnvSchema.safeParse(process.env);

if (!parsedBase.success) {
  throw new Error(`Invalid environment configuration: ${parsedBase.error.message}`);
}

const cloudinaryEnvSchema = z.object({
  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1)
});

const cloudinaryEnv =
  parsedBase.data.STORAGE_PROVIDER === "cloudinary"
    ? cloudinaryEnvSchema.parse(process.env)
    : {
        CLOUDINARY_CLOUD_NAME: undefined,
        CLOUDINARY_API_KEY: undefined,
        CLOUDINARY_API_SECRET: undefined
      };

export const env = {
  ...parsedBase.data,
  ...cloudinaryEnv,
  CORS_ALLOWED_ORIGINS: parsedBase.data.CORS_ALLOWED_ORIGINS.split(",")
    .map((value) => value.trim())
    .filter(Boolean)
};
