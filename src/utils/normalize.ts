export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string): string {
  // Strip all non-digit characters
  const digits = phone.replace(/\D/g, "");
  
  // Standardize Kenyan formats:
  // 2547... -> 07...
  // 2541... -> 01...
  if (digits.startsWith("254") && digits.length === 12) {
    return "0" + digits.substring(3);
  }
  
  return digits;
}
