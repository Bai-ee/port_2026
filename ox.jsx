import React, { useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useFrame, extend, useThree } from '@react-three/fiber';
import { OrbitControls, Effects } from '@react-three/drei';
import { UnrealBloomPass } from 'three-stdlib';
import * as THREE from 'three';

extend({ UnrealBloomPass });

const MOBILE_MEDIA_QUERY = '(max-width: 767px), (pointer: coarse)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const useMediaMatch = (query) => {
  const getMatches = () => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }

    return window.matchMedia(query).matches;
  };

  const [matches, setMatches] = useState(getMatches);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQuery = window.matchMedia(query);
    const updateMatches = (event) => setMatches(event.matches);

    setMatches(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateMatches);
      return () => mediaQuery.removeEventListener('change', updateMatches);
    }

    mediaQuery.addListener(updateMatches);
    return () => mediaQuery.removeListener(updateMatches);
  }, [query]);

  return matches;
};

// Component to set scene background color
const SceneBackground = ({ color }) => {
  const { scene } = useThree();

  useEffect(() => {
    if (color === null) {
      scene.background = null;
    } else {
      scene.background = new THREE.Color(color);
    }
  }, [color, scene]);

  return null;
};

const ParticleSwarm = ({ params = {}, liveParamsRef = null, runtimeProfile = {} }) => {
  const meshRef = useRef();
  const groupRef = useRef();
  const frameBudgetRef = useRef(0);
  const defaultParams = {
    scale: 55,
    chaos: 0.8,
    flow: 0.6,
    particleCount: 25000,
    particleSize: 0.3,
    speedMult: 0.1,
    bloomThreshold: 0,
    bloomStrength: 1.8,
    bloomRadius: 0.4,
    hueSpeed: 0.02,
    waveAmplitude: 3,
    saturation: 0.85,
    lightness: 0.5,
    // New shape/geometry params
    torusMajorRadius: 1,
    torusTubeRadius: 0.2,
    torusSegments: 100,
    torusSegmentsDepth: 50,
    // Rotation params (static tilt)
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    // Tire spin animation params
    tireSpinAxis: 'y', // which axis to spin around: 'x', 'y', or 'z'
    tireSpinSpeed: 0.5, // speed of tire rotation (0 = static, up to 5 = very fast)
    // Animation params
    animationSpeed: 1.0,
    sphereSegments: 16,
  };

  const staticParams = useMemo(() => ({ ...defaultParams, ...params }), [params]);
  const count = staticParams.particleCount;
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const target = useMemo(() => new THREE.Vector3(), []);
  const pColor = useMemo(() => new THREE.Color(), []);
  const color = pColor; // Alias for user code compatibility

  const positions = useMemo(() => {
     const pos = [];
     for(let i=0; i<count; i++) pos.push(new THREE.Vector3((Math.random()-0.5)*100, (Math.random()-0.5)*100, (Math.random()-0.5)*100));
     return pos;
  }, [count]);

  // Material & Geom
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 1.0 } },
    transparent: true,
    vertexShader: `
        varying vec3 vNormal;
        varying vec3 vColor;
        void main() {
            vNormal = normalize(normalMatrix * normal);
            vColor = instanceColor;
            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uOpacity;
        varying vec3 vNormal;
        varying vec3 vColor;
        void main() {
            vec3 viewDir = vec3(0.0, 0.0, 1.0);
            float metallic = dot(vNormal, viewDir) * 0.5 + 0.5;
            metallic = pow(metallic, 3.0);
            float diffuse = metallic * 0.8 + 0.2;
            vec3 col = vColor * diffuse;
            gl_FragColor = vec4(col, uOpacity);
        }
    `
}), []);
  const geometry = useMemo(() => {
    return new THREE.SphereGeometry(1, staticParams.sphereSegments, staticParams.sphereSegments);
  }, [staticParams.sphereSegments]);
  const addControl = (id, l, min, max, val) => {
      return staticParams[id] !== undefined ? staticParams[id] : val;
  };
  const setInfo = () => {};
  const annotate = () => {};

  useFrame((state) => {
    if (!meshRef.current || !groupRef.current) return;
    const targetFrameInterval = runtimeProfile.targetFrameInterval ?? 0;
    if (targetFrameInterval > 0) {
      frameBudgetRef.current += state.clock.getDelta();
      if (frameBudgetRef.current < targetFrameInterval) {
        return;
      }
      frameBudgetRef.current = 0;
    }

    const PARAMS = liveParamsRef?.current ?? staticParams;
    const speedMult = PARAMS.speedMult * PARAMS.animationSpeed;
    const time = state.clock.getElapsedTime() * speedMult;
    const THREE_LIB = THREE;

    // Calculate animated tire spin (independent from master animation speed)
    const spinAngle = state.clock.getElapsedTime() * PARAMS.tireSpinSpeed;

    // Apply static tilt + animated spin
    let rotX = PARAMS.rotationX;
    let rotY = PARAMS.rotationY;
    let rotZ = PARAMS.rotationZ;

    // Add spin animation to the appropriate axis
    if (PARAMS.tireSpinAxis === 'x') {
      rotX += spinAngle;
    } else if (PARAMS.tireSpinAxis === 'y') {
      rotY += spinAngle;
    } else if (PARAMS.tireSpinAxis === 'z') {
      rotZ += spinAngle;
    }

    // Apply combined rotations to the group
    groupRef.current.rotation.x = rotX;
    groupRef.current.rotation.y = rotY;
    groupRef.current.rotation.z = rotZ;

    material.uniforms.uOpacity.value = PARAMS.opacity ?? 1;

    for (let i = 0; i < count; i++) {
        // USER CODE START
        const scale = PARAMS.scale;
        const chaos = PARAMS.chaos;
        const flow = PARAMS.flow;

        if (i === 0) {
            setInfo("4D Hyper-Torus", "Clifford torus breathing in projected space");
            annotate("core", new THREE.Vector3(0,0,0), "Singularity");
        }

        const t = i / count;
        const golden = 2.39996322972865332;
        const tau = 6.283185307179586;

        // Parametric torus generation
        const theta = i * golden + time * flow * 0.5;
        const phi = Math.acos(1 - 2 * t);
        const u = theta;
        const v = phi * 2 + time * 0.4;

        // Major and minor radii for torus shape
        const R = PARAMS.torusMajorRadius; // major radius
        const r = PARAMS.torusTubeRadius; // tube radius (thickness)

        // Clifford torus with adjustable geometry
        const cu = Math.cos(u);
        const su = Math.sin(u);
        const cv = Math.cos(v);
        const sv = Math.sin(v);

        // 4D torus coordinates
        const r1 = R + r * 0.2 * Math.sin(time * 0.5);
        const x4 = r1 * cu;
        const y4 = r1 * su;
        const z4 = r * cv;
        const w4 = r * sv;

        // Stereographic projection from 4D to 3D
        const d = 2 - w4;
        const x = x4 / d;
        const y = y4 / d;
        const z = z4 / d;

        const wave = Math.sin(x * 5 + time) * Math.cos(y * 5 - time * 0.7) * chaos;

        target.set(
            x * scale + wave * PARAMS.waveAmplitude,
            y * scale + wave * PARAMS.waveAmplitude * Math.sin(time * 0.3),
            z * scale * 0.8 + wave * Math.cos(time * 0.4)
        );

        const hue = (PARAMS.hueOffset + t * 0.8 + time * PARAMS.hueSpeed + wave * 0.05) % 1;
        color.setHSL(hue, PARAMS.saturation, PARAMS.lightness + wave * 0.15);
        // USER CODE END

        positions[i].lerp(target, runtimeProfile.positionLerp ?? 0.1);
        dummy.position.copy(positions[i]);
        dummy.scale.setScalar(PARAMS.particleSize);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
        meshRef.current.setColorAt(i, pColor);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  });

  return (
    <group ref={groupRef}>
      <instancedMesh ref={meshRef} args={[geometry, material, count]} />
    </group>
  );
};

