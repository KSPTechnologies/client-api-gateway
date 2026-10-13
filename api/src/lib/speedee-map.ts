/**
 * SpeeDee custom-carrier mapping layer — PURE functions (no I/O) translating
 * Logiwa's Custom Carrier payloads into SpeeDee ShipIt bodies and SpeeDee
 * responses back into Logiwa's shapes. All behavior that could differ per
 * warehouse/account lives in SpeedeeConfig (stored in KV `speedee:config`,
 * merged over DEFAULT_SPEEDEE_CONFIG) — never hardcoded here.
 */

// ── Config ───────────────────────────────────────────

export interface SpeedeeConfig {
  displayName: string;
  /** Logiwa shippingOption (uppercased) -> service/vehicle pair. '*' = default. */
  serviceMap: Record<string, { serviceLevelId: string; vehicleTypeId: string }>;
  /** Logiwa package/carrier-package type (uppercased) -> SpeeDee parcelTypeId. '*' = default. */
  parcelTypeMap: Record<string, string>;
  hazmatParcelTypeId: string;
  /** Logiwa confirmation value (uppercased) -> SpeeDee extraFeeId ('' = none). */
  confirmationMap: Record<string, string>;
  /** charge ids counted as shippingCost; everything else is otherCost. */
  shippingChargeIds: string[];
  /** 'dollars' = quantity is declared $ value; 'per100' = $100 units. */
  declaredValueUnits: 'dollars' | 'per100';
  trackingUrlTemplate: string;          // {tracking} substituted
  referenceMaxLength: number;
  /** 'portal' = tell warehouse to print from ShipIt portal; 'summary' = gateway PDF. */
  eodMode: 'portal' | 'summary';
  pollBudgetMs: number;
  pollBackoffMs: number[];
  mockMode: boolean;
  /** ShipIt paths — UNCONFIRMED ones are overridable here without a deploy. */
  paths: {
    createOrder: string;                // POST
    quote: string;                      // POST
    search: string;                     // POST
    returnOrder: string;                // POST ?sourceOrderId=
    getOrder: string;                   // GET  {orderId} substituted — CONFIRM vs Postman
    getItems: string;                   // GET  {orderId} — CONFIRM
    labelsJson: string;                 // GET  {orderId} — CONFIRM
    cancelOrder: string;                // POST {orderId} — CONFIRM (may be DELETE)
    deleteItems: string;                // POST {orderId} — CONFIRM
  };
  useReturnEndpoint: boolean;           // true = POST /orders/return when source order known
}

export const DEFAULT_SPEEDEE_CONFIG: SpeedeeConfig = {
  displayName: 'SpeeDee',
  serviceMap: {
    '*': { serviceLevelId: 'PACKAGE_PARCEL', vehicleTypeId: 'STEPVAN' },
    'GROUND': { serviceLevelId: 'PACKAGE_PARCEL', vehicleTypeId: 'STEPVAN' },
    'LTL': { serviceLevelId: 'LTL_NEXTDAYPU', vehicleTypeId: 'SEMITRAILER_53TANDEMAXELTRACTOR' },
  },
  parcelTypeMap: { '*': 'BOX' },
  hazmatParcelTypeId: 'ANY_SIZE_BOX_HZ',
  confirmationMap: {
    'ADULT': 'AODSIGNATURE',
    'SIGNATURE': 'AOD',
    'DIRECT': 'AOD',
    'INDIRECT': 'AODINDIRECT',
    'NONE': '',
  },
  shippingChargeIds: ['DELIVERY', 'ITEMPRICE', 'SHIPMENTWEIGHT'],
  declaredValueUnits: 'dollars',        // CONFIRM with SpeeDee
  trackingUrlTemplate: 'https://speedeedelivery.com/track-a-shipment/?barcodes={tracking}',
  referenceMaxLength: 30,               // CONFIRM actual limit
  eodMode: 'portal',
  pollBudgetMs: 11_000,
  pollBackoffMs: [300, 500, 1000],
  mockMode: false,
  paths: {
    createOrder: '/api/v1/orders',
    quote: '/api/v1/orders/quote',
    search: '/api/v1/orders/search',
    returnOrder: '/api/v1/orders/return',
    getOrder: '/api/v1/orders/{orderId}',
    getItems: '/api/v1/orders/{orderId}/items',
    labelsJson: '/api/v1/orders/{orderId}/labels',
    cancelOrder: '/api/v1/orders/{orderId}/cancel',
    deleteItems: '/api/v1/orders/{orderId}/items/delete',
  },
  useReturnEndpoint: false,
};

