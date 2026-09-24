"use client";

import { Canvas, ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Billboard, OrbitControls } from "@react-three/drei";
import { Component, MutableRefObject, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { getTopic, Topic, topicEdges, topics, Vec3 } from "@/lib/universe";
import { attentionEdges, flowingAttentionEdges, relationshipKey, type RegionActivity, type RegionRelationships } from "@/lib/data/activity";
import type { AskResult } from "@/lib/ai/ask";

export type UniverseProps = {
  entered: boolean;
  askOpen: boolean;
  focusedId: string | null;
  selectedChildId: string | null;
  selectedSignalId: string | null;
  hoveredId: string | null;
  signalMarkers: { id: string; source: string }[];
  regionActivity: Record<string, RegionActivity> | null;
  regionRelationships: RegionRelationships | null;
  archiveRelationships: RegionRelationships | null;
  semanticRelationships: Record<string, number> | null;
  askPathIds: string[];
  askSteps: AskResult["pathSteps"];
  onFocus: (id: string | null) => void;
  onChild: (id: string) => void;
  onSignal: (id: string) => void;
  onHover: (id: string | null) => void;
  reducedMotion: boolean;
};

const topicPoints = new Map(topics.map((topic) => [topic.id, new THREE.Vector3(...topic.position)]));
const establishedEdgeKeys = new Set(topicEdges.map(([first, second]) => relationshipKey(first, second)));

type CameraMove = {
  fromPosition: THREE.Vector3;
  toPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  elapsed: number;
  duration: number;
};

function CameraRig({ entered, focusedId, selectedChildId, reducedMotion, compact, askOverlay, controls }: { entered: boolean; focusedId: string | null; selectedChildId: string | null; reducedMotion: boolean; compact: boolean; askOverlay: boolean; controls: MutableRefObject<React.ComponentRef<typeof OrbitControls> | null> }) {
  const { camera, size } = useThree();
  const move = useRef<CameraMove | null>(null);
  const panelConstrained = !compact && size.width <= 1000;

  useEffect(() => {
    const topic = getTopic(focusedId);
    const child = topic?.children.find((item) => item.id === selectedChildId);
    const toTarget = new THREE.Vector3();
    const toPosition = new THREE.Vector3();
    if (child) {
      toTarget.set(child.position[0] + (compact ? 0 : panelConstrained ? 7 : 2.2), child.position[1] - (compact ? 2.5 : 0), child.position[2]);
      toPosition.copy(toTarget).add(new THREE.Vector3(compact ? 0 : 3, compact ? 0 : 2, compact ? 27 : 15));
    } else if (topic) {
      toTarget.set(topic.position[0] + (compact ? 0 : panelConstrained ? 8 : 3), topic.position[1] - (compact ? 4 : 0), topic.position[2]);
      toPosition.copy(toTarget).add(new THREE.Vector3(compact ? 0 : 5, compact ? 0 : 4, compact ? 43 : 27));
    } else {
      toPosition.set(compact ? 0 : 7, compact ? 0 : 5, compact ? 103 : 48);
    }
    if (askOverlay && topic) {
      const offset = child ? 6 : 10;
      toTarget.y += offset;
      toPosition.y += offset;
    }
    if (!entered) toPosition.z = compact ? 115 : 70;
    move.current = {
      fromPosition: camera.position.clone(),
      toPosition,
      fromTarget: controls.current?.target.clone() ?? new THREE.Vector3(),
      toTarget,
      elapsed: 0,
      duration: reducedMotion ? 0 : !entered ? 1 : topic ? 1.7 : 2.2,
    };
  }, [askOverlay, camera, compact, controls, entered, focusedId, panelConstrained, selectedChildId, reducedMotion]);

  useFrame((_, delta) => {
    const current = move.current;
    if (!current) return;
    current.elapsed += Math.min(delta, .05);
    const progress = current.duration === 0 ? 1 : Math.min(1, current.elapsed / current.duration);
    const eased = progress < .5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
    camera.position.lerpVectors(current.fromPosition, current.toPosition, eased);
    if (controls.current) controls.current.target.lerpVectors(current.fromTarget, current.toTarget, eased);
    if (progress === 1) move.current = null;
  });
  return null;
}

function filamentCurve(from: Vec3, to: Vec3, bend: number): THREE.QuadraticBezierCurve3 {
  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const mid = start.clone().add(end).multiplyScalar(.5);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  // Bend sideways as well as in depth so relationships read as paths from the overview camera.
  if (length > 0) {
    mid.x -= dy / length * bend;
    mid.y += dx / length * bend;
  }
  mid.z -= bend;
  return new THREE.QuadraticBezierCurve3(start, mid, end);
}

function Filament({ from, to, color = "#7c8896", opacity = .16, bend = .8 }: { from: Vec3; to: Vec3; color?: string; opacity?: number; bend?: number }) {
  const line = useMemo(() => {
    return new THREE.BufferGeometry().setFromPoints(filamentCurve(from, to, bend).getPoints(30));
  }, [from, to, bend]);
  const material = useMemo(() => new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }), [color, opacity]);
  const object = useMemo(() => new THREE.Line(line, material), [line, material]);
  useEffect(() => () => line.dispose(), [line]);
  useEffect(() => () => material.dispose(), [material]);
  return <primitive object={object} />;
}

