// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

// OData query options: parsing and filter evaluation. Only what the Toolbox uses is supported
// (docs/webapi-surface.md); anything else throws UnsupportedError with the request in the message,
// never an empty result.

export class UnsupportedError extends Error {
  constructor(what: string) {
    super(`Simulator: ${what} isn't supported yet.`);
    this.name = "UnsupportedError";
  }
}

export interface Expand { navigation: string; select?: string[] }
export interface OrderBy { column: string; descending: boolean }

export interface Query {
  select?: string[];
  filter?: Expr;
  expand: Expand[];
  orderBy: OrderBy[];
  top?: number;
  skip: number;
}

export type Literal = string | number | boolean | null;
export type Expr =
  | { kind: "and" | "or"; left: Expr; right: Expr }
  | { kind: "not"; operand: Expr }
  | { kind: "compare"; op: "eq" | "ne" | "gt" | "ge" | "lt" | "le"; left: Operand; right: Operand }
  | { kind: "call"; name: "contains" | "startswith" | "endswith"; column: string; value: string };
export type Operand = { kind: "column"; name: string } | { kind: "literal"; value: Literal; literalKind: "string" | "guid" | "datetime" | "number" | "bool" | "null" };

const KNOWN_OPTIONS = new Set(["$select", "$filter", "$expand", "$orderby", "$top", "$skiptoken"]);

const decode = (value: string): string => {
  try { return decodeURIComponent(value.replace(/\+/g, "%20")); } catch { return value; }
};

// Splits on a separator outside parentheses and quotes.
function splitTop(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0, quoted = false, start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") quoted = !quoted;
    else if (!quoted && ch === "(") depth++;
    else if (!quoted && ch === ")") depth--;
    else if (!quoted && depth === 0 && ch === separator) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}

