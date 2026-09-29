/**
 * Demo network. Every source here is simulated (source.simulated = true) and the
 * UI labels it as such. Companies, people and signals are fictional.
 */
import type {
  Capability,
  Company,
  Constraint,
  EvidenceRef,
  Need,
  NeedIntensity,
  Objective,
  Person,
  Relationship,
  Signal,
  Source,
  Visibility,
} from "@/lib/domain/types";
import type { Tag } from "@/lib/domain/taxonomy";

export const DEMO_NOW = "2026-09-29T16:00:00.000Z";
export const DEMO_FUTURE = "2027-03-29T16:00:00.000Z";
export const VIEWER_ID = "p-maya";

const src = (id: string, kind: Source["kind"], label: string, retrievedAt: string, url?: string): Source => ({
  id,
  kind,
  label,
  url,
  retrievedAt,
  simulated: true,
});

export const seedSources: Source[] = [
  src("s-ev-web", "company-website", "edgevision.example / product", "2026-09-20T00:00:00.000Z"),
  src("s-ev-case", "company-website", "edgevision.example / customers", "2026-09-20T00:00:00.000Z"),
  src("s-ev-maya", "conversation", "Maya Chen · private agent briefing", "2026-09-18T00:00:00.000Z"),
  src("s-ev-sales", "self-reported", "EdgeVision sales team · deal notes", "2026-08-30T00:00:00.000Z"),
  src("s-ec-web", "company-website", "eurocompute.example / services", "2026-09-12T00:00:00.000Z"),
  src("s-ec-pr", "press-release", "EuroCompute opens second integration line in Brno", "2026-09-02T00:00:00.000Z"),
  src("s-ec-lukas", "conversation", "Lukas Brandt · agent profile", "2026-09-15T00:00:00.000Z"),
  src("s-sc-web", "company-website", "securechannel.example / vendors", "2026-09-10T00:00:00.000Z"),
  src("s-sc-vendor", "public-filing", "SecureChannel vendor onboarding policy", "2026-06-01T00:00:00.000Z"),
  src("s-sc-sophie", "conversation", "Sophie Laurent · agent profile", "2026-09-29T00:00:00.000Z"),
  src("s-kr-web", "company-website", "kestrelrobotics.example", "2026-07-01T00:00:00.000Z"),
  src("s-kr-daniel", "conversation", "Daniel Okafor · meetup notes", "2025-05-14T00:00:00.000Z"),
  src("s-af-web", "company-website", "atlasfreight.example / about", "2026-05-01T00:00:00.000Z"),
  { id: "s-orqo-inference", kind: "agent-inferred", label: "ORQO agent inference", retrievedAt: DEMO_NOW, simulated: false },
  src(
    "s-sig-ev-eu",
    "simulated-signal",
    "Simulated press release · EdgeVision expands into Europe",
    "2027-03-24T00:00:00.000Z",
  ),
];

const ev = (sourceId: string, excerpt: string, epistemic: EvidenceRef["epistemic"] = "fact", marketingLanguage?: boolean): EvidenceRef => ({
  sourceId,
  excerpt,
  epistemic,
  marketingLanguage,
});

function cap(
  id: string,
  companyId: string,
  label: string,
  detail: string,
  tags: Tag[],
  evidence: EvidenceRef[],
  visibility: Visibility = "public",
  observedAt = "2026-09-20T00:00:00.000Z",
): Capability {
  return { id, companyId, label, detail, tags, evidence, visibility, observedAt };
}

function need(
  id: string,
  companyId: string,
  label: string,
  detail: string,
  tags: Tag[],
  intensity: NeedIntensity,
  evidence: EvidenceRef[],
  visibility: Visibility = "connection",
  disclosure?: string,
  observedAt = "2026-09-20T00:00:00.000Z",
): Need {
  return { id, companyId, label, detail, tags, intensity, evidence, visibility, disclosure, observedAt };
}

const obj = (id: string, statement: string, horizon: string, evidence: EvidenceRef[], visibility: Visibility = "public"): Objective => ({
  id,
  statement,
  horizon,
  evidence,
  visibility,
});

