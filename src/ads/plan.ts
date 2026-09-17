import { getAdTarget } from "./platforms";
import type { AdBeat, AdBeatKind, AdBrief, AdPlan, AdTarget, AdVariantPlan } from "./types";

type HookAngle = {
  id: string;
  name: string;
  hookAngle: string;
  hookVisual: (brief: AdBrief) => string;
  hookVoiceover: (brief: AdBrief) => string;
};

const HOOK_ANGLES: readonly HookAngle[] = [
  {
    id: "pain-interrupt",
    name: "Pain Interrupt",
    hookAngle: "Open on the audience's frustration before showing the product.",
    hookVisual: (brief) => `Show ${brief.audience} hitting the moment where ${brief.problem} becomes impossible to ignore.`,
    hookVoiceover: (brief) => `Still dealing with ${brief.problem}?`,
  },
  {
    id: "desired-future",
    name: "Desired Future",
    hookAngle: "Lead with the result the audience wants, then reveal how it happens.",
    hookVisual: (brief) => `Open on the cleanest visual expression of this result: ${brief.promise}.`,
    hookVoiceover: (brief) => `What if you could ${lowercaseFirst(brief.promise)}?`,
  },
  {
    id: "proof-first",
    name: "Proof First",
    hookAngle: "Put evidence or the product result in the first two seconds.",
    hookVisual: (brief) =>
      brief.proof?.[0]
        ? `Turn this proof into a visual headline: ${brief.proof[0]}.`
        : `Show a fast before-and-after that demonstrates ${brief.promise}.`,
    hookVoiceover: (brief) =>
      brief.proof?.[0] ?? `See how ${brief.productName} delivers: ${brief.promise}.`,
  },
];

export function createAdPlan(brief: AdBrief, now = new Date()): AdPlan {
  return {
    brief,
    createdAt: now.toISOString(),
    variants: brief.channels.flatMap((channel) => {
      const target = getAdTarget(channel);
      return HOOK_ANGLES.map((angle) => createVariant(brief, target, angle));
    }),
  };
}

function createVariant(
  brief: AdBrief,
  target: AdTarget,
  angle: HookAngle,
): AdVariantPlan {
  const windows = beatWindows(target.durationSeconds, Boolean(brief.offer));
  const beats = windows.map((window, index) =>
    createBeat(brief, target, angle, window.kind, index, window.start, window.end),
  );

  return {
    id: `${target.channel}-${angle.id}`,
    name: `${target.label} · ${angle.name}`,
    hookAngle: angle.hookAngle,
    target,
    beats,
  };
}

function createBeat(
  brief: AdBrief,
  target: AdTarget,
  angle: HookAngle,
  kind: AdBeatKind,
  index: number,
  startSeconds: number,
  endSeconds: number,
): AdBeat {
  const base = {
    id: `${target.channel}-${angle.id}-${index + 1}`,
    kind,
    startSeconds,
    endSeconds,
  };

  switch (kind) {
    case "hook":
      return {
        ...base,
        objective: "Stop the scroll and make the audience recognize themselves.",
        visualDirection: angle.hookVisual(brief),
        voiceover: angle.hookVoiceover(brief),
        onScreenText: trimForOverlay(brief.problem),
      };
    case "problem":
      return {
        ...base,
        objective: "Make the cost of the current behavior concrete.",
        visualDirection: `Show the friction created by ${brief.problem} with one readable action, not a montage.`,
        voiceover: `For ${brief.audience}, ${brief.problem} wastes time and kills momentum.`,
      };
    case "product":
      return {
        ...base,
        objective: "Reveal the product and demonstrate the central action.",
        visualDirection: `Show ${brief.productName} solving the problem in a close, readable product shot.`,
        voiceover: `${brief.productName} helps you ${lowercaseFirst(brief.promise)}.`,
        onScreenText: trimForOverlay(brief.promise),
      };
    case "proof":
      return {
        ...base,
        objective: "Give the claim a reason to be believed.",
        visualDirection: brief.proof?.length
          ? `Show evidence on screen: ${brief.proof.join("; ")}.`
          : "Show a specific product result with a clear before-and-after comparison.",
        voiceover: brief.proof?.[0] ?? `See the difference ${brief.productName} makes.`,
      };
    case "offer":
      return {
        ...base,
        objective: "Make the next step feel immediate.",
        visualDirection: "Hold the product beside a large, simple offer card.",
        voiceover: brief.offer ?? "",
        onScreenText: brief.offer ? trimForOverlay(brief.offer) : undefined,
      };
    case "cta":
      return {
        ...base,
        objective: "End with one action and enough hold time to read it.",
        visualDirection: `End card for ${brief.brandName}, product mark, and one CTA. Keep text inside the ${target.label} safe zone.`,
        voiceover: brief.callToAction,
        onScreenText: trimForOverlay(brief.callToAction),
      };
  }
}

function beatWindows(duration: number, hasOffer: boolean) {
  const kinds: AdBeatKind[] = hasOffer
    ? ["hook", "problem", "product", "proof", "offer", "cta"]
    : ["hook", "problem", "product", "proof", "cta"];
  const weights = hasOffer
    ? [0.13, 0.2, 0.27, 0.2, 0.1, 0.1]
    : [0.13, 0.2, 0.3, 0.22, 0.15];

  let cursor = 0;
  return kinds.map((kind, index) => {
    const start = roundTime(cursor);
    cursor = index === kinds.length - 1 ? duration : cursor + duration * (weights[index] ?? 0);
    return { kind, start, end: roundTime(cursor) };
  });
}

function roundTime(value: number): number {
  return Math.round(value * 10) / 10;
}

function trimForOverlay(value: string): string {
  const words = value.trim().split(/\s+/);
  return words.length <= 8 ? value.trim() : `${words.slice(0, 8).join(" ")}…`;
}

function lowercaseFirst(value: string): string {
  return value ? `${value[0]?.toLowerCase() ?? ""}${value.slice(1)}` : value;
}
