// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * KeePass 2.x XML importer.
 *
 * KeePass XML structure (abbreviated):
 *   <KeePassFile>
 *     <Root>
 *       <Group>
 *         <Name>...</Name>
 *         <Group>...</Group>          (nested subgroups)
 *         <Entry>
 *           <String>
 *             <Key>Title</Key>
 *             <Value>...</Value>
 *           </String>
 *           <String>
 *             <Key>UserName</Key>
 *             <Value>...</Value>
 *           </String>
 *           ...Password / URL / Notes / arbitrary custom keys...
 *         </Entry>
 *       </Group>
 *     </Root>
 *   </KeePassFile>
 *
 * We collect every <Entry> node anywhere in the tree and map the core
 * String/Key/Value pairs to ParsedItem fields. Extra String entries become
 * customFields.
 */

import { parsedItemArraySchema, type Importer, type ParsedItem } from "./types.js";
import { inputToText } from "./csv.js";

// ===========================================================================
// Minimal XML parser (elements + text + CDATA + entity decoding only)
// ===========================================================================

interface XmlNode {
  name: string;
  children: XmlNode[];
  text: string;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: "#root", children: [], text: "" };
  const stack: XmlNode[] = [root];
  let index = 0;

  while (index < source.length) {
    const ch = source[index];

    // CDATA section
    if (ch === "<" && source.startsWith("<![CDATA[", index)) {
      const end = source.indexOf("]]>", index + 9);
      if (end < 0) break;
      const current = stack[stack.length - 1];
      if (current) {
        current.text += source.slice(index + 9, end);
      }
      index = end + 3;
      continue;
    }

    // Comment
    if (ch === "<" && source.startsWith("<!--", index)) {
      const end = source.indexOf("-->", index + 4);
      if (end < 0) break;
      index = end + 3;
      continue;
    }

    // Processing instruction / DOCTYPE
    if (ch === "<" && (source[index + 1] === "?" || source[index + 1] === "!")) {
      const end = source.indexOf(">", index);
      if (end < 0) break;
      index = end + 1;
      continue;
    }

    // Closing tag
    if (ch === "<" && source[index + 1] === "/") {
      const end = source.indexOf(">", index);
      if (end < 0) break;
      stack.pop();
      index = end + 1;
      continue;
    }

    // Opening tag
    if (ch === "<") {
      const end = source.indexOf(">", index);
      if (end < 0) break;
      const raw = source.slice(index + 1, end);
      const selfClosing = raw.endsWith("/");
      const inner = selfClosing ? raw.slice(0, -1).trim() : raw.trim();
      const spaceIndex = inner.search(/\s/);
      const name = spaceIndex < 0 ? inner : inner.slice(0, spaceIndex);
      const node: XmlNode = { name, children: [], text: "" };
      const parent = stack[stack.length - 1];
      if (parent) {
        parent.children.push(node);
      }
      if (!selfClosing) {
        stack.push(node);
      }
      index = end + 1;
      continue;
    }

    // Text content
    const nextTag = source.indexOf("<", index);
    const textEnd = nextTag < 0 ? source.length : nextTag;
    const current = stack[stack.length - 1];
    if (current) {
      current.text += decodeEntities(source.slice(index, textEnd));
    }
    index = textEnd;
  }

  return root;
}

function findAll(node: XmlNode, tagName: string, sink: XmlNode[]): void {
  for (const child of node.children) {
    if (child.name === tagName) {
      sink.push(child);
    }
    if (child.children.length > 0) {
      findAll(child, tagName, sink);
    }
  }
}

function firstChild(node: XmlNode, tagName: string): XmlNode | undefined {
  for (const child of node.children) {
    if (child.name === tagName) return child;
  }
  return undefined;
}

function childText(node: XmlNode, tagName: string): string {
  const child = firstChild(node, tagName);
  return child ? child.text.trim() : "";
}

// ===========================================================================
// KeePass-specific mapping
// ===========================================================================

interface KeePassEntry {
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  customFields: Array<{ name: string; value: string; type: "text" }>;
}

function entryFromXml(entryNode: XmlNode): KeePassEntry {
  const entry: KeePassEntry = {
    title: "",
    username: "",
    password: "",
    url: "",
    notes: "",
    customFields: [],
  };

  for (const stringNode of entryNode.children) {
    if (stringNode.name !== "String") continue;
    const key = childText(stringNode, "Key");
    const value = childText(stringNode, "Value");

    switch (key) {
      case "Title":
        entry.title = value;
        break;
      case "UserName":
        entry.username = value;
        break;
      case "Password":
        entry.password = value;
        break;
      case "URL":
        entry.url = value;
        break;
      case "Notes":
        entry.notes = value;
        break;
      default:
        if (key.length > 0) {
          entry.customFields.push({ name: key, value, type: "text" });
        }
    }
  }

  return entry;
}

export async function parse(input: File | string | Uint8Array): Promise<ParsedItem[]> {
  const text = await inputToText(input);
  return parsedItemArraySchema.parse(parseKeePassXML(text));
}

export function parseKeePassXML(xml: string): ParsedItem[] {
  const document = parseXml(xml);
  const entries: XmlNode[] = [];
  findAll(document, "Entry", entries);

  const items: ParsedItem[] = [];

  for (const entryNode of entries) {
    const entry = entryFromXml(entryNode);
    const name = entry.title.length > 0 ? entry.title : "Untitled";
    const hasCredentials =
      entry.username.length > 0 || entry.password.length > 0 || entry.url.length > 0;

    if (!hasCredentials && entry.notes.length > 0) {
      items.push({
        name,
        type: "secure_note",
        data: {
          content: entry.notes,
          notes: "",
          customFields: entry.customFields,
        },
      });
      continue;
    }

    items.push({
      name,
      type: "login",
      data: {
        username: entry.username,
        password: entry.password,
        uri: entry.url,
        totp: "",
        notes: entry.notes,
        customFields: entry.customFields,
      },
    });
  }

  return items;
}

export const importer: Importer = {
  id: "keepass-xml",
  label: "KeePass (XML)",
  accept: ".xml,text/xml,application/xml",
  parse,
};
