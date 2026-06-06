// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";
import {
  classifyField,
  luhnValid,
  detectCardBrand,
  formatExpiry,
  normalizeCombinedExpiry,
  splitFullName,
  hasCardGroup,
  hasIdentityGroup,
  distinctIdentityAttributes,
  buildCreditCardData,
  buildIdentityData,
  cardTitle,
  identityTitle,
  type ClassifiedValue,
} from "./form-fields.js";

const VISA = "4242424242424242";
const MC = "5555555555554444";
const MC2 = "2223003122003222";
const AMEX = "378282246310005";
const DISCOVER = "6011111111111117";

describe("classifyField - autocomplete mapping", () => {
  it("maps cc-number with a Luhn-valid value", () => {
    expect(classifyField({ autocomplete: "cc-number", value: VISA })).toBe("cc-number");
  });
  it("rejects cc-number when the value fails Luhn", () => {
    expect(classifyField({ autocomplete: "cc-number", value: "1234567890123" })).toBeNull();
  });
  it("honours billing/shipping prefixes on the token", () => {
    expect(classifyField({ autocomplete: "billing postal-code" })).toBe("postal-code");
    expect(classifyField({ autocomplete: "shipping address-level2" })).toBe("address-level2");
  });
  it("maps cc-exp / cc-csc / cc-name", () => {
    expect(classifyField({ autocomplete: "cc-exp" })).toBe("cc-exp");
    expect(classifyField({ autocomplete: "cc-csc" })).toBe("cc-csc");
    expect(classifyField({ autocomplete: "cc-name" })).toBe("cc-name");
  });
  it("maps identity tokens", () => {
    expect(classifyField({ autocomplete: "given-name" })).toBe("given-name");
    expect(classifyField({ autocomplete: "family-name" })).toBe("family-name");
    expect(classifyField({ autocomplete: "email" })).toBe("email");
    expect(classifyField({ autocomplete: "tel" })).toBe("tel");
    expect(classifyField({ autocomplete: "street-address" })).toBe("street-address");
    expect(classifyField({ autocomplete: "address-level1" })).toBe("address-level1");
    expect(classifyField({ autocomplete: "country-name" })).toBe("country");
  });
});

describe("classifyField - heuristics (en + de)", () => {
  it("classifies CVV before number", () => {
    expect(classifyField({ name: "card_security_code" })).toBe("cc-csc");
    expect(classifyField({ name: "cvc" })).toBe("cc-csc");
    expect(classifyField({ placeholder: "Prüfziffer" })).toBe("cc-csc");
  });
  it("classifies card number by name and Luhn-validates", () => {
    expect(classifyField({ name: "cardnumber", value: VISA })).toBe("cc-number");
    expect(classifyField({ name: "kartennummer", value: MC })).toBe("cc-number");
    expect(classifyField({ name: "cardnumber", value: "" })).toBeNull();
  });
  it("classifies expiry forms", () => {
    expect(classifyField({ name: "expiry" })).toBe("cc-exp");
    expect(classifyField({ placeholder: "MM/YY" })).toBe("cc-exp");
    expect(classifyField({ label: "Ablauf Monat" })).toBe("cc-exp-month");
  });
  it("classifies names (en + de)", () => {
    expect(classifyField({ name: "first_name" })).toBe("given-name");
    expect(classifyField({ id: "vorname" })).toBe("given-name");
    expect(classifyField({ name: "lastName" })).toBe("family-name");
    expect(classifyField({ id: "nachname" })).toBe("family-name");
  });
  it("classifies address parts (en + de)", () => {
    expect(classifyField({ name: "street" })).toBe("street-address");
    expect(classifyField({ name: "strasse" })).toBe("street-address");
    expect(classifyField({ name: "zip" })).toBe("postal-code");
    expect(classifyField({ name: "plz" })).toBe("postal-code");
    expect(classifyField({ name: "city" })).toBe("address-level2");
    expect(classifyField({ name: "stadt" })).toBe("address-level2");
  });
  it("does not classify non-text input types", () => {
    expect(classifyField({ name: "cardnumber", type: "checkbox", value: VISA })).toBeNull();
    expect(classifyField({ name: "first_name", type: "password" })).toBeNull();
  });
  it("returns null for unrelated fields", () => {
    expect(classifyField({ name: "search" })).toBeNull();
    expect(classifyField({})).toBeNull();
  });
});

describe("luhnValid", () => {
  it("accepts known-good numbers", () => {
    for (const n of [VISA, MC, MC2, AMEX, DISCOVER]) expect(luhnValid(n)).toBe(true);
  });
  it("rejects bad numbers and too-short input", () => {
    expect(luhnValid("4242424242424241")).toBe(false);
    expect(luhnValid("4111")).toBe(false);
  });
  it("ignores spaces and dashes", () => {
    expect(luhnValid("4242 4242 4242 4242")).toBe(true);
  });
});

describe("detectCardBrand", () => {
  it("detects brands from the IIN prefix", () => {
    expect(detectCardBrand(VISA)).toBe("visa");
    expect(detectCardBrand(MC)).toBe("mastercard");
    expect(detectCardBrand(MC2)).toBe("mastercard");
    expect(detectCardBrand(AMEX)).toBe("amex");
    expect(detectCardBrand(DISCOVER)).toBe("discover");
  });
  it("returns empty for unknown prefixes", () => {
    expect(detectCardBrand("9999999999999999")).toBe("");
    expect(detectCardBrand("")).toBe("");
  });
});

