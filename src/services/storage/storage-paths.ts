const PATH_SEGMENT_PATTERN = /[^a-z0-9-_]/g;

export const sanitizeStoragePathSegment = (value: string) => {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(PATH_SEGMENT_PATTERN, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "item";
};

export const buildStorageFolderSegments = (...segments: Array<string | number | null | undefined>) => {
  return segments
    .filter((segment): segment is string | number => segment !== null && segment !== undefined && segment !== "")
    .map((segment) => sanitizeStoragePathSegment(String(segment)));
};
