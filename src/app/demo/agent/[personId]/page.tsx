"use client";

import { notFound, useParams } from "next/navigation";
import { AgentProfile } from "@/components/agent-profile";
import { useOrqo } from "@/lib/store";

export default function PersonAgentPage() {
  const { personId } = useParams<{ personId: string }>();
  const world = useOrqo((s) => s.world);
  if (!world.people[personId]) notFound();
  return <AgentProfile world={world} personId={personId} />;
}