describe("expiry normalisation", () => {
  it("formats month + year into MM/YY", () => {
    expect(formatExpiry("8", "2027")).toBe("08/27");
    expect(formatExpiry("12", "27")).toBe("12/27");
    expect(formatExpiry("", "27")).toBe("");
  });
  it("normalises combined expiry shapes", () => {
    expect(normalizeCombinedExpiry("08/27")).toBe("08/27");
    expect(normalizeCombinedExpiry("8/2027")).toBe("08/27");
    expect(normalizeCombinedExpiry("08-2027")).toBe("08/27");
    expect(normalizeCombinedExpiry("0827")).toBe("08/27");
    expect(normalizeCombinedExpiry("garbage")).toBe("");
  });
});

describe("splitFullName", () => {
  it("splits on the last space", () => {
    expect(splitFullName("Jane Doe")).toEqual({ firstName: "Jane", lastName: "Doe" });
    expect(splitFullName("Mary Jane Watson")).toEqual({
      firstName: "Mary Jane",
      lastName: "Watson",
    });
    expect(splitFullName("Cher")).toEqual({ firstName: "Cher", lastName: "" });
    expect(splitFullName("")).toEqual({ firstName: "", lastName: "" });
  });
});

describe("group thresholds", () => {
  it("requires number + (exp|cvv|name) for a card group", () => {
    expect(hasCardGroup([{ kind: "cc-number", value: VISA }])).toBe(false);
    expect(
      hasCardGroup([
        { kind: "cc-number", value: VISA },
        { kind: "cc-csc", value: "123" },
      ]),
    ).toBe(true);
    expect(
      hasCardGroup([
        { kind: "cc-number", value: VISA },
        { kind: "cc-exp", value: "08/27" },
      ]),
    ).toBe(true);
    expect(hasCardGroup([{ kind: "cc-csc", value: "123" }])).toBe(false);
  });

  it("counts distinct identity attributes, collapsing name parts", () => {
    const fields: ClassifiedValue[] = [
      { kind: "given-name", value: "Jane" },
      { kind: "family-name", value: "Doe" },
      { kind: "street-address", value: "1 Main St" },
    ];
    // name + street = 2 distinct, so not a group yet.
    expect(distinctIdentityAttributes(fields)).toBe(2);
    expect(hasIdentityGroup(fields)).toBe(false);
  });

  it("treats name + street + city as an identity group", () => {
    const fields: ClassifiedValue[] = [
      { kind: "given-name", value: "Jane" },
      { kind: "family-name", value: "Doe" },
      { kind: "street-address", value: "1 Main St" },
      { kind: "address-level2", value: "Berlin" },
    ];
    expect(distinctIdentityAttributes(fields)).toBe(3);
    expect(hasIdentityGroup(fields)).toBe(true);
  });

  it("ignores empty values when counting", () => {
    const fields: ClassifiedValue[] = [
      { kind: "email", value: "a@b.com" },
      { kind: "tel", value: "" },
      { kind: "postal-code", value: "" },
    ];
    expect(hasIdentityGroup(fields)).toBe(false);
  });
});

describe("payload builders (web-compatible shapes)", () => {
  it("builds a credit_card payload with normalised expiry and brand", () => {
    const data = buildCreditCardData([
      { kind: "cc-name", value: "Jane Doe" },
      { kind: "cc-number", value: "4242 4242 4242 4242" },
      { kind: "cc-exp-month", value: "8" },
      { kind: "cc-exp-year", value: "2027" },
      { kind: "cc-csc", value: "123" },
    ]);
    expect(data).toEqual({
      cardholderName: "Jane Doe",
      number: "4242 4242 4242 4242",
      expiry: "08/27",
      cvv: "123",
      cardType: "visa",
      notes: "",
      customFields: [],
    });
  });

  it("builds an identity payload and splits a full name when no parts exist", () => {
    const data = buildIdentityData([
      { kind: "full-name", value: "Jane Doe" },
      { kind: "email", value: "jane@example.com" },
      { kind: "street-address", value: "1 Main St" },
      { kind: "address-level2", value: "Berlin" },
      { kind: "postal-code", value: "10115" },
    ]);
    expect(data.firstName).toBe("Jane");
    expect(data.lastName).toBe("Doe");
    expect(data.email).toBe("jane@example.com");
    expect(data.city).toBe("Berlin");
    expect(data.postalCode).toBe("10115");
    expect(data.ssn).toBe("");
    expect(data.customFields).toEqual([]);
  });
});

describe("titles", () => {
  it("renders a masked card title", () => {
    expect(
      cardTitle({
        cardholderName: "",
        number: VISA,
        expiry: "",
        cvv: "",
        cardType: "visa",
        notes: "",
        customFields: [],
      }),
    ).toBe("Visa •••• 4242");
  });
  it("falls back to a generic card label without a number", () => {
    expect(
      cardTitle({
        cardholderName: "",
        number: "",
        expiry: "",
        cvv: "",
        cardType: "",
        notes: "",
        customFields: [],
      }),
    ).toBe("Card");
  });
  it("renders First Last for identity", () => {
    expect(
      identityTitle({
        firstName: "Jane",
        lastName: "Doe",
        email: "",
        phone: "",
        address: "",
        city: "",
        state: "",
        country: "",
        postalCode: "",
        ssn: "",
        passportNumber: "",
        licenseNumber: "",
        notes: "",
        customFields: [],
      }),
    ).toBe("Jane Doe");
  });
});
