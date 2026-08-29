import { z } from "zod";

const isRootRelativeUrl = (value: string) => value.startsWith("/");

export const mediaUrlSchema = z.string().trim().refine((value) => {
  if (!value) {
    return true;
  }

  return z.string().url().safeParse(value).success || isRootRelativeUrl(value);
}, "Invalid media URL");

export const nullableMediaUrlSchema = mediaUrlSchema.optional().nullable();