function Label({ title, subtitle, color = "#e3e4e1", size = 4.9 }: { title: string; subtitle?: string; color?: string; size?: number }) {
  const { texture, width } = useMemo(() => {
    const canvas = document.createElement("canvas");
    let context = canvas.getContext("2d")!;
    context.font = "600 75px Arial";
    const titleWidth = context.measureText(title).width;
    context.font = "36px monospace";
    const subtitleWidth = subtitle ? context.measureText(subtitle).width : 0;
    const width = Math.max(640, Math.ceil(Math.max(titleWidth, subtitleWidth) + 80));
    canvas.width = width; canvas.height = 160;
    context = canvas.getContext("2d")!;
    context.textAlign = "center";
    context.font = "600 75px Arial";
    context.fillStyle = color;
    context.fillText(title, width / 2, subtitle ? 84 : 107);
    if (subtitle) {
      context.font = "36px monospace";
      context.fillStyle = "#a5afb8";
      context.fillText(subtitle, width / 2, 139);
    }
    const output = new THREE.CanvasTexture(canvas);
    output.colorSpace = THREE.SRGBColorSpace;
    return { texture: output, width };
  }, [title, subtitle, color]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <sprite scale={[size * width / 640, size / 4, 1]} raycast={() => null}><spriteMaterial map={texture} transparent depthWrite={false} /></sprite>;
}

function GlowNode({ topic, focused, hovered, muted, emphasized, onFocus, onHover, reducedMotion, compact, measured, showLabel }: { topic: Topic; focused: boolean; hovered: boolean; muted: boolean; emphasized: boolean; onFocus: (id: string) => void; onHover: (id: string | null) => void; reducedMotion: boolean; compact: boolean; measured: boolean; showLabel: boolean }) {
  const glow = useRef<THREE.Sprite>(null);
  const glowMaterial = useRef<THREE.SpriteMaterial>(null);
  const core = useRef<THREE.Mesh>(null);
  const glowSize = focused ? 9.5 : 6 + topic.activity / 35 + (emphasized ? 1.2 : 0);
  const coreSize = focused ? .57 : (.34 + topic.activity / 260) * (hovered || emphasized ? 1.12 : 1);
  const glowTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 128; canvas.height = 128;
    const context = canvas.getContext("2d")!;
    const red = parseInt(topic.color.slice(1, 3), 16);
    const green = parseInt(topic.color.slice(3, 5), 16);
    const blue = parseInt(topic.color.slice(5, 7), 16);
    const gradient = context.createRadialGradient(64, 64, 2, 64, 64, 64);
    gradient.addColorStop(0, `rgba(${red},${green},${blue},.5)`);
    gradient.addColorStop(.18, `rgba(${red},${green},${blue},.26)`);
    gradient.addColorStop(.5, `rgba(${red},${green},${blue},.07)`);
    gradient.addColorStop(1, `rgba(${red},${green},${blue},0)`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, [topic.color]);
  useEffect(() => () => glowTexture.dispose(), [glowTexture]);
  useFrame(({ clock }, delta) => {
    if (!glow.current || !core.current) return;
    const pulse = reducedMotion ? 1 : 1 + Math.sin(clock.elapsedTime * (1.2 + topic.activity / 150) + topic.activity) * .07;
    const speed = reducedMotion ? 1000 : 3.5;
    const size = THREE.MathUtils.damp(glow.current.scale.x, glowSize * pulse, speed, delta);
    glow.current.scale.set(size, size, 1);
    const coreScale = THREE.MathUtils.damp(core.current.scale.x, coreSize, speed, delta);
    core.current.scale.setScalar(coreScale);
    if (glowMaterial.current) {
      const opacity = muted ? .06 : hovered ? 1 : focused || emphasized ? .82 : .48 + topic.change / 650;
      glowMaterial.current.opacity = THREE.MathUtils.damp(glowMaterial.current.opacity, opacity, speed, delta);
    }
  });
  return <group position={topic.position}>
    <sprite ref={glow} scale={[glowSize, glowSize, 1]} raycast={() => null}><spriteMaterial ref={glowMaterial} map={glowTexture} transparent opacity={muted ? .06 : hovered ? 1 : focused || emphasized ? .82 : .48 + topic.change / 650} depthWrite={false} blending={THREE.AdditiveBlending} /></sprite>
    <mesh ref={core} scale={coreSize} raycast={() => null}>
      <sphereGeometry args={[1, 24, 16]} />
      <meshBasicMaterial color={topic.color} transparent opacity={muted ? .28 : 1} />
    </mesh>
    <mesh onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); if (event.delta <= 8) onFocus(topic.id); }} onPointerOver={(event) => { event.stopPropagation(); onHover(topic.id); document.body.style.cursor = "pointer"; }} onPointerOut={() => { onHover(null); document.body.style.cursor = "auto"; }}>
      <sphereGeometry args={[1.18, 16, 12]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
    <Billboard follow><mesh raycast={() => null}><ringGeometry args={[.86, .875, 64]} /><meshBasicMaterial color={topic.color} transparent opacity={muted ? .07 : hovered || emphasized ? .68 : .35} side={THREE.DoubleSide} /></mesh></Billboard>
    {!muted && <group visible={showLabel} position={[!focused && topic.id === "startups" ? -3.5 : 0, -1.5, 0]}><Label title={topic.short} subtitle={measured ? `${topic.signals} OBSERVED` : "AWAITING DATA"} color={focused ? "#f4e2cc" : "#e3e4e1"} size={compact ? 7.2 : focused ? 5.1 : 7.5} /></group>}
  </group>;
}

