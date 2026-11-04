// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { evaluate, filterColumns, parseQuery, Query, UnsupportedError } from "./odata";
import { Column, storageKey, Table, TABLES, tableByEntitySet } from "./schema";
import { afterCreate, Relationship, RELATIONSHIPS, stamp } from "./rules";
import { cleanId, Row, Store } from "./store";

// Answers Web API reads from the store, in the Web API's own shapes: Xrm.WebApi results, @odata.nextLink
// paging, lookup and option-set annotations, and { error: { code, message } } errors. Writes come in
// phase 2 and fail loudly until then.

export const FORMATTED = "@OData.Community.Display.V1.FormattedValue";
export const LOOKUP_TABLE = "@Microsoft.Dynamics.CRM.lookuplogicalname";
export const API_PATH = "/api/data/v9.2/";

// An error the way Dataverse reports it. `code` is Dataverse's hex error code.
export class WebApiError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
    this.name = "WebApiError";
  }
  get errorCode(): number { return parseInt(this.code, 16) | 0; }
}

const notFoundProperty = (name: string, table: string) =>
  new WebApiError(`Could not find a property named '${name}' on type 'Microsoft.Dynamics.CRM.${table}'.`, "0x0", 400);

export interface WebApiOptions {
  clientUrl: string;
  // The simulated clock, for createdon and modifiedon. Defaults to the real time.
  now?: () => Date;
  // Rows per page before @odata.nextLink. Dataverse uses 5000; tests use a small number so paging runs.
  pageSize?: number;
}

export interface RetrieveResult { entities: Row[]; nextLink?: string }

// EntityDefinitions, answered from the schema (the Context Variable Monitor and Visual Routing Tester ask it).
const METADATA: Table = {
  logicalName: "EntityDefinitions", entitySetName: "EntityDefinitions", primaryId: "MetadataId",
  columns: { MetadataId: { type: "guid" }, LogicalName: { type: "string" }, EntitySetName: { type: "string" }, PrimaryIdAttribute: { type: "string" }, PrimaryNameAttribute: { type: "string" } },
  navigation: {}
};
const metadataRows = (): Row[] => Object.values(TABLES).map((t, i) => ({
  MetadataId: `00000000-0000-4000-9000-${String(i + 1).padStart(12, "0")}`,
  LogicalName: t.logicalName, EntitySetName: t.entitySetName, PrimaryIdAttribute: t.primaryId, PrimaryNameAttribute: t.primaryName ?? null
}));

export class WebApi {
  readonly clientUrl: string;
  private pageSize: number;
  private now: () => Date;

  constructor(private store: Store, options: WebApiOptions) {
    this.clientUrl = options.clientUrl.replace(/\/$/, "");
    this.pageSize = options.pageSize ?? 5000;
    this.now = options.now ?? (() => new Date());
  }

  // ---- Xrm.WebApi ----

  retrieveMultiple(logicalName: string, queryString?: string, maxPageSize?: number): RetrieveResult {
    const table = this.table(logicalName);
    const query = parseQuery(queryString);
    const rows = this.select(table, query);
    const page = Math.min(maxPageSize ?? this.pageSize, this.pageSize);
    const start = query.skip;
    const entities = rows.slice(start, start + page).map((r) => this.shape(table, r, query.select, query.expand));
    const more = query.top === undefined && start + page < rows.length;
    return { entities, nextLink: more ? this.nextLink(table, queryString, start + page) : undefined };
  }

  retrieve(logicalName: string, id: string, queryString?: string): Row {
    const table = this.table(logicalName);
    const query = parseQuery(queryString);
    if (query.filter || query.orderBy.length || query.top !== undefined) throw new UnsupportedError("$filter, $orderby or $top on a single record");
    const row = this.rows(table).find((r) => r[table.primaryId] === cleanId(id));
    if (!row) throw new WebApiError(`${logicalName} With Id = ${cleanId(id)} Does Not Exist`, "0x80040217", 404);
    return this.shape(table, row, query.select, query.expand);
  }

  // ---- writes ----

  create(logicalName: string, payload: Row): string {
    const table = this.writable(logicalName);
    const row = this.toRow(table, payload);
    stamp(logicalName, row, true, this.now());
    const created = this.store.insert(logicalName, row);
    afterCreate(this.store, logicalName, created);
    return created[table.primaryId];
  }

