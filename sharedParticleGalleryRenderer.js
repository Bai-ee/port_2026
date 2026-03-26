import * as THREE from 'three';

const DEFAULT_PARAMS = {
  scale: 24,
  chaos: 1,
  flow: 0.22,
  particleCount: 1400,
  particleSize: 0.2,
  speedMult: 0.12,
  hueSpeed: 0.04,
  waveAmplitude: 1.2,
  saturation: 0.8,
  lightness: 0.64,
  rotationX: 0,
  rotationY: 0,
  rotationZ: 0,
  tireSpinAxis: 'z',
  tireSpinSpeed: 0,
  animationSpeed: 1,
};

const SYSTEM_PRESETS = [
  {
    kind: 'torus',
    seed: 0.12,
    scale: 26,
    particleCount: 1500,
    hueOffset: 0.02,
    hueRange: 0.1,
    saturation: 0.84,
    lightness: 0.7,
    cameraZ: 86,
    rotation: [0.9, -0.45, 0.22],
  },
  {
    kind: 'vortex',
    seed: 0.31,
    scale: 28,
    particleCount: 1300,
    hueOffset: 0.14,
    hueRange: 0.08,
    saturation: 0.9,
    lightness: 0.68,
    cameraZ: 94,
    rotation: [0.1, 0.35, -0.15],
  },
  {
    kind: 'lattice',
    seed: 0.49,
    scale: 32,
    particleCount: 1200,
    hueOffset: 0.58,
    hueRange: 0.12,
    saturation: 0.72,
    lightness: 0.7,
    cameraZ: 96,
    rotation: [0.42, -0.55, 0.1],
  },
  {
    kind: 'sphere',
    seed: 0.66,
    scale: 30,
    particleCount: 1450,
    hueOffset: 0.76,
    hueRange: 0.07,
    saturation: 0.84,
    lightness: 0.69,
    cameraZ: 88,
    rotation: [0.55, 0.18, -0.12],
  },
  {
    kind: 'ribbon',
    seed: 0.84,
    scale: 34,
    particleCount: 1250,
    hueOffset: 0.92,
    hueRange: 0.09,
    saturation: 0.8,
    lightness: 0.7,
    cameraZ: 102,
    rotation: [-0.25, 0.46, 0.3],
  },
  {
    kind: 'orbits',
    seed: 1.05,
    scale: 29,
    particleCount: 1350,
    hueOffset: 0.34,
    hueRange: 0.11,
    saturation: 0.86,
    lightness: 0.7,
    cameraZ: 90,
    rotation: [0.24, -0.28, 0.18],
  },
  {
    kind: 'cloud',
    seed: 1.24,
    scale: 36,
    particleCount: 1500,
    hueOffset: 0.46,
    hueRange: 0.09,
    saturation: 0.78,
    lightness: 0.72,
    cameraZ: 104,
    rotation: [-0.42, 0.16, -0.24],
  },
  {
    kind: 'helix',
    seed: 1.41,
    scale: 31,
    particleCount: 1350,
    hueOffset: 0.22,
    hueRange: 0.08,
    saturation: 0.9,
    lightness: 0.68,
    cameraZ: 92,
    rotation: [0.3, 0.52, -0.08],
  },
];

