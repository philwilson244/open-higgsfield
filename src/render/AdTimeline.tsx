import { AbsoluteFill, OffthreadVideo, Sequence, useVideoConfig } from "remotion";

export type TimelineClip = {
  src: string;
  startSeconds: number;
  endSeconds: number;
  onScreenText?: string;
};

export type AdTimelineProps = {
  brand: string;
  accentColor?: string;
  clips: TimelineClip[];
};

export function AdTimeline({ brand, accentColor = "#d1fe17", clips }: AdTimelineProps) {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: "#000", fontFamily: "Arial, sans-serif" }}>
      {clips.map((clip, index) => {
        const from = Math.round(clip.startSeconds * fps);
        const durationInFrames = Math.max(1, Math.round((clip.endSeconds - clip.startSeconds) * fps));
        return (
          <Sequence key={`${clip.src}-${index}`} from={from} durationInFrames={durationInFrames}>
            <AbsoluteFill>
              <OffthreadVideo
                src={clip.src}
                startFrom={0}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
              {clip.onScreenText ? (
                <div style={{
                  position: "absolute", left: "7%", right: "7%", bottom: "12%",
                  color: "white", fontSize: 54, lineHeight: 1.05, fontWeight: 800,
                  textAlign: "center", textShadow: "0 3px 18px #000",
                }}>
                  {clip.onScreenText}
                </div>
              ) : null}
            </AbsoluteFill>
          </Sequence>
        );
      })}
      <div style={{ position: "absolute", top: 28, left: 34, color: accentColor, fontSize: 24, fontWeight: 800 }}>
        {brand}
      </div>
    </AbsoluteFill>
  );
}
