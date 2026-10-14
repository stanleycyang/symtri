import {
  AbsoluteFill, Composition, OffthreadVideo, Sequence, interpolate,
  registerRoot, spring, staticFile, useCurrentFrame, useVideoConfig, getInputProps,
} from "remotion";
import { Launch } from "./launch";
type Clip = { id: string; file: string; duration: number; width: number; height: number; captions: { seconds: number; text: string }[] };
const { clips = [] } = getInputProps<{ clips?: Clip[] }>();

type DemoProps = { src: string; captions: { seconds: number; text: string }[] };

function Card({ end = false }: { end?: boolean }) {
  return <AbsoluteFill style={{ background: "#07090d", color: "#e5e7eb", justifyContent: "center", alignItems: "center", fontFamily: "Arial, sans-serif", textAlign: "center" }}>
    <div style={{ color: "#d5a878", fontSize: 26, letterSpacing: 4 }}>SYMTRI</div>
    <div style={{ fontSize: end ? 48 : 58, fontWeight: 700, margin: "24px 48px" }}>{end ? "Follow the signals." : "The internet is thinking."}</div>
    <div style={{ fontSize: 24, color: "#c6cbd2" }}>{end ? "symtri.com · github.com/stanleycyang/symtri" : "A living map of technology and research"}</div>
  </AbsoluteFill>;
}

function Caption({ text }: { text: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = spring({ frame, fps, config: { damping: 200, stiffness: 120 } });
  const y = interpolate(opacity, [0, 1], [18, 0]);
  return <div style={{ position: "absolute", left: 32, top: 82, maxWidth: "80%", padding: "12px 18px", background: "rgba(7,9,13,.9)", border: "1px solid #d5a878", color: "#f4e2cc", fontFamily: "Arial, sans-serif", fontSize: 24, transform: `translateY(${y}px)`, opacity }}>{text}</div>;
}

function DemoVideo({ src, captions }: DemoProps) {
  const { fps, durationInFrames } = useVideoConfig();
  const cardFrames = 2 * fps;
  const footageFrames = durationInFrames - cardFrames * 2;
  return <AbsoluteFill style={{ background: "#07090d" }}>
    <Sequence durationInFrames={cardFrames}><Card /></Sequence>
    <Sequence from={cardFrames} durationInFrames={footageFrames}>
      <OffthreadVideo src={staticFile(src)} muted style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      {captions.map((caption, index) => {
        const from = Math.round(caption.seconds * fps);
        const next = captions[index + 1];
        const end = next ? Math.round(next.seconds * fps) : footageFrames;
        return <Sequence key={caption.text} from={from} durationInFrames={Math.max(1, end - from)}><Caption text={caption.text} /></Sequence>;
      })}
    </Sequence>
    <Sequence from={durationInFrames - cardFrames} durationInFrames={cardFrames}><Card end /></Sequence>
  </AbsoluteFill>;
}

export function RemotionRoot() {
  return <>{clips.map((clip) => <Composition
    key={clip.id} id={clip.id} component={DemoVideo}
    defaultProps={{ src: clip.file, captions: clip.captions }}
    durationInFrames={Math.ceil(clip.duration * 30) + 120} fps={30}
    width={clip.width} height={clip.height}
  />)}
    <Composition id="Launch16x9" component={Launch} defaultProps={{ variant: "16x9" as const }} durationInFrames={2250} fps={30} width={1920} height={1080} />
    <Composition id="LaunchSquare" component={Launch} defaultProps={{ variant: "square" as const }} durationInFrames={2250} fps={30} width={1080} height={1080} />
    <Composition id="LaunchVertical" component={Launch} defaultProps={{ variant: "vertical" as const }} durationInFrames={2250} fps={30} width={1080} height={1920} />
  </>;
}

registerRoot(RemotionRoot);