function ChildNode({ position, name, color, active, onClick }: { position: Vec3; name: string; color: string; active: boolean; onClick: () => void }) {
  return <group position={position}>
    <mesh raycast={() => null}>
      <sphereGeometry args={[.18, 14, 10]} />
      <meshBasicMaterial color={color} />
    </mesh>
    <mesh onClick={(event) => { event.stopPropagation(); if (event.delta <= 8) onClick(); }} onPointerOver={() => { document.body.style.cursor = "pointer"; }} onPointerOut={() => { document.body.style.cursor = "auto"; }}>
      <sphereGeometry args={[.65, 12, 8]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
    <mesh raycast={() => null}><sphereGeometry args={[active ? .55 : .38, 12, 8]} /><meshBasicMaterial color={color} transparent opacity={active ? .13 : .055} depthWrite={false} /></mesh>
    <group position={[0, -.75, 0]}><Label title={name} color={active ? "#d5a878" : "#d6d9db"} size={2.8} /></group>
  </group>;
}

function SignalMote({ position, source, color, active, onClick }: { position: Vec3; source: string; color: string; active: boolean; onClick: () => void }) {
  const short = source === "Hacker News" ? "HN" : source === "GitHub" ? "GH" : "ARX";
  return <group position={position}>
    <mesh raycast={() => null}>
      <octahedronGeometry args={[active ? .18 : .12, 0]} />
      <meshBasicMaterial color={active ? "#f5e6d4" : color} />
    </mesh>
    <mesh onClick={(event) => { event.stopPropagation(); if (event.delta <= 8) onClick(); }} onPointerOver={() => { document.body.style.cursor = "pointer"; }} onPointerOut={() => { document.body.style.cursor = "auto"; }}>
      <sphereGeometry args={[.48, 10, 8]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
    <group position={[0, -.35, 0]}><Label title={short} color="#b9c0c5" size={1.45} /></group>
  </group>;
}

function Dust({ count, reducedMotion }: { count: number; reducedMotion: boolean }) {
  const points = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const palette = [new THREE.Color("#e4c9aa"), new THREE.Color("#9db0c6"), new THREE.Color("#ffffff")];
    for (let i = 0; i < count; i++) {
      const r = 16 + Math.sqrt((i * 73.193) % 1) * 62;
      const phi = i * 2.399963;
      const z = ((i * .618033) % 1) * 2 - 1;
      const horizontal = Math.sqrt(1 - z * z);
      positions[i * 3] = Math.cos(phi) * horizontal * r;
      positions[i * 3 + 1] = Math.sin(phi) * horizontal * r;
      positions[i * 3 + 2] = z * r - 18;
      const color = palette[i % palette.length];
      colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
    }
    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    buffer.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return buffer;
  }, [count]);
  useFrame((_, delta) => { if (points.current && !reducedMotion) points.current.rotation.y += delta * .0018; });
  return <points ref={points} geometry={geometry} raycast={() => null}><pointsMaterial size={.075} transparent opacity={.52} vertexColors sizeAttenuation depthWrite={false} /></points>;
}