const constraint = (
  id: string,
  label: string,
  requiresTags: Tag[],
  appliesTo: Constraint["appliesTo"],
  evidence: EvidenceRef[],
  visibility: Visibility = "public",
): Constraint => ({ id, label, requiresTags, appliesTo, evidence, visibility });

const edgevision: Company = {
  id: "c-edgevision",
  name: "EdgeVision",
  tagline: "Computer vision that runs where the cameras are.",
  summary:
    "US edge AI company. Its inference runtime and vision stack run optimized models on edge GPUs, powering video analytics apps for retail, logistics and industrial sites.",
  headquarters: "San Francisco, CA",
  size: "85 employees · Series B",
  markets: ["Retail operations", "Logistics yards", "Industrial safety", "Manufacturing QA"],
  geographies: ["United States", "Canada"],
  accent: "#A78BFA",
  offers: [
    cap("cap-ev-runtime", "c-edgevision", "Edge AI inference runtime", "Runs quantized vision models on Jetson-class and x86 edge GPUs with no cloud round-trip.", ["edge-ai-software", "ai-inference"], [
      ev("s-ev-web", "Inference runtime supports NVIDIA Jetson Orin and x86 edge GPUs; median latency under 40 ms."),
    ]),
    cap("cap-ev-cv", "c-edgevision", "Computer vision stack", "Detection, tracking and re-identification models tuned for fixed cameras.", ["computer-vision", "video-analytics"], [
      ev("s-ev-web", "Pre-trained detection, tracking and PPE models for fixed industrial cameras."),
    ]),
    cap("cap-ev-apps", "c-edgevision", "Enterprise video analytics apps", "Packaged apps for safety compliance, yard management and shrink reduction.", ["enterprise-ai-apps", "video-analytics"], [
      ev("s-ev-case", "Deployed across 140 US retail and logistics sites."),
    ]),
    cap("cap-ev-ip", "c-edgevision", "US-built AI product IP", "Owns its models, runtime and application IP; licenses per device.", ["us-technology"], [
      ev("s-ev-web", "Per-device software licensing; all core IP developed in-house."),
    ]),
  ],
  needs: [
    need("need-ev-europe", "c-edgevision", "European expansion", "Board-level mandate to enter European enterprise markets.", ["eu-market-presence", "eu-deployment"], "active", [
      ev("s-ev-maya", "Board asked for a European go-to-market plan by Q1 2027; budget approved for first EU hires."),
    ], "agent-only", "EdgeVision is evaluating European expansion."),
    need("need-ev-hw", "c-edgevision", "Hardware integration partner", "Enterprise buyers want a turnkey appliance, not software on their own hardware.", ["hardware-integration", "gpu-edge-systems"], "active", [
      ev("s-ev-sales", "3 of the last 5 enterprise deals stalled on hardware sourcing and on-site installation."),
    ], "connection"),
    need("need-ev-mfg", "c-edgevision", "European manufacturing", "Needs CE-compliant hardware built and supported inside the EU.", ["eu-manufacturing", "testing-certification"], "exploring", [
      ev("s-ev-maya", "EU customers will require CE marking and local RMA handling.", "inference"),
    ], "agent-only", "EdgeVision would need EU-built, certified hardware."),
    need("need-ev-dist", "c-edgevision", "European enterprise distribution", "No sales channel into European enterprises today.", ["eu-enterprise-distribution", "channel-sales"], "exploring", [
      ev("s-ev-maya", "No European channel partners signed; direct sales team is US-only."),
    ], "agent-only", "EdgeVision has no European sales channel yet."),
    need("need-ev-channels", "c-edgevision", "Enterprise channels", "Wants resellers with existing enterprise security buyers.", ["enterprise-relationships"], "exploring", [
      ev("s-ev-sales", "Security teams are the most common internal champion in closed deals.", "inference"),
    ]),
  ],
  objectives: [
    obj("obj-ev-1", "Expand its AI product into European enterprise markets.", "Next 12 months", [ev("s-ev-maya", "European GTM plan requested by the board.")], "network"),
    obj("obj-ev-2", "Sell complete appliances instead of software-only licenses.", "2027", [ev("s-ev-sales", "Appliance deals close faster in enterprise accounts.", "inference")], "connection"),
  ],
  constraints: [
    constraint("con-ev-gpu", "Hardware partners must support Jetson-class edge GPUs", ["gpu-edge-systems"], ["hardware-partner"], [
      ev("s-ev-web", "Runtime is certified on Jetson Orin; other accelerators are on the roadmap."),
    ]),
  ],
};

