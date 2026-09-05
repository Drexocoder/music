export type PlanId = "free" | "silver" | "gold" | "platinum";

export type Plan = {
  id: PlanId;
  label: string;
  priceInr: number;
  daily: number;
  monthly: number;
  perks: string[];
};

export const OWNER_TELEGRAM_ID = 8186068163;
export const SUPPORT_HANDLE = "@sini_here";

export const PLANS: Plan[] = [
  {
    id: "free",
    label: "Free",
    priceInr: 0,
    daily: 300,
    monthly: 9000,
    perks: ["Search + audio & video downloads", "Auto renews every 30 days"],
  },
  {
    id: "silver",
    label: "Silver",
    priceInr: 45,
    daily: 2000,
    monthly: 60000,
    perks: ["Great for a single music bot", "Priority queue"],
  },
  {
    id: "gold",
    label: "Gold",
    priceInr: 100,
    daily: 5000,
    monthly: 150000,
    perks: ["For busy bots / several groups", "Priority queue"],
  },
  {
    id: "platinum",
    label: "Platinum",
    priceInr: 150,
    daily: 7000,
    monthly: 210000,
    perks: ["Highest limits", "Direct support"],
  },
];

export function planById(id: string): Plan {
  return PLANS.find((p) => p.id === id) ?? PLANS[0]!;
}
