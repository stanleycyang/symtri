import { Composition, OffthreadVideo, Sequence, interpolate, spring, registerRoot, staticFile } from "remotion";
import React from "react";

const TitleCard: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => {
  return (
    <div style={{ flex: 1, background: "#07090d", color: "#e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, ui-sans-serif, system-ui" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ letterSpacing: 2, fontSize: 24, color: "#c6cbd2", marginBottom: 8 }}>SYMTRI</div>
        <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1.1 }}>The internet is thinking</div>
        <div style={{ fontSize: 22, color: "#c6cbd2", marginTop: 14 }}>{subtitle}</div>
      </div>
    </div>
  );
};

const Caption: React.FC<{ frame: number; from: number; to: number; text: string }> = ({ frame, from, to, text }) => {
  const progress = Math.min(1, Math.max(0, (frame - from) / Math.max(1, to - from)));
  const y = interpolate(progress, [0, 1], [28, 0]);
  const opacity = spring({ frame: frame - from, fps: 30, config: { damping: 200, stiffness: 120 } });
  return (
    <div style={{ position: "absolute", left: 42, bottom: 42, color: "#f4e2cc", fontSize: 24, transform: `translateY(${y}px)`, opacity }}>
      {text}
    </div>
  );
};

const WrapVideo: React.FC<{ src: string; width: number; height: number }> = ({ src, width, height }) => {
  const duration = 30 * 30; // 30 seconds at 30 fps
  return (
    <div style={{ flex: 1, background: "#07090d" }}>
      <Sequence durationInFrames={90}>
        <TitleCard title="SYMTRI" subtitle="A living map of technology" />
      </Sequence>
      <Sequence from={90} durationInFrames={duration - 180}>
        <OffthreadVideo src={src} />
        <Caption frame={0} from={100} to={260} text="Enter the universe" />
        <Caption frame={0} from={260} to={430} text="Orbit and zoom smoothly" />
        <Caption frame={0} from={430} to={600} text="Open AI → Agents" />
        <Caption frame={0} from={600} to={780} text="Ask: How is AI connected to energy?" />
      </Sequence>
      <Sequence from={duration - 90} durationInFrames={90}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#e5e7eb", fontSize: 28 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ marginBottom: 10 }}>symtri.com</div>
            <div style={{ fontSize: 20, color: "#c6cbd2" }}>Star the repo on GitHub</div>
          </div>
        </div>
      </Sequence>
    </div>
  );
};

export function RemotionRoot() {
  const wide = staticFile("/demo-raw-1600x1000.mp4");
  const square = staticFile("/demo-raw-1080x1080.mp4");
  return (
    <>
      <Composition
        id="Demo16x9"
        component={() => <WrapVideo src={wide} width={1600} height={1000} />}
        durationInFrames={30 * 30}
        fps={30}
        width={1600}
        height={900}
      />
      <Composition
        id="DemoSquare"
        component={() => <WrapVideo src={square} width={1080} height={1080} />}
        durationInFrames={30 * 30}
        fps={30}
        width={1080}
        height={1080}
      />
    </>
  );
}

registerRoot(RemotionRoot);