const eurocompute: Company = {
  id: "c-eurocompute",
  name: "EuroCompute",
  tagline: "European hardware integration and appliance manufacturing.",
  summary:
    "Designs, integrates, certifies and ships GPU and edge appliances from facilities in Germany and Czechia. Sells through OEM/ODM contracts, not through enterprise channels.",
  headquarters: "Stuttgart, Germany",
  size: "320 employees · Private",
  markets: ["Industrial OEMs", "Telecom edge", "Public sector"],
  geographies: ["Germany", "Czechia", "EU-wide deployment"],
  accent: "#60A5FA",
  offers: [
    cap("cap-ec-integration", "c-eurocompute", "Hardware integration", "Board-level integration, thermal design and BIOS/firmware configuration.", ["hardware-integration"], [
      ev("s-ec-web", "Integration of NVIDIA Jetson and x86 GPU platforms into ruggedized enclosures."),
    ]),
    cap("cap-ec-gpu", "c-eurocompute", "GPU / edge systems", "Reference designs for Jetson Orin and x86 edge GPU appliances.", ["gpu-edge-systems"], [
      ev("s-ec-web", "Jetson Orin and x86 edge GPU reference designs in production."),
    ]),
    cap("cap-ec-mfg", "c-eurocompute", "European manufacturing", "Assembly lines in Stuttgart and Brno.", ["eu-manufacturing"], [
      ev("s-ec-pr", "Second integration line opened in Brno, doubling appliance capacity."),
    ]),
    cap("cap-ec-cert", "c-eurocompute", "Testing & certification", "In-house burn-in testing; CE and TÜV certification support.", ["testing-certification"], [
      ev("s-ec-web", "CE, TÜV and EN 62368 certification handled in-house."),
    ]),
    cap("cap-ec-logistics", "c-eurocompute", "Logistics & RMA", "EU warehousing, shipping and returns.", ["logistics"], [
      ev("s-ec-web", "EU-wide logistics and RMA handling."),
    ]),
    cap("cap-ec-oem", "c-eurocompute", "OEM / ODM appliances", "Builds white-label, pre-imaged appliances under a partner's brand.", ["oem-odm", "packaged-solution"], [
      ev("s-ec-web", "White-label appliance builds, pre-imaged with partner software."),
    ]),
    cap("cap-ec-deploy", "c-eurocompute", "European deployment", "Field installation teams across 14 EU countries.", ["eu-deployment"], [
      ev("s-ec-web", "Field deployment teams in 14 EU countries."),
    ]),
  ],
  needs: [
    need("need-ec-ai", "c-eurocompute", "AI software partners", "Needs differentiated AI software to ship on its edge appliances.", ["edge-ai-software", "ai-inference", "computer-vision"], "active", [
      ev("s-ec-lukas", "Actively looking for AI software to pre-install on edge appliances in 2027."),
    ], "network"),
    need("need-ec-us", "c-eurocompute", "US technology companies", "Wants to be the EU build partner for US AI vendors.", ["us-technology"], "active", [
      ev("s-ec-lukas", "Target: two US AI vendor partnerships signed in the next year."),
    ], "network"),
    need("need-ec-products", "c-eurocompute", "New AI appliance products", "Brno capacity needs new product lines to fill it.", ["edge-ai-software", "enterprise-ai-apps"], "active", [
      ev("s-ec-pr", "New line doubles capacity; utilization targets set for 2027.", "inference"),
    ], "agent-only", "EuroCompute has manufacturing capacity for new appliance products."),
    need("need-ec-commercial", "c-eurocompute", "Commercial partnerships", "General interest in new partnerships.", [], "exploring", [
      ev("s-ec-web", "Open to strategic partnerships.", "fact", true),
    ], "public"),
  ],
  objectives: [
    obj("obj-ec-1", "Become the European hardware and deployment partner for innovative US AI companies.", "2026–2028", [ev("s-ec-lukas", "Stated partnership strategy.")]),
  ],
  constraints: [],
};