  update(logicalName: string, id: string, payload: Row): void {
    const table = this.writable(logicalName);
    this.existing(table, id);
    const changes = this.toRow(table, payload);
    delete changes[table.primaryId];
    stamp(logicalName, changes, false, this.now());
    this.store.update(logicalName, id, changes);
  }

  remove(logicalName: string, id: string): void {
    const table = this.writable(logicalName);
    this.existing(table, id);
    this.store.remove(logicalName, id);
  }

  // N:N: POST <set>(id)/<relationship>/$ref with { "@odata.id": "<url of the other record>" }.
  associate(tableOrName: Table | string, id: string, relationshipName: string, otherUrl: string): void {
    const table = typeof tableOrName === "string" ? this.writable(tableOrName) : tableOrName;
    const { relationship, side } = this.relationship(table, relationshipName);
    const other = this.parseRecordUrl(otherUrl);
    const otherTable = relationship.tables[1 - side];
    if (other.table.logicalName !== otherTable) throw new WebApiError(`The relationship '${relationshipName}' doesn't link ${table.logicalName} to ${other.table.logicalName}.`, "0x80060891", 400);
    this.existing(table, id);
    this.existing(other.table, other.id);
    const pair: Row = { [relationship.columns[side]]: cleanId(id), [relationship.columns[1 - side]]: other.id };
    const already = this.store.table(relationship.intersect).some((r) => r[relationship.columns[0]] === pair[relationship.columns[0]] && r[relationship.columns[1]] === pair[relationship.columns[1]]);
    if (already) throw new WebApiError("Cannot insert duplicate key.", "0x80040237", 400);
    this.store.insert(relationship.intersect, pair);
  }

  disassociate(table: Table, id: string, relationshipName: string, otherId: string): void {
    const { relationship, side } = this.relationship(table, relationshipName);
    const [mine, theirs] = [relationship.columns[side], relationship.columns[1 - side]];
    const intersect = TABLES[relationship.intersect];
    const row = this.store.table(relationship.intersect).find((r) => r[mine] === cleanId(id) && r[theirs] === cleanId(otherId));
    if (row) this.store.remove(relationship.intersect, row[intersect.primaryId]);
  }

  // ---- fetch to <clientUrl>/api/data/v9.2/... ----

  handles(url: string): boolean {
    return url.startsWith(this.clientUrl + API_PATH);
  }