export function mergeConfig(stored: Partial<SpeedeeConfig> | null): SpeedeeConfig {
  if (!stored) return DEFAULT_SPEEDEE_CONFIG;
  return {
    ...DEFAULT_SPEEDEE_CONFIG,
    ...stored,
    serviceMap: { ...DEFAULT_SPEEDEE_CONFIG.serviceMap, ...(stored.serviceMap || {}) },
    parcelTypeMap: { ...DEFAULT_SPEEDEE_CONFIG.parcelTypeMap, ...(stored.parcelTypeMap || {}) },
    confirmationMap: { ...DEFAULT_SPEEDEE_CONFIG.confirmationMap, ...(stored.confirmationMap || {}) },
    paths: { ...DEFAULT_SPEEDEE_CONFIG.paths, ...(stored.paths || {}) },
  };
}

// ── Unit conversions ─────────────────────────────────

export function toPounds(value: number, units?: string): number {
  const u = String(units || 'LB').toUpperCase();
  let lb = value;
  if (u === 'KG' || u === 'KGS') lb = value * 2.20462;
  else if (u === 'OZ') lb = value / 16;
  const rounded = Math.round(lb * 100) / 100;
  return rounded > 0 ? rounded : 0.01; // SpeeDee: weight must be > 0
}

export function toInches(value: number, units?: string): number {
  const u = String(units || 'IN').toUpperCase();
  const inches = (u === 'CM' || u === 'CMS') ? value / 2.54 : value;
  return Math.round(inches * 100) / 100;
}

// ── Mapping result types ─────────────────────────────

export interface MapResult {
  body: Record<string, unknown> | null;
  warnings: string[];
  errors: string[];                     // non-empty => do not call SpeeDee
}

// ── Address / contact helpers ────────────────────────

function mapAddress(a: any): Record<string, unknown> {
  return {
    addressLine1: a?.AddressLine1 ?? a?.addressLine1 ?? '',
    addressLine2: a?.AddressLine2 ?? a?.addressLine2 ?? null,
    city: a?.City ?? a?.city ?? '',
    stateProvince: a?.StateOrProvinceCode ?? a?.stateOrProvinceCode ?? '',
    postalCode: String(a?.PostalCode ?? a?.postalCode ?? '').trim(),
    country: 'US',
  };
}

function countryOf(a: any): string {
  return String(a?.CountryCode ?? a?.countryCode ?? 'US').toUpperCase();
}

function mapContact(party: any, companyFallback?: string): Record<string, unknown> {
  const c = party?.contact ?? {};
  return {
    name: c?.personName ?? c?.PersonName ?? companyFallback ?? '',
    phoneNumber: c?.phoneNumber ?? c?.PhoneNumber ?? null,
    email: c?.emailAddress ?? c?.EmailAddress ?? null,
  };
}

function truncRef(val: unknown, max: number, warnings: string[], which: string): string | null {
  if (val === undefined || val === null || val === '') return null;
  const s = String(val);
  if (s.length > max) {
    warnings.push(`${which} truncated to ${max} chars`);
    return s.slice(0, max);
  }
  return s;
}

// ── Core: Logiwa request -> SpeeDee order/quote body ─