const createMaterial = () => {
  return new THREE.ShaderMaterial({
    transparent: false,
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
      varying vec3 vNormal;
      varying vec3 vColor;

      void main() {
        vec3 viewDir = vec3(0.0, 0.0, 1.0);
        float metallic = dot(vNormal, viewDir) * 0.5 + 0.5;
        metallic = pow(metallic, 2.5);
        vec3 col = mix(vColor * 0.22, vColor, metallic);
        gl_FragColor = vec4(col + vColor * 0.14, 1.0);
      }
    `,
  });
};

const getTargetPosition = (system, index, elapsed) => {
  const t = index / system.count;
  const speed = elapsed * system.speedMult;
  const tau = Math.PI * 2;
  const seedPhase = system.seed * tau;
  const target = system.target;

  switch (system.kind) {
    case 'torus': {
      const theta = t * tau * 14 + speed * 0.9 + seedPhase;
      const phi = t * tau * 5 - speed * 0.55;
      const major = 0.92 + Math.sin(speed * 0.7) * 0.08;
      const minor = 0.38 + Math.cos(speed * 0.9 + t * 8) * 0.06;
      const ring = major + minor * Math.cos(phi);

      target.set(
        Math.cos(theta) * ring * system.scale,
        Math.sin(phi) * minor * system.scale * 1.55,
        Math.sin(theta) * ring * system.scale * 0.9
      );
      break;
    }
    case 'vortex': {
      const swirl = speed * 1.3 + t * tau * 18 + seedPhase;
      const height = (t - 0.5) * system.scale * 3.1;
      const radius = (0.18 + t * 0.95) * system.scale * (0.8 + 0.22 * Math.sin(speed * 1.4));

      target.set(
        Math.cos(swirl) * radius,
        height + Math.sin(swirl * 0.8) * system.waveAmplitude * 3.4,
        Math.sin(swirl) * radius
      );
      break;
    }
    case 'lattice': {
      const side = Math.ceil(Math.cbrt(system.count));
      const xIndex = index % side;
      const yIndex = Math.floor(index / side) % side;
      const zIndex = Math.floor(index / (side * side));
      const spread = system.scale * 0.38;
      const x = (xIndex - side / 2) * spread;
      const y = (yIndex - side / 2) * spread;
      const z = (zIndex - side / 2) * spread;
      const wave = Math.sin((xIndex + yIndex) * 0.7 + speed * 1.8) * system.waveAmplitude * 2.2;

      target.set(
        x + wave,
        y + Math.cos((zIndex + xIndex) * 0.65 - speed * 1.2) * system.waveAmplitude * 2.6,
        z + Math.sin((yIndex + zIndex) * 0.55 + speed * 1.4) * system.waveAmplitude * 2.8
      );
      break;
    }
    case 'sphere': {
      const phi = Math.acos(1 - 2 * t);
      const theta = tau * (index * 0.61803398875 + system.seed + speed * 0.14);
      const radius = system.scale * (0.92 + 0.22 * Math.sin(speed * 1.7 + t * 9));

      target.set(
        Math.cos(theta) * Math.sin(phi) * radius,
        Math.cos(phi) * radius,
        Math.sin(theta) * Math.sin(phi) * radius
      );
      break;
    }
    case 'ribbon': {
      const progress = t * 2 - 1;
      const angle = progress * tau * 2.2 + speed * 0.8 + seedPhase;
      const waveA = Math.sin(progress * tau * 3 + speed * 1.1);
      const waveB = Math.cos(progress * tau * 2.5 - speed * 0.9);

      target.set(
        progress * system.scale * 2.6,
        waveA * system.scale * 0.95,
        Math.sin(angle) * system.scale * 0.88 + waveB * system.waveAmplitude * 4
      );
      break;
    }
    case 'orbits': {
      const ringIndex = index % 5;
      const local = (index / system.count) * tau * (4 + ringIndex);
      const radius = system.scale * (0.32 + ringIndex * 0.18);
      const spin = speed * (0.5 + ringIndex * 0.18) + seedPhase;

      target.set(
        Math.cos(local + spin) * radius,
        Math.sin(local * 2 + speed) * system.waveAmplitude * 4.5,
        Math.sin(local + spin) * radius
      );
      break;
    }
    case 'cloud': {
      const phi = Math.acos(1 - 2 * t);
      const theta = tau * (index * 0.754877666 + system.seed);
      const baseRadius = system.scale * 0.72;
      const wave =
        Math.sin(theta * 2 + speed * 1.6) * 0.22 +
        Math.cos(phi * 4 - speed * 1.2) * 0.18 +
        Math.sin((theta + phi) * 3 + speed * 0.8) * 0.12;
      const radius = baseRadius * (1 + wave);

      target.set(
        Math.cos(theta) * Math.sin(phi) * radius,
        Math.cos(phi) * radius,
        Math.sin(theta) * Math.sin(phi) * radius
      );
      break;
    }
    case 'helix':
    default: {
      const angle = t * tau * 11 + speed * 1.15 + seedPhase;
      const radius = system.scale * (0.28 + 0.48 * Math.sin(t * tau * 2 + speed * 0.7) ** 2);
      const height = (t - 0.5) * system.scale * 3.4;

      target.set(
        Math.cos(angle) * radius,
        height,
        Math.sin(angle) * radius + Math.cos(angle * 0.5) * system.waveAmplitude * 4
      );
      break;
    }
  }

  return target;
};

const createParticleSystem = ({ geometry, material, baseParams, preset }) => {
  const count = preset.particleCount ?? baseParams.particleCount;
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const camera = new THREE.PerspectiveCamera(54, 1, 0.1, 500);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const target = new THREE.Vector3();
  const positions = Array.from({ length: count }, () => {
    return new THREE.Vector3(
      (Math.random() - 0.5) * 28,
      (Math.random() - 0.5) * 28,
      (Math.random() - 0.5) * 28
    );
  });

  camera.position.set(0, 0, preset.cameraZ ?? 90);
  group.rotation.set(...(preset.rotation ?? [0, 0, 0]));
  group.add(mesh);
  scene.add(group);

  return {
    scene,
    camera,
    group,
    mesh,
    dummy,
    color,
    target,
    positions,
    count,
    kind: preset.kind,
    seed: preset.seed,
    scale: preset.scale ?? baseParams.scale,
    speedMult: (baseParams.speedMult ?? 0.12) * (preset.speedMult ?? 1),
    waveAmplitude: (baseParams.waveAmplitude ?? 1.2) * (preset.waveAmplitude ?? 1),
    saturation: preset.saturation ?? baseParams.saturation,
    lightness: preset.lightness ?? baseParams.lightness,
    hueOffset: preset.hueOffset ?? 0,
    hueRange: preset.hueRange ?? 0.08,
  };
};

export const createSharedParticleGalleryRenderer = ({
  canvas,
  container,
  getWindows,
  params = {},
}) => {
  const baseParams = { ...DEFAULT_PARAMS, ...params };
  const isMobile = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(max-width: 767px), (pointer: coarse)').matches
    : false;
  const prefersReducedMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
  const particleCountScale = prefersReducedMotion ? 0.45 : isMobile ? 0.72 : 1;
  const maxDpr = prefersReducedMotion ? 1 : isMobile ? 1.1 : 1.5;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !isMobile && !prefersReducedMotion,
    alpha: true,
    powerPreference: 'high-performance',
  });
  const geometry = new THREE.SphereGeometry(baseParams.particleSize, 12, 12);
  const material = createMaterial();
  const systems = SYSTEM_PRESETS.map((preset) => {
    const optimizedCount = Math.max(
      240,
      Math.round((preset.particleCount ?? baseParams.particleCount) * particleCountScale)
    );

    return createParticleSystem({
      geometry,
      material,
      baseParams: {
        ...baseParams,
        particleCount: optimizedCount,
      },
      preset: {
        ...preset,
        particleCount: optimizedCount,
      },
    });
  });

  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = false;

  let displayWidth = 0;
  let displayHeight = 0;
  let displayRatio = 1;

  const syncDisplaySize = () => {
    const nextWidth = Math.max(1, Math.round(container.clientWidth));
    const nextHeight = Math.max(1, Math.round(container.clientHeight));
    const nextRatio = Math.min(window.devicePixelRatio || 1, maxDpr);

    if (
      nextWidth === displayWidth &&
      nextHeight === displayHeight &&
      nextRatio === displayRatio
    ) {
      return;
    }

    displayWidth = nextWidth;
    displayHeight = nextHeight;
    displayRatio = nextRatio;

    renderer.setPixelRatio(displayRatio);
    renderer.setSize(displayWidth, displayHeight, false);
  };

  const updateSystem = (system, elapsed) => {
    const drift = elapsed * baseParams.animationSpeed;

    for (let index = 0; index < system.count; index += 1) {
      const target = getTargetPosition(system, index, drift);
      const hue =
        (system.hueOffset + index / system.count * system.hueRange + elapsed * baseParams.hueSpeed) % 1;

      system.color.setHSL(hue, system.saturation, system.lightness);
      system.positions[index].lerp(target, 0.08);
      system.dummy.position.copy(system.positions[index]);
      system.dummy.updateMatrix();
      system.mesh.setMatrixAt(index, system.dummy.matrix);
      system.mesh.setColorAt(index, system.color);
    }

    system.mesh.instanceMatrix.needsUpdate = true;

    if (system.mesh.instanceColor) {
      system.mesh.instanceColor.needsUpdate = true;
    }
  };

  const getVisibleBounds = (rect, containerRect) => {
    const visibleLeft = Math.max(0, rect.left - containerRect.left);
    const visibleRight = Math.min(containerRect.width, rect.right - containerRect.left);
    const visibleBottom = Math.min(containerRect.height, rect.bottom - containerRect.top);
    const visibleWidth = visibleRight - visibleLeft;
    const visibleHeight = visibleBottom - Math.max(0, rect.top - containerRect.top);

    if (visibleWidth <= 1 || visibleHeight <= 1) {
      return null;
    }

    return {
      visibleLeft,
      visibleBottom,
      visibleWidth,
      visibleHeight,
    };
  };

  const renderWindow = (system, bounds) => {
    if (!bounds) {
      return;
    }

    system.camera.aspect = bounds.visibleWidth / bounds.visibleHeight;
    system.camera.updateProjectionMatrix();

    renderer.setViewport(bounds.visibleLeft, displayHeight - bounds.visibleBottom, bounds.visibleWidth, bounds.visibleHeight);
    renderer.setScissor(bounds.visibleLeft, displayHeight - bounds.visibleBottom, bounds.visibleWidth, bounds.visibleHeight);
    renderer.render(system.scene, system.camera);
  };

  const render = (elapsed) => {
    syncDisplaySize();

    renderer.setViewport(0, 0, displayWidth, displayHeight);
    renderer.setScissor(0, 0, displayWidth, displayHeight);
    renderer.setScissorTest(false);
    renderer.clear(true, true, true);
    renderer.setScissorTest(true);

    const windows = getWindows();

    if (!windows.length) {
      return;
    }

    const containerRect = container.getBoundingClientRect();

    systems.forEach((system, index) => {
      const windowElement = windows[index];

      if (!windowElement) {
        return;
      }

      const bounds = getVisibleBounds(windowElement.getBoundingClientRect(), containerRect);

      if (!bounds) {
        return;
      }

      updateSystem(system, elapsed + index * 0.17);
      renderWindow(system, bounds);
    });
  };

  const dispose = () => {
    geometry.dispose();
    material.dispose();
    renderer.dispose();
  };

  return {
    render,
    dispose,
  };
};
