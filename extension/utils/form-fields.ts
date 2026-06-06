// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure, side-effect-free classification of form inputs into credit-card and
 * identity fields, plus the value-level checks (Luhn, card brand) and the group
 * thresholds the content script uses to decide whether a submitted form is worth
 * capturing. Kept DOM-free so it is unit-testable in a node environment: the
 * content script feeds it a small descriptor per input rather than the element.
 */

export type CardFieldKind =
  | "cc-number"
  | "cc-name"
  | "cc-exp"
  | "cc-exp-month"
  | "cc-exp-year"
  | "cc-csc";

export type IdentityFieldKind =
  | "given-name"
  | "family-name"
  | "full-name"
  | "email"
  | "tel"
  | "street-address"
  | "address-level1" // state / region
  | "address-level2" // city / locality
  | "postal-code"
  | "country";

export type FieldKind = CardFieldKind | IdentityFieldKind;

// The minimal, DOM-free view of an input the classifier needs. The content
// script builds this from a real HTMLInputElement; tests build it by hand.
export interface FieldDescriptor {
  autocomplete?: string;
  name?: string;
  id?: string;
  placeholder?: string;
  label?: string;
  type?: string;
  value?: string;
}

// ── autocomplete attribute mapping ─────────────────────────────────────────
// The autocomplete token is the strongest signal: it is a deliberate author
// hint and standardised, so it wins over the name/id/label heuristics.
const AUTOCOMPLETE_MAP: Record<string, FieldKind> = {
  "cc-number": "cc-number",
  "cc-name": "cc-name",
  "cc-given-name": "cc-name",
  "cc-family-name": "cc-name",
  "cc-exp": "cc-exp",
  "cc-exp-month": "cc-exp-month",
  "cc-exp-year": "cc-exp-year",
  "cc-csc": "cc-csc",
  "given-name": "given-name",
  "family-name": "family-name",
  name: "full-name",
  email: "email",
  tel: "tel",
  "tel-national": "tel",
  "street-address": "street-address",
  "address-line1": "street-address",
  "address-line2": "street-address",
  "address-level1": "address-level1",
  "address-level2": "address-level2",
  "postal-code": "postal-code",
  country: "country",
  "country-name": "country",
};

// The autocomplete attribute may carry section/billing/shipping prefixes, e.g.
// "billing cc-number" or "section-foo shipping postal-code". Match the last
// recognised token.
function fromAutocomplete(autocomplete: string | undefined): FieldKind | null {
  if (!autocomplete) return null;
  const tokens = autocomplete.toLowerCase().trim().split(/\s+/);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i]!;
    if (token in AUTOCOMPLETE_MAP) return AUTOCOMPLETE_MAP[token]!;
  }
  return null;
}

// ── name / id / placeholder / label heuristics (multilingual-ish) ──────────
// Ordered most-specific first: a single haystack is tested against each rule
// and the first match wins, so "card number" is classified as the number, not
// matched by a looser "name" rule.
interface HeuristicRule {
  kind: FieldKind;
  test: RegExp;
}

