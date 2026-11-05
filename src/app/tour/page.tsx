import type { Metadata } from "next";
import { TourPlayer } from "@/components/tour/player";
import { buildTour } from "@/lib/tour/scenario";

/**
 * The public guided tour (Nov 2026): one click from the home page, then ORQO plays a complete
 * business-development case by itself. Static: the scenario is computed at build time by the product engine
 * from prepared data. No account, no session, no database, no provider.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "ORQO — guided demo",
  description: "Watch ORQO turn company intelligence into a concrete, evidence-backed partnership opportunity.",
};

export default function TourPage() {
  return <TourPlayer data={buildTour()} />;
}
