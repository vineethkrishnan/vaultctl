/**
 * 1Password 1PUX importer.
 *
 * A .1pux file is a ZIP bundle containing (among other things) export.data —
 * a JSON document with this rough shape:
 *
 *   {
 *     "accounts": [
 *       {
 *         "attrs": { "name": "…" },
 *         "vaults": [
 *           {
 *             "attrs": { "name": "…" },
 *             "items": [
 *               {
 *                 "overview": { "title": "…", "url": "…" },
 *                 "details": {
 *                   "loginFields": [ { "designation": "username|password", "value": "…" } ],
 *                   "notesPlain": "…",
 *                   "sections": [ { "fields": [ { "title": "…", "value": { "string": "…" } } ] } ]
 *                 },
 *                 "categoryUuid": "001" (login) | "003" (secure note) | …
 *               }
 *             ]
 *           }
 *         ]
 *       }
 *     ]
 *   }
 *
 * We narrow this via zod at the boundary and emit ParsedItem entries. Fields
 * we don't recognise get ignored rather than crashing.
 */

import { z } from "zod";

import { parsedItemArraySchema, type Importer, type ParsedItem } from "./types.js";
import { inputToBytes } from "./csv.js";
import { findEntry, readZip } from "./zip.js";

// Category UUIDs 1Password uses in its exports. Others fall through to a
// secure note with whatever text we can extract.
const CATEGORY_LOGIN = "001";
const CATEGORY_CREDIT_CARD = "002";
const CATEGORY_SECURE_NOTE = "003";
const CATEGORY_IDENTITY = "004";
const CATEGORY_PASSWORD = "005";

const loginFieldSchema = z.object({
  designation: z.string().optional(),
  value: z.string().optional(),
});

const sectionFieldValueSchema = z.object({
  string: z.string().optional(),
  concealed: z.string().optional(),
  email: z.string().optional(),
  url: z.string().optional(),
  totp: z.string().optional(),
  date: z.number().optional(),
  monthYear: z.number().optional(),
});

const sectionFieldSchema = z.object({
  title: z.string().optional(),
  value: sectionFieldValueSchema.optional(),
});

const sectionSchema = z.object({
  title: z.string().optional(),
  fields: z.array(sectionFieldSchema).optional(),
});

const detailsSchema = z.object({
  loginFields: z.array(loginFieldSchema).optional(),
  notesPlain: z.string().optional(),
  password: z.string().optional(),
  sections: z.array(sectionSchema).optional(),
});

const overviewSchema = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  urls: z
    .array(
      z.object({
        label: z.string().optional(),
        url: z.string().optional(),
      }),
    )
    .optional(),
});

const itemSchema = z.object({
  uuid: z.string().optional(),
  categoryUuid: z.string().optional(),
  overview: overviewSchema.optional(),
  details: detailsSchema.optional(),
});

const vaultSchema = z.object({
  attrs: z.object({ name: z.string().optional() }).optional(),
  items: z.array(itemSchema).optional(),
});

const accountSchema = z.object({
  attrs: z.object({ name: z.string().optional() }).optional(),
  vaults: z.array(vaultSchema).optional(),
});

const exportDataSchema = z.object({
  accounts: z.array(accountSchema).optional(),
});

// ===========================================================================
// Parser
// ===========================================================================

export async function parse(input: File | string | Uint8Array): Promise<ParsedItem[]> {
  const bytes = await inputToBytes(input);
  const entries = await readZip(bytes);
  const exportData = findEntry(entries, "export.data");
  if (!exportData) {
    throw new Error("onepassword-1pux: export.data missing from bundle");
  }
  const json = new TextDecoder().decode(exportData);
  return parsedItemArraySchema.parse(parseOnePassword1PUX(json));
}

/** Core mapping from a decoded export.data JSON string to ParsedItem[]. */
export function parseOnePassword1PUX(json: string): ParsedItem[] {
  const raw: unknown = JSON.parse(json);
  const parsed = exportDataSchema.parse(raw);

  const items: ParsedItem[] = [];
  for (const account of parsed.accounts ?? []) {
    for (const vault of account.vaults ?? []) {
      for (const item of vault.items ?? []) {
        const mapped = mapItem(item);
        if (mapped) items.push(mapped);
      }
    }
  }
  return items;
}

type OnePasswordItem = z.infer<typeof itemSchema>;

