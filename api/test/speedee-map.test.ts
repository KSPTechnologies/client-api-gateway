import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SPEEDEE_CONFIG, mergeConfig, toPounds, toInches,
  buildSpeedeeBody, bucketCharges, businessDaysBetween, isTemporaryTracking,
} from '../src/lib/speedee-map';

const cfg = DEFAULT_SPEEDEE_CONFIG;

const baseReq = () => ({
  shipmentOrderIdentifier: 'a1b2c3',
  shipmentOrderCode: 'SO100',
  shippingOption: 'GROUND',
  shipFrom: {
    address: { AddressLine1: '123 A St', City: 'St Cloud', StateOrProvinceCode: 'MN', PostalCode: '56301', CountryCode: 'US' },
    contact: { companyName: 'KSP', personName: 'Dock', phoneNumber: '555', emailAddress: 'dock@ksp.com' },
  },
  shipTo: {
    address: { AddressLine1: '9 B Ave', City: 'Fargo', StateOrProvinceCode: 'ND', PostalCode: '58102', CountryCode: 'US' },
    contact: { personName: 'Jane Doe', phoneNumber: '555' },
  },
  requestedPackageLineItems: [
    { weight: { Value: 2, Units: 'KG' }, dimensions: { Length: 30, Width: 20, Height: 10, Units: 'CM' }, products: [{ isHazardous: false }] },
  ],
  labelReferences: { reference1: 'REF-ONE', reference2: 'REF-TWO' },
});

describe('unit conversions', () => {
  it('KG/OZ -> LB', () => {
    expect(toPounds(2, 'KG')).toBeCloseTo(4.41, 2);
    expect(toPounds(16, 'OZ')).toBe(1);
    expect(toPounds(5, 'LB')).toBe(5);
    expect(toPounds(0, 'LB')).toBe(0.01); // min > 0
  });
  it('CM -> IN', () => {
    expect(toInches(2.54, 'CM')).toBe(1);
    expect(toInches(10, 'IN')).toBe(10);
  });
});

describe('reference mapping', () => {
  it('maps ref1 and ref2->referenceNumber3, NEVER referenceNumber2', () => {
    const { body } = buildSpeedeeBody(baseReq(), cfg, null);
    expect(body!.referenceNumber1).toBe('REF-ONE');
    expect(body!.referenceNumber3).toBe('REF-TWO');
    expect(JSON.stringify(body)).not.toContain('referenceNumber2');
  });
  it('falls back to shipmentOrderCode and truncates with a warning', () => {
    const req = baseReq() as any;
    req.labelReferences = { reference1: 'X'.repeat(99) };
    const { body, warnings } = buildSpeedeeBody(req, cfg, null);
    expect(String(body!.referenceNumber1)).toHaveLength(cfg.referenceMaxLength);
    expect(warnings.join(' ')).toContain('truncated');
  });
});

describe('hazmat detection', () => {
  it('hazmat product -> HZ parcel type, userField, HAZMAT fee', () => {
    const req = baseReq() as any;
    req.requestedPackageLineItems[0].products = [{ isHazardous: true }];
    const { body } = buildSpeedeeBody(req, cfg, null);
    const item = (body!.items as any[])[0];
    expect(item.parcelTypeId).toBe('ANY_SIZE_BOX_HZ');
    expect(item.userFields).toEqual([{ userFieldId: 'HAZMAT', value: 'TRUE' }]);
    expect((body!.extraFees as any[]).some((f) => f.extraFeeId === 'HAZMAT')).toBe(true);
  });
});

describe('confirmation -> fee mapping', () => {
  it('ADULT -> AODSIGNATURE; strongest wins across packages', () => {
    const req = baseReq() as any;
    req.requestedPackageLineItems = [
      { ...req.requestedPackageLineItems[0], confirmation: 'INDIRECT' },
      { ...req.requestedPackageLineItems[0], confirmation: 'ADULT' },
    ];
    const { body, warnings } = buildSpeedeeBody(req, cfg, null);
    const fees = (body!.extraFees as any[]).map((f) => f.extraFeeId);
    expect(fees).toContain('AODSIGNATURE');
    expect(fees).not.toContain('AODINDIRECT');
    expect(warnings.join(' ')).toContain('Mixed confirmation');
  });
  it('saturdayDelivery ignored with warning', () => {
    const req = baseReq() as any;
    req.advancedOptions = { saturdayDelivery: true };
    const { warnings } = buildSpeedeeBody(req, cfg, null);
    expect(warnings.join(' ')).toContain('Saturday');
  });
});

