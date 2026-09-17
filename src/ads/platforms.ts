import type { AdChannel, AdTarget } from "./types";

// Editorial defaults, not platform acceptance limits. Safe zones are conservative
// composition guides and must be checked in each placement's current preview.
export const AD_TARGETS: Record<AdChannel, AdTarget> = {
  youtube_shorts: {
    channel: "youtube_shorts",
    label: "YouTube Shorts",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    durationSeconds: 30,
    safeZone: { topPercent: 8, rightPercent: 8, bottomPercent: 20, leftPercent: 8 },
    captionedByDefault: true,
  },
  youtube_instream: {
    channel: "youtube_instream",
    label: "YouTube In-stream",
    aspectRatio: "16:9",
    width: 1920,
    height: 1080,
    durationSeconds: 30,
    safeZone: { topPercent: 5, rightPercent: 5, bottomPercent: 12, leftPercent: 5 },
    captionedByDefault: true,
  },
  instagram_reels: {
    channel: "instagram_reels",
    label: "Instagram Reels",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    durationSeconds: 15,
    safeZone: { topPercent: 12, rightPercent: 10, bottomPercent: 24, leftPercent: 10 },
    captionedByDefault: true,
  },
  tiktok: {
    channel: "tiktok",
    label: "TikTok",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    durationSeconds: 15,
    safeZone: { topPercent: 10, rightPercent: 12, bottomPercent: 22, leftPercent: 8 },
    captionedByDefault: true,
  },
  facebook_feed: {
    channel: "facebook_feed",
    label: "Facebook Feed",
    aspectRatio: "4:5",
    width: 1080,
    height: 1350,
    durationSeconds: 15,
    safeZone: { topPercent: 8, rightPercent: 8, bottomPercent: 16, leftPercent: 8 },
    captionedByDefault: true,
  },
};

export function getAdTarget(channel: AdChannel): AdTarget {
  return AD_TARGETS[channel];
}
