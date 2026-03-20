/**
 * Parse a UTC timestamp from D1 (stored without timezone indicator)
 * and format it for display in the user's local timezone.
 */
export function formatDate(utcString: string): string {
  // D1 stores as "2026-03-20 20:02:11" (UTC but no Z)
  // Append Z so JS treats it as UTC, then toLocaleString converts to local
  const date = new Date(utcString.endsWith('Z') ? utcString : utcString + 'Z');
  return date.toLocaleString();
}

export function formatDateShort(utcString: string): string {
  const date = new Date(utcString.endsWith('Z') ? utcString : utcString + 'Z');
  return date.toLocaleDateString();
}
