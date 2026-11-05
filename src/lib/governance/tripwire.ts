/**
 * Security tripwires (Phase 17A): deterministic STOP + DENY + AUDIT.
 *
 * A tripwire is raised by code when something tries to go beyond its authority. No model is ever asked
 * whether a violation is acceptable. The caller stops the action, and the server records an audit event
 * (`governance.tripwire.<kind>`) through a database function that only accepts these kinds.
 */
import { AppError } from "@/lib/server/errors";

export const TRIPWIRES = [
  "missing_authority",
  "unauthorized_tool",
  "unauthorized_network",
  "cross_organization",
  "provider_outside_authority",
  "write_outside_authority",
  "privilege_expansion",
  "delegation_limit",
  "runtime_limit",
  "cost_limit",
  "provider_call_limit",
  "external_action",
  "authority_modification",
] as const;
export type Tripwire = (typeof TRIPWIRES)[number];

/** Denial raised by a tripwire. Business code must stop; the gate records it before throwing. */
export class TripwireError extends AppError {
  constructor(
    readonly tripwire: Tripwire,
    readonly detail: string | null = null,
  ) {
    super("forbidden", `Refused by ORQO governance (${tripwire}).`);
  }
}
