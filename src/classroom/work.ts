// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

// A learner's work on a class exercise, packed to go to the class (backend/src/classes.ts): JSON,
// gzip-compressed by the browser, in Base64. About 10 KB for a whole environment.

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function pack(value: unknown): Promise<string> {
  const zipped = await pipe(new TextEncoder().encode(JSON.stringify(value)), new CompressionStream("gzip"));
  let text = "";
  for (let i = 0; i < zipped.length; i += 0x8000) text += String.fromCharCode(...zipped.subarray(i, i + 0x8000));
  return btoa(text);
}

export async function unpack<T>(data: string): Promise<T> {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(await pipe(bytes, new DecompressionStream("gzip")))) as T;
}

// Whether this browser can pack work at all (every current browser can).
export const canPack = () => typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";
