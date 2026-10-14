import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Html5Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

const colors = { bg: "#07090d", text: "#eeeee9", gold: "#d5a878", muted: "#98a5b2" };
const font: CSSProperties = { fontFamily: "Arial, Helvetica, sans-serif" };
type Variant = "16x9" | "square" | "vertical";

function Constellation() {
  const frame = useCurrentFrame();
  const points = [[160, 260], [390, 130], [610, 300], [430, 500], [160, 590], [760, 570], [850, 190]];
  return <svg viewBox="0 0 1000 800" style={{ width: "100%", height: "100%", opacity: 0.65 }}>
    <defs><radialGradient id="halo"><stop stopColor={colors.gold} stopOpacity=".25"/><stop offset="1" stopColor={colors.gold} stopOpacity="0"/></radialGradient></defs>
    {[[0, 1], [1, 2], [2, 3], [3, 4], [2, 5], [2, 6], [0, 4], [3, 5]].map(([a, b]) => <line key={`${a}-${b}`} x1={points[a][0]} y1={points[a][1]} x2={points[b][0]} y2={points[b][1]} stroke={colors.gold} strokeWidth="1" opacity={0.2 + Math.sin(frame / 40 + a) * 0.08}/>)}
    {points.map(([x, y], i) => <g key={i}><circle cx={x} cy={y} r={65 + Math.sin(frame / 40 + i) * 8} fill="url(#halo)"/><circle cx={x} cy={y} r={i === 2 ? 7 : 4} fill={colors.gold}/></g>)}
  </svg>;
}

function Stage({ children, duration }: { children: ReactNode; duration: number }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 15, duration - 15, duration], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

function Shot({ file, panel = false }: { file: string; panel?: boolean }) {
  const frame = useCurrentFrame();
  return <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", border: "1px solid #d5a87830", borderRadius: 24, background: "#0b1016", boxShadow: "0 35px 100px #0008" }}>
    <Img src={staticFile(`launch-assets/${file}`)} style={{ width: "100%", height: "100%", objectFit: "contain", transform: panel ? undefined : `scale(${1 + Math.min(frame / 900, 0.018)})` }}/>
  </div>;
}

