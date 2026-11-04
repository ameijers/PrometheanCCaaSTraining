// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";

// What the backend keeps: classes, learners' progress, AI usage, AI-written scenarios. One small interface,
// so it can be files on this machine (FileStore) or Azure Table Storage when hosted (tableStore.ts).
// Values are JSON. Partitions and keys are plain: letters, digits, "-", "_" and ":".

export interface KvStore {
  get<T>(partition: string, key: string): Promise<T | undefined>;
  put(partition: string, key: string, value: unknown): Promise<void>;
  list<T>(partition: string): Promise<{ key: string; value: T }[]>;
  // Removes a value; nothing happens when it isn't there.
  remove(partition: string, key: string): Promise<void>;
}

const SAFE = /^[\w:-]{1,120}$/;
export function checkKey(...parts: string[]): void {
  for (const p of parts) if (!SAFE.test(p)) throw new Error(`Not a valid key: ${p}`);
}

// One JSON file per partition. Fine for one machine; writes are serialized so two requests don't clash.
export class FileStore implements KvStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly dir: string) {}

  private file(partition: string): string {
    checkKey(partition);
    return path.join(this.dir, `${partition.replace(/:/g, "_")}.json`);
  }

  private read(partition: string): Record<string, unknown> {
    try { return JSON.parse(fs.readFileSync(this.file(partition), "utf8")); } catch { return {}; }
  }

  async get<T>(partition: string, key: string): Promise<T | undefined> {
    checkKey(partition, key);
    return this.read(partition)[key] as T | undefined;
  }

  put(partition: string, key: string, value: unknown): Promise<void> {
    checkKey(partition, key);
    const run = this.queue.then(() => {
      const all = this.read(partition);
      all[key] = value;
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.file(partition), JSON.stringify(all));
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async list<T>(partition: string): Promise<{ key: string; value: T }[]> {
    return Object.entries(this.read(partition)).map(([key, value]) => ({ key, value: value as T }));
  }

  remove(partition: string, key: string): Promise<void> {
    checkKey(partition, key);
    const run = this.queue.then(() => {
      const all = this.read(partition);
      if (!(key in all)) return;
      delete all[key];
      fs.writeFileSync(this.file(partition), JSON.stringify(all));
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}

// For tests: nothing on disk.
export class MemoryStore implements KvStore {
  private data = new Map<string, Map<string, unknown>>();
  async get<T>(partition: string, key: string): Promise<T | undefined> { return this.data.get(partition)?.get(key) as T | undefined; }
  async put(partition: string, key: string, value: unknown): Promise<void> {
    checkKey(partition, key);
    if (!this.data.has(partition)) this.data.set(partition, new Map());
    this.data.get(partition)!.set(key, JSON.parse(JSON.stringify(value)));
  }
  async list<T>(partition: string): Promise<{ key: string; value: T }[]> { return [...(this.data.get(partition) ?? [])].map(([key, value]) => ({ key, value: value as T })); }
  async remove(partition: string, key: string): Promise<void> { checkKey(partition, key); this.data.get(partition)?.delete(key); }
}
