'use client';

// Liquid-glass sculpture behind the /recreate hero — interleaved crescent
// shells wrapped around a hollow center (ref: untitleivid 7.png). Thick
// refraction via MeshTransmissionMaterial; green-ground / blue-sky
// Lightformer environment supplies the reference's reflections.

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Float, Lightformer, MeshTransmissionMaterial } from '@react-three/drei';

// The transmission buffer needs structure to bend — a flat color refracts to
// itself and the glass disappears. Blue-sky → cream → green-ground gradient
// (the reference's world) fills the buffer; the page outside stays untouched.
function makeRefractionGradient() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#a9cbe8');
  g.addColorStop(0.42, '#eef0e2');
  g.addColorStop(0.58, '#e9ecd8');
  g.addColorStop(1, '#79883f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const PREFERS_REDUCED_MOTION =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Each blade = a thick open torus arc lying on its own great circle — the
// reference's curved "banana" shells. Varied major radii / tube widths / arc
// sweeps + distinct tilts interleave them around a hollow center with real
// negative space between blades (a dense set reads as one muddy ball).
const BLADES = [
  { major: 0.92, tube: 0.26, arc: Math.PI * 1.2, rotation: [0.2, 0.15, 0.5], scale: [1, 1, 0.75] },
  { major: 0.8, tube: 0.3, arc: Math.PI * 1.0, rotation: [Math.PI / 2.1, 0.6, 1.7], scale: [1, 1, 0.7] },
  { major: 0.98, tube: 0.22, arc: Math.PI * 0.9, rotation: [-1.0, 1.9, -0.4], scale: [1, 1, 0.8] },
  { major: 0.72, tube: 0.27, arc: Math.PI * 1.15, rotation: [2.3, -0.7, 2.6], scale: [0.95, 0.95, 0.72] },
  { major: 0.86, tube: 0.2, arc: Math.PI * 0.75, rotation: [-2.0, -1.4, 0.9], scale: [1.05, 1.05, 0.8] },
];

function CrescentShells() {
  const groupRef = useRef(null);

  const geometries = useMemo(
    () => BLADES.map((b) => new THREE.TorusGeometry(b.major, b.tube, 32, 96, b.arc)),
    []
  );
  const refractionBackground = useMemo(() => makeRefractionGradient(), []);

  useFrame((_, delta) => {
    if (PREFERS_REDUCED_MOTION || !groupRef.current) return;
    groupRef.current.rotation.y += delta * 0.12;
    groupRef.current.rotation.x = Math.sin(groupRef.current.rotation.y * 0.5) * 0.14;
  });

  return (
    <group ref={groupRef} rotation={[0.15, -0.6, 0.05]}>
      {BLADES.map((b, i) => (
        <mesh key={i} geometry={geometries[i]} rotation={b.rotation} scale={b.scale}>
          <MeshTransmissionMaterial
            samples={6}
            resolution={512}
            transmission={1}
            thickness={1.1}
            roughness={0.05}
            ior={1.45}
            chromaticAberration={0.08}
            anisotropicBlur={0.2}
            distortion={0.3}
            distortionScale={0.6}
            temporalDistortion={PREFERS_REDUCED_MOTION ? 0 : 0.08}
            clearcoat={1}
            clearcoatRoughness={0.04}
            attenuationColor="#e4eedd"
            attenuationDistance={2.5}
            background={refractionBackground}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

// Green below / blue above / hard white strips — the reference's grass-and-sky
// reflection set, built locally (no HDRI fetch).
function SculptureEnvironment() {
  return (
    <Environment resolution={256} frames={1}>
      <Lightformer form="rect" intensity={0.9} color="#77883b" scale={[12, 6, 1]} position={[0, -5, 0]} rotation={[Math.PI / 2, 0, 0]} />
      <Lightformer form="rect" intensity={1.1} color="#9fc2e6" scale={[14, 7, 1]} position={[0, 6, 0]} rotation={[-Math.PI / 2, 0, 0]} />
      <Lightformer form="rect" intensity={7} color="#ffffff" scale={[0.5, 6, 1]} position={[-4, 2, 4]} rotation={[0, Math.PI / 3, 0]} />
      <Lightformer form="rect" intensity={6} color="#ffffff" scale={[5, 0.35, 1]} position={[3, 3, 3]} rotation={[0, -Math.PI / 4, 0]} />
      <Lightformer form="rect" intensity={4} color="#ffffff" scale={[0.4, 3, 1]} position={[2, -1, 4]} rotation={[0, -Math.PI / 6, 0]} />
      <Lightformer form="circle" intensity={2} color="#eaf4ff" scale={3} position={[0, 1, -5]} />
    </Environment>
  );
}

export default function GlassSculpture() {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 0, 5.2], fov: 35 }}
      gl={{ alpha: true, antialias: true }}
      style={{ width: '100%', height: '100%' }}
    >
      <Float
        enabled={!PREFERS_REDUCED_MOTION}
        speed={1.2}
        rotationIntensity={0.25}
        floatIntensity={0.5}
        floatingRange={[-0.08, 0.08]}
      >
        <CrescentShells />
      </Float>
      <SculptureEnvironment />
    </Canvas>
  );
}
