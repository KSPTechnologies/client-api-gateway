/**
 * US state/territory name → 2-letter code normalization.
 *
 * Logiwa's address fields (customerStateCode, billingStateCode,
 * shipmentStateCode, nested address.state) expect 2-letter codes.
 * Some client integrations send full names ("Louisiana"); this helper
 * converts them before the payload leaves the gateway.
 *
 * Unknown values pass through unchanged so we don't silently corrupt
 * APO/FPO addresses, Canadian provinces, or typos.
 */

const NAME_TO_CODE: Record<string, string> = {
  'alabama': 'AL',
  'alaska': 'AK',
  'arizona': 'AZ',
  'arkansas': 'AR',
  'california': 'CA',
  'colorado': 'CO',
  'connecticut': 'CT',
  'delaware': 'DE',
  'district of columbia': 'DC',
  'washington dc': 'DC',
  'washington d.c.': 'DC',
  'florida': 'FL',
  'georgia': 'GA',
  'hawaii': 'HI',
  'idaho': 'ID',
  'illinois': 'IL',
  'indiana': 'IN',
  'iowa': 'IA',
  'kansas': 'KS',
  'kentucky': 'KY',
  'louisiana': 'LA',
  'maine': 'ME',
  'maryland': 'MD',
  'massachusetts': 'MA',
  'michigan': 'MI',
  'minnesota': 'MN',
  'mississippi': 'MS',
  'missouri': 'MO',
  'montana': 'MT',
  'nebraska': 'NE',
  'nevada': 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  'ohio': 'OH',
  'oklahoma': 'OK',
  'oregon': 'OR',
  'pennsylvania': 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  'tennessee': 'TN',
  'texas': 'TX',
  'utah': 'UT',
  'vermont': 'VT',
  'virginia': 'VA',
  'washington': 'WA',
  'west virginia': 'WV',
  'wisconsin': 'WI',
  'wyoming': 'WY',
  // Territories
  'puerto rico': 'PR',
  'guam': 'GU',
  'us virgin islands': 'VI',
  'u.s. virgin islands': 'VI',
  'virgin islands': 'VI',
  'american samoa': 'AS',
  'northern mariana islands': 'MP',
  // Military
  'armed forces americas': 'AA',
  'armed forces europe': 'AE',
  'armed forces pacific': 'AP',
};

const VALID_CODES = new Set(Object.values(NAME_TO_CODE));

/**
 * Normalize a single state value to its 2-letter code.
 * - Already-valid 2-letter codes are uppercased and returned.
 * - Known full names (case-insensitive) are mapped to their code.
 * - Unknown values pass through unchanged.
 */
export function normalizeStateCode(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;

  if (trimmed.length === 2) {
    const upper = trimmed.toUpperCase();
    if (VALID_CODES.has(upper)) return upper;
  }

  const mapped = NAME_TO_CODE[trimmed.toLowerCase()];
  if (mapped) return mapped;

  return value;
}

/**
 * Walk a payload object and normalize any value at a key matching
 * `state` or `*StateCode` (case-insensitive). Mutates in place and
 * also returns the object for chaining.
 */
export function normalizeStatesInPayload<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    for (const item of obj) normalizeStatesInPayload(item);
    return obj;
  }
  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const lower = key.toLowerCase();
    if (lower === 'state' || lower.endsWith('statecode')) {
      record[key] = normalizeStateCode(record[key]);
    } else {
      normalizeStatesInPayload(record[key]);
    }
  }
  return obj;
}
