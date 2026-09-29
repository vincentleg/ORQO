/**
 * Shared capability/need vocabulary. Capabilities and needs are tagged with the
 * same terms so the Bilateral Reasoning module can align one side's needs with
 * the other side's capabilities.
 */
export const TAGS = {
  "edge-ai-software": "Edge AI software",
  "computer-vision": "Computer vision",
  "video-analytics": "Video analytics",
  "ai-inference": "AI inference runtime",
  "enterprise-ai-apps": "Enterprise AI applications",
  "us-technology": "US-developed technology",
  "hardware-integration": "Hardware integration",
  "gpu-edge-systems": "GPU / edge systems",
  "eu-manufacturing": "European manufacturing",
  "testing-certification": "Testing & certification",
  logistics: "Logistics",
  "oem-odm": "OEM / ODM services",
  "eu-deployment": "European deployment",
  "eu-market-presence": "European market presence",
  "eu-support": "EU-based support",
  "eu-enterprise-distribution": "European enterprise distribution",
  "channel-sales": "Channel sales",
  "enterprise-relationships": "Enterprise relationships",
  "security-customer-network": "Cybersecurity customer network",
  "packaged-solution": "Packaged hardware/software solution",
  "ai-infrastructure-product": "AI infrastructure product",
  robotics: "Robotics platform",
  "warehouse-automation": "Warehouse automation",
  "us-enterprise-distribution": "US enterprise distribution",
  "freight-logistics": "Freight & logistics",
  "fleet-telematics": "Fleet telematics",
} as const;

export type Tag = keyof typeof TAGS;

export function tagLabel(tag: Tag): string {
  return TAGS[tag];
}
