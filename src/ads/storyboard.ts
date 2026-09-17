import type { AdBeat, AdBrief, AdVariantPlan } from "./types";

export function shotPrompt(brief: AdBrief, beat: AdBeat): string {
  return [
    `Brand: ${brief.brandName}. Product: ${brief.productName}.`,
    `Audience: ${brief.audience}.`,
    beat.visualDirection,
    brief.tone?.length ? `Tone: ${brief.tone.join(", ")}.` : "",
    brief.prohibitedClaims?.length
      ? `Do not claim or depict: ${brief.prohibitedClaims.join("; ")}.`
      : "",
    "Do not invent product interfaces, logos, statistics, or endorsements. Add exact brand assets and text in post-production.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function storyboardWarnings(
  brief: AdBrief,
  variant: AdVariantPlan,
): string[] {
  const warnings: string[] = [];
  const copy = variant.beats
    .map((b) => `${b.voiceover} ${b.onScreenText ?? ""}`)
    .join(" ")
    .toLowerCase();
  if (!brief.proof?.length)
    warnings.push(
      "No supporting evidence supplied. Review product claims before approval.",
    );
  for (const text of brief.requiredText ?? [])
    if (!copy.includes(text.toLowerCase()))
      warnings.push(`Required copy missing: ${text}`);
  for (const claim of brief.prohibitedClaims ?? [])
    if (copy.includes(claim.toLowerCase()))
      warnings.push(`Restricted phrase found: ${claim}`);
  for (const b of variant.beats) {
    const duration = b.endSeconds - b.startSeconds;
    const words = b.voiceover.trim().split(/\s+/).filter(Boolean).length;
    if (words > duration * 3)
      warnings.push(
        `${b.kind}: voiceover is too long for ${duration.toFixed(1)}s. Shorten it or change the timing.`,
      );
  }
  return warnings;
}

export function retimeBeat(
  variant: AdVariantPlan,
  index: number,
  seconds: number,
): AdVariantPlan {
  if (
    !Number.isFinite(seconds) ||
    seconds < 0.5 ||
    index < 0 ||
    index >= variant.beats.length - 1
  )
    throw new Error("Invalid shot duration");
  const beats = variant.beats.map((b) => ({ ...b }));
  const beat = beats[index]!;
  const next = beats[index + 1]!;
  const end = Math.round((beat.startSeconds + seconds) * 10) / 10;
  if (end > next.endSeconds - 0.5)
    throw new Error("Leave at least 0.5 seconds for the next shot");
  beat.endSeconds = end;
  next.startSeconds = end;
  return { ...variant, beats };
}
