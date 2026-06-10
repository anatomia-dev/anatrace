/**
 * Shared byte-decode for the C3 mandate adapters. `extract` is PURE — it reads only the bytes
 * passed in the `NamedBlob[]` group (never disk). Mirrors `adapter.ts`'s `decodeUtf8`/BOM-strip;
 * declared as a minimal ambient so it typechecks under core's `types: []` purity tsconfig.
 */
declare const TextDecoder: {
  new (label?: string): { decode(input?: Uint8Array): string };
};

/** Decode UTF-8 bytes to a string, stripping a leading BOM. Never throws. */
export function decodeBlob(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8').decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