export function parseQuery(queryString: string | undefined): Query {
  const query: Query = { expand: [], orderBy: [], skip: 0 };
  const text = (queryString ?? "").replace(/^\?/, "");
  if (!text) return query;
  for (const part of splitTop(text, "&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const name = decode(eq < 0 ? part : part.slice(0, eq));
    const value = decode(eq < 0 ? "" : part.slice(eq + 1));
    if (name === "fetchXml") throw new UnsupportedError("fetchXml");
    if (!KNOWN_OPTIONS.has(name)) throw new UnsupportedError(name.startsWith("$") ? name : `the query option “${name}”`);
    applyOption(query, name, value);
  }
  return query;
}

function applyOption(query: Query, name: string, value: string): void {
  switch (name) {
    case "$select": query.select = value.split(",").map((s) => s.trim()).filter(Boolean); break;
    case "$filter": query.filter = parseFilter(value); break;
    case "$expand": query.expand = splitTop(value, ",").map(parseExpand); break;
    case "$orderby":
      query.orderBy = value.split(",").map((s) => {
        const [column, direction] = s.trim().split(/\s+/);
        if (direction && !/^(asc|desc)$/i.test(direction)) throw new UnsupportedError(`$orderby “${s}”`);
        return { column, descending: /^desc$/i.test(direction ?? "") };
      });
      break;
    case "$top": query.top = Number(value); if (!Number.isInteger(query.top) || query.top < 0) throw new UnsupportedError(`$top=${value}`); break;
    case "$skiptoken": query.skip = Number(value) || 0; break;
  }
}

function parseExpand(text: string): Expand {
  const match = text.trim().match(/^([\w.]+)(?:\((.*)\))?$/s);
  if (!match) throw new UnsupportedError(`$expand “${text}”`);
  const expand: Expand = { navigation: match[1] };
  if (match[2]) {
    for (const option of splitTop(match[2], ";")) {
      const [name, value] = [option.slice(0, option.indexOf("=")), option.slice(option.indexOf("=") + 1)];
      if (name !== "$select") throw new UnsupportedError(`${name || option} inside $expand`);
      expand.select = value.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return expand;
}

// ---- $filter ----

type Token = { type: "ident" | "string" | "guid" | "datetime" | "number" | "(" | ")" | ","; text: string };

const GUID = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?/i;
const DATETIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?/;
const NUMBER = /^-?\d+(\.\d+)?/;
const IDENT = /^[A-Za-z_@$][\w.@/$]*/;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let rest = text;
  while ((rest = rest.trimStart())) {
    const ch = rest[0];
    if (ch === "(" || ch === ")" || ch === ",") { tokens.push({ type: ch, text: ch }); rest = rest.slice(1); continue; }
    if (ch === "'") {
      let i = 1, value = "";
      for (; i < rest.length; i++) {
        if (rest[i] === "'" && rest[i + 1] === "'") { value += "'"; i++; } else if (rest[i] === "'") break; else value += rest[i];
      }
      if (i >= rest.length) throw new UnsupportedError(`$filter with an unclosed quote (“${text}”)`);
      tokens.push({ type: "string", text: value });
      rest = rest.slice(i + 1);
      continue;
    }
    const m = rest.match(GUID) ?? undefined;
    if (m) { tokens.push({ type: "guid", text: m[0] }); rest = rest.slice(m[0].length); continue; }
    const d = rest.match(DATETIME);
    if (d && d[0].length > 4) { tokens.push({ type: "datetime", text: d[0] }); rest = rest.slice(d[0].length); continue; }
    const n = rest.match(NUMBER);
    if (n) { tokens.push({ type: "number", text: n[0] }); rest = rest.slice(n[0].length); continue; }
    const id = rest.match(IDENT);
    if (id) { tokens.push({ type: "ident", text: id[0] }); rest = rest.slice(id[0].length); continue; }
    throw new UnsupportedError(`$filter “${text}”`);
  }
  return tokens;
}

export function parseFilter(text: string): Expr {
  const tokens = tokenize(text);
  let pos = 0;
  const peek = () => tokens[pos];
  const isWord = (word: string) => peek()?.type === "ident" && peek().text.toLowerCase() === word;
  const expect = (type: Token["type"]) => {
    if (peek()?.type !== type) throw new UnsupportedError(`$filter “${text}”`);
    return tokens[pos++];
  };

  const operand = (): Operand => {
    const t = tokens[pos++];
    if (!t) throw new UnsupportedError(`$filter “${text}”`);
    switch (t.type) {
      case "string": return { kind: "literal", value: t.text, literalKind: "string" };
      case "guid": return { kind: "literal", value: t.text.replace(/[{}]/g, "").toLowerCase(), literalKind: "guid" };
      case "datetime": return { kind: "literal", value: t.text, literalKind: "datetime" };
      case "number": return { kind: "literal", value: Number(t.text), literalKind: "number" };
      case "ident": {
        const word = t.text.toLowerCase();
        if (word === "true" || word === "false") return { kind: "literal", value: word === "true", literalKind: "bool" };
        if (word === "null") return { kind: "literal", value: null, literalKind: "null" };
        if (t.text.includes("/")) throw new UnsupportedError(`filtering on a related table (“${t.text}”)`);
        return { kind: "column", name: t.text };
      }
      default: throw new UnsupportedError(`$filter “${text}”`);
    }
  };

  const primary = (): Expr => {
    if (peek()?.type === "(") { pos++; const e = or(); expect(")"); return e; }
    if (isWord("not")) { pos++; return { kind: "not", operand: primary() }; }
    if (peek()?.type === "ident" && tokens[pos + 1]?.type === "(") {
      const name = tokens[pos].text.toLowerCase();
      if (name !== "contains" && name !== "startswith" && name !== "endswith") throw new UnsupportedError(`the filter function ${tokens[pos].text}()`);
      pos += 2;
      const column = expect("ident").text;
      expect(",");
      const value = expect("string").text;
      expect(")");
      return { kind: "call", name, column, value };
    }
    const left = operand();
    const opToken = tokens[pos++];
    const op = opToken?.text.toLowerCase();
    if (!op || !["eq", "ne", "gt", "ge", "lt", "le"].includes(op)) {
      throw new UnsupportedError(opToken ? `the filter operator “${opToken.text}”` : `$filter “${text}”`);
    }
    return { kind: "compare", op: op as any, left, right: operand() };
  };
  const and = (): Expr => {
    let e = primary();
    while (isWord("and")) { pos++; e = { kind: "and", left: e, right: primary() }; }
    return e;
  };
  const or = (): Expr => {
    let e = and();
    while (isWord("or")) { pos++; e = { kind: "or", left: e, right: and() }; }
    return e;
  };

  const expr = or();
  if (pos < tokens.length) throw new UnsupportedError(`$filter “${text}”`);
  return expr;
}

// The columns a filter reads, so the caller can check they exist.
export function filterColumns(expr: Expr): string[] {
  switch (expr.kind) {
    case "and": case "or": return [...filterColumns(expr.left), ...filterColumns(expr.right)];
    case "not": return filterColumns(expr.operand);
    case "call": return [expr.column];
    case "compare": return [expr.left, expr.right].flatMap((o) => (o.kind === "column" ? [o.name] : []));
  }
}

const GUID_VALUE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Dataverse compares text without regard to case, and GUIDs with or without braces.
function normalize(value: unknown, otherKind?: string): unknown {
  if (value === undefined) return null;
  if (typeof value === "string") {
    if (otherKind === "datetime") return Date.parse(value);
    const bare = value.replace(/[{}]/g, "");
    return GUID_VALUE.test(bare) ? bare.toLowerCase() : value.toLowerCase();
  }
  return value;
}

function compare(op: string, a: unknown, b: unknown): boolean {
  if (op === "eq") return a === b;
  if (op === "ne") return a !== b;
  if (a === null || b === null) return false;
  const x = a as any, y = b as any;
  return op === "gt" ? x > y : op === "ge" ? x >= y : op === "lt" ? x < y : x <= y;
}

export function evaluate(expr: Expr, row: Record<string, unknown>, read: (row: Record<string, unknown>, column: string) => unknown = (r, c) => r[c]): boolean {
  switch (expr.kind) {
    case "and": return evaluate(expr.left, row, read) && evaluate(expr.right, row, read);
    case "or": return evaluate(expr.left, row, read) || evaluate(expr.right, row, read);
    case "not": return !evaluate(expr.operand, row, read);
    case "call": {
      const value = read(row, expr.column);
      if (typeof value !== "string") return false;
      const [v, w] = [value.toLowerCase(), expr.value.toLowerCase()];
      return expr.name === "contains" ? v.includes(w) : expr.name === "startswith" ? v.startsWith(w) : v.endsWith(w);
    }
    case "compare": {
      const kindOf = (o: Operand) => (o.kind === "literal" ? o.literalKind : undefined);
      const value = (o: Operand, other: Operand) => o.kind === "column"
        ? normalize(read(row, o.name), kindOf(other))
        : o.literalKind === "datetime" ? Date.parse(o.value as string) : normalize(o.value);
      return compare(expr.op, value(expr.left, expr.right), value(expr.right, expr.left));
    }
  }
}
