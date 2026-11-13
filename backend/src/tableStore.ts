// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

import { TableClient } from "@azure/data-tables";
import { KvStore, checkKey } from "./kv";

// The backend's store when it's hosted (phase 9): Azure Table Storage, one table. A partition is the
// table's PartitionKey, a key its RowKey, and the value is kept as JSON text in one column. Calls as
// documented in @azure/data-tables (TableClient: fromConnectionString, createTable, getEntity,
// upsertEntity, listEntities, deleteEntity).

interface Row { value: string }

export class TableStore implements KvStore {
  private ready: Promise<void>;
  private readonly client: TableClient;

  constructor(connectionString: string, table = "training") {
    this.client = TableClient.fromConnectionString(connectionString, table);
    // createTable doesn't fail when the table is there already.
    this.ready = this.client.createTable();
  }

  async get<T>(partition: string, key: string): Promise<T | undefined> {
    checkKey(partition, key);
    await this.ready;
    try {
      const row = await this.client.getEntity<Row>(partition, key);
      return JSON.parse(row.value) as T;
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode === 404) return undefined;
      throw e;
    }
  }

  async put(partition: string, key: string, value: unknown): Promise<void> {
    checkKey(partition, key);
    await this.ready;
    await this.client.upsertEntity<Row>({ partitionKey: partition, rowKey: key, value: JSON.stringify(value) }, "Replace");
  }

  async list<T>(partition: string): Promise<{ key: string; value: T }[]> {
    checkKey(partition);
    await this.ready;
    const out: { key: string; value: T }[] = [];
    // Partition names are checked above (letters, digits, "-", "_", ":"), so they're safe in the filter.
    for await (const row of this.client.listEntities<Row>({ queryOptions: { filter: `PartitionKey eq '${partition}'` } })) {
      out.push({ key: String(row.rowKey), value: JSON.parse(row.value) as T });
    }
    return out;
  }

  async remove(partition: string, key: string): Promise<void> {
    checkKey(partition, key);
    await this.ready;
    try {
      await this.client.deleteEntity(partition, key);
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode !== 404) throw e;
    }
  }
}
