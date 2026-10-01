import { describe, expect, test } from "bun:test";
import { PLANS } from "@/lib/entitlements/plans";
import { AGENTS } from "@/lib/entitlements/agents";
import {
  agentAccess,
  agentPermissions,
  allowedAutonomy,
  autonomyCeiling,
  capabilityOwner,
  collaboratorsOf,
  displayStatus,
  isMissionTemplate,
  MAX_PLAN_STEPS,
  MISSION_TEMPLATE_IDS,
  MISSION_TEMPLATES,
  organizationAccess,
  organizationView,
  planMission,
  reportingChain,
  type AccessContext,
} from "./organization";
import { DATA_DOMAINS, PRIVATE_FIELDS, TOOL_PERMISSIONS } from "./permissions";
import { decideMission, decideTool } from "./policy";
import { ROLES } from "./roles";
import { AGENT_ORDER, AGENT_REGISTRY, CAPABILITIES, MISSION_ROUTES, requiredPlan } from "./registry";
import { TOOLS } from "./tools";
import { AGENT_IDS, CAPABILITY_IDS, MISSION_TYPES, TOOL_IDS } from "./types";

const free: AccessContext = { entitledPlan: "free", preview: false, role: "owner" };
const preview: AccessContext = { entitledPlan: "free", preview: true, role: "owner" };
const business: AccessContext = { entitledPlan: "business", preview: false, role: "owner" };

describe("Organization is derived from the single registry", () => {
  test("every agent appears exactly once across the layers; no second definition exists", () => {
    const v = organizationView();
    const ids = [...v.orchestration, ...v.management.map((m) => m.manager), ...v.specialists, ...v.custom].map((a) => a.id);
    expect(ids.sort()).toEqual([...AGENT_IDS].sort());
    expect(new Set(ids).size).toBe(ids.length);
    // The entitlement catalog is a projection of the registry, not a copy.
    expect(AGENTS.map((a) => a.key)).toEqual([...AGENT_ORDER]);
  });

  test("orchestrator → managers → specialists, from parent links", () => {
    const v = organizationView();
    expect(v.orchestration.map((a) => a.id)).toEqual(["orchestrator"]);
    expect(v.management.map((m) => m.manager.id)).toEqual(["partnership", "sales"]);
    for (const m of v.management) {
      expect(m.manager.parent).toBe("orchestrator");
      for (const s of m.coordinates) expect(s.parent).toBe(m.manager.id);
    }
    expect(v.management.find((m) => m.manager.id === "partnership")!.coordinates.map((a) => a.id)).toEqual(["relationship", "research", "signal", "technical", "market"]);
    expect(v.management.find((m) => m.manager.id === "sales")!.coordinates.map((a) => a.id)).toEqual(["prospecting", "followUp", "event"]);
    // Every core specialist reports to a manager.
    for (const s of v.specialists) expect(AGENT_REGISTRY[s.parent!].tier).toBe("manager");
    expect(v.custom.map((a) => a.id)).toEqual(["custom"]);
    expect(reportingChain("research")).toEqual(["research", "partnership", "orchestrator"]);
  });
});

describe("Truthful execution status", () => {
  test("agentAccess shows executable exactly when the server would accept the agent's missions", () => {
    for (const plan of PLANS)
      for (const p of [false, true])
        for (const role of ROLES)
          for (const id of AGENT_ORDER) {
            const agent = AGENT_REGISTRY[id];
            const access = agentAccess(agent, { entitledPlan: plan, preview: p, role });
            const server = agent.missionTypes.some((m) => decideMission({ agentId: id, missionType: m, role, entitledPlan: plan, preview: p, requestedAutonomy: null }).ok);
            expect(access.state === "executable").toBe(server);
          }
  });

  test("coming-soon agents are coming soon on every plan and in preview; never 'locked → upgrade'", () => {
    for (const ctx of [free, preview, business]) {
      const access = organizationAccess(ctx);
      for (const id of AGENT_ORDER) if (AGENT_REGISTRY[id].status === "coming_soon") expect(access[id]).toEqual({ state: "coming_soon", requiredPlan: requiredPlan(AGENT_REGISTRY[id]) });
    }
  });

  test("Free: built agents are locked, nothing is available", () => {
    const access = organizationAccess(free);
    expect(access.research).toEqual({ state: "locked", requiredPlan: "pro" });
    expect(access.prospecting).toEqual({ state: "locked", requiredPlan: "pro" });
    expect(access.partnership).toEqual({ state: "locked", requiredPlan: "business" });
    expect(Object.values(access).some((a) => a.state === "executable")).toBe(false);
  });

  test("operator preview shows Preview (not Available) and cannot unlock unbuilt agents", () => {
    const access = organizationAccess(preview);
    for (const id of ["research", "prospecting", "partnership"] as const) expect(displayStatus(access[id])).toBe("preview");
    for (const id of ["orchestrator", "sales", "signal", "event", "followUp", "relationship", "custom"] as const) {
      expect(displayStatus(access[id])).toBe("coming_soon");
      expect(decideMission({ agentId: id, missionType: "analyze_company", role: "owner", entitledPlan: "business", preview: true, requestedAutonomy: null }).ok).toBe(false);
    }
  });

  test("viewers see the role state; plan entitlement shows Available", () => {
    expect(agentAccess(AGENT_REGISTRY.research, { ...business, role: "viewer" }).state).toBe("role");
    expect(displayStatus(agentAccess(AGENT_REGISTRY.research, business))).toBe("available");
  });
});