const HEURISTICS: HeuristicRule[] = [
  // Card. cvv/cvc/security-code before number so "card security code" is a CSC.
  { kind: "cc-csc", test: /\bcvv\b|\bcvc\b|\bcvc2\b|\bcsc\b|security[\s_-]?code|card[\s_-]?code|prüfziffer|kartenprüf/ },
  { kind: "cc-exp-month", test: /exp[\s_-]?month|expiry[\s_-]?month|ablauf[\s_-]?monat|\bmonth\b|\bmonat\b/ },
  { kind: "cc-exp-year", test: /exp[\s_-]?year|expiry[\s_-]?year|ablauf[\s_-]?jahr|\byear\b|\bjahr\b/ },
  { kind: "cc-exp", test: /expir|\bexp\b|valid[\s_-]?(thru|until)|ablauf|gültig|mm[\s/._-]?yy/ },
  { kind: "cc-name", test: /card[\s_-]?holder|cardholder|name[\s_-]?on[\s_-]?card|karteninhaber|name[\s_-]?der[\s_-]?karte/ },
  { kind: "cc-number", test: /card[\s_-]?number|cardnumber|\bccnum|kartennummer|\bkarte\b|\bcard\b|\bpan\b/ },
  // Identity.
  { kind: "given-name", test: /first[\s_-]?name|firstname|given[\s_-]?name|\bfname\b|vorname/ },
  { kind: "family-name", test: /last[\s_-]?name|lastname|family[\s_-]?name|sur[\s_-]?name|\blname\b|nachname|familienname/ },
  { kind: "email", test: /e[\s_-]?mail|email|\bmail\b/ },
  { kind: "tel", test: /phone|telephone|\btel\b|mobile|telefon|handy|mobil/ },
  { kind: "postal-code", test: /postal[\s_-]?code|\bzip\b|zip[\s_-]?code|post[\s_-]?code|\bplz\b|postleitzahl/ },
  { kind: "address-level2", test: /\bcity\b|\btown\b|locality|\bstadt\b|\bort\b|wohnort/ },
  { kind: "address-level1", test: /\bstate\b|province|\bregion\b|bundesland|\bland\b(?!es)/ },
  { kind: "street-address", test: /street|address|\baddr\b|strasse|straße|anschrift|adresse/ },
  { kind: "country", test: /country|\bnation\b|\bland\b/ },
  // Full name last so it never shadows first/last/street.
  { kind: "full-name", test: /full[\s_-]?name|your[\s_-]?name|\bname\b/ },
];

function heuristicHaystack(descriptor: FieldDescriptor): string {
  return `${descriptor.name ?? ""} ${descriptor.id ?? ""} ${
    descriptor.placeholder ?? ""
  } ${descriptor.label ?? ""}`.toLowerCase();
}

// True when the field's input type rules a card/identity classification out
// (a checkbox/password/file can never be a card number or a city).
function isClassifiableType(type: string | undefined): boolean {
  const value = (type ?? "text").toLowerCase();
  return (
    value === "text" ||
    value === "tel" ||
    value === "email" ||
    value === "number" ||
    value === "search" ||
    value === ""
  );
}

// Classify a single input. Priority: autocomplete attribute, then the
// name/id/placeholder/label heuristics. A card-number candidate must also pass
// Luhn on its current value to be accepted, which cuts false positives from
// generic "number" fields. Returns null when nothing matches.
export function classifyField(descriptor: FieldDescriptor): FieldKind | null {
  if (!isClassifiableType(descriptor.type)) return null;
  const kind = fromAutocomplete(descriptor.autocomplete) ?? heuristicFromText(descriptor);
  if (!kind) return null;
  if (kind === "cc-number") {
    // Only treat it as a card number when the value (if any) Luhn-validates.
    // An empty value can't be validated, so it is rejected at capture time; the
    // content script only classifies on submit, where a value is present.
    const digits = digitsOnly(descriptor.value ?? "");
    if (digits.length < 12 || !luhnValid(digits)) return null;
  }
  return kind;
}

function heuristicFromText(descriptor: FieldDescriptor): FieldKind | null {
  const haystack = heuristicHaystack(descriptor);
  if (!haystack.trim()) return null;
  for (const rule of HEURISTICS) {
    if (rule.test.test(haystack)) return rule.kind;
  }
  return null;
}

