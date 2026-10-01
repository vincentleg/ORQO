/**
 * Tool permissions — what each registered tool may read or change (Phase 9).
 *
 * This is trusted application policy, written by hand from each tool's server
 * implementation and its strict output schema (src/lib/server/agents/tools.ts).
 * It describes; it never grants. Execution is still decided by
 * decideMission/decideTool. Nothing here is derived from a tool result, web
 * content or a model, so untrusted data cannot widen an agent's permissions.
 */
import type { ToolId } from "./types";

/**
 * read: no persistent change.
 * write_internal: stores derived data in this workspace (e.g. a company analysis and its evidence).
 * write_external: acts outside ORQO (send, schedule, post). No such tool exists.
 */
export type ToolAccess = "read" | "write_internal" | "write_external";

/** Human-level data domains. Labels live in the i18n catalogs (agents.domains.*). */
export const DATA_DOMAINS = ["organization_profile", "network_companies", "stored_analysis", "public_web", "web_search", "discovery_memory", "relationship_context", "follow_ups", "signals", "events", "opportunity_graph"] as const;
export type DataDomain = (typeof DATA_DOMAINS)[number];

/** Private fields no agent tool returns. A tool lists those it explicitly withholds from a domain it reads. */
export const PRIVATE_FIELDS = ["contact_channels", "private_notes", "interaction_content", "event_preparation_notes"] as const;
export type PrivateField = (typeof PRIVATE_FIELDS)[number];

export interface ToolPermission {
  access: ToolAccess;
  domains: readonly DataDomain[];
  withholds: readonly PrivateField[];
}

const read = (domains: readonly DataDomain[], withholds: readonly PrivateField[] = []): ToolPermission => ({ access: "read", domains, withholds });

export const TOOL_PERMISSIONS: Record<ToolId, ToolPermission> = {
  read_workspace_company: read(["organization_profile"]),
  read_network_company: read(["network_companies"]),
  read_stored_research: read(["stored_analysis"]),
  // Phase 3 governed research saves the analysis and its evidence in the workspace.
  official_site_research: { access: "write_internal", domains: ["public_web", "stored_analysis"], withholds: [] },
  deep_company_research: { access: "write_internal", domains: ["public_web", "web_search", "stored_analysis"], withholds: [] },
  evaluate_business_relevance: read(["organization_profile", "stored_analysis"]),
  build_discovery_plan: read(["organization_profile"]),
  read_existing_company_knowledge: read(["network_companies", "stored_analysis", "discovery_memory"]),
  source_known_candidates: read(["network_companies", "stored_analysis"]),
  search_web_candidates: read(["web_search"]),
  deduplicate_candidates: read(["network_companies", "stored_analysis", "discovery_memory"]),
  qualify_candidate: read(["organization_profile", "stored_analysis"]),
  apply_discovery_critic: read(["stored_analysis"]),
  // Stage, origin, contact names/roles, interaction titles/dates/next steps, open follow-up titles.
  read_relationship_context: read(["relationship_context", "follow_ups"], ["contact_channels", "private_notes", "interaction_content"]),
  read_company_signals: read(["signals"]),
  // Dates, location, mission, targets and factual review counts.
  read_event_context: read(["events"], ["event_preparation_notes", "contact_channels", "interaction_content"]),
  // Concepts offered/sought with their epistemic status, and candidates (companies, pattern, references, unknowns). Structure only.
  read_opportunity_graph: read(["opportunity_graph"], ["contact_channels", "private_notes", "interaction_content", "event_preparation_notes"]),
};
