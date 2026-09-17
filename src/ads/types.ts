export type AdChannel =
  | "youtube_shorts"
  | "youtube_instream"
  | "instagram_reels"
  | "tiktok"
  | "facebook_feed";

export type AdGoal =
  | "awareness"
  | "traffic"
  | "lead"
  | "install"
  | "purchase";

export type AspectRatio = "9:16" | "16:9" | "1:1" | "4:5";

export type AdBrief = {
  brandName: string;
  productName: string;
  audience: string;
  problem: string;
  promise: string;
  offer?: string;
  proof?: string[];
  callToAction: string;
  goal: AdGoal;
  channels: AdChannel[];
  tone?: string[];
  requiredText?: string[];
  prohibitedClaims?: string[];
};

export type AdTarget = {
  channel: AdChannel;
  label: string;
  aspectRatio: AspectRatio;
  width: number;
  height: number;
  durationSeconds: number;
  safeZone: {
    topPercent: number;
    rightPercent: number;
    bottomPercent: number;
    leftPercent: number;
  };
  captionedByDefault: boolean;
};

export type AdBeatKind =
  | "hook"
  | "problem"
  | "product"
  | "proof"
  | "offer"
  | "cta";

export type AdBeat = {
  id: string;
  kind: AdBeatKind;
  startSeconds: number;
  endSeconds: number;
  objective: string;
  visualDirection: string;
  voiceover: string;
  onScreenText?: string;
};

export type AdVariantPlan = {
  id: string;
  name: string;
  hookAngle: string;
  target: AdTarget;
  beats: AdBeat[];
};

export type AdPlan = {
  brief: AdBrief;
  createdAt: string;
  variants: AdVariantPlan[];
};
