export type Sector =
  | "ai"
  | "fintech"
  | "cleantech"
  | "biotech"
  | "consumer_hardware"
  | "consumer_marketplace";

export const SECTOR_LABEL: Record<Sector, string> = {
  ai: "AI / 算法",
  fintech: "金融科技",
  cleantech: "新能源",
  biotech: "生物医药",
  consumer_hardware: "消费硬件",
  consumer_marketplace: "消费互联网",
};

export const ALL_SECTORS: readonly Sector[] = [
  "ai",
  "fintech",
  "cleantech",
  "biotech",
  "consumer_hardware",
  "consumer_marketplace",
];

export type MarketTrend = "hot" | "cold" | "neutral";
