import type { BrandKit } from "./schema";

export type CompanyTemplate = {
  id: "fullcourt" | "pocket" | "pws";
  label: string;
  kit: BrandKit;
};

export const COMPANY_TEMPLATES: readonly CompanyTemplate[] = [
  {
    id: "fullcourt",
    label: "Fullcourt",
    kit: {
      name: "Fullcourt",
      product: "The app for organizing pickup games, leagues, courts, check-ins, and player stats",
      audience: "Pickup basketball players, organizers, league operators, and gym owners",
      tone: ["Competitive", "Funny", "Fast", "Community-driven", "Basketball-authentic"],
      color: "#ff5a1f",
      requiredText: ["Fullcourt"],
      prohibitedClaims: ["Guaranteed competition", "Guaranteed players"],
      fonts: ["Bay Boss", "Inter"],
      ctaLibrary: ["Create your game", "Find your run", "Claim your home court"],
      voiceDirection: "Confident basketball voice. Short sentences, real gym language, never corporate.",
      musicDirection: "Percussive hip-hop energy with clean licensing and room for sneaker and ball sound design.",
      referenceNotes: "Use the real Fullcourt interface for every phone screen. Never generate fake app UI.",
    },
  },
  {
    id: "pocket",
    label: "Pocket OS.AI",
    kit: {
      name: "Pocket OS.AI",
      product: "Operating software for rental operators, brokers, private car clubs, and automotive sales teams",
      audience: "Rental fleet operators, exotic-car brokers, private clubs, and independent dealers",
      tone: ["Sharp", "Funny", "Premium", "Direct", "Operator-first"],
      color: "#4ade80",
      requiredText: ["Pocket"],
      prohibitedClaims: ["Guaranteed revenue", "Guaranteed bookings", "Risk-free"],
      fonts: ["Inter", "Geist"],
      ctaLibrary: ["Ditch your lazy business partner", "Own your customer", "Run it on Pocket"],
      voiceDirection: "Dry, confident delivery. The joke should land before the product explanation.",
      musicDirection: "Modern luxury pulse, restrained bass, clean cinematic transitions.",
      referenceNotes: "Composite real Pocket screenshots onto phones. Preserve vehicle identity, wheels, paint, and interiors.",
    },
  },
  {
    id: "pws",
    label: "PWS",
    kit: {
      name: "Philip Wilson Sportscars",
      product: "Private exotic-car brokerage, acquisition, consignment, and market advisory",
      audience: "Celebrities, professional athletes, executives, collectors, and serious exotic-car buyers",
      tone: ["Discreet", "Expert", "Cinematic", "Personal", "No hype"],
      color: "#d4af37",
      requiredText: ["Philip Wilson Sportscars"],
      prohibitedClaims: ["Guaranteed appreciation", "Investment guaranteed", "Lowest price"],
      fonts: ["Cormorant Garamond", "Inter"],
      ctaLibrary: ["Private inquiries", "Source your next car", "Sell discreetly"],
      voiceDirection: "Calm expert narration from a trusted broker. Specific car details over superlatives.",
      musicDirection: "Minimal cinematic score with natural engine sound kept forward in the mix.",
      referenceNotes: "Source footage is vehicle truth. Never alter options, paint, wheels, bodywork, or interior specification.",
    },
  },
];
