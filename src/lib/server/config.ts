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

export function serverConfig(): ServerConfig {
  const env = process.env;
  return {
    openrouter: {
      apiKey: env.OPENROUTER_API_KEY || undefined,
      discoveryModel: env.ORQO_DISCOVERY_MODEL || env.OPENROUTER_MODEL || "google/gemini-3.8-flash",
      enabled: env.ORQO_LIVE_AI !== "off",
    },
    neo4j: {
      uri: env.NEO4J_URI || undefined,
      username: env.NEO4J_USERNAME || env.NEO4J_USER || undefined,
      password: env.NEO4J_PASSWORD || undefined,
      database: env.NEO4J_DATABASE || "neo4j",
    },
    brave: { apiKey: env.BRAVE_API_KEY || env.BRAVE_SEARCH_API_KEY || undefined },
  };
}

export interface PublicStatus {
  /** `signInRequired`: a key is configured, but live AI calls are only served to signed-in users. */
  ai: { available: boolean; signInRequired: boolean; provider: "openrouter"; model: string };
  graph: { backend: "neo4j" | "memory"; configured: boolean };
  research: { brave: boolean };
  agentMessaging: { band: boolean };
}

export function publicStatus(opts: { signedIn: boolean }): PublicStatus {
  const c = serverConfig();
  const configured = Boolean(c.openrouter.apiKey && c.openrouter.enabled);
  return {
    ai: { available: configured && opts.signedIn, signInRequired: configured && !opts.signedIn, provider: "openrouter", model: c.openrouter.discoveryModel },
    graph: { backend: c.neo4j.uri && c.neo4j.password ? "neo4j" : "memory", configured: Boolean(c.neo4j.uri && c.neo4j.password) },
    research: { brave: Boolean(c.brave.apiKey) },
    agentMessaging: { band: Boolean(process.env.BAND_API_KEY) },
  };
}
