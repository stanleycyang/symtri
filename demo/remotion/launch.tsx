import React from "react";
import { AbsoluteFill, Audio, Easing, Img, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";

const palette = {
  bg: "#07090d",
  text: "#e3e4e1",
  accent: "#d5a878",
  subtle: "#a5afb8",
};

const typeStyle: React.CSSProperties = {
  fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
  fontWeight: 800,
  letterSpacing: 0.5,
};

function KineticLine({ text, from, duration = 45, y = 0, color = palette.text, size = 96, align = "center" as const }) {
  const frame = useCurrentFrame();
  const enter = spring({ frame: frame - from, fps: 30, config: { damping: 200, stiffness: 140 } });
  const exit = Math.min(1, Math.max(0, (frame - (from + duration - 24)) / 24));
  const opacity = Math.max(0, Math.min(1, enter - exit));
  const dy = interpolate(enter, [0, 1], [30, 0], { easing: Easing.out(Easing.cubic) });
  return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: align === "center" ? "center" : align === "left" ? "flex-start" : "flex-end",
      color, opacity, transform: `translateY(${y + dy}px)`,
    }}>
      <div style={{ ...typeStyle, fontSize: size, maxWidth: "86%", textAlign: align as any, lineHeight: 1.02 }}>
        {text}
      </div>
    </div>
  );
}

function Caption({ text, from, to, y = 320, size = 36 }) {
  const frame = useCurrentFrame();
  const progress = Math.min(1, Math.max(0, (frame - from) / Math.max(1, to - from)));
  const dy = interpolate(progress, [0, 1], [26, 0], { easing: Easing.ease });
  const opacity = spring({ frame: frame - from, fps: 30 });
  return (
    <div style={{ position: "absolute", left: 64, right: 64, bottom: y, color: palette.accent, opacity, transform: `translateY(${dy}px)`, fontSize: size, fontFamily: "Inter, ui-sans-serif, system-ui" }}>
      {text}
    </div>
  );
}

export function Launch({ variant = "16x9" }: { variant?: "16x9" | "square" | "vertical" }) {
  const { width, height } = useVideoConfig();
  const videoWide = staticFile("/demo-raw-1600x1000.mp4");
  const videoSquare = staticFile("/demo-raw-1080x1080.mp4");
  const videoSrc = variant === "square" ? videoSquare : videoWide;
  const objectFit = variant === "vertical" ? "cover" : "cover";
  const music = staticFile("/launch-track.mp3");

  // 75s @ 30fps = 2250 frames
  return (
    <AbsoluteFill style={{ background: palette.bg }}>
      <Audio src={music} startFrom={0} />

      {/* 1) Hook */}
      <Sequence from={0} durationInFrames={150}>
        <KineticLine text={"Search answers questions"} from={0} size={86} />
        <KineticLine text={"you already know to ask."} from={24} size={86} color={palette.accent} />
      </Sequence>

      {/* 2) Turn */}
      <Sequence from={150} durationInFrames={120}>
        <KineticLine text={"What about the connections"} from={0} size={86} />
        <KineticLine text={"you didn't?"} from={24} size={110} color={palette.accent} />
      </Sequence>

      {/* 3) Aha — ideas linking across regions with universe footage */}
      <Sequence from={270} durationInFrames={540}>
        <OffthreadVideo src={videoSrc} style={{ width: "100%", height: "100%", objectFit, filter: "brightness(0.82)" }} />
        <Caption text={"Ideas link across AI, energy, space, and science."} from={40} to={220} />
        <Caption text={"Follow signals, not just headlines."} from={220} to={380} />
      </Sequence>

      {/* 4) Features */}
      <Sequence from={810} durationInFrames={600}>
        <KineticLine text={"10 regions · 66 topics · live sources"} from={0} size={68} />
        <Caption text={"Orbit and zoom a living 3D universe."} from={40} to={220} />
        <Caption text={"Ask SYMTRI across topics — with real sources."} from={220} to={400} />
        <Caption text={"Read the weekly Signal with citations."} from={400} to={560} />
      </Sequence>

      {/* 5) Open source */}
      <Sequence from={1410} durationInFrames={180}>
        <KineticLine text={"Open source."} from={0} size={96} color={palette.accent} />
        <Caption text={"GitHub · Contributors welcome"} from={30} to={150} />
      </Sequence>

      {/* 6) End card */}
      <Sequence from={1590} durationInFrames={660}>
        <AbsoluteFill style={{ background: palette.bg, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", color: palette.text }}>
          <div style={{ ...typeStyle, fontSize: 60, letterSpacing: 2, color: palette.subtle, marginBottom: 8 }}>SYMTRI</div>
          <div style={{ ...typeStyle, fontSize: 84, color: palette.text, textAlign: "center", lineHeight: 1.05, maxWidth: "90%" }}>
            The internet is thinking.
          </div>
          <div style={{ marginTop: 22, fontSize: 28, color: palette.accent, fontFamily: "Inter, ui-sans-serif, system-ui" }}>
            symtri.com · Star on GitHub
          </div>
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
}

