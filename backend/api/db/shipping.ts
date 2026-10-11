import { z } from "zod";
import { getD1 } from "./index";
import { calculateShipping } from "@backend/domain/commerce";
import {
  shippingCountries, shippingMethods, isSafeTrackingUrlTemplate, carrierTrackingUrl,
  type Carrier, type CarrierInput, type ShippingRule, type ShippingRuleInput,
  type ShippingSettings, type ShippingQuote, type ShippingCountry, type ShippingMethod,
} from "@shared/shipping";

const money = z.number().int().min(0).max(100_000_000);
const carrierCode = z.string().trim().min(1).max(40).regex(/^[a-z0-9][a-z0-9_-]*$/);
const ruleInputSchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(100), method: z.enum(shippingMethods),
  countries: z.array(z.enum(shippingCountries)).min(1).max(shippingCountries.length)
    .refine((countries) => new Set(countries).size === countries.length),
  baseCents: money, includedWeightGrams: z.number().int().min(0).max(1_000_000),
  stepWeightGrams: z.number().int().min(1).max(1_000_000), stepCents: money,
  freeAboveCents: z.number().int().min(1).max(100_000_000).nullable(),
  minDays: z.number().int().min(1).max(365), maxDays: z.number().int().min(1).max(365),
  carrierCode: carrierCode.nullable(), enabled: z.boolean(), expectedVersion: z.number().int().min(-1),
}).refine((rule) => rule.maxDays >= rule.minDays);
const carrierInputSchema = z.object({
  code: carrierCode, name: z.string().trim().min(1).max(100),
  trackingUrlTemplate: z.string().refine(isSafeTrackingUrlTemplate), enabled: z.boolean(),
  expectedVersion: z.number().int().min(-1),
});
const quoteInputSchema = z.object({
  country: z.enum(shippingCountries), method: z.enum(shippingMethods),
  subtotalCents: z.number().int().min(0).max(20_000_000_000),
  weightGrams: z.number().int().min(1).max(200_000_000),
});

type RuleRow = {
  id: string; name: string; method: ShippingMethod; countriesJson: string;
  baseCents: number; includedWeightGrams: number; stepWeightGrams: number; stepCents: number;
  freeAboveCents: number | null; minDays: number; maxDays: number; carrierCode: string | null;
  enabled: number; version: number; updatedAt: string;
};
type CarrierRow = Omit<Carrier, "enabled"> & { enabled: number };
const ruleColumns = `id, name, method, countries_json AS countriesJson, base_cents AS baseCents,
  included_weight_grams AS includedWeightGrams, step_weight_grams AS stepWeightGrams, step_cents AS stepCents,
  free_above_cents AS freeAboveCents, min_days AS minDays, max_days AS maxDays,
  carrier_code AS carrierCode, enabled, version, updated_at AS updatedAt`;
const carrierColumns = `code, name, tracking_url_template AS trackingUrlTemplate, enabled, version, updated_at AS updatedAt`;

function validOwner(ownerId: string) {
  if (!ownerId || ownerId.trim() !== ownerId || ownerId.length > 512) throw new Error("invalid_shipping_owner");
}