  async fetch(url: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }): Promise<Response> {
    const method = (init?.method ?? "GET").toUpperCase();
    try {
      const path = url.slice((this.clientUrl + API_PATH).length);
      const [resource, queryString] = [decodeURIComponent(path.split("?")[0]), path.includes("?") ? path.slice(path.indexOf("?")) : undefined];
      const body = (): Row => {
        if (typeof init?.body !== "string" || !init.body) return {};
        try { return JSON.parse(init.body); } catch { throw new WebApiError("The request body isn't valid JSON.", "0x80060888", 400); }
      };
      const GUID = "\\{?[0-9a-fA-F-]{36}\\}?";

      // <set>(id)/<relationship>/$ref, and <set>(id)/<relationship>(otherId)/$ref to remove one.
      let m = resource.match(new RegExp(`^(\\w+)\\((${GUID})\\)/(\\w+)(?:\\((${GUID})\\))?/\\$ref$`));
      if (m) {
        const table = this.setOrThrow(m[1]);
        if (method === "POST" && !m[4]) { this.associate(table, m[2], m[3], String(body()["@odata.id"] ?? "")); return empty(204); }
        if (method === "DELETE") {
          const otherId = m[4] ?? (queryString ? new URLSearchParams(queryString.slice(1)).get("$id") : null);
          if (!otherId) throw new UnsupportedError(`DELETE ${resource} without the record to remove`);
          this.disassociate(table, m[2], m[3], m[4] ? otherId : this.parseRecordUrl(otherId).id);
          return empty(204);
        }
      }

      // The one bound action the Toolbox calls: teams(id)/Microsoft.Dynamics.CRM.AddMembersTeam.
      m = resource.match(new RegExp(`^teams\\((${GUID})\\)/Microsoft\\.Dynamics\\.CRM\\.AddMembersTeam$`));
      if (m && method === "POST") {
        const members = Array.isArray(body().Members) ? body().Members as Row[] : [];
        const team = this.setOrThrow("teams");
        for (const member of members) {
          if (!member.systemuserid) throw new WebApiError("A member has no systemuserid.", "0x80040203", 400);
          const done = this.store.table("teammembership").some((r) => r.teamid === cleanId(m![1]) && r.systemuserid === cleanId(member.systemuserid));
          if (!done) this.associate(team, m[1], "teammembership_association", `${this.clientUrl}${API_PATH}systemusers(${member.systemuserid})`);
        }
        return empty(204);
      }

      // EntityDefinitions(LogicalName='x'), as Environment Artifact Finder reads it.
      m = resource.match(/^EntityDefinitions\(LogicalName='(\w+)'\)$/);
      if (m && method === "GET") return json(200, this.entityDefinition(m[1], queryString));

      // <set>(id): read, update, delete.
      m = resource.match(new RegExp(`^(\\w+)\\((${GUID})\\)$`));
      if (m) {
        const table = this.setOrThrow(m[1]);
        if (method === "GET") return json(200, { "@odata.context": this.context(table), ...this.retrieve(table.logicalName, m[2], queryString) });
        if (method === "PATCH") {
          const exists = this.store.find(table.logicalName, m[2]);
          // PATCH with If-Match: * only updates; without it, a missing record is created (upsert).
          if (!exists && !header(init?.headers, "If-Match")) {
            this.create(table.logicalName, { ...body(), [table.primaryId]: cleanId(m[2]) });
          } else {
            this.update(table.logicalName, m[2], body());
          }
          return empty(204, { "OData-EntityId": `${this.clientUrl}${API_PATH}${table.entitySetName}(${cleanId(m[2])})` });
        }
        if (method === "DELETE") { this.remove(table.logicalName, m[2]); return empty(204); }
      }

      // <set>: read many, create.
      if (/^\w+$/.test(resource)) {
        const table = this.setOrThrow(resource);
        if (method === "GET") {
          const result = this.retrieveMultiple(table.logicalName, queryString);
          return json(200, { "@odata.context": this.context(table), value: result.entities, ...(result.nextLink ? { "@odata.nextLink": result.nextLink } : {}) });
        }
        if (method === "POST") {
          const id = this.create(table.logicalName, body());
          return empty(204, { "OData-EntityId": `${this.clientUrl}${API_PATH}${table.entitySetName}(${id})` });
        }
      }
      throw new UnsupportedError(`${method} ${resource}`);
    } catch (error) {
      const e = error as Error;
      const status = error instanceof WebApiError ? error.status : error instanceof UnsupportedError ? 501 : 500;
      const code = error instanceof WebApiError ? error.code : "0x80040216";
      return json(status, { error: { code, message: `${e.message}${error instanceof UnsupportedError ? ` (request: ${method} ${url})` : ""}` } });
    }
  }

  // ---- inside ----

  private writable(logicalName: string): Table {
    const table = this.table(logicalName);
    if (table === METADATA) throw new UnsupportedError("writing EntityDefinitions");
    return table;
  }

  private existing(table: Table, id: string): Row {
    const row = this.store.find(table.logicalName, id);
    if (!row) throw new WebApiError(`${table.logicalName} With Id = ${cleanId(id)} Does Not Exist`, "0x80040217", 404);
    return row;
  }

  // The lookup column a navigation property sets. A lookup's own name works unless the table declares a
  // differently cased navigation property for it (Dataverse's names are case-sensitive).
  private navigationColumn(table: Table, name: string): string | undefined {
    const declared = table.navigation[name];
    if (declared?.kind === "one") return declared.column;
    const column = table.columns[name];
    const shadowed = Object.entries(table.navigation).some(([nav, n]) => n.kind === "one" && n.column === name && nav !== name);
    return column?.type === "lookup" && !shadowed ? name : undefined;
  }

  // A Web API payload as a stored row: plain columns as they are, "nav@odata.bind" as _lookup_value.
  private toRow(table: Table, payload: Row): Row {
    const row: Row = {};
    const invalid = (key: string) => new WebApiError(`Invalid property '${key}' was found in entity 'Microsoft.Dynamics.CRM.${table.logicalName}'.`, "0x80060888", 400);
    for (const [key, value] of Object.entries(payload ?? {})) {
      if (key.startsWith("@")) continue;
      const bind = key.match(/^(\w+)@odata\.bind$/);
      if (bind) {
        const column = this.navigationColumn(table, bind[1]);
        if (!column) throw invalid(bind[1]);
        if (value === null) { row[`_${column}_value`] = null; continue; }
        const target = this.parseRecordUrl(String(value));
        const expected = table.columns[column].target;
        if (target.table.logicalName !== expected) throw new WebApiError(`The ${bind[1]} lookup points to ${expected}, not ${target.table.logicalName}.`, "0x80060891", 400);
        this.existing(target.table, target.id);
        row[`_${column}_value`] = target.id;
        continue;
      }
      if (key.includes("@")) continue; // other annotations
      const column = table.columns[key];
      if (!column || column.type === "lookup") throw invalid(key);
      if (value !== null && !fits(column.type, value)) {
        throw new WebApiError(`Cannot convert the literal '${String(value)}' to the expected type of '${key}' (${column.type}).`, "0x80048d19", 400);
      }
      row[key] = value;
    }
    return row;
  }

  // "/queues(id)", "queues(id)" or a full Web API URL.
  private parseRecordUrl(url: string): { table: Table; id: string } {
    const m = url.match(/(?:^|\/)(\w+)\((\{?[0-9a-fA-F-]{36}\}?)\)$/);
    if (!m) throw new WebApiError(`The record reference '${url}' isn't valid.`, "0x80060888", 400);
    return { table: this.setOrThrow(m[1]), id: cleanId(m[2]) };
  }

  private relationship(table: Table, name: string): { relationship: Relationship; side: number } {
    const relationship = RELATIONSHIPS.find((r) => r.name === name);
    const side = relationship ? relationship.tables.indexOf(table.logicalName) : -1;
    if (!relationship || side < 0) throw notFoundProperty(name, table.logicalName);
    return { relationship, side };
  }

  // One table's metadata with its many-to-one relationships, as Environment Artifact Finder reads it.
  private entityDefinition(logicalName: string, queryString?: string): Row {
    const table = TABLES[logicalName];
    if (!table) throw new WebApiError(`Could not find entity with name '${logicalName}'.`, "0x80040217", 404);
    const query = parseQuery(queryString);
    const known = new Set(["LogicalName", "EntitySetName", "PrimaryIdAttribute", "PrimaryNameAttribute", "MetadataId"]);
    for (const s of query.select ?? []) if (!known.has(s)) throw notFoundProperty(s, "EntityMetadata");
    for (const e of query.expand) if (e.navigation !== "ManyToOneRelationships") throw new UnsupportedError(`$expand=${e.navigation} on EntityDefinitions`);
    const all = metadataRows().find((r) => r.LogicalName === logicalName)!;
    const out: Row = {};
    for (const key of query.select ?? Object.keys(all)) out[key] = all[key];
    if (query.expand.length) {
      out.ManyToOneRelationships = Object.entries(table.columns).filter(([, c]) => c.type === "lookup")
        .map(([name, c]) => ({ ReferencingAttribute: name, ReferencedEntity: c.target }));
    }
    return out;
  }

  private table(logicalName: string): Table {
    if (logicalName === "EntityDefinitions") return METADATA;
    const table = TABLES[logicalName];
    if (!table) throw new WebApiError(`The entity with a name = '${logicalName}' with namemapping = 'Logical' was not found in the MetadataCache.`, "0x80041102", 404);
    return table;
  }

  private setOrThrow(entitySetName: string): Table {
    if (entitySetName === "EntityDefinitions") return METADATA;
    const table = tableByEntitySet(entitySetName);
    if (!table) throw new WebApiError(`Resource not found for the segment '${entitySetName}'.`, "0x8006088a", 404);
    return table;
  }

  private rows(table: Table): Row[] {
    return table === METADATA ? metadataRows() : this.store.table(table.logicalName);
  }

  private context(table: Table): string {
    return `${this.clientUrl}${API_PATH}$metadata#${table.entitySetName}`;
  }

  private nextLink(table: Table, queryString: string | undefined, skip: number): string {
    const rest = (queryString ?? "").replace(/^\?/, "").split("&").filter((p) => p && !p.startsWith("$skiptoken="));
    return `${this.clientUrl}${API_PATH}${table.entitySetName}?${[...rest, `$skiptoken=${skip}`].join("&")}`;
  }

  // The stored key a query name refers to: a lookup may be named x or _x_value.
  private resolve(table: Table, name: string): { key: string; column: Column; logical: string } {
    const lookup = name.match(/^_(.+)_value$/);
    const logical = lookup ? lookup[1] : name;
    const column = table.columns[logical];
    if (!column || (lookup && column.type !== "lookup")) throw notFoundProperty(name, table.logicalName);
    return { key: storageKey(logical, column), column, logical };
  }

  private select(table: Table, query: Query): Row[] {
    let rows = this.rows(table);
    if (query.filter) {
      const keys = new Map(filterColumns(query.filter).map((c) => [c, this.resolve(table, c).key]));
      rows = rows.filter((r) => evaluate(query.filter!, r, (row, c) => row[keys.get(c)!]));
    }
    if (query.orderBy.length) {
      const order = query.orderBy.map((o) => ({ key: this.resolve(table, o.column).key, sign: o.descending ? -1 : 1 }));
      rows = [...rows].sort((a, b) => {
        for (const { key, sign } of order) {
          const [x, y] = [a[key] ?? null, b[key] ?? null];
          if (x === y) continue;
          if (x === null) return -sign;
          if (y === null) return sign;
          return (typeof x === "string" ? x.localeCompare(y, undefined, { sensitivity: "base" }) : x < y ? -1 : 1) * sign;
        }
        return 0;
      });
    }
    if (query.top !== undefined) rows = rows.slice(0, query.top);
    return rows;
  }

  // A row as the Web API returns it: the primary key, the selected columns (all when none are
  // selected), annotations, and expanded records.
  private shape(table: Table, row: Row, select: string[] | undefined, expand: Query["expand"] = []): Row {
    const out: Row = { [table.primaryId]: row[table.primaryId] };
    const names = select ?? Object.keys(table.columns);
    for (const name of names) {
      const { key, column } = this.resolve(table, name);
      const value = row[key] ?? null;
      out[key] = value;
      if (value === null) continue;
      if (column.type === "lookup") {
        const target = TABLES[column.target!];
        const name = target?.primaryName ? this.store.find(target.logicalName, value)?.[target.primaryName] : undefined;
        if (typeof name === "string") out[`${key}${FORMATTED}`] = name;
        out[`${key}${LOOKUP_TABLE}`] = column.target;
      } else if (column.type === "option" && column.labels?.[value] !== undefined) {
        out[`${key}${FORMATTED}`] = column.labels[value];
      }
    }
    for (const e of expand) {
      const nav = table.navigation[e.navigation];
      if (!nav) throw notFoundProperty(e.navigation, table.logicalName);
      const target = TABLES[nav.target];
      if (nav.kind === "one") {
        const id = row[`_${nav.column}_value`];
        const related = id ? this.store.find(target.logicalName, id) : undefined;
        out[e.navigation] = related ? this.shape(target, related, e.select) : null;
      } else {
        const id = row[table.primaryId];
        out[e.navigation] = this.store.table(target.logicalName).filter((r) => r[`_${nav.column}_value`] === id).map((r) => this.shape(target, r, e.select));
      }
    }
    return out;
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; odata.metadata=minimal", "OData-Version": "4.0" } });
}

function empty(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { "OData-Version": "4.0", ...headers } });
}

function header(headers: unknown, name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name) ?? undefined;
  const found = Object.entries(headers as Record<string, string>).find(([k]) => k.toLowerCase() === name.toLowerCase());
  return found?.[1];
}

function fits(type: Column["type"], value: unknown): boolean {
  switch (type) {
    case "int": case "decimal": case "option": return typeof value === "number";
    case "bool": return typeof value === "boolean";
    default: return typeof value === "string";
  }
}