function IncomingSignals({ compact, reducedMotion, activeTopics }: { compact: boolean; reducedMotion: boolean; activeTopics: Topic[] }) {
  const particles = useMemo(() => activeTopics.flatMap((topic, topicIndex) =>
    Array.from({ length: Math.round(topic.activity * (compact ? .07 : .16)) }, (_, index) => ({
      target: topic.position,
      color: topic.color,
      phase: (index * .618033 + topicIndex * .137) % 1,
      angle: index * 2.39996 + topicIndex * .73,
      speed: .022 + topic.activity / 6000,
    }))
  ), [activeTopics, compact]);
  const geometry = useMemo(() => {
    const positions = new Float32Array(particles.length * 3);
    const colors = new Float32Array(particles.length * 3);
    particles.forEach((particle, index) => {
      const color = new THREE.Color(particle.color);
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    });
    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    buffer.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return buffer;
  }, [particles]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const points = useRef<THREE.Points>(null);
  useFrame(({ clock }) => {
    if (!points.current) return;
    const positions = points.current.geometry.attributes.position as THREE.BufferAttribute;
    const time = reducedMotion ? 0 : clock.elapsedTime;
    particles.forEach((particle, index) => {
      const progress = (particle.phase + time * particle.speed) % 1;
      const radius = 1 + (1 - progress) ** 1.45 * 18;
      const angle = particle.angle + progress * 2.2;
      positions.setXYZ(index,
        particle.target[0] + Math.cos(angle) * radius,
        particle.target[1] + Math.sin(angle) * radius * .7,
        particle.target[2] - (1 - progress) * 11 + Math.sin(angle * 1.7) * 1.2);
    });
    positions.needsUpdate = true;
  });
  return <points ref={points} geometry={geometry} raycast={() => null}><pointsMaterial size={.115} vertexColors transparent opacity={.72} sizeAttenuation depthWrite={false} /></points>;
}

function FlowSignals({ reducedMotion, edges }: { reducedMotion: boolean; edges: [string, string][] }) {
  const paths = useMemo(() => edges.map(([a, b]) => {
    const first = getTopic(a)!;
    const second = getTopic(b)!;
    return filamentCurve(first.position, second.position, 2.6);
  }), [edges]);
  const perPath = 7;
  const geometry = useMemo(() => {
    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute("position", new THREE.BufferAttribute(new Float32Array(paths.length * perPath * 3), 3));
    return buffer;
  }, [paths]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const points = useRef<THREE.Points>(null);
  const point = useRef(new THREE.Vector3());
  useFrame(({ clock }) => {
    if (!points.current) return;
    const positions = points.current.geometry.attributes.position as THREE.BufferAttribute;
    const time = reducedMotion ? 0 : clock.elapsedTime;
    paths.forEach((path, pathIndex) => {
      for (let step = 0; step < perPath; step++) {
        const progress = (step / perPath + time * (.016 + pathIndex % 3 * .004)) % 1;
        path.getPoint(progress, point.current);
        positions.setXYZ(pathIndex * perPath + step, point.current.x, point.current.y, point.current.z);
      }
    });
    positions.needsUpdate = true;
  });
  return <points ref={points} geometry={geometry} raycast={() => null}><pointsMaterial color="#e7c6a3" size={.075} transparent opacity={.72} sizeAttenuation depthWrite={false} /></points>;
}

function SignalCloud({ topic, reducedMotion }: { topic: Topic; reducedMotion: boolean }) {
  const points = useRef<THREE.Points>(null);
  const material = useRef<THREE.PointsMaterial>(null);
  const visibleCount = useRef(80 + topic.activity * 3);
  const geometry = useMemo(() => {
    const positions = new Float32Array(380 * 3);
    for (let i = 0; i < 380; i++) {
      const angle = i * 2.39996;
      const radius = 1.3 + Math.sqrt(((i * 47.17) % 1)) * 6.7;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = Math.sin(angle) * radius * .7;
      positions[i * 3 + 2] = (((i * .3183) % 1) - .5) * 7;
    }
    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    buffer.setDrawRange(0, 380);
    return buffer;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame((_, delta) => {
    const speed = reducedMotion ? 1000 : 2.5;
    visibleCount.current = THREE.MathUtils.damp(visibleCount.current, 80 + topic.activity * 3, speed, delta);
    geometry.setDrawRange(0, Math.round(visibleCount.current));
    if (points.current && !reducedMotion) points.current.rotation.z += delta * (.006 + topic.activity / 10000);
    if (material.current) material.current.opacity = THREE.MathUtils.damp(material.current.opacity, Math.min(.58, .33 + topic.change / 1000), speed, delta);
  });
  return <points ref={points} position={topic.position} geometry={geometry} raycast={() => null}><pointsMaterial ref={material} color={topic.color} size={.035} transparent opacity={Math.min(.58, .33 + topic.change / 1000)} sizeAttenuation depthWrite={false} /></points>;
}

function World({ entered, askOpen, focusedId, selectedChildId, selectedSignalId, hoveredId, signalMarkers, regionActivity, regionRelationships, archiveRelationships, semanticRelationships, askPathIds, askSteps, onFocus, onChild, onSignal, onHover, reducedMotion, compact }: UniverseProps & { compact: boolean }) {
  const controls = useRef<React.ComponentRef<typeof OrbitControls> | null>(null);
  const { camera } = useThree();
  const activeTopics = useMemo(() => regionActivity ? topics.map((topic) => {
    const measured = regionActivity[topic.id];
    return { ...topic, activity: measured.visual, change: measured.momentum === "rising" ? 80 : 0, signals: measured.count };
  }) : topics, [regionActivity]);
  const activeEdges = useMemo(() => attentionEdges(regionRelationships), [regionRelationships]);
  const flowingEdges = useMemo(() => flowingAttentionEdges(activeEdges, regionRelationships), [activeEdges, regionRelationships]);
  const focused = getTopic(focusedId);
  const pathChildren = new Set(askSteps.map((step) => step.subtopicId).filter((id): id is string => id !== null));
  const pathPosition = (step: AskResult["pathSteps"][number]): Vec3 => {
    const topic = getTopic(step.regionId)!;
    return topic.children.find((child) => child.id === step.subtopicId)?.position ?? topic.position;
  };
  const selectedChild = focused?.children.find((child) => child.id === selectedChildId);
  const revealRef = useRef<string | null>(null);
  const signalsRef = useRef(false);
  const [revealId, setRevealId] = useState<string | null>(null);
  const [revealSignals, setRevealSignals] = useState(false);
  useFrame(() => {
    let candidate = focused;
    if (!candidate) {
      let closest = Infinity;
      for (const topic of topics) {
        const distance = camera.position.distanceTo(topicPoints.get(topic.id)!);
        if (distance < closest) { closest = distance; candidate = topic; }
      }
    }
    const distance = candidate ? camera.position.distanceTo(topicPoints.get(candidate.id)!) : Infinity;
    const nextReveal = candidate && distance < (revealRef.current === candidate.id ? (compact ? 58 : 40) : (compact ? 50 : 34)) ? candidate.id : null;
    if (revealRef.current !== nextReveal) { revealRef.current = nextReveal; setRevealId(nextReveal); }
    const childDistance = selectedChild ? camera.position.distanceTo(new THREE.Vector3(...selectedChild.position)) : Infinity;
    const nextSignals = Boolean(selectedChild && childDistance < (signalsRef.current ? (compact ? 38 : 28) : (compact ? 32 : 23)));
    if (signalsRef.current !== nextSignals) { signalsRef.current = nextSignals; setRevealSignals(nextSignals); }
  });
  return <>
    <color attach="background" args={["#07090d"]} />
    <fog attach="fog" args={["#07090d", compact ? 75 : 48, compact ? 160 : 130]} />
    <CameraRig entered={entered} focusedId={focusedId} selectedChildId={selectedChildId} reducedMotion={reducedMotion} compact={compact} askOverlay={compact && askOpen} controls={controls} />
    <OrbitControls ref={controls} enableDamping dampingFactor={.055} enablePan={false} minDistance={9} maxDistance={compact ? 135 : 84} rotateSpeed={.43} zoomSpeed={.65} />
    <Dust count={compact ? 650 : 1500} reducedMotion={reducedMotion} />
    <IncomingSignals compact={compact} reducedMotion={reducedMotion} activeTopics={activeTopics} />
    <FlowSignals reducedMotion={reducedMotion} edges={flowingEdges} />
    {activeEdges.map(([a, b]) => {
      const first = getTopic(a)!;
      const second = getTopic(b)!;
      const key = relationshipKey(a, b);
      const highlighted = hoveredId === a || hoveredId === b;
      const inAnswer = askPathIds.some((id, index) => index > 0 && relationshipKey(askPathIds[index - 1], id) === key);
      const count = regionRelationships?.[key] ?? 0;
      const archived = archiveRelationships?.[key] ?? 0;
      const similarity = semanticRelationships?.[key];
      const semanticBoost = similarity === undefined ? 0 : Math.max(0, Math.min(.16, (similarity - .25) * .3));
      const recentStrength = regionRelationships ? Math.min(.45, .07 + count * .07 + semanticBoost) : .13 + semanticBoost;
      const strength = Math.max(recentStrength, archived ? Math.min(.24, .06 + Math.log1p(archived) * .045) : 0);
      const color = inAnswer ? "#d5a878" : highlighted ? getTopic(hoveredId)?.color : establishedEdgeKeys.has(key) ? undefined : "#bfa178";
      const opacity = inAnswer ? .72 : hoveredId ? (highlighted ? Math.max(.42, strength) : .04)
        : focused ? (focused.id === a || focused.id === b ? Math.max(.19, strength) : .035) : strength;
      return <Filament key={`${a}-${b}`} from={first.position} to={second.position} color={color} opacity={opacity} bend={2.6} />;
    })}
    {askSteps.map((step, index) => index > 0 && step.subtopicId && askSteps[index - 1].subtopicId ? <Filament key={`ask-${index}`} from={pathPosition(askSteps[index - 1])} to={pathPosition(step)} color="#e6b988" opacity={.82} bend={.8} /> : null)}
    {activeTopics.map((topic) => <group key={topic.id}>
      <SignalCloud topic={topic} reducedMotion={reducedMotion} />
      <GlowNode topic={topic} focused={focusedId === topic.id} hovered={hoveredId === topic.id} muted={Boolean(focused && focused.id !== topic.id && !askPathIds.includes(topic.id))} emphasized={askPathIds.includes(topic.id)} onFocus={(id) => onFocus(id)} onHover={onHover} reducedMotion={reducedMotion} compact={compact} measured={Boolean(regionActivity)} showLabel={entered} />
      {topic.children.filter((child) => revealId === topic.id || pathChildren.has(child.id)).map((child) => <group key={child.id}>
        <Filament from={topic.position} to={child.position} color={pathChildren.has(child.id) ? "#e6b988" : topic.color} opacity={pathChildren.has(child.id) ? .55 : .21} bend={.45} />
        <ChildNode position={child.position} name={child.name} color={topic.color} active={selectedChildId === child.id || pathChildren.has(child.id)} onClick={() => { if (focusedId !== topic.id) onFocus(topic.id); onChild(child.id); }} />
        {revealSignals && selectedChildId === child.id && signalMarkers.map((signal, index) => {
          const angle = index * Math.PI * 2 / 3 + .5;
          const signalPosition: Vec3 = [child.position[0] + Math.cos(angle) * 1.85, child.position[1] + Math.sin(angle) * 1.6, child.position[2] + .5];
          return <group key={signal.id}><Filament from={child.position} to={signalPosition} color={topic.color} opacity={.22} bend={.15} /><SignalMote position={signalPosition} source={signal.source} color={topic.color} active={selectedSignalId === signal.id} onClick={() => onSignal(signal.id)} /></group>;
        })}
      </group>)}
    </group>)}
    <mesh onClick={(event) => { if (event.delta <= 8) onFocus(null); }} position={[0, 0, -35]}><planeGeometry args={[250, 250]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} /></mesh>
  </>;
}

class SceneErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(error: Error) {
    if (!/webgl|context lost/i.test(error.message)) throw error;
    return { failed: true };
  }
  componentDidCatch(error: Error) { console.warn("SYMTRI 3D view unavailable", error.message); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function UniverseFallback({ entered, focusedId, onFocus }: Pick<UniverseProps, "entered" | "focusedId" | "onFocus">) {
  const focused = getTopic(focusedId);
  return <div className="universe-fallback">
    {entered && focused && <div className="universe-fallback-focus" aria-hidden="true">
      <span style={{ borderColor: focused.color }} /><strong>{focused.short}</strong><small>REGION IN FOCUS</small>
    </div>}
    {entered && !focusedId && <div className="universe-fallback-content">
      <p className="eyebrow">EXPLORE THE LIVE SIGNALS</p>
      <h2>Follow an idea.</h2>
      <p>The 3D view is unavailable here. Choose a region to explore its topics and sources.</p>
      <div className="universe-fallback-regions">{topics.map((topic) =>
        <button key={topic.id} type="button" onClick={() => onFocus(topic.id)}>
          <span style={{ background: topic.color }} aria-hidden="true" />{topic.short}<b aria-hidden="true">↗</b>
        </button>)}</div>
    </div>}
  </div>;
}

export default function Universe(props: UniverseProps) {
  const [compact, setCompact] = useState(false);
  useEffect(() => { const query = window.matchMedia("(max-width: 700px)"); const update = () => setCompact(query.matches); update(); query.addEventListener("change", update); return () => query.removeEventListener("change", update); }, []);
  return <SceneErrorBoundary fallback={<UniverseFallback entered={props.entered} focusedId={props.focusedId} onFocus={props.onFocus} />}>
    <Canvas className="universe-canvas" camera={{ position: [0, 0, 70], fov: 48, near: .1, far: 250 }} dpr={[1, compact ? 1.4 : 1.8]} gl={{ antialias: !compact, alpha: false, powerPreference: "high-performance" }} onCreated={({ gl }) => gl.setClearColor("#07090d")}>
      <World {...props} compact={compact} />
    </Canvas>
  </SceneErrorBoundary>;
}