const securechannel: Company = {
  id: "c-securechannel",
  name: "SecureChannel",
  tagline: "European enterprise distribution for security and infrastructure.",
  summary:
    "Value-added distributor serving 1,200 resellers and system integrators across DACH, Benelux, France and the Nordics. Strong with CISOs and infrastructure buyers.",
  headquarters: "Amsterdam, Netherlands",
  size: "540 employees · Private",
  markets: ["Enterprise security", "Critical infrastructure", "Industrial IT"],
  geographies: ["DACH", "Benelux", "France", "Nordics"],
  accent: "#34D399",
  offers: [
    cap("cap-sc-dist", "c-securechannel", "European enterprise distribution", "Distribution contracts, stocking and financing across 4 regions.", ["eu-enterprise-distribution"], [
      ev("s-sc-web", "Distributes to 1,200 resellers and system integrators in DACH, Benelux, France and the Nordics."),
    ]),
    cap("cap-sc-channel", "c-securechannel", "Channel sales", "Partner enablement, deal registration and channel marketing.", ["channel-sales"], [
      ev("s-sc-web", "Runs partner enablement and deal registration for 60+ vendors."),
    ]),
    cap("cap-sc-network", "c-securechannel", "Cybersecurity customer network", "Relationships with CISOs and infrastructure teams.", ["security-customer-network", "enterprise-relationships"], [
      ev("s-sc-web", "Core customer base: enterprise security and infrastructure teams."),
    ]),
    cap("cap-sc-access", "c-securechannel", "Market access", "Local presence and pre-sales engineers in each region.", ["eu-market-presence"], [
      ev("s-sc-web", "Pre-sales engineering teams in 9 countries."),
    ]),
  ],
  needs: [
    need("need-sc-ai", "c-securechannel", "New AI infrastructure products", "Portfolio gap in AI infrastructure; resellers are asking for it.", ["ai-infrastructure-product", "packaged-solution"], "active", [
      ev("s-sc-sophie", "Top resellers asked for an AI infrastructure line card for 2027."),
    ], "network"),
    need("need-sc-diff", "c-securechannel", "Differentiated enterprise technology", "Needs products that are not already carried by competing distributors.", ["enterprise-ai-apps", "video-analytics"], "active", [
      ev("s-sc-sophie", "Looking for vision/AI products no competing distributor carries in DACH."),
    ], "network"),
    need("need-sc-solutions", "c-securechannel", "Hardware/software solutions to distribute", "Channel sells boxes with software, not software alone.", ["packaged-solution"], "active", [
      ev("s-sc-vendor", "Channel margins depend on stocked hardware; pure-software vendors onboard only via a hardware partner.", "inference"),
    ], "connection"),
  ],
  objectives: [
    obj("obj-sc-1", "Expand its portfolio into enterprise AI infrastructure.", "2027", [ev("s-sc-sophie", "AI infrastructure is the 2027 portfolio priority.")]),
  ],
  constraints: [
    constraint("con-sc-eu", "Vendors must provide EU-based support and GDPR-compliant deployment", ["eu-support"], ["vendor", "software-vendor"], [
      ev("s-sc-vendor", "Vendor onboarding requires an EU support entity and GDPR-compliant data handling."),
    ]),
  ],
};