describe("Autonomy ceiling", () => {
  test("ceiling is the registry maximum when executable, none otherwise; Execute is never granted", () => {
    for (const id of AGENT_ORDER) {
      const a = AGENT_REGISTRY[id];
      expect(a.autonomy.max).toBeLessThan(3);
      expect(autonomyCeiling(a, agentAccess(a, free))).toBeNull();
      expect(allowedAutonomy(a, agentAccess(a, free))).toEqual([]);
    }
    expect(autonomyCeiling(AGENT_REGISTRY.research, agentAccess(AGENT_REGISTRY.research, business))).toBe(2);
    expect(allowedAutonomy(AGENT_REGISTRY.research, agentAccess(AGENT_REGISTRY.research, business))).toEqual([0, 1, 2]);
    expect(autonomyCeiling(AGENT_REGISTRY.signal, agentAccess(AGENT_REGISTRY.signal, business))).toBeNull();
  });

  test("the server refuses any autonomy above the ceiling, even with preview", () => {
    for (const id of ["research", "prospecting", "partnership"] as const) {
      const a = AGENT_REGISTRY[id];
      const d = decideMission({ agentId: id, missionType: a.missionTypes[0], role: "owner", entitledPlan: "business", preview: true, requestedAutonomy: 3 });
      expect(d.ok).toBe(false);
      if (!d.ok) expect(d.reason).toBe("autonomy_not_allowed");
    }
  });
});

describe("Tool permissions and data boundaries", () => {
  test("every registered tool has permission metadata; domains are known", () => {
    expect(Object.keys(TOOL_PERMISSIONS).sort()).toEqual([...TOOL_IDS].sort());
    for (const p of Object.values(TOOL_PERMISSIONS)) for (const d of p.domains) expect(DATA_DOMAINS).toContain(d);
  });

  test("read vs write: no tool acts outside ORQO; only governed research stores data, and only analyses", () => {
    const writers = TOOL_IDS.filter((t) => TOOL_PERMISSIONS[t].access !== "read");
    expect(writers.sort()).toEqual(["deep_company_research", "official_site_research"]);
    expect(TOOL_IDS.some((t) => TOOL_PERMISSIONS[t].access === "write_external")).toBe(false);
    // Write tools never touch relationship memory.
    for (const t of writers) for (const d of ["relationship_context", "follow_ups", "events"] as const) expect(TOOL_PERMISSIONS[t].domains).not.toContain(d);
  });

  test("relationship and event seams declare the private fields they withhold", () => {
    expect(TOOL_PERMISSIONS.read_relationship_context.withholds).toEqual(expect.arrayContaining(["contact_channels", "private_notes", "interaction_content"]));
    expect(TOOL_PERMISSIONS.read_event_context.withholds).toEqual(expect.arrayContaining(["event_preparation_notes", "contact_channels"]));
    // Cross-check with the declared tool purpose (written from the output schema).
    expect(TOOLS.read_relationship_context.purpose).toContain("No contact channels or free-text notes");
  });

  test("agent permissions are derived from granted tools only", () => {
    const research = agentPermissions(AGENT_REGISTRY.research);
    expect(research.reads).toEqual(expect.arrayContaining(["organization_profile", "network_companies", "stored_analysis", "public_web"]));
    expect(research.reads).not.toContain("relationship_context");
    expect(research.stores).toEqual(["stored_analysis"]);
    expect(research.tools.find((t) => t.id === "deep_company_research")!.needsApproval).toBe(true);
    expect(research.cannot).toEqual(expect.arrayContaining(["act_externally", "modify_relationships", "execute_without_you", "read_private_fields", "spend_without_approval"]));

    const partnership = agentPermissions(AGENT_REGISTRY.partnership);
    expect(partnership.reads).not.toContain("public_web");
    expect(partnership.cannot).toContain("use_paid_providers");

    // A planned agent is granted nothing; its built read seams are listed as planned only.
    const signal = agentPermissions(AGENT_REGISTRY.signal);
    expect(signal.tools).toEqual([]);
    expect(signal.reads).toEqual([]);
    expect(signal.plannedTools).toEqual(["read_company_signals", "read_relationship_context"]);
    expect(decideTool(AGENT_REGISTRY.signal, "signal_analysis", "read_company_signals", 2).ok).toBe(false);
  });

  test("every agent withholds every private field and cannot act externally", () => {
    for (const id of AGENT_ORDER) {
      const p = agentPermissions(AGENT_REGISTRY[id]);
      expect(p.withholds).toEqual([...PRIVATE_FIELDS]);
      expect(p.cannot).toContain("act_externally");
      expect(p.cannot).toContain("read_private_fields");
    }
    // No outbound tool can be granted: such ids are not registered.
    for (const fake of ["send_email", "send_linkedin_message", "create_meeting", "update_relationship_stage"]) expect(decideTool(AGENT_REGISTRY.research, "company_research", fake, 2)).toEqual({ ok: false, reason: "tool_not_registered" });
  });
});