export function buildSpeedeeBody(req: any, cfg: SpeedeeConfig, webhookUrl: string | null): MapResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  const shipFrom = req?.shipFrom ?? {};
  const shipTo = req?.shipTo ?? {};

  // US-only carrier
  for (const [label, party] of [['ship-from', shipFrom], ['ship-to', shipTo]] as const) {
    const cc = countryOf(party?.address);
    if (cc && cc !== 'US') errors.push(`SpeeDee is a US-only regional carrier; ${label} country '${cc}' is not supported`);
  }

  // Service level / vehicle (config-driven)
  const optRaw = String(req?.shippingOption ?? req?.shippingOptionName ?? '').toUpperCase();
  const svc = cfg.serviceMap[optRaw] || cfg.serviceMap['*'];
  if (!svc) errors.push(`No SpeeDee service mapping for shipping option '${optRaw || '(none)'}'`);

  // readyAt
  const readyAt = req?.plannedPickUpDate || req?.expectedShipmentDate || new Date().toISOString();

  // Packages
  const pkgs: any[] = Array.isArray(req?.requestedPackageLineItems) ? req.requestedPackageLineItems : [];
  if (pkgs.length === 0) errors.push('No packages (requestedPackageLineItems is empty)');

  let orderWeightLb = 0;
  let anyHazmat = false;
  let strongestConf = '';
  const confRank: Record<string, number> = { '': 0, 'AODINDIRECT': 1, 'AOD': 2, 'AODSIGNATURE': 3 };

  const items = pkgs.map((p: any, i: number) => {
    const wLb = toPounds(Number(p?.weight?.Value ?? p?.weight?.value ?? 0), p?.weight?.Units ?? p?.weight?.units);
    orderWeightLb += wLb;

    const dims = p?.dimensions ?? {};
    const dimUnits = dims?.Units ?? dims?.units;

    const hazmat = Array.isArray(p?.products) && p.products.some((pr: any) => pr?.isHazardous === true);
    if (hazmat) anyHazmat = true;

    // Per-package confirmation (strongest wins at order level)
    const confRaw = String(p?.confirmation ?? p?.deliveryConfirmation ?? '').toUpperCase();
    const mapped = cfg.confirmationMap[confRaw];
    if (confRaw && mapped === undefined) warnings.push(`Unknown confirmation '${confRaw}' on package ${i + 1} — ignored (update speedee config)`);
    const fee = mapped || '';
    if ((confRank[fee] ?? 0) > (confRank[strongestConf] ?? 0)) strongestConf = fee;

    const pkgTypeRaw = String(p?.packageType ?? p?.carrierPackageName ?? '').toUpperCase();
    const parcelTypeId = hazmat
      ? cfg.hazmatParcelTypeId
      : (cfg.parcelTypeMap[pkgTypeRaw] || cfg.parcelTypeMap['*'] || 'BOX');

    const description = p?.description ?? p?.products?.[0]?.description ?? p?.products?.[0]?.name ?? null;

    const item: Record<string, unknown> = {
      weight: wLb,
      length: toInches(Number(dims?.Length ?? dims?.length ?? 0), dimUnits),
      width: toInches(Number(dims?.Width ?? dims?.width ?? 0), dimUnits),
      height: toInches(Number(dims?.Height ?? dims?.height ?? 0), dimUnits),
      parcelTypeId,
      description,
      barcodeTemplate: null,
    };
    if (hazmat) item.userFields = [{ userFieldId: 'HAZMAT', value: 'TRUE' }];
    return item;
  });

  // Order-level confirmation (advancedOptions can set it too)
  const advConfRaw = String(req?.advancedOptions?.deliveryConfirmaton ?? req?.advancedOptions?.deliveryConfirmation ?? '').toUpperCase();
  if (advConfRaw) {
    const mapped = cfg.confirmationMap[advConfRaw];
    if (mapped === undefined) warnings.push(`Unknown advancedOptions confirmation '${advConfRaw}' — ignored`);
    else if ((confRank[mapped || ''] ?? 0) > (confRank[strongestConf] ?? 0)) strongestConf = mapped || '';
  }
  const confValues = new Set(pkgs.map((p: any) => String(p?.confirmation ?? '').toUpperCase()).filter(Boolean));
  if (confValues.size > 1) warnings.push(`Mixed confirmation values across packages — using strongest (${strongestConf || 'none'})`);

  // Extra fees
  const extraFees: Array<Record<string, unknown>> = [];
  if (strongestConf) extraFees.push({ extraFeeId: strongestConf, quantity: 1 });
  if (anyHazmat) extraFees.push({ extraFeeId: 'HAZMAT', quantity: 1 });
  const insVal = Number(req?.insuranceOptions?.Value ?? req?.insuranceOptions?.value ?? 0);
  if (insVal > 0) {
    const qty = cfg.declaredValueUnits === 'per100' ? Math.ceil(insVal / 100) : Math.round(insVal);
    extraFees.push({ extraFeeId: 'DECLAREDVALUE', quantity: qty });
  }
  if (req?.advancedOptions?.saturdayDelivery) warnings.push('Saturday delivery is not supported by SpeeDee — ignored');

  // References — NEVER send referenceNumber2 (SpeeDee internal)
  const ref1 = truncRef(req?.labelReferences?.reference1 ?? req?.shipmentOrderCode, cfg.referenceMaxLength, warnings, 'referenceNumber1');
  const ref3 = truncRef(
    req?.labelReferences?.reference2 ?? req?.labelReferences?.reference3 ?? req?.retailerPoNumber,
    cfg.referenceMaxLength, warnings, 'referenceNumber3'
  );

  if (errors.length) return { body: null, warnings, errors };

  const body: Record<string, unknown> = {
    serviceLevelId: svc.serviceLevelId,
    vehicleTypeId: svc.vehicleTypeId,
    readyAt,
    pickupAddress: { ...mapAddress(shipFrom?.address), company: shipFrom?.contact?.companyName ?? null },
    pickupContactInfo: mapContact(shipFrom),
    dropoffAddress: { ...mapAddress(shipTo?.address), company: shipTo?.contact?.companyName ?? null },
    dropoffContactInfo: mapContact(shipTo),
    referenceNumber1: ref1,
    referenceNumber3: ref3,
    numberOfPieces: items.length,
    weight: Math.round(orderWeightLb * 100) / 100,
    items,
    extraFees,
  };
  if (webhookUrl) body.webhookUrl = webhookUrl;
  return { body, warnings, errors };
}

// ── Charges -> Logiwa rate buckets ───────────────────

export interface RateBuckets {
  totalCost: number;
  shippingCost: number;
  otherCost: number;
}

export function bucketCharges(charges: any[], cfg: SpeedeeConfig): RateBuckets {
  let total = 0;
  let shipping = 0;
  const shipIds = cfg.shippingChargeIds.map((s) => s.toUpperCase());
  for (const c of charges || []) {
    const price = Number(c?.price ?? c?.amount ?? 0);
    if (!isFinite(price)) continue;
    total += price;
    const id = String(c?.chargeId ?? c?.id ?? c?.name ?? '').toUpperCase();
    if (shipIds.includes(id)) shipping += price;
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { totalCost: r2(total), shippingCost: r2(shipping), otherCost: r2(total - shipping) };
}

export function businessDaysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || to <= from) return 1;
  let days = 0;
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (d < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) days++;
  }
  return Math.max(days, 1);
}

/** Temporary item tracking numbers are bare item sequence numbers (01, 02, …). */
export function isTemporaryTracking(trackingNumber: unknown): boolean {
  const s = String(trackingNumber ?? '').trim();
  return s === '' || /^\d{1,3}$/.test(s);
}