const kestrel: Company = {
  id: "c-kestrel",
  name: "Kestrel Robotics",
  tagline: "Autonomous mobile robots for warehouses.",
  summary: "US robotics company building autonomous mobile robots for mid-size warehouses. Considering adding vision-based safety features.",
  headquarters: "Austin, TX",
  size: "60 employees · Series A",
  markets: ["Warehousing", "3PL"],
  geographies: ["United States"],
  accent: "#FBBF24",
  offers: [
    cap("cap-kr-amr", "c-kestrel", "Autonomous mobile robots", "AMR fleet for pallet and tote movement.", ["robotics", "warehouse-automation"], [
      ev("s-kr-web", "AMR fleets deployed in 30 US warehouses."),
    ]),
    cap("cap-kr-dist", "c-kestrel", "US warehouse customer base", "Direct sales to US 3PLs.", ["us-enterprise-distribution"], [
      ev("s-kr-web", "Direct sales team covering US 3PLs."),
    ]),
  ],
  needs: [
    need("need-kr-vision", "c-kestrel", "Vision-based safety", "Exploring camera-based person detection for robot safety zones.", ["computer-vision"], "exploring", [
      ev("s-kr-daniel", "Mentioned vision-based safety as a 'maybe for next year' item.", "inference"),
    ], "connection", undefined, "2025-05-14T00:00:00.000Z"),
  ],
  objectives: [obj("obj-kr-1", "Reach 100 warehouse deployments.", "2027", [ev("s-kr-web", "Public growth target.")])],
  constraints: [],
};

const atlas: Company = {
  id: "c-atlas",
  name: "Atlas Freight",
  tagline: "Midwest freight and fleet operations.",
  summary: "Regional trucking and freight brokerage with its own telematics platform.",
  headquarters: "Chicago, IL",
  size: "1,100 employees · Private",
  markets: ["Freight", "Brokerage"],
  geographies: ["United States"],
  accent: "#F472B6",
  offers: [
    cap("cap-af-freight", "c-atlas", "Freight & brokerage", "LTL and FTL freight across the Midwest.", ["freight-logistics"], [
      ev("s-af-web", "Operates 600 trucks across 11 states."),
    ]),
    cap("cap-af-telematics", "c-atlas", "Fleet telematics", "In-house telematics platform.", ["fleet-telematics"], [ev("s-af-web", "Proprietary telematics on all trucks.")]),
  ],
  needs: [
    need("need-af-ai", "c-atlas", "AI transformation", "Website states an intent to embrace AI across operations.", ["enterprise-ai-apps"], "exploring", [
      ev("s-af-web", "We are embracing AI to transform every part of our operations.", "fact", true),
    ], "public"),
  ],
  objectives: [obj("obj-af-1", "Improve fleet utilization.", "Ongoing", [ev("s-af-web", "Stated on company site.", "fact", true)])],
  constraints: [],
};

export const seedCompanies: Company[] = [edgevision, eurocompute, securechannel, kestrel, atlas];

export const seedPeople: Person[] = [
  { id: "p-maya", name: "Maya Chen", role: "VP Business Development", companyId: "c-edgevision", location: "San Francisco", bio: "Leads partnerships and international expansion at EdgeVision." },
  { id: "p-lukas", name: "Lukas Brandt", role: "Head of Partnerships", companyId: "c-eurocompute", location: "Stuttgart", bio: "Builds EuroCompute's partnerships with software vendors." },
  { id: "p-sophie", name: "Sophie Laurent", role: "Director, Emerging Technology", companyId: "c-securechannel", location: "Amsterdam", bio: "Owns SecureChannel's new-vendor portfolio." },
  { id: "p-daniel", name: "Daniel Okafor", role: "CTO", companyId: "c-kestrel", location: "Austin", bio: "Runs engineering and the robotics safety roadmap." },
  { id: "p-rosa", name: "Rosa Martínez", role: "COO", companyId: "c-atlas", location: "Chicago", bio: "Runs fleet operations and technology." },
];

const rel = (id: string, a: string, b: string, ca: string, cb: string, encounter: Relationship["encounter"]): Relationship => ({
  id,
  personIds: [a, b],
  companyIds: [ca, cb],
  encounter,
  status: "unevaluated",
  evaluations: [],
  visibility: "connection",
});