export async function getShippingSettings(ownerId: string): Promise<ShippingSettings> {
  validOwner(ownerId);
  const db = getD1();
  // One consistent read snapshot: a carrier/rule change cannot produce a mixed revision.
  const results = await db.batch([
    db.prepare(`SELECT ${ruleColumns} FROM shipping_rules WHERE owner_id = ? ORDER BY method, name, id`).bind(ownerId),
    db.prepare(`SELECT ${carrierColumns} FROM shipping_carriers WHERE owner_id = ? ORDER BY code`).bind(ownerId),
  ]);
  const rules = (results[0].results as unknown as RuleRow[]).map((row): ShippingRule => {
    const countries: unknown = JSON.parse(row.countriesJson);
    const { countriesJson: _countriesJson, enabled, ...rest } = row;
    const input = ruleInputSchema.safeParse({ ...rest, countries, enabled: enabled === 1, expectedVersion: row.version });
    // Corrupt configuration must fail closed rather than quietly reverting to legacy rates.
    if (!input.success) throw new Error("shipping_configuration_invalid");
    return { ...rest, countries: input.data.countries, enabled: enabled === 1 };
  });
  const carriers = (results[1].results as unknown as CarrierRow[]).map((row): Carrier => {
    if (!carrierInputSchema.safeParse({ ...row, enabled: row.enabled === 1, expectedVersion: row.version }).success) {
      throw new Error("shipping_configuration_invalid");
    }
    return { ...row, enabled: row.enabled === 1 };
  });
  const bytes = new TextEncoder().encode(JSON.stringify({ rules, carriers }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const revision = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { rules, carriers, configured: rules.length > 0, revision };
}

export async function saveCarrier(ownerId: string, input: CarrierInput): Promise<boolean> {
  validOwner(ownerId);
  const parsed = carrierInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("invalid_shipping_carrier");
  const carrier = parsed.data;
  const now = new Date().toISOString();
  const db = getD1();
  const mutation = carrier.expectedVersion === -1
    ? db.prepare(`INSERT INTO shipping_carriers(owner_id, code, name, tracking_url_template, enabled, version, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?) ON CONFLICT DO NOTHING`)
      .bind(ownerId, carrier.code, carrier.name, carrier.trackingUrlTemplate, carrier.enabled ? 1 : 0, now)
    : db.prepare(`UPDATE shipping_carriers SET name = ?, tracking_url_template = ?, enabled = ?, version = version + 1, updated_at = ?
      WHERE owner_id = ? AND code = ? AND version = ?`)
      .bind(carrier.name, carrier.trackingUrlTemplate, carrier.enabled ? 1 : 0, now, ownerId, carrier.code, carrier.expectedVersion);
  const results = await db.batch([mutation, db.prepare(`INSERT INTO shipping_events
    (id, owner_id, entity, entity_id, action, details_json, actor_id, created_at)
    SELECT ?, owner_id, 'carrier', code, ?, ?, ?, ? FROM shipping_carriers
    WHERE owner_id = ? AND code = ? AND changes() > 0`).bind(crypto.randomUUID(),
      carrier.expectedVersion === -1 ? "created" : "updated", JSON.stringify({ ...carrier, version: carrier.expectedVersion + 1 }),
      ownerId, now, ownerId, carrier.code)]);
  return (results[0].meta.changes ?? 0) > 0;
}

export async function saveShippingRule(ownerId: string, input: ShippingRuleInput): Promise<boolean> {
  validOwner(ownerId);
  const parsed = ruleInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("invalid_shipping_rule");
  const rule = parsed.data;
  const now = new Date().toISOString();
  // This unique token, not a possibly same-millisecond timestamp, guards dependent
  // mapping writes after a stale/no-op optimistic mutation in an atomic D1 batch.
  const mutationId = crypto.randomUUID();
  const db = getD1();
  if (rule.carrierCode && !(await db.prepare("SELECT code FROM shipping_carriers WHERE owner_id = ? AND code = ?")
    .bind(ownerId, rule.carrierCode).first())) throw new Error("shipping_carrier_unavailable");
  const values = [rule.name, rule.method, JSON.stringify([...rule.countries].sort()), rule.baseCents,
    rule.includedWeightGrams, rule.stepWeightGrams, rule.stepCents, rule.freeAboveCents,
    rule.minDays, rule.maxDays, rule.carrierCode, rule.enabled ? 1 : 0];
  const mutation = rule.expectedVersion === -1
    ? db.prepare(`INSERT INTO shipping_rules(id, owner_id, name, method, countries_json, base_cents,
      included_weight_grams, step_weight_grams, step_cents, free_above_cents, min_days, max_days,
      carrier_code, enabled, version, updated_at, mutation_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?) ON CONFLICT DO NOTHING`)
      .bind(rule.id, ownerId, ...values, now, mutationId)
    : db.prepare(`UPDATE shipping_rules SET name = ?, method = ?, countries_json = ?, base_cents = ?,
      included_weight_grams = ?, step_weight_grams = ?, step_cents = ?, free_above_cents = ?,
      min_days = ?, max_days = ?, carrier_code = ?, enabled = ?, version = version + 1, updated_at = ?, mutation_id = ?
      WHERE owner_id = ? AND id = ? AND version = ?`)
      .bind(...values, now, mutationId, ownerId, rule.id, rule.expectedVersion);
  try {
    const results = await db.batch([
      mutation,
      db.prepare(`INSERT INTO shipping_events (id, owner_id, entity, entity_id, action, details_json, actor_id, created_at)
        SELECT ?, owner_id, 'rule', id, ?, ?, ?, ? FROM shipping_rules
        WHERE owner_id = ? AND id = ? AND changes() > 0`).bind(crypto.randomUUID(),
          rule.expectedVersion === -1 ? "created" : "updated", JSON.stringify({ ...rule, version: rule.expectedVersion + 1 }),
          ownerId, now, ownerId, rule.id),
      db.prepare(`DELETE FROM shipping_rule_countries WHERE owner_id = ? AND rule_id = ?
        AND EXISTS(SELECT 1 FROM shipping_rules WHERE id = ? AND owner_id = ? AND mutation_id = ?)`)
        .bind(ownerId, rule.id, rule.id, ownerId, mutationId),
      ...rule.countries.map((country) => db.prepare(`INSERT INTO shipping_rule_countries(rule_id, owner_id, method, country, enabled)
        SELECT id, owner_id, method, ?, enabled FROM shipping_rules WHERE id = ? AND owner_id = ? AND mutation_id = ?`)
        .bind(country, rule.id, ownerId, mutationId)),
    ]);
    return (results[0].meta.changes ?? 0) > 0;
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed: shipping_rule_countries\.(?:owner_id|rule_id)/i.test(error.message)) {
      throw new Error("shipping_route_overlap");
    }
    throw error;
  }
}

export function quoteShippingFromSettings(settings: ShippingSettings, input: {
  country: ShippingCountry; method: ShippingMethod; subtotalCents: number; weightGrams: number;
}): ShippingQuote {
  const parsed = quoteInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("invalid_shipping_quote");
  const { country, method, subtotalCents, weightGrams } = parsed.data;
  const base: ShippingQuote = { available: false, country, method, revision: settings.revision,
    shippingCents: null, minDays: null, maxDays: null, ruleId: null, carrierCode: null, reason: "no_rule" };
  if (!settings.configured) {
    const eta = { standard: [10, 18], express: [5, 9], priority: [3, 6] }[method];
    return { ...base, available: true, shippingCents: calculateShipping(method, subtotalCents),
      minDays: eta[0], maxDays: eta[1], reason: null };
  }
  const matches = settings.rules.filter((rule) => rule.method === method && rule.countries.includes(country));
  const enabled = matches.filter((rule) => rule.enabled);
  if (enabled.length > 1) throw new Error("shipping_configuration_invalid");
  const rule = enabled[0];
  if (!rule) return { ...base, reason: matches.length > 0 ? "route_disabled" : "country_not_served" };
  const carrier = rule.carrierCode ? settings.carriers.find((candidate) => candidate.code === rule.carrierCode && candidate.enabled) : null;
  if (rule.carrierCode && !carrier) return { ...base, ruleId: rule.id, reason: "carrier_disabled" };
  const extraSteps = Math.ceil(Math.max(0, weightGrams - rule.includedWeightGrams) / rule.stepWeightGrams);
  const shippingCents = rule.freeAboveCents !== null && subtotalCents >= rule.freeAboveCents
    ? 0 : rule.baseCents + extraSteps * rule.stepCents;
  if (!Number.isSafeInteger(shippingCents) || shippingCents > 100_000_000) throw new Error("shipping_quote_exceeds_limit");
  return { ...base, available: true, shippingCents, minDays: rule.minDays, maxDays: rule.maxDays,
    ruleId: rule.id, carrierCode: rule.carrierCode, reason: null };
}

export async function quoteShipping(ownerId: string, input: Parameters<typeof quoteShippingFromSettings>[1]): Promise<ShippingQuote> {
  return quoteShippingFromSettings(await getShippingSettings(ownerId), input);
}

export async function resolveCarrierTracking(ownerId: string, code: string, trackingNumber: string): Promise<{
  code: string; name: string; trackingUrl: string;
} | null> {
  validOwner(ownerId);
  if (!carrierCode.safeParse(code).success) return null;
  const row = await getD1().prepare(`SELECT ${carrierColumns} FROM shipping_carriers WHERE owner_id = ? AND code = ? AND enabled = 1`)
    .bind(ownerId, code).first<CarrierRow>();
  if (!row) return null;
  const trackingUrl = carrierTrackingUrl(row.trackingUrlTemplate, trackingNumber);
  return trackingUrl ? { code: row.code, name: row.name, trackingUrl } : null;
}