// ── Luhn validation + card brand ────────────────────────────────────────────
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function luhnValid(value: string): boolean {
  const digits = digitsOnly(value);
  if (digits.length < 12) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = digits.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

export type CardBrand = "visa" | "mastercard" | "amex" | "discover" | "";

// Detect the card brand from the IIN/BIN prefix, returning the lowercase token
// the web editor stores in `cardType` (empty when unknown).
export function detectCardBrand(value: string): CardBrand {
  const digits = digitsOnly(value);
  if (!digits) return "";
  if (/^4/.test(digits)) return "visa";
  if (/^3[47]/.test(digits)) return "amex";
  // Mastercard: 51-55 or the 2221-2720 range.
  if (/^5[1-5]/.test(digits)) return "mastercard";
  const firstFour = Number(digits.slice(0, 4));
  if (digits.length >= 4 && firstFour >= 2221 && firstFour <= 2720) {
    return "mastercard";
  }
  // Discover: 6011, 65, or 644-649.
  if (/^6011/.test(digits) || /^65/.test(digits) || /^64[4-9]/.test(digits)) {
    return "discover";
  }
  return "";
}

// Last four digits, for the masked item title / picker label.
export function lastFour(value: string): string {
  return digitsOnly(value).slice(-4);
}

// ── Expiry normalisation ────────────────────────────────────────────────────
// The web CreditCardFields editor formats expiry as "MM/YY". Normalise the
// many shapes a checkout form yields (single combined field, or separate
// month/year fields) into that, so items round-trip with the editor.
export function formatExpiry(month: string, year: string): string {
  const monthDigits = digitsOnly(month).slice(0, 2);
  if (!monthDigits) return "";
  const paddedMonth = monthDigits.padStart(2, "0");
  const yearDigits = digitsOnly(year);
  if (!yearDigits) return paddedMonth;
  const shortYear = yearDigits.length >= 4 ? yearDigits.slice(-2) : yearDigits.padStart(2, "0");
  return `${paddedMonth}/${shortYear}`;
}

// Normalise a single combined expiry value ("08/27", "08-2027", "0827") to
// "MM/YY". Returns "" when it can't be parsed into a plausible month.
export function normalizeCombinedExpiry(value: string): string {
  const separated = value.match(/^\s*(\d{1,2})\s*[/.\-\s]\s*(\d{2,4})\s*$/);
  if (separated) return formatExpiry(separated[1]!, separated[2]!);
  const digits = digitsOnly(value);
  if (digits.length === 4) return formatExpiry(digits.slice(0, 2), digits.slice(2));
  if (digits.length === 6) return formatExpiry(digits.slice(0, 2), digits.slice(2));
  return "";
}

// ── Captured field values (DOM-free) ────────────────────────────────────────
// A classified field paired with its current value, the unit both the group
// detection and the capture builders consume.
export interface ClassifiedValue {
  kind: FieldKind;
  value: string;
}

const CARD_KINDS = new Set<CardFieldKind>([
  "cc-number",
  "cc-name",
  "cc-exp",
  "cc-exp-month",
  "cc-exp-year",
  "cc-csc",
]);

const IDENTITY_KINDS = new Set<IdentityFieldKind>([
  "given-name",
  "family-name",
  "full-name",
  "email",
  "tel",
  "street-address",
  "address-level1",
  "address-level2",
  "postal-code",
  "country",
]);

export function isCardKind(kind: FieldKind): kind is CardFieldKind {
  return CARD_KINDS.has(kind as CardFieldKind);
}

export function isIdentityKind(kind: FieldKind): kind is IdentityFieldKind {
  return IDENTITY_KINDS.has(kind as IdentityFieldKind);
}

// ── Group thresholds ────────────────────────────────────────────────────────
// A card group is worth capturing when there is a number plus at least one of
// expiry (any form) / cvv / cardholder name. The number alone is too weak (it
// could be an order id that happened to Luhn-pass).
export function hasCardGroup(fields: ClassifiedValue[]): boolean {
  const kinds = new Set(fields.map((f) => f.kind));
  if (!kinds.has("cc-number")) return false;
  return (
    kinds.has("cc-exp") ||
    kinds.has("cc-exp-month") ||
    kinds.has("cc-exp-year") ||
    kinds.has("cc-csc") ||
    kinds.has("cc-name")
  );
}

// An identity group needs at least three DISTINCT identity attributes, so a
// stray "email" on a newsletter form never trips it. A name (first/last/full),
// a street, and a city or postal code is the canonical shipping shape.
export function hasIdentityGroup(fields: ClassifiedValue[]): boolean {
  return distinctIdentityAttributes(fields) >= 3;
}

// Count distinct identity attributes present with a non-empty value, collapsing
// first/last/full name to one "name" attribute and city/state/postal/country to
// their own buckets so three filled name parts don't masquerade as a group.
export function distinctIdentityAttributes(fields: ClassifiedValue[]): number {
  const present = new Set<string>();
  for (const field of fields) {
    if (!field.value.trim()) continue;
    if (!isIdentityKind(field.kind)) continue;
    if (field.kind === "given-name" || field.kind === "family-name" || field.kind === "full-name") {
      present.add("name");
    } else {
      present.add(field.kind);
    }
  }
  return present.size;
}

// ── Capture builders (web-compatible JSON shapes) ──────────────────────────
export interface CreditCardData {
  cardholderName: string;
  number: string;
  expiry: string;
  cvv: string;
  cardType: string;
  notes: string;
  customFields: never[];
}

export interface IdentityData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  ssn: string;
  passportNumber: string;
  licenseNumber: string;
  notes: string;
  customFields: never[];
}