export default function App({ params = {}, liveParamsRef = null, backgroundColor = '#1a1a1a' }) {
  const isMobile = useMediaMatch(MOBILE_MEDIA_QUERY);
  const prefersReducedMotion = useMediaMatch(REDUCED_MOTION_QUERY);

  const qualityProfile = useMemo(() => {
    if (prefersReducedMotion) {
      return {
        antialias: false,
        autoRotate: false,
        dpr: [1, 1],
        enableControls: false,
        particleScale: 0.08,
        powerPreference: 'default',
        positionLerp: 0.18,
        sphereSegments: 6,
        targetFrameInterval: 1 / 20,
      };
    }

    if (isMobile) {
      return {
        antialias: false,
        autoRotate: false,
        dpr: [1, 1],
        enableControls: false,
        particleScale: 0.14,
        powerPreference: 'default',
        positionLerp: 0.16,
        sphereSegments: 6,
        targetFrameInterval: 1 / 24,
      };
    }

    return {
      antialias: true,
      autoRotate: true,
      dpr: [1, 1.5],
      enableControls: true,
      particleScale: 1,
      powerPreference: 'high-performance',
      positionLerp: 0.1,
      sphereSegments: 16,
      targetFrameInterval: 0,
    };
  }, [isMobile, prefersReducedMotion]);

  const optimizedParams = useMemo(() => {
    const resolvedParticleCount = params.particleCount ?? 25000;
    const resolvedAnimationSpeed = params.animationSpeed ?? 1;

    return {
      ...params,
      particleCount: Math.max(400, Math.round(resolvedParticleCount * qualityProfile.particleScale)),
      sphereSegments: qualityProfile.sphereSegments,
      tireSpinSpeed: prefersReducedMotion ? 0 : params.tireSpinSpeed,
      animationSpeed: prefersReducedMotion ? Math.min(resolvedAnimationSpeed, 1) : resolvedAnimationSpeed,
    };
  }, [params, prefersReducedMotion, qualityProfile]);

  const bloomStrength = optimizedParams.bloomStrength ?? 1.8;
  const bloomEnabled = !isMobile && !prefersReducedMotion && bloomStrength > 0;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100dvh',
        background: 'transparent',
        zIndex: 1,
        pointerEvents: 'none',
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 100], fov: 60 }}
        dpr={qualityProfile.dpr}
        style={{ pointerEvents: 'none', background: 'transparent', cursor: 'default' }}
        gl={{ alpha: false, antialias: qualityProfile.antialias, powerPreference: qualityProfile.powerPreference }}
      >
        <SceneBackground color={backgroundColor} />
        <ParticleSwarm params={optimizedParams} liveParamsRef={liveParamsRef} runtimeProfile={qualityProfile} />
        {qualityProfile.enableControls ? (
          <OrbitControls autoRotate={qualityProfile.autoRotate} enableZoom enablePan={false} enableRotate enableDamping dampingFactor={0.08} rotateSpeed={0.45} zoomSpeed={0.75} minDistance={45} maxDistance={180} />
        ) : null}
        {bloomEnabled ? (
          <Effects disableGamma>
            <unrealBloomPass
              threshold={optimizedParams.bloomThreshold ?? 0}
              strength={bloomStrength}
              radius={optimizedParams.bloomRadius ?? 0.4}
            />
          </Effects>
        ) : null}
      </Canvas>
    </div>
  );
}