describe("Deterministic mission planning", () => {
  test("every capability used by a mission has exactly one owner; routing follows mission routes first", () => {
    for (const caps of Object.values(MISSION_TEMPLATES)) for (const c of caps) expect(capabilityOwner(c)).not.toBeNull();
    for (const m of MISSION_TYPES) expect(capabilityOwner(MISSION_ROUTES[m].capability)!.agent.id).toBe(MISSION_ROUTES[m].agent);
    expect(capabilityOwner("company_research")!.agent.id).toBe("research");
    expect(capabilityOwner("relationship_context")!.agent.id).toBe("relationship");
    expect(capabilityOwner("followup_preparation")!.agent.id).toBe("followUp");
    expect(capabilityOwner("event_analysis")!.agent.id).toBe("event");
    expect(capabilityOwner("technical_fit")!.agent.id).toBe("technical");
    for (const c of CAPABILITY_IDS) expect(capabilityOwner(c)?.agent.slot ?? "core").toBe("core");
  });

  test("plans are bounded, deterministic and contain no repeated capability", () => {
    for (const id of MISSION_TEMPLATE_IDS) {
      expect(MISSION_TEMPLATES[id].length).toBeLessThanOrEqual(MAX_PLAN_STEPS);
      expect(new Set(MISSION_TEMPLATES[id]).size).toBe(MISSION_TEMPLATES[id].length);
      const access = organizationAccess(preview);
      expect(planMission(id, access)).toEqual(planMission(id, access));
    }
    expect(planMission("constructor", organizationAccess(preview))).toBeNull();
    expect(planMission("send_all_emails", organizationAccess(preview))).toBeNull();
    expect(isMissionTemplate("toString")).toBe(false);
  });

  test("event preparation: unavailable steps are marked honestly and cannot run", () => {
    const plan = planMission("prepare_event", organizationAccess(preview))!;
    expect(plan.steps.map((s) => [s.agent, s.status, s.runnable])).toEqual([
      ["event", "coming_soon", false],
      ["prospecting", "preview", true],
      ["research", "preview", true],
      ["relationship", "coming_soon", false],
      ["followUp", "coming_soon", false],
    ]);
    expect(plan.lead).toBe("orchestrator");
    expect(plan.leadStatus).toBe("coming_soon");
    expect(plan.runnable).toBe(2);
    // Handoffs are suggestions between consecutive steps.
    expect(plan.steps[0].handoff).toEqual({ to: "prospecting", capability: "prospect_discovery" });
    expect(plan.steps.at(-1)!.handoff).toBeNull();
  });

  test("Free: no planned step is runnable; locked steps carry their plan", () => {
    const plan = planMission("find_companies", organizationAccess(free))!;
    expect(plan.runnable).toBe(0);
    expect(plan.steps.map((s) => [s.agent, s.status, s.requiredPlan])).toEqual([
      ["prospecting", "locked", "pro"],
      ["research", "locked", "pro"],
      ["partnership", "locked", "business"],
    ]);
  });

  test("runnable steps map to a real mission type; approval boundaries come from tool policy", () => {
    const plan = planMission("research_company", organizationAccess(business))!;
    expect(plan.lead).toBe("partnership");
    expect(plan.steps.map((s) => [s.agent, s.missionType, s.runnable, s.approvalBoundary])).toEqual([
      ["research", "analyze_company", true, true],
      ["partnership", "explain_opportunities", true, false],
    ]);
  });

  test("planning is pure: the planner has no access to tools, stores or providers", async () => {
    const src = await Bun.file(new URL("./organization.ts", import.meta.url)).text();
    expect(src).not.toMatch(/from "@\/lib\/server/);
    expect(src).not.toMatch(/fetch\(|executeRun|createMission/);
  });

  test("collaborators are derived from shared missions", () => {
    expect(collaboratorsOf("research")).toEqual(expect.arrayContaining(["partnership", "prospecting", "technical"]));
    expect(collaboratorsOf("research")).not.toContain("research");
    expect(collaboratorsOf("custom")).toEqual([]);
  });
});

describe("Phase 7/8 agents stay truthful", () => {
  test("Signals and Event agents remain coming soon with no granted tools and no missions", () => {
    for (const id of ["signal", "event", "followUp", "relationship"] as const) {
      expect(AGENT_REGISTRY[id].status).toBe("coming_soon");
      expect(AGENT_REGISTRY[id].tools).toEqual([]);
      expect(AGENT_REGISTRY[id].missionTypes).toEqual([]);
    }
    expect(CAPABILITIES.technical_fit.tools).toEqual([]);
  });
});
