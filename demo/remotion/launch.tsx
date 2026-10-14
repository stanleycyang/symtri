import type { CSSProperties } from "react";
import { AbsoluteFill, Html5Audio, Easing, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";

const palette = { bg: "#07090d", text: "#e3e4e1", accent: "#d5a878", subtle: "#a5afb8" };
const typeStyle: CSSProperties = { fontFamily: "Arial, sans-serif", fontWeight: 800, letterSpacing: 0.5 };

type LineProps = { text: string; from?: number; duration: number; y?: number; color?: string; size: number };
function KineticLine({ text, from = 0, duration, y = 0, color = palette.text, size }: LineProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - from, fps, config: { damping: 200, stiffness: 140 } });
  const exit = Math.min(1, Math.max(0, (frame - (from + duration - 24)) / 24));
  const opacity = Math.max(0, Math.min(1, enter - exit));
  const dy = interpolate(enter, [0, 1], [30, 0], { easing: Easing.out(Easing.cubic) });
  return <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", color, opacity, transform: `translateY(${y + dy}px)` }}>
    <div style={{ ...typeStyle, fontSize: size, maxWidth: "86%", textAlign: "center", lineHeight: 1.1 }}>{text}</div>
  </AbsoluteFill>;
}

function Caption({ text, size }: { text: string; size: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = spring({ frame, fps, config: { damping: 200 } });
  return <div style={{ position: "absolute", left: "6%", right: "6%", bottom: "12%", padding: "20px", background: "rgba(7,9,13,.92)", color: palette.accent, opacity, fontSize: size, fontFamily: "Arial, sans-serif", textAlign: "center" }}>{text}</div>;
}

export function Launch({ variant = "16x9" }: { variant?: "16x9" | "square" | "vertical" }) {
  const { durationInFrames } = useVideoConfig();
  const wide = variant === "16x9";
  const headline = wide ? 86 : 64;
  const caption = wide ? 36 : 30;
  const videoSrc = staticFile(wide ? "launch-demo-wide.mp4" : "launch-demo-square.mp4");
  return <AbsoluteFill style={{ background: palette.bg }}>
    <Html5Audio src={staticFile("launch-track.mp3")} volume={frame => 0.25 * Math.max(0, Math.min(1, frame / 60, (durationInFrames - frame) / 90))} />
    <Sequence durationInFrames={150}>
      <KineticLine text="Search answers questions" duration={150} y={-85} size={headline} />
      <KineticLine text="you already know to ask." from={24} duration={126} y={85} size={headline} color={palette.accent} />
    </Sequence>
    <Sequence from={150} durationInFrames={120}>
      <KineticLine text="What about the connections" duration={120} y={-85} size={headline} />
      <KineticLine text="you didn't?" from={24} duration={96} y={85} size={headline + 16} color={palette.accent} />
    </Sequence>
    <Sequence from={270} durationInFrames={540}>
      <OffthreadVideo src={videoSrc} trimBefore={60} muted style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      <Sequence from={40} durationInFrames={180}><Caption text="Explore AI, energy, space, and science." size={caption} /></Sequence>
      <Sequence from={220} durationInFrames={160}><Caption text="Follow signals back to their sources." size={caption} /></Sequence>
    </Sequence>
    <Sequence from={810} durationInFrames={600}>
      <KineticLine text="Research. Code. Discussion." duration={600} y={-80} size={headline} />
      <Sequence from={40} durationInFrames={180}><Caption text="Orbit and zoom a living 3D universe." size={caption} /></Sequence>
      <Sequence from={220} durationInFrames={180}><Caption text="Ask across topics, with original sources." size={caption} /></Sequence>
      <Sequence from={400} durationInFrames={160}><Caption text="Read the weekly Signal with citations." size={caption} /></Sequence>
    </Sequence>
    <Sequence from={1410} durationInFrames={180}>
      <KineticLine text="Open source." duration={180} y={-60} size={headline + 10} color={palette.accent} />
      <Sequence from={30} durationInFrames={120}><Caption text="GitHub · Contributors welcome" size={caption} /></Sequence>
    </Sequence>
    <Sequence from={1590} durationInFrames={660}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", color: palette.text, textAlign: "center" }}>
        <div style={{ ...typeStyle, fontSize: 48, letterSpacing: 2, color: palette.subtle }}>SYMTRI</div>
        <div style={{ ...typeStyle, fontSize: headline, lineHeight: 1.1, maxWidth: "86%", marginTop: 24 }}>The internet is thinking.</div>
        <div style={{ marginTop: 28, fontSize: caption, color: palette.accent, fontFamily: "Arial, sans-serif" }}>symtri.com · Star on GitHub</div>
        <div style={{ position: "absolute", left: "6%", right: "6%", bottom: "5%", fontSize: wide ? 22 : 20, lineHeight: 1.5, color: palette.subtle, fontFamily: "Arial, sans-serif" }}>
          Music: “Impact Moderato” — Kevin MacLeod (incompetech.com)<br />CC BY 4.0 · creativecommons.org/licenses/by/4.0/<br />Excerpt with fades and adjusted volume
        </div>
      </AbsoluteFill>
    </Sequence>
  </AbsoluteFill>;
}
