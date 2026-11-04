// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { TABLES } from "./schema";

// The simulator's rows, per table, in the shape the Web API returns them: real column names,
// lookups as _x_value, GUIDs lowercase without braces. Pure: saving to IndexedDB is in persist.ts.

export type Row = Record<string, any>;
export type Rows = Record<string, Row[]>;

export interface SessionFile {
  kind: "ccaas-training-session";
  version: 1;
  savedOn: string;
  rows: Rows;
}

export const cleanId = (id: string): string => id.replace(/[{}]/g, "").toLowerCase();

let counter = 0;
export function newGuid(): string {
  const c = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  counter++;
  return `00000000-0000-4000-8000-${String(Date.now() % 1e8).padStart(8, "0")}${String(counter % 1e4).padStart(4, "0")}`;
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export class Store {
  private rows: Rows = {};
  private listeners = new Set<() => void>();

  constructor(rows?: Rows) {
    if (rows) this.load(rows);
  }

  table(logicalName: string): Row[] {
    if (!TABLES[logicalName]) throw new Error(`Simulator: the table “${logicalName}” isn't in the simulator yet.`);
    return this.rows[logicalName] ?? [];
  }

  find(logicalName: string, id: string): Row | undefined {
    const key = TABLES[logicalName]?.primaryId;
    const wanted = cleanId(id);
    return this.table(logicalName).find((r) => r[key] === wanted);
  }

  // Adds a row. GUIDs are cleaned, a missing id is made, and statecode defaults to 0 (active) where
  // the table has one, as Dataverse does for a new record.
  insert(logicalName: string, row: Row): Row {
    const table = TABLES[logicalName];
    if (!table) throw new Error(`Simulator: the table “${logicalName}” isn't in the simulator yet.`);
    const clean: Row = {};
    for (const [key, value] of Object.entries(row)) clean[key] = typeof value === "string" && isGuidColumn(logicalName, key) ? cleanId(value) : value;
    clean[table.primaryId] = clean[table.primaryId] ?? newGuid();
    if (table.columns.statecode && clean.statecode === undefined) clean.statecode = 0;
    if (this.find(logicalName, clean[table.primaryId])) throw new Error(`Simulator: a ${logicalName} row with id ${clean[table.primaryId]} already exists.`);
    (this.rows[logicalName] ??= []).push(clean);
    this.changed();
    return clean;
  }

  // Changes columns of an existing row. Returns the row after the change.
  update(logicalName: string, id: string, changes: Row): Row {
    const row = this.find(logicalName, id);
    if (!row) throw new Error(`Simulator: no ${logicalName} row with id ${id}.`);
    for (const [key, value] of Object.entries(changes)) row[key] = typeof value === "string" && isGuidColumn(logicalName, key) ? cleanId(value) : value;
    this.changed();
    return row;
  }

  remove(logicalName: string, id: string): void {
    const key = TABLES[logicalName].primaryId;
    const wanted = cleanId(id);
    this.rows[logicalName] = this.table(logicalName).filter((r) => r[key] !== wanted);
    this.changed();
  }

  load(rows: Rows): void {
    this.rows = {};
    const quiet = this.listeners;
    this.listeners = new Set();
    for (const [table, list] of Object.entries(rows)) list.forEach((r) => this.insert(table, r));
    this.listeners = quiet;
    this.changed();
  }

  snapshot(): Rows {
    return copy(this.rows);
  }

  count(): number {
    return Object.values(this.rows).reduce((n, list) => n + list.length, 0);
  }

  toFile(): SessionFile {
    return { kind: "ccaas-training-session", version: 1, savedOn: new Date().toISOString(), rows: this.snapshot() };
  }

  static readFile(json: unknown): Rows {
    const file = json as Partial<SessionFile>;
    if (file?.kind !== "ccaas-training-session" || file.version !== 1 || typeof file.rows !== "object") {
      throw new Error("This file isn't a saved training session.");
    }
    return file.rows as Rows;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    this.listeners.forEach((l) => l());
  }
}

// Primary keys, lookups and guid columns hold GUIDs and are kept lowercase without braces.
function isGuidColumn(logicalName: string, key: string): boolean {
  const table = TABLES[logicalName];
  if (key === table.primaryId) return true;
  const lookup = key.match(/^_(.+)_value$/);
  if (lookup) return table.columns[lookup[1]]?.type === "lookup";
  return table.columns[key]?.type === "guid";
}
