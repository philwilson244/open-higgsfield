import type { BrandKit } from "./schema";
import type { AdBrief } from "./types";

export const emptyBrandKit: BrandKit = {
  name: "",
  product: "",
  audience: "",
  color: "#d1fe17",
  tone: [],
  requiredText: [],
  prohibitedClaims: [],
  fonts: [],
  ctaLibrary: [],
};

export function kitFromBrief(brief: AdBrief, color: string): BrandKit {
  return {
    ...emptyBrandKit,
    name: brief.brandName,
    product: brief.productName,
    audience: brief.audience,
    color,
    tone: brief.tone ?? [],
    requiredText: brief.requiredText ?? [],
    prohibitedClaims: brief.prohibitedClaims ?? [],
    ctaLibrary: brief.callToAction ? [brief.callToAction] : [],
  };
}

// Campaign specifics stay with the brief; the kit supplies identity and guardrails.
export function applyBrandKit(brief: AdBrief, kit: BrandKit): AdBrief {
  return {
    ...brief,
    brandName: kit.name,
    productName: kit.product,
    audience: kit.audience,
    tone: [...kit.tone],
    requiredText: [...kit.requiredText],
    prohibitedClaims: [...kit.prohibitedClaims],
    callToAction: brief.callToAction || kit.ctaLibrary[0] || "",
  };
}
