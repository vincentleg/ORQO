"use client";

import { AgentProfile } from "@/components/agent-profile";
import { useOrqo } from "@/lib/store";

export default function AgentPage() {
  const world = useOrqo((s) => s.world);
  return <AgentProfile world={world} personId={world.viewerId} />;
}