function Chapter({ variant, number, label, title, description, file, panel = false }: { variant: Variant; number: string; label: string; title: string; description: string; file: string; panel?: boolean }) {
  const frame = useCurrentFrame();
  const rise = interpolate(frame, [0, 24], [22, 0], { extrapolateRight: "clamp" });
  const wide = variant === "16x9";
  const vertical = variant === "vertical";
  return <AbsoluteFill style={{ padding: wide ? "100px 100px 100px 110px" : vertical ? "135px 75px 145px" : "75px 75px 120px", display: "flex", flexDirection: wide ? "row" : "column", gap: wide ? 65 : 45 }}>
    <div style={{ transform: `translateY(${rise}px)`, width: wide ? "35%" : "100%", flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <div style={{ color: colors.gold, fontSize: 23, letterSpacing: 4, marginBottom: 30 }}>{number} / {label.toUpperCase()}</div>
      <div style={{ fontSize: wide ? 80 : 65, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2, maxWidth: 900 }}>{title}</div>
      <div style={{ color: colors.muted, fontSize: wide ? 29 : 27, lineHeight: 1.5, marginTop: 30, maxWidth: 800 }}>{description}</div>
    </div>
    <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex", justifyContent: "center" }}>
      <div style={{ width: panel && wide ? "78%" : "100%", height: "100%" }}><Shot file={file === "map.png" && frame >= 225 ? "threads.png" : file === "signal.png" && frame < 90 ? "signal-header.png" : file} panel={panel}/></div>
    </div>
    <div style={{ position: "absolute", bottom: wide ? 40 : 55, left: wide ? 110 : 75, fontSize: 17, color: colors.muted, letterSpacing: 2 }}>SYMTRI / ACTUAL PRODUCT SCREENS</div>
  </AbsoluteFill>;
}

function Statement({ variant, eyebrow, title, accent, detail }: { variant: Variant; eyebrow: string; title: string; accent: string; detail?: string }) {
  const wide = variant === "16x9";
  return <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center", padding: wide ? 150 : 80 }}>
    <div style={{ position: "absolute", inset: 0, opacity: 0.5 }}><Constellation/></div>
    <div style={{ position: "relative", maxWidth: wide ? 1450 : 900 }}>
      <div style={{ color: colors.muted, fontSize: 25, letterSpacing: 7, marginBottom: 45 }}>{eyebrow}</div>
      <div style={{ fontSize: wide ? 106 : 83, fontWeight: 700, letterSpacing: -3, lineHeight: 1.1 }}>{title}<br/><span style={{ color: colors.gold }}>{accent}</span></div>
      {detail && <div style={{ fontSize: 29, color: colors.muted, marginTop: 40, lineHeight: 1.5 }}>{detail}</div>}
    </div>
  </AbsoluteFill>;
}

export function Launch({ variant = "16x9" }: { variant?: Variant }) {
  const { durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();
  const wide = variant === "16x9";
  return <AbsoluteFill style={{ ...font, background: colors.bg, color: colors.text }}>
    <div style={{ position: "absolute", bottom: 0, left: 0, width: `${frame / durationInFrames * 100}%`, height: 3, background: colors.gold, zIndex: 2 }}/>
    <Html5Audio src={staticFile("launch-track.mp3")} volume={frame => 0.25 * Math.max(0, Math.min(1, frame / 60, (durationInFrames - frame) / 90))}/>
    <Sequence durationInFrames={180}><Stage duration={180}><Statement variant={variant} eyebrow="SYMTRI" title="The internet is thinking." accent="See the connections."/></Stage></Sequence>
    <Sequence from={180} durationInFrames={180}><Stage duration={180}><Statement variant={variant} eyebrow="A MAP OF WHAT'S EMERGING" title="Research. Code." accent="Discussion." detail="Explore how ideas connect across disciplines."/></Stage></Sequence>
    <Sequence from={360} durationInFrames={450}><Stage duration={450}><Chapter variant={variant} number="01" label="Explore" title="Follow your curiosity." description="Move through a universe of topics. Find the threads that connect them." file="map.png"/></Stage></Sequence>
    <Sequence from={810} durationInFrames={420}><Stage duration={420}><Chapter variant={variant} number="02" label="Read" title="Go to the source." description="Open a signal. Read its context. Follow the original research, project, or discussion." file="source.png" panel/></Stage></Sequence>
    <Sequence from={1230} durationInFrames={450}><Stage duration={450}><Chapter variant={variant} number="03" label="Ask" title="Ask across topics." description="How is AI connected to energy? Explore an answer with cited evidence." file="ask.png" panel/></Stage></Sequence>
    <Sequence from={1680} durationInFrames={270}><Stage duration={270}><Chapter variant={variant} number="04" label="The Signal" title="Keep the bigger picture." description="A weekly briefing of notable signals and connections, with sources to explore." file="signal.png" panel/></Stage></Sequence>
    <Sequence from={1950} durationInFrames={120}><Stage duration={120}><Statement variant={variant} eyebrow="BUILT IN THE OPEN" title="Bring your ideas." accent="Contribute on GitHub."/></Stage></Sequence>
    <Sequence from={2070} durationInFrames={180}><Stage duration={180}>
      <Statement variant={variant} eyebrow="SYMTRI" title="See what connects." accent="symtri.com" detail="github.com/stanleycyang/symtri · Star & contribute"/>
      <div style={{ position: "absolute", bottom: wide ? 45 : 65, left: 60, right: 60, textAlign: "center", fontSize: wide ? 20 : 19, lineHeight: 1.5, color: colors.muted }}>
        Music: “Impact Moderato” — Kevin MacLeod (incompetech.com)<br/>CC BY 4.0 · creativecommons.org/licenses/by/4.0/<br/>Excerpt with fades and adjusted volume
      </div>
    </Stage></Sequence>
  </AbsoluteFill>;
}