describe('US-only + validation', () => {
  it('rejects non-US ship-to', () => {
    const req = baseReq() as any;
    req.shipTo.address.CountryCode = 'CA';
    const { body, errors } = buildSpeedeeBody(req, cfg, null);
    expect(body).toBeNull();
    expect(errors.join(' ')).toContain('US-only');
  });
  it('rejects empty package list', () => {
    const req = baseReq() as any;
    req.requestedPackageLineItems = [];
    expect(buildSpeedeeBody(req, cfg, null).errors.length).toBeGreaterThan(0);
  });
});

describe('cost bucketing', () => {
  it('confirmed ShipIt charge shape: Delivery type + Extra extraFeeTypeId', () => {
    const b = bucketCharges([
      { type: 'Delivery', price: 8.5, fromZone: 1, toZone: 3 },
      { type: 'Extra', price: 1.0, quantity: 1, extraFeeTypeId: 'ITEMPRICE' },
      { type: 'Extra', price: 0.5, quantity: 1, extraFeeTypeId: 'SHIPMENTWEIGHT' },
      { type: 'Extra', price: 3.25, quantity: 1, extraFeeTypeId: 'AODSIGNATURE' },
      { type: 'Extra', price: 1.75, quantity: 1, extraFeeTypeId: 'DAS' },
    ], cfg);
    expect(b.totalCost).toBe(15);
    expect(b.shippingCost).toBe(10);
    expect(b.otherCost).toBe(5);
  });
  it('legacy chargeId shape still buckets', () => {
    const b = bucketCharges([{ chargeId: 'DELIVERY', price: 10 }, { chargeId: 'DAS', price: 2 }], cfg);
    expect(b.shippingCost).toBe(10);
    expect(b.otherCost).toBe(2);
  });
});

describe('temporary tracking detection', () => {
  it('flags 01/02/empty as temporary, real numbers as final', () => {
    expect(isTemporaryTracking('01')).toBe(true);
    expect(isTemporaryTracking('2')).toBe(true);
    expect(isTemporaryTracking('')).toBe(true);
    expect(isTemporaryTracking('841745101316484999')).toBe(false);
    expect(isTemporaryTracking('SD3041-001A')).toBe(false);
  });
});

describe('estimatedDays', () => {
  it('business days, min 1', () => {
    expect(businessDaysBetween('2026-10-16T08:00:00Z', '2026-10-19T17:00:00Z')).toBe(1); // Fri->Mon
    expect(businessDaysBetween('2026-10-12T08:00:00Z', '2026-10-15T17:00:00Z')).toBe(3);
    expect(businessDaysBetween('2026-10-15T08:00:00Z', '2026-10-15T08:00:00Z')).toBe(1);
  });
});

describe('config merge', () => {
  it('stored overrides merge over defaults incl. paths', () => {
    const merged = mergeConfig({ paths: { getItems: '/api/v2/items/{orderId}' } as any, mockMode: true });
    expect(merged.paths.getItems).toBe('/api/v2/items/{orderId}');
    expect(merged.paths.quote).toBe('/api/v1/orders/quote');
    expect(merged.mockMode).toBe(true);
    expect(merged.serviceMap['LTL'].vehicleTypeId).toBe('SEMITRAILER_53TANDEMAXELTRACTOR');
  });
});

describe('vehicle omission', () => {
  it('null vehicleTypeId in serviceMap -> field omitted (platform defaults it)', () => {
    const merged = mergeConfig({ serviceMap: { 'LTLX': { serviceLevelId: 'LTL_NEXTDAYPU', vehicleTypeId: null } } as any });
    const req = JSON.parse(JSON.stringify({
      shipmentOrderIdentifier: 'x', shipmentOrderCode: 'X1', shippingOption: 'LTLX',
      shipFrom: { address: { AddressLine1: 'a', City: 'c', StateOrProvinceCode: 'MN', PostalCode: '55445', CountryCode: 'US' } },
      shipTo: { address: { AddressLine1: 'b', City: 'd', StateOrProvinceCode: 'ND', PostalCode: '58102', CountryCode: 'US' } },
      requestedPackageLineItems: [{ weight: { Value: 5, Units: 'LB' } }],
    }));
    const { body } = buildSpeedeeBody(req, merged, null);
    expect(body).not.toBeNull();
    expect('vehicleTypeId' in body!).toBe(false);
    expect(body!.serviceLevelId).toBe('LTL_NEXTDAYPU');
  });
});
