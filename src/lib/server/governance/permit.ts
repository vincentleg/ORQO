/**
 * Provider permits (Phase 17A). A paid provider transport refuses to send anything without a permit, and
 * only the provider gate issues permits, after every check has passed and the spend is reserved.
 * A permit is single-use, bound to one provider and one reservation, and cannot be forged: it must be the
 * exact object the gate registered (a plain object with the same fields is rejected).
 */
import type { Provider } from "@/lib/governance/authority";

declare const PERMIT: unique symbol;
export interface ProviderPermit {
  readonly provider: Provider;
  readonly reservationId: string;
  readonly [PERMIT]: true;
}

const issued = new WeakMap<object, { provider: Provider; used: boolean }>();

export class PermitError extends Error {}

/** Called by the provider gate only (enforced by a static test). */
export function issuePermit(provider: Provider, reservationId: string): ProviderPermit {
  const permit = Object.freeze({ provider, reservationId }) as unknown as ProviderPermit;
  issued.set(permit, { provider, used: false });
  return permit;
}

/** Called by the transports: consumes the permit, or throws when it is missing, forged, reused or for another provider. */
export function consumePermit(permit: unknown, provider: Provider): void {
  const p = typeof permit === "object" && permit !== null ? issued.get(permit) : undefined;
  if (!p || p.used || p.provider !== provider) throw new PermitError("A provider call needs a valid permit from the provider gate.");
  p.used = true;
}
