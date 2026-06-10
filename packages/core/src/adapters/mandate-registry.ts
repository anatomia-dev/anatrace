import type { NamedBlob } from '../adapter.js';
import type { MandateAdapter } from '../types.js';
import { anatomiaAdapter } from './anatomia.js';
import { superpowersAdapter } from './superpowers.js';

/** The reference mandate adapters (C3). spec-kit/OpenSpec are deferred (later configs). */
export const MANDATE_ADAPTERS: readonly MandateAdapter[] = [anatomiaAdapter, superpowersAdapter];

/** First adapter whose `detect(group)` returns true, else `null`. Pure; never throws. */
export function detectMandateAdapter(group: NamedBlob[]): MandateAdapter | null {
  for (const a of MANDATE_ADAPTERS) {
    if (a.detect(group)) return a;
  }
  return null;
}
