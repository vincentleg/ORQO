/**
 * Server-only configuration. Values come from the environment (.env.local).
 * Never send these values to the client; `publicStatus` exposes only booleans
 * and model names.
 */
export interface ServerConfig {
  openrouter: { apiKey?: string; discoveryModel: string; enabled: boolean };
  neo4j: { uri?: string; username?: string; password?: string; database: string };
  brave: { apiKey?: string };
}

/**
 * Emergency stop for every PAID provider (OpenRouter, Brave). When ORQO_PROVIDERS_KILL_SWITCH=on, the
 * configuration reports them as absent, so every existing gate (research policy, agent tools, legacy routes,
 * status) fails closed through its normal "not configured / unavailable" path. Deterministic features, the
 * official-site analysis and Neo4j are unaffected. No restart-free toggle: it is read per call from the env.
 */
export function paidProvidersKilled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ORQO_PROVIDERS_KILL_SWITCH === "on";
}

export function serverConfig(): ServerConfig {
  const env = process.env;
  const killed = paidProvidersKilled(env);
  return {
    openrouter: {
      apiKey: killed ? undefined : env.OPENROUTER_API_KEY || undefined,
      discoveryModel: env.ORQO_DISCOVERY_MODEL || env.OPENROUTER_MODEL || "google/gemini-3.8-flash",
      enabled: !killed && env.ORQO_LIVE_AI !== "off",
    },
    neo4j: {
      uri: env.NEO4J_URI || undefined,
      username: env.NEO4J_USERNAME || env.NEO4J_USER || undefined,
      password: env.NEO4J_PASSWORD || undefined,
      database: env.NEO4J_DATABASE || "neo4j",
    },
    brave: { apiKey: killed ? undefined : env.BRAVE_API_KEY || env.BRAVE_SEARCH_API_KEY || undefined },
  };
}

/**
 * Legacy demo routes (/api/discover, /api/research) spend paid provider
 * credits for any signed-in user, with no plan, quota or usage ledger. They
 * are therefore OFF unless the operator opts in with ORQO_DEMO_LIVE_PROVIDERS=on
 * (e.g. for a supervised live demo). Production research goes through
 * /api/v1/organizations/:org/research, which enforces the full policy.
 */
export function legacyLiveProvidersEnabled(): boolean {
  return process.env.ORQO_DEMO_LIVE_PROVIDERS === "on";
}

export interface PublicStatus {
  /** `signInRequired`: a key is configured, but live AI calls are only served to signed-in users. */
  ai: { available: boolean; signInRequired: boolean; provider: "openrouter"; model: string };
  /** backend: the /demo graph mirror (always in-memory). configured: Neo4j settings exist for the workspace Opportunity Graph. */
  graph: { backend: "memory"; configured: boolean };
  research: { brave: boolean };
  agentMessaging: { band: boolean };
}

export function publicStatus(opts: { signedIn: boolean }): PublicStatus {
  const c = serverConfig();
  const configured = Boolean(c.openrouter.apiKey && c.openrouter.enabled && legacyLiveProvidersEnabled());
  return {
    ai: { available: configured && opts.signedIn, signInRequired: configured && !opts.signedIn, provider: "openrouter", model: c.openrouter.discoveryModel },
    graph: { backend: "memory", configured: Boolean(c.neo4j.uri && c.neo4j.password) },
    research: { brave: Boolean(c.brave.apiKey && legacyLiveProvidersEnabled()) },
    agentMessaging: { band: Boolean(process.env.BAND_API_KEY) },
  };
}