function mapItem(item: OnePasswordItem): ParsedItem | null {
  const title = item.overview?.title ?? "";
  const name = title.length > 0 ? title : "Untitled";

  if (item.categoryUuid === CATEGORY_LOGIN || item.categoryUuid === CATEGORY_PASSWORD) {
    return {
      name,
      type: "login",
      data: {
        username: loginField(item, "username"),
        password: loginField(item, "password") || (item.details?.password ?? ""),
        uri: primaryUrl(item),
        totp: sectionTotp(item),
        notes: item.details?.notesPlain ?? "",
        customFields: collectCustomFields(item),
      },
    };
  }

  if (item.categoryUuid === CATEGORY_SECURE_NOTE) {
    return {
      name,
      type: "secure_note",
      data: {
        content: item.details?.notesPlain ?? "",
        notes: "",
        customFields: collectCustomFields(item),
      },
    };
  }

  if (item.categoryUuid === CATEGORY_CREDIT_CARD) {
    return {
      name,
      type: "credit_card",
      data: {
        cardholderName: findSectionValue(item, ["cardholder", "cardholder name"]),
        number: findSectionValue(item, ["number", "ccnum"]),
        expiry: findSectionValue(item, ["expiry", "expiration", "expires"]),
        cvv: findSectionValue(item, ["cvv", "verification number", "code"]),
        cardType: findSectionValue(item, ["type", "cardtype"]),
        notes: item.details?.notesPlain ?? "",
        customFields: collectCustomFields(item),
      },
    };
  }

  if (item.categoryUuid === CATEGORY_IDENTITY) {
    return {
      name,
      type: "identity",
      data: {
        firstName: findSectionValue(item, ["firstname", "first name"]),
        lastName: findSectionValue(item, ["lastname", "last name"]),
        email: findSectionValue(item, ["email"]),
        phone: findSectionValue(item, ["phone", "defaultphone"]),
        address: findSectionValue(item, ["address"]),
        city: findSectionValue(item, ["city"]),
        state: findSectionValue(item, ["state"]),
        country: findSectionValue(item, ["country"]),
        postalCode: findSectionValue(item, ["zip", "postal", "postcode"]),
        ssn: findSectionValue(item, ["ssn"]),
        passportNumber: "",
        licenseNumber: "",
        notes: item.details?.notesPlain ?? "",
        customFields: collectCustomFields(item),
      },
    };
  }

  // Unknown category — degrade to secure note with notesPlain as content.
  const notes = item.details?.notesPlain ?? "";
  if (notes.length === 0 && title.length === 0) return null;
  return {
    name,
    type: "secure_note",
    data: {
      content: notes,
      notes: "",
      customFields: collectCustomFields(item),
    },
  };
}

function loginField(item: OnePasswordItem, designation: string): string {
  const fields = item.details?.loginFields ?? [];
  for (const field of fields) {
    if (field.designation === designation && typeof field.value === "string") {
      return field.value;
    }
  }
  return "";
}

function primaryUrl(item: OnePasswordItem): string {
  if (item.overview?.url && item.overview.url.length > 0) return item.overview.url;
  const urls = item.overview?.urls ?? [];
  for (const entry of urls) {
    if (entry.url && entry.url.length > 0) return entry.url;
  }
  return "";
}

function sectionTotp(item: OnePasswordItem): string {
  for (const section of item.details?.sections ?? []) {
    for (const field of section.fields ?? []) {
      if (field.value?.totp) return field.value.totp;
    }
  }
  return "";
}

function findSectionValue(item: OnePasswordItem, needles: readonly string[]): string {
  for (const section of item.details?.sections ?? []) {
    for (const field of section.fields ?? []) {
      const title = (field.title ?? "").toLowerCase();
      if (needles.some((needle) => title.includes(needle))) {
        return fieldValueAsString(field.value);
      }
    }
  }
  return "";
}

function fieldValueAsString(value: z.infer<typeof sectionFieldValueSchema> | undefined): string {
  if (!value) return "";
  return (
    value.string ??
    value.concealed ??
    value.email ??
    value.url ??
    value.totp ??
    ""
  );
}

function collectCustomFields(
  item: OnePasswordItem,
): Array<{ name: string; value: string; type: "text" }> {
  const fields: Array<{ name: string; value: string; type: "text" }> = [];
  for (const section of item.details?.sections ?? []) {
    for (const field of section.fields ?? []) {
      const title = field.title ?? "";
      const stringValue = fieldValueAsString(field.value);
      if (title.length > 0 && stringValue.length > 0) {
        fields.push({ name: title, value: stringValue, type: "text" });
      }
    }
  }
  return fields;
}

export const importer: Importer = {
  id: "onepassword-1pux",
  label: "1Password (1PUX)",
  accept: ".1pux,application/zip",
  parse,
};