function firstValue(fields: ClassifiedValue[], kind: FieldKind): string {
  return fields.find((f) => f.kind === kind && f.value.trim())?.value.trim() ?? "";
}

// Build the credit_card payload exactly as the web editor stores it. Expiry is
// assembled from whichever shape the form used (combined, or month + year).
export function buildCreditCardData(fields: ClassifiedValue[]): CreditCardData {
  const number = firstValue(fields, "cc-number");
  const combinedExpiry = firstValue(fields, "cc-exp");
  const month = firstValue(fields, "cc-exp-month");
  const year = firstValue(fields, "cc-exp-year");
  const expiry = combinedExpiry
    ? normalizeCombinedExpiry(combinedExpiry)
    : formatExpiry(month, year);
  return {
    cardholderName: firstValue(fields, "cc-name"),
    number,
    expiry,
    cvv: firstValue(fields, "cc-csc"),
    cardType: detectCardBrand(number),
    notes: "",
    customFields: [],
  };
}

// Split a single "Full Name" value into first + last; the last whitespace run
// separates them, so "Mary Jane Watson" -> first "Mary Jane", last "Watson".
export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim().replace(/\s+/g, " ");
  if (!trimmed) return { firstName: "", lastName: "" };
  const lastSpace = trimmed.lastIndexOf(" ");
  if (lastSpace === -1) return { firstName: trimmed, lastName: "" };
  return {
    firstName: trimmed.slice(0, lastSpace),
    lastName: trimmed.slice(lastSpace + 1),
  };
}

export function buildIdentityData(fields: ClassifiedValue[]): IdentityData {
  let firstName = firstValue(fields, "given-name");
  let lastName = firstValue(fields, "family-name");
  if (!firstName && !lastName) {
    const split = splitFullName(firstValue(fields, "full-name"));
    firstName = split.firstName;
    lastName = split.lastName;
  }
  return {
    firstName,
    lastName,
    email: firstValue(fields, "email"),
    phone: firstValue(fields, "tel"),
    address: firstValue(fields, "street-address"),
    city: firstValue(fields, "address-level2"),
    state: firstValue(fields, "address-level1"),
    country: firstValue(fields, "country"),
    postalCode: firstValue(fields, "postal-code"),
    ssn: "",
    passportNumber: "",
    licenseNumber: "",
    notes: "",
    customFields: [],
  };
}

// Item titles the web list shows. Card: brand + last4 (e.g. "Visa •••• 4242").
// Falls back to "Card" when the brand is unknown.
export function cardTitle(data: CreditCardData): string {
  const brandLabel = BRAND_LABELS[data.cardType as CardBrand] ?? "Card";
  const four = lastFour(data.number);
  return four ? `${brandLabel} •••• ${four}` : brandLabel;
}

const BRAND_LABELS: Record<CardBrand, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "Amex",
  discover: "Discover",
  "": "Card",
};

// Identity title: "First Last", falling back to whichever name part exists, then
// the email, then a generic label.
export function identityTitle(data: IdentityData): string {
  const name = `${data.firstName} ${data.lastName}`.trim();
  if (name) return name;
  if (data.email) return data.email;
  return "Identity";
}
