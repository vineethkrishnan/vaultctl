/**
 * Bitwarden CSV importer.
 *
 * Bitwarden's "unencrypted CSV" export columns:
 *   folder, favorite, type, name, notes, fields, reprompt,
 *   login_uri, login_username, login_password, login_totp
 * Card and identity types add additional card_* / identity_* columns.
 *
 * Behaviour preserved from the original parseBitwardenCSV that lived inside
 * ImportDialog.tsx.
 */

import { parsedItemArraySchema, type Importer, type ParsedItem } from "./types.js";
import { csvRowToString, inputToText, parseCSV, parseCSVRow } from "./csv.js";

export async function parse(input: File | string | Uint8Array): Promise<ParsedItem[]> {
  const text = await inputToText(input);
  return parsedItemArraySchema.parse(parseBitwardenCSV(text));
}

/** Synchronous core parser — exposed for tests and round-tripping. */
export function parseBitwardenCSV(csv: string): ParsedItem[] {
  const rows = parseCSV(csv);
  if (rows.length < 2) return [];

  const headerRow = rows[0];
  if (!headerRow) return [];
  const headers = headerRow.map((header) => header.trim().toLowerCase());

  const items: ParsedItem[] = [];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const cols = rows[rowIndex];
    if (!cols) continue;

    const row: Record<string, string> = {};
    headers.forEach((header, columnIndex) => {
      row[header] = cols[columnIndex] ?? "";
    });

    const bwType = (row["type"] ?? "").toLowerCase();
    const name = row["name"] && row["name"].length > 0 ? row["name"] : "Untitled";

    if (bwType === "login" || bwType === "1") {
      items.push({
        name,
        type: "login",
        data: {
          username: row["login_username"] ?? "",
          password: row["login_password"] ?? "",
          uri: row["login_uri"] ?? "",
          totp: row["login_totp"] ?? "",
          notes: row["notes"] ?? "",
          customFields: [],
        },
      });
      continue;
    }

    if (bwType === "note" || bwType === "securenote" || bwType === "2") {
      items.push({
        name,
        type: "secure_note",
        data: {
          content: row["notes"] ?? "",
          notes: "",
          customFields: [],
        },
      });
      continue;
    }

    if (bwType === "card" || bwType === "3") {
      const expMonth = row["card_expmonth"] ?? "";
      const expYear = row["card_expyear"] ?? "";
      items.push({
        name,
        type: "credit_card",
        data: {
          cardholderName: row["card_cardholdername"] ?? "",
          number: row["card_number"] ?? "",
          expiry: expMonth && expYear ? `${expMonth}/${expYear.slice(-2)}` : "",
          cvv: row["card_code"] ?? "",
          cardType: row["card_brand"] ?? "",
          notes: row["notes"] ?? "",
          customFields: [],
        },
      });
      continue;
    }

    if (bwType === "identity" || bwType === "4") {
      const address1 = row["identity_address1"] ?? "";
      const address2 = row["identity_address2"] ?? "";
      items.push({
        name,
        type: "identity",
        data: {
          firstName: row["identity_firstname"] ?? "",
          lastName: row["identity_lastname"] ?? "",
          email: row["identity_email"] ?? "",
          phone: row["identity_phone"] ?? "",
          address: [address1, address2].filter((segment) => segment.length > 0).join(", "),
          city: row["identity_city"] ?? "",
          state: row["identity_state"] ?? "",
          country: row["identity_country"] ?? "",
          postalCode: row["identity_postalcode"] ?? "",
          ssn: row["identity_ssn"] ?? "",
          passportNumber: row["identity_passportnumber"] ?? "",
          licenseNumber: row["identity_licensenumber"] ?? "",
          notes: row["notes"] ?? "",
          customFields: [],
        },
      });
      continue;
    }

    // Unknown types fall back to secure note to preserve whatever data is
    // present in the notes column rather than silently dropping the row.
    items.push({
      name,
      type: "secure_note",
      data: {
        content: row["notes"] ?? "",
        notes: "",
        customFields: [],
      },
    });
  }

  return items;
}

/**
 * Serialize ParsedItem[] back to Bitwarden CSV format. Used by the
 * round-trip integrity test. Not intended for production use.
 */
export function serializeBitwardenCSV(items: readonly ParsedItem[]): string {
  const headers = [
    "folder",
    "favorite",
    "type",
    "name",
    "notes",
    "fields",
    "reprompt",
    "login_uri",
    "login_username",
    "login_password",
    "login_totp",
    "card_cardholdername",
    "card_number",
    "card_expmonth",
    "card_expyear",
    "card_code",
    "card_brand",
    "identity_firstname",
    "identity_lastname",
    "identity_email",
    "identity_phone",
    "identity_address1",
    "identity_city",
    "identity_state",
    "identity_country",
    "identity_postalcode",
    "identity_ssn",
    "identity_passportnumber",
    "identity_licensenumber",
  ];

  const lines: string[] = [csvRowToString(headers)];

  for (const item of items) {
    const row: Record<string, string> = Object.fromEntries(headers.map((header) => [header, ""]));
    row["name"] = item.name;

    if (item.type === "login") {
      row["type"] = "login";
      row["login_username"] = stringField(item.data, "username");
      row["login_password"] = stringField(item.data, "password");
      row["login_uri"] = stringField(item.data, "uri");
      row["login_totp"] = stringField(item.data, "totp");
      row["notes"] = stringField(item.data, "notes");
    } else if (item.type === "secure_note") {
      row["type"] = "note";
      row["notes"] = stringField(item.data, "content");
    } else if (item.type === "credit_card") {
      row["type"] = "card";
      row["card_cardholdername"] = stringField(item.data, "cardholderName");
      row["card_number"] = stringField(item.data, "number");
      row["card_code"] = stringField(item.data, "cvv");
      row["card_brand"] = stringField(item.data, "cardType");
      row["notes"] = stringField(item.data, "notes");
      const expiry = stringField(item.data, "expiry");
      if (expiry.includes("/")) {
        const parts = expiry.split("/");
        row["card_expmonth"] = parts[0] ?? "";
        row["card_expyear"] = parts[1] ?? "";
      }
    } else if (item.type === "identity") {
      row["type"] = "identity";
      row["identity_firstname"] = stringField(item.data, "firstName");
      row["identity_lastname"] = stringField(item.data, "lastName");
      row["identity_email"] = stringField(item.data, "email");
      row["identity_phone"] = stringField(item.data, "phone");
      row["identity_address1"] = stringField(item.data, "address");
      row["identity_city"] = stringField(item.data, "city");
      row["identity_state"] = stringField(item.data, "state");
      row["identity_country"] = stringField(item.data, "country");
      row["identity_postalcode"] = stringField(item.data, "postalCode");
      row["identity_ssn"] = stringField(item.data, "ssn");
      row["identity_passportnumber"] = stringField(item.data, "passportNumber");
      row["identity_licensenumber"] = stringField(item.data, "licenseNumber");
      row["notes"] = stringField(item.data, "notes");
    }

    lines.push(csvRowToString(headers.map((header) => row[header] ?? "")));
  }

  return `${lines.join("\n")}\n`;
}

function stringField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === "string" ? value : "";
}

// Re-export parseCSVRow for tests covering the legacy single-row helper.
export { parseCSVRow };

export const importer: Importer = {
  id: "bitwarden-csv",
  label: "Bitwarden (CSV)",
  accept: ".csv,text/csv",
  parse,
};
