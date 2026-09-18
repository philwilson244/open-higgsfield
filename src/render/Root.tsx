import { Composition, registerRoot } from "remotion";
import { AdTimeline, type AdTimelineProps } from "./AdTimeline";

const defaults: AdTimelineProps = { brand: "Open Higgsfield", clips: [] };

function RemotionRoot() {
  return (
    <Composition
      id="AdTimeline"
      component={AdTimeline}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={450}
      defaultProps={defaults}
      calculateMetadata={({ props }) => {
        const duration = props.clips.reduce((max, clip) => Math.max(max, clip.endSeconds), 1);
        return { durationInFrames: Math.max(1, Math.ceil(duration * 30)) };
      }}
    />
  );
}

registerRoot(RemotionRoot);