export const seedRelationships: Relationship[] = [
  rel("r-maya-lukas", "p-maya", "p-lukas", "c-edgevision", "c-eurocompute", {
    event: "Embedded World 2026",
    location: "Nuremberg",
    date: "2026-03-24T00:00:00.000Z",
    note: "Talked after the edge computing panel. Exchanged contacts, never followed up.",
  }),
  rel("r-maya-sophie", "p-maya", "p-sophie", "c-edgevision", "c-securechannel", {
    event: "The AI Conference 2026",
    location: "San Francisco",
    date: "2026-09-29T00:00:00.000Z",
    note: "Met at the partner lounge this morning.",
  }),
  rel("r-maya-daniel", "p-maya", "p-daniel", "c-edgevision", "c-kestrel", {
    event: "Robotics Summit 2025",
    location: "Boston",
    date: "2025-05-14T00:00:00.000Z",
    note: "Short chat about warehouse safety.",
  }),
  rel("r-maya-rosa", "p-maya", "p-rosa", "c-edgevision", "c-atlas", {
    event: "Supply Chain AI Forum",
    location: "Chicago",
    date: "2025-10-02T00:00:00.000Z",
    note: "Sat at the same dinner table.",
  }),
];

/** Relationships whose agents were already connected before the demo starts, with the time they were evaluated. */
export const preEvaluated: { relationshipId: string; at: string }[] = [
  { relationshipId: "r-maya-rosa", at: "2025-10-03T09:00:00.000Z" },
  { relationshipId: "r-maya-daniel", at: "2025-05-15T09:00:00.000Z" },
  { relationshipId: "r-maya-sophie", at: "2026-09-29T11:40:00.000Z" },
];

export const seedSignals: Signal[] = [
  {
    id: "sig-ec-brno",
    companyId: "c-eurocompute",
    type: "market-expansion",
    headline: "EuroCompute opens second integration line in Brno",
    description: "Doubles appliance integration capacity; utilization targets set for 2027.",
    sourceId: "s-ec-pr",
    occurredAt: "2026-09-02T00:00:00.000Z",
    effect: {},
    affectedRelationshipIds: [],
    simulated: true,
  },
];

/** Signal injected by FAST FORWARD +6 MONTHS. Simulated and labelled as such. */
export const futureSignal: Signal = {
  id: "sig-ev-europe",
  companyId: "c-edgevision",
  type: "market-expansion",
  headline: "EdgeVision announces expansion into Germany and Western Europe",
  description:
    "Opens a Munich office and EU support center, names a General Manager for Europe and targets enterprise customers in DACH, Benelux and France from H2 2027.",
  sourceId: "s-sig-ev-eu",
  occurredAt: "2027-03-24T00:00:00.000Z",
  simulated: true,
  affectedRelationshipIds: [],
  effect: {
    addCapabilities: [
      cap(
        "cap-ev-eu",
        "c-edgevision",
        "EU presence & support center",
        "Munich office with EU support and GDPR-compliant deployment operations.",
        ["eu-market-presence", "eu-support"],
        [ev("s-sig-ev-eu", "Munich office and EU support center open; GDPR-compliant deployment operations in place.")],
        "public",
        "2027-03-24T00:00:00.000Z",
      ),
    ],
    escalateNeeds: [
      {
        needId: "need-ev-europe",
        intensity: "critical",
        evidence: ev("s-sig-ev-eu", "Munich office open; General Manager for Europe appointed."),
        disclosure: "EdgeVision has publicly committed to Europe: Munich office open, GM Europe appointed.",
      },
      {
        needId: "need-ev-dist",
        intensity: "critical",
        evidence: ev("s-sig-ev-eu", "Targets enterprise customers in DACH, Benelux and France from H2 2027; no channel partner announced."),
        disclosure: "EdgeVision needs a European enterprise channel for its H2 2027 launch — none announced.",
      },
      { needId: "need-ev-mfg", intensity: "active", evidence: ev("s-sig-ev-eu", "EU customers will be served from EU-built hardware.") },
    ],
    addObjectives: [obj("obj-ev-3", "Land first 20 European enterprise customers by end of 2027.", "2027", [ev("s-sig-ev-eu", "Stated in expansion announcement.")])],
    addGeographies: ["Germany", "Western Europe"],
  },
};
