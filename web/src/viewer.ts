// The house in 3D: an overview you can orbit, and a walk mode you enter through the gate. Units are metres.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { VignetteShader } from "three/examples/jsm/shaders/VignetteShader.js";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { meshVoxels, type Vox } from "./mesher.ts";
import { makeScenery, type Setting, type Scenery } from "./scenery.ts";
import { Life, type Walk } from "./life.ts";

// ?quality=high keeps the full look for video captures; visitors get a lighter, adaptive mode.
const HQ = new URLSearchParams(location.search).get("quality") === "high";

export type Block = [number, number, number, string, string]; // x, y, z, material, tag (voxel units)
export type ElementInfo = { id: string; name: string; original: string | null; kind: string; mentions?: number };

const EYE = 1.6;
const HEIGHT = 1.75;
const RADIUS = 0.28;
const STEP = 0.55; // highest ledge you walk up without jumping
const hoverKey = (x: number, y: number, z: number) => ((x + 4096) * 8192 + (y + 4096)) * 8192 + (z + 4096);
const PASSABLE = new Set(["leaves", "maple", "ginkgo", "pine", "blossom", "water"]);

type Box = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }; // metres
type Part = { mesh: THREE.Mesh; tag: string; guess: boolean; faceVox: Vox[] };

export class HouseViewer {
  renderer: THREE.WebGLRenderer;
  labels: CSS2DRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  orbit: OrbitControls;
  walk: PointerLockControls;
  sun: THREE.DirectionalLight;
  group = new THREE.Group();
  labelGroup = new THREE.Group();
  parts: Part[] = [];
  blocks: Block[] = [];
  size = 0.5; // metres per voxel
  solid = new Set<string>();
  boxes = new Map<string, Box>();
  elements = new Map<string, ElementInfo>();
  showGuesses = true;
  showLabels = true;
  mode: "orbit" | "walk" | "fly" = "orbit";
  private labelTick = 0;
  get flightMs() {
    return this.flight?.ms ?? 0;
  }
  private flight: { pos: THREE.CatmullRomCurve3; look: THREE.CatmullRomCurve3; start: number; ms: number; done?: () => void } | null = null;
  highlighted: string | null = null;
  onHover: (tag: string | null) => void = () => {};
  onSelect: (tag: string | null) => void = () => {};
  onModeChange: (m: "orbit" | "walk" | "fly") => void = () => {};
  private el: HTMLElement;
  // elements being "printed": a clipping plane rises through each one behind a glowing scan line
  private rising: { mesh: THREE.Mesh; at: number; plane: THREE.Plane; y0: number; y1: number; scan: THREE.Mesh }[] = [];
  private scanMat = new THREE.MeshBasicMaterial({ color: "#ffd98a", transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  private vel = new THREE.Vector3();
  private keys = new Set<string>();
  private onGround = false;
  private clock = new THREE.Clock();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(9, 9);
  private lastHover: string | null = null;
  private composer: EffectComposer;
  private ao: GTAOPass;
  private tufts: THREE.InstancedMesh;
  private bokeh: BokehPass;
  private mirrors: Reflector[] = [];
  private clouds = new THREE.Group();
  private normalMaps: [THREE.Texture, THREE.Texture] | null = null;
  private sky: Sky;
  private island = new THREE.Group();
  private backdrop: THREE.CanvasTexture;
  private nightBackdrop!: THREE.CanvasTexture;
  private lantern = new THREE.PointLight("#ffe2bd", 0, 9, 1.6);
  night = 0; // 0 day .. 1 night
  private nightLights = new THREE.Group();
  private nightUniform = { value: 0 };
  private hemi!: THREE.HemisphereLight;
  private islandTop = new Set<string>();
  private metalMats = new Set<THREE.MeshStandardMaterial>();
  private flightSolid = new Set<string>(); // everything a camera must not pass through, leaves included
  private waterUniforms = { time: { value: 0 }, waterColor: { value: new THREE.Color("#2f6f86") }, tNormal: { value: null as THREE.Texture | null }, tSky: { value: null as THREE.Texture | null }, skyTop: { value: new THREE.Color("#4d86c8") }, skyLow: { value: new THREE.Color("#b9d0e6") } };
  private bloom!: UnrealBloomPass;
  private dome!: THREE.Mesh;
  private starField!: THREE.Points;
  private giltEnv!: THREE.Texture;
  private vignette!: ShaderPass;
  private grade!: ShaderPass;

  constructor(el: HTMLElement) {
    this.el = el;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(HQ ? Math.min(devicePixelRatio, 2) : Math.min(devicePixelRatio, 1.25));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = HQ ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = HQ; // for visitors the sun only re-renders shadows when something changes
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.localClippingEnabled = true;
    this.renderer.toneMappingExposure = 0.64;
    el.appendChild(this.renderer.domElement);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = "labels";
    el.appendChild(this.labels.domElement);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 700);

    // Physical sky with a low, warm sun.
    const sky = (this.sky = new Sky());
    sky.scale.setScalar(550);
    const u = sky.material.uniforms;
    u.cloudCoverage.value = 0.45;
    u.cloudSpeed.value = 0.00006;
    u.turbidity.value = 7;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.006;
    u.mieDirectionalG.value = 0.86;
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 22), THREE.MathUtils.degToRad(140));
    u.sunPosition.value.copy(sunDir);
    // a softer sky behind low shots: the raw sky is so bright it bloomed into a white veil over small places
    // (and brighter again near sunset, when the raw sky goes dull grey)
    sky.material.uniforms.skyGain = this.skyGain;
    sky.material.uniforms.skyBlue = this.skyBlue;
    // by day the pale haze near the horizon is graded toward a clear blue, the way a photographer would
    sky.material.fragmentShader = "uniform float skyGain;\nuniform float skyBlue;\n" + sky.material.fragmentShader.replace("gl_FragColor = vec4( texColor, 1.0 );", "vec3 skyC = texColor * skyGain; float skyL = dot(skyC, vec3(0.2126, 0.7152, 0.0722)); skyC = mix(skyC, vec3(0.42, 0.62, 0.95) * skyL * 1.25, skyBlue * smoothstep(-0.06, 0.1, direction.y)); gl_FragColor = vec4( skyC * min( 1.0, 1.35 / max( max( skyC.r, skyC.g ), max( skyC.b, 1e-4 ) ) ), 1.0 );");
    this.scene.add(sky);
    // Image-based light: render the sky once into an environment map that every surface picks up.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const skyScene = new THREE.Scene();
    const skyCopy = new Sky();
    skyCopy.scale.setScalar(600);
    Object.assign(skyCopy.material.uniforms.sunPosition.value, sunDir);
    for (const k of ["turbidity", "rayleigh", "mieCoefficient", "mieDirectionalG"]) skyCopy.material.uniforms[k].value = u[k].value;
    skyScene.add(skyCopy);
    this.scene.environment = pmrem.fromScene(skyScene).texture;
    this.scene.environmentIntensity = 0.06;
    // Overview backdrop: a warm late-afternoon gradient instead of a pale void.
    const bg = this.backdropCanvas;
    bg.width = 1024;
    bg.height = 512;
    const bgc = bg.getContext("2d")!;
    const grad = bgc.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, "#7fa6c9");
    grad.addColorStop(0.5, "#cdd3cf");
    grad.addColorStop(0.78, "#efd6b4");
    grad.addColorStop(1, "#e7b98e");
    bgc.fillStyle = grad;
    bgc.fillRect(0, 0, 1024, 512);
    this.backdrop = new THREE.CanvasTexture(bg);
    this.backdrop.colorSpace = THREE.SRGBColorSpace;
    // The backdrop is painted on a dome round the camera (not the screen), so water can reflect it.
    this.waterUniforms.tSky.value = this.backdrop;
    this.paintBackdrop(0);
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(560, 48, 24), new THREE.MeshBasicMaterial({ map: this.backdrop, side: THREE.BackSide, fog: false, depthWrite: false, depthTest: false }));
    this.dome.renderOrder = -1; // drawn first, behind everything (the physical sky covers it until it is dark)
    // drawn at the far plane like the physical sky, so a mirror's tilted clipping never cuts it away
    (this.dome.material as THREE.Material).onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace("#include <project_vertex>", "#include <project_vertex>\ngl_Position.z = gl_Position.w;");
    };
    this.scene.add(this.dome);
    // stars: sharp single points of light on a sphere round the camera, brighter and denser overhead
    {
      const n = 1600, p = new Float32Array(n * 3), c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const u = Math.random() * Math.PI * 2, el = Math.asin(0.03 + 0.97 * Math.random() ** 0.7), b = 0.35 + Math.random() ** 3 * 0.9;
        p.set([Math.cos(u) * Math.cos(el) * 520, Math.sin(el) * 520, Math.sin(u) * Math.cos(el) * 520], i * 3);
        c.set([b, b, b * (0.92 + Math.random() * 0.12)], i * 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(c, 3));
      this.starField = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, fog: false }));
      this.starField.renderOrder = 0;
      this.starField.visible = false;
      this.scene.add(this.starField);
    }
    // Gilt reflects a soft warm sky, not the physical sky's blinding sun disc.
    const gc = document.createElement("canvas");
    gc.width = 256;
    gc.height = 128;
    const gg = gc.getContext("2d")!;
    const ggrad = gg.createLinearGradient(0, 0, 0, 128);
    [[0, "#5d7fa8"], [0.42, "#d9d6cb"], [0.5, "#fff1d6"], [0.56, "#b89466"], [1, "#4a3826"]].forEach(([p, c]) => ggrad.addColorStop(p as number, c as string));
    gg.fillStyle = ggrad;
    gg.fillRect(0, 0, 256, 128);
    const gt = new THREE.CanvasTexture(gc);
    gt.mapping = THREE.EquirectangularReflectionMapping;
    gt.colorSpace = THREE.SRGBColorSpace;
    this.giltEnv = pmrem.fromEquirectangular(gt).texture;
    const nb = document.createElement("canvas");
    nb.width = 1024;
    nb.height = 512;
    const nbc = nb.getContext("2d")!;
    const ng = nbc.createLinearGradient(0, 0, 0, 512);
    ng.addColorStop(0, "#050914");
    ng.addColorStop(0.6, "#111a33");
    ng.addColorStop(1, "#2a2440");
    nbc.fillStyle = ng;
    nbc.fillRect(0, 0, 1024, 512);
    for (let i = 0; i < 260; i++) {
      const y = Math.random() ** 1.6 * 330;
      nbc.fillStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.6})`;
      nbc.fillRect(Math.random() * 1024, y, Math.random() < 0.15 ? 2 : 1, Math.random() < 0.15 ? 2 : 1);
    }
    this.nightBackdrop = new THREE.CanvasTexture(nb);
    this.nightBackdrop.colorSpace = THREE.SRGBColorSpace;
    this.scene.fog = new THREE.Fog("#e8d6bd", 160, 900);

    this.hemi = new THREE.HemisphereLight("#bcd4ee", "#8a6f4c", 1.1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight("#ffd29a", 4.0);
    this.sun.userData.dir = sunDir;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(HQ ? 4096 : 2048, HQ ? 4096 : 2048);
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);
    // In walk mode a soft warm light travels with you, so rooms read as daylit interiors, not caves.
    this.camera.add(this.lantern);
    this.scene.add(this.camera);

    this.tufts = this.makeTufts();
    this.scene.add(this.island, this.tufts, this.group, this.labelGroup, this.clouds, this.nightLights, this.life.group);

    // Contact shadows: ground-truth ambient occlusion over the whole frame, then tone mapping.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.ao = new GTAOPass(this.scene, this.camera, 512, 512);
    this.ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1.1, samples: HQ ? 16 : 8 });
    this.ao.blendIntensity = 0.85;
    this.composer.addPass(this.ao);
    // Tilt-shift in the overview: a shallow depth of field makes the diorama read as a miniature.
    // Gilt and lamps glow a little: only the brightest pixels bloom.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.3, 0.5, 1.15);
    this.composer.addPass(this.bloom);
    this.bokeh = new BokehPass(this.scene, this.camera, { focus: 30, aperture: 0.00015, maxblur: 0.0035 });
    this.composer.addPass(this.bokeh);
    // a film grade: warm highlights and cool shadows, strongest at golden hour
    this.grade = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, amount: { value: 0.15 } },
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `uniform sampler2D tDiffuse; uniform float amount; varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tDiffuse, vUv);
          float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
          vec3 tint = mix(vec3(0.62, 0.78, 1.0), vec3(1.18, 0.86, 0.58), smoothstep(0.02, 0.45, l));
          vec3 g = c.rgb * tint;
          g = mix(vec3(dot(g, vec3(0.2126, 0.7152, 0.0722))), g, 1.15);
          gl_FragColor = vec4(mix(c.rgb, g, amount), c.a);
        }`,
    });
    this.composer.addPass(this.grade);
    const vignette = (this.vignette = new ShaderPass(VignetteShader));
    vignette.uniforms.offset.value = 0.95;
    vignette.uniforms.darkness.value = 1.1; // above 1 the corners darken; below 1 they would fade to grey
    this.composer.addPass(vignette);
    this.composer.addPass(new OutputPass());

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.maxPolarAngle = Math.PI * 0.48;
    this.orbit.minDistance = 2;
    this.walk = new PointerLockControls(this.camera, this.renderer.domElement);
    this.walk.addEventListener("unlock", () => this.setMode("orbit"));

    new ResizeObserver(() => this.resize()).observe(el);
    document.addEventListener("visibilitychange", () => { this.lastFrame = 0; });
    addEventListener("keydown", (e) => this.keys.add(e.code));
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    this.renderer.domElement.addEventListener("pointermove", (e) => {
      const r = this.renderer.domElement.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    });
    let down = { x: 0, y: 0 };
    this.renderer.domElement.addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY }));
    this.renderer.domElement.addEventListener("click", (e) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      this.onSelect(this.pick());
    });
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }





  // Grass tufts scattered on the meadow (not inside the build footprint).
  private makeTufts() {
    const geo = new THREE.BoxGeometry(0.16, 0.22, 0.16);
    geo.translate(0, 0.11, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 1 });
    const mesh = new THREE.InstancedMesh(geo, mat, 4000);
    mesh.count = 0;
    mesh.receiveShadow = true;
    return mesh;
  }

  // The place stands on a floating island of land: the yard or plaza right round it, then scenery nobody
  // described (a village's fields and neighbours, or a town's streets and rooftops), fading into the haze,
  // above a deep base of soil and banded rock. Drawn with the same voxel mesher, at 0.5 m.
  setPlace(setting: Setting, entrance: string | null) {
    this.setting = setting;
    this.entranceTag = entrance;
  }
  private setting: Setting = "village";
  private groundS = 0.5; // metres per voxel of the island and scenery
  private sceneryFlight = new Set<string>();
  private groundRadius = 0;
  private skyGain = { value: 0.6 };
  private skyBlue = { value: 0.45 };
  private farLand: THREE.Mesh | null = null;
  private farThings: THREE.InstancedMesh | null = null;
  life = new Life();
  private laneCells = new Set<string>();
  private entranceTag: string | null = null;
  private sceneryUniforms = { uRect: { value: new THREE.Vector4() }, uHaze: { value: new THREE.Color("#e8d6bd") }, uFade: { value: 60 } };

  private placeEnvironment() {
    const b = this.bounds();
    if (!b) return;
    for (const c of [...this.island.children]) {
      this.island.remove(c);
      (c as THREE.Mesh).geometry.dispose();
    }
    const e = this.entranceTag ? this.boxes.get(this.entranceTag) : null;
    const doorX = e ? (e.x0 + e.x1) / 2 : (b.x0 + b.x1) / 2;
    const sc = makeScenery(b, doorX, this.setting, b.y1);
    const S = (this.groundS = sc.S), x0 = Math.floor((b.x0 - sc.radius) / S), x1 = Math.ceil((b.x1 + sc.radius) / S), z0 = Math.floor((b.z0 - sc.radius) / S), z1 = Math.ceil((b.z1 + sc.radius) / S);
    this.islandTop = sc.top;
    this.groundRadius = sc.radius;
    this.laneCells = new Set(sc.vox.filter((v) => v.y === -1 && (v.m === "lane" || v.m === "street" || v.m === "plaza")).map((v) => `${v.x},${v.z}`));
    // scenery that stands up (houses, trees, cane) is solid to the flight camera too
    this.sceneryFlight = new Set(sc.vox.filter((v) => v.y >= 0).map((v) => `${v.x},${v.y},${v.z}`));
    this.sceneryUniforms.uRect.value.set(b.x0, b.x1, b.z0, b.z1);
    this.sceneryUniforms.uFade.value = sc.radius * 0.9;
    const su = this.sceneryUniforms, nu = this.nightUniform;
    for (const tm of meshVoxels(sc.vox, S)) {
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
      // lit windows glow after dark; everything fades toward the haze with distance from the place
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, su, { uNight: nu });
        sh.vertexShader = sh.vertexShader
          .replace("#include <common>", "#include <common>\nattribute float glow;\nvarying float vGlow;\nvarying vec3 vW;")
          .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = glow;\nvW = (modelMatrix * vec4(position, 1.0)).xyz;");
        sh.fragmentShader = sh.fragmentShader
          .replace("#include <common>", "#include <common>\nuniform float uNight;\nuniform vec4 uRect;\nuniform vec3 uHaze;\nuniform float uFade;\nvarying float vGlow;\nvarying vec3 vW;")
          .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vColor.rgb * vGlow * uNight * 1.1;")
          .replace("#include <dithering_fragment>", "#include <dithering_fragment>\nfloat out_ = length(vec2(max(0.0, max(uRect.x - vW.x, vW.x - uRect.y)), max(0.0, max(uRect.z - vW.z, vW.z - uRect.w))));\ngl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, smoothstep(4.0, uFade, out_) * 0.55);");
      };
      const mesh = new THREE.Mesh(tm.geometry, mat);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      this.island.add(mesh);
    }
    this.placeLife(sc);
    // the land goes on past the island to the horizon, fading into haze, so the world never ends in a void
    if (this.farLand) {
      this.scene.remove(this.farLand);
      this.farLand.geometry.dispose();
    }
    if (this.farThings) {
      this.scene.remove(this.farThings);
      this.farThings.geometry.dispose();
    }
    this.farLand = new THREE.Mesh(new THREE.CircleGeometry(sc.radius * 9, 64), new THREE.MeshStandardMaterial({ color: this.setting === "town" ? "#b7a48c" : this.setting === "forest" ? "#3f5a34" : "#8e9a62", roughness: 1 }));
    this.farLand.rotation.x = -Math.PI / 2;
    this.farLand.position.set((b.x0 + b.x1) / 2, -0.03, (b.z0 + b.z1) / 2);
    this.farLand.receiveShadow = true;
    // and on it, far away, more of the same: low rooftops round a town, clumps of trees and huts round a village
    {
      const town = this.setting === "town", n = town ? 900 : 380;
      // a village's far trees are little voxel crowns on a trunk (unit size, scaled per tree); a town's are boxes
      const cubes: THREE.BufferGeometry[] = [];
      if (!town) {
        // a crown of three offset blocks over a trunk: reads as a voxel tree from far off, with no seams
        cubes.push(new THREE.BoxGeometry(0.14, 0.62, 0.14).translate(0, 0.31, 0));
        cubes.push(new THREE.BoxGeometry(1.0, 0.5, 0.9).translate(0, 0.82, 0));
        cubes.push(new THREE.BoxGeometry(0.7, 0.32, 0.75).translate(0.08, 1.2, -0.05));
        cubes.push(new THREE.BoxGeometry(0.62, 0.36, 0.5).translate(-0.3, 0.98, 0.22));
      }
      const geo = town ? new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0) : mergeGeometries(cubes);
      const far = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 1 }), n);
      const o = new THREE.Object3D(), col = new THREE.Color();
      let seed = 5;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, R0 = sc.radius * (town ? 1.02 : 1.7);
      const forest = this.setting === "forest";
      const tones = town ? ["#e9dcc6", "#e3cfb0", "#d9c4a8", "#cdb79c", "#e8d7c9", "#c9b49a"] : forest ? ["#2f5530", "#b5402a", "#3d6431", "#b79a72"] : ["#4f7a37", "#5a8540", "#46702f", "#b79a72"];
      let k = 0;
      for (let i = 0; i < n * 3 && k < n; i++) {
        const a = rnd() * Math.PI * 2, r = R0 + Math.pow(rnd(), 0.8) * sc.radius * 3.2;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        if (this.islandTop.has(`${Math.floor(x / this.groundS)},${Math.floor(z / this.groundS)}`)) continue;
        const tree = !town && rnd() < (this.setting === "forest" ? 1 : 0.8);
        const w = tree ? 2.4 + rnd() * 1.6 : town ? 6 + rnd() * 10 : 5 + rnd() * 3;
        const h = tree ? 3 + rnd() * 3 : town ? 3 + rnd() * rnd() * 9 : 3;
        o.position.set(x, 0, z);
        o.rotation.y = town ? 0 : rnd() * Math.PI;
        o.scale.set(w, tree ? w * (0.8 + rnd() * 0.4) : h, tree ? w : w * (0.7 + rnd() * 0.6));
        o.updateMatrix();
        far.setMatrixAt(k, o.matrix);
        far.setColorAt(k, col.set(tones[tree ? Math.floor(rnd() * 3) : town ? Math.floor(rnd() * tones.length) : 3]).lerp(new THREE.Color("#a9b8c4"), (tree ? 0.15 : 0.35) + 0.35 * ((r - R0) / (sc.radius * 3.2))));
        k++;
      }
      far.count = k;
      far.receiveShadow = false; // too far for the shadow map; receiving it only speckles them
      this.farThings = far;
      this.scene.add(far);
    }
    this.scene.add(this.farLand);
    const meadow = sc.meadow;
    // grass tufts on the meadow part only
    const o = new THREE.Object3D(), col = new THREE.Color();
    let seed = 11, n = 0;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let tries = 0; tries < 120000 && n < 4000; tries++) {
      const x = (x0 + rnd() * (x1 - x0)) * S, z = (z0 + rnd() * (z1 - z0)) * S;
      if (!meadow.has(`${Math.floor(x / S)},${Math.floor(z / S)}`)) continue;
      o.position.set(x, 0, z);
      o.scale.set(0.8 + rnd() * 0.6, 0.5 + rnd() * 0.9, 0.8 + rnd() * 0.6);
      o.rotation.y = rnd() * Math.PI;
      o.updateMatrix();
      this.tufts.setMatrixAt(n, o.matrix);
      this.tufts.setColorAt(n, col.setHSL(0.24 + rnd() * 0.05, 0.42 + rnd() * 0.15, 0.3 + rnd() * 0.1));
      n++;
    }
    this.tufts.count = n;
    this.tufts.instanceMatrix.needsUpdate = true;
    if (this.tufts.instanceColor) this.tufts.instanceColor.needsUpdate = true;
    // the culling sphere was first worked out while the mesh was empty; without this the grass pops in and out as the camera turns
    this.tufts.computeBoundingSphere();
  }

  // People on open ground at walking level (paths, plazas, the parikrama, streets), and birds overhead.
  private placeLife(sc: Scenery) {
    const s = this.size, b = this.bounds();
    if (!b) return;
    const town = this.setting === "town";
    const WALK = new Set(["marble", "stone", "sandstone", "red_sandstone", "cement", "tile", "earth", "dung_floor", "white", "grass", "lime_plaster", "black_stone"]);
    // the highest solid voxel in each build column; people stand only where nothing is overhead
    const top = new Map<string, { y: number; m: string }>();
    for (const [x, y, z, m] of this.blocks) {
      const k = `${x},${z}`, t = top.get(k);
      if (!t || y > t.y) top.set(k, { y, m });
    }
    const ground = (px: number, pz: number): number | null => {
      const t = top.get(`${Math.floor(px / s)},${Math.floor(pz / s)}`);
      if (t) return WALK.has(t.m) && (t.y + 1) * s < 3.2 ? (t.y + 1) * s : null;
      const g = this.groundS, gx = Math.floor(px / g), gz = Math.floor(pz / g);
      if (!town && !this.islandTop.has(`${gx},${gz}`)) return null;
      if (this.sceneryFlight.has(`${gx},0,${gz}`) || this.sceneryFlight.has(`${gx},1,${gz}`)) return null;
      return this.islandTop.has(`${gx},${gz}`) ? 0 : null;
    };
    const inBuild = (x: number, z: number) => x >= b.x0 && x < b.x1 && z >= b.z0 && z < b.z1;
    const e2 = this.entranceTag ? this.boxes.get(this.entranceTag) : null;
    let seed = 99;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const walks: Walk[] = [];
    // keep the way in clear, so the shot through the gate is not blocked by someone standing in it
    const ent = e2 ? { x: (e2.x0 + e2.x1) / 2, z0: e2.z0 - 12, z1: e2.z1 + 25 } : null;
    const inTheWay = (x: number, z: number) => !!ent && Math.abs(x - ent.x) < 3.5 && z > ent.z0 && z < ent.z1;
    // open ground, not the top of a wall: the same footing half a metre to every side
    const footing = (x: number, z: number) => {
      const y = ground(x, z);
      if (y === null) return null;
      for (const [dx, dz] of [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) {
        const g = ground(x + dx, z + dz);
        if (g === null || Math.abs(g - y) > 0.3) return null;
      }
      return y;
    };
    const tryWalk = (x: number, z: number) => {
      if (inTheWay(x, z)) return;
      const y = footing(x, z);
      if (y === null) return;
      const a = rnd() * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
      let len = 0;
      for (let d = 0.5; d <= 2 + rnd() * 5; d += 0.5) {
        const g = footing(x + dx * d, z + dz * d);
        if (g === null || Math.abs(g - y) > 0.3) break;
        len = d;
      }
      if (len >= 1.5 && !inTheWay(x + dx * len, z + dz * len)) walks.push({ a: new THREE.Vector3(x, y, z), b: new THREE.Vector3(x + dx * len, y, z + dz * len) });
    };
    const size = Math.max(b.x1 - b.x0, b.z1 - b.z0, 10);
    const want = town ? Math.min(160, Math.round(size * 1.3)) : 6;
    // pilgrims inside a famous place; townspeople or villagers on the streets and lanes outside it
    for (let i = 0; i < want * 40 && walks.length < (town ? want * 0.7 : 0); i++) {
      const x = b.x0 + rnd() * (b.x1 - b.x0), z = b.z0 + rnd() * (b.z1 - b.z0);
      tryWalk(x, z);
    }
    const r = sc.radius;
    for (let i = 0; i < want * 60 && walks.length < want; i++) {
      const x = (b.x0 + b.x1) / 2 + (rnd() - 0.5) * 2 * r, z = (b.z0 + b.z1) / 2 + (rnd() - 0.5) * 2 * r;
      if (inBuild(x, z)) continue;
      const g = this.groundS;
      if (!town && !this.laneCells.has(`${Math.floor(x / g)},${Math.floor(z / g)}`)) continue;
      tryWalk(x, z);
    }
    const birds = new THREE.Vector3((b.x0 + b.x1) / 2, Math.max(12, b.y1 + 8), (b.z0 + b.z1) / 2);
    this.life.populate(walks, birds, Math.max(10, size * 0.4));
    const fires: THREE.Vector3[] = [];
    for (const [id, e] of this.elements) {
      const bx = this.boxes.get(id);
      if (bx && ["stove", "tandoor"].includes(e.kind)) fires.push(new THREE.Vector3((bx.x0 + bx.x1) / 2, bx.y1, (bx.z0 + bx.z1) / 2));
    }
    const R = sc.radius;
    this.life.addFires(fires, town ? null : { x0: b.x0 - R * 0.6, x1: b.x1 + R * 0.6, z0: b.z0 - R * 0.6, z1: b.z1 + R * 0.6 });
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    this.composer?.setSize(w, h);
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  setElements(list: ElementInfo[]) {
    this.elements = new Map(list.map((e) => [e.id, e]));
    this.rebuildLabels();
  }

  // The build frame has left at -x when facing +z (how people and models think about it);
  // three.js is right-handed, so facing +z puts -x on the right. Mirror x once, here.
  setBlocks(input: Block[], animate: boolean, size = this.size) {
    this.shadowDirty = 240;
    this.lastFrame = 0;
    this.size = size;
    const before = new Set(this.parts.map((p) => p.tag));
    this.blocks = input.map((b) => [-b[0] - 1, b[1], b[2], b[3], b[4]]); // voxel x covers [x, x+1), so its mirror is -x-1
    for (const p of this.parts) {
      this.group.remove(p.mesh);
      p.mesh.geometry.dispose();
      (p.mesh.material as THREE.Material).dispose();
    }
    this.metalMats.clear();
    this.parts = [];
    for (const r of this.rising) this.group.remove(r.scan);
    this.rising = [];
    this.boxes.clear();
    const s = size;
    for (const b of this.blocks) {
      const x0 = b[0] * s, x1 = (b[0] + 1) * s, y0 = b[1] * s, y1 = (b[1] + 1) * s, z0 = b[2] * s, z1 = (b[2] + 1) * s;
      const bx = this.boxes.get(b[4]);
      if (!bx) this.boxes.set(b[4], { x0, x1, y0, y1, z0, z1 });
      else Object.assign(bx, { x0: Math.min(bx.x0, x0), x1: Math.max(bx.x1, x1), y0: Math.min(bx.y0, y0), y1: Math.max(bx.y1, y1), z0: Math.min(bx.z0, z0), z1: Math.max(bx.z1, z1) });
    }
    const vox: Vox[] = this.blocks.filter((b) => b[3] !== "water").map((b) => ({ x: b[0], y: b[1], z: b[2], m: b[3], t: b[4] }));
    this.makeWater(this.blocks.filter((b) => b[3] === "water"), s);
    const order = new Map<string, number>();
    this.blocks.forEach((b, i) => order.has(b[4]) || order.set(b[4], i));
    const now = performance.now();
    const fresh: THREE.Mesh[] = [];
    for (const tm of meshVoxels(vox, s)) {
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: tm.transparent ? 0.06 : tm.metal ? 0.42 : tm.guess ? 0.75 : 0.92,
        metalness: tm.metal ? 0.9 : 0,
        transparent: tm.transparent,
        opacity: tm.transparent ? 0.88 : 1,
      });
      // gilt reflects the sky at full strength, so domes glint instead of looking painted
      if (tm.metal) {
        mat.envMap = this.giltEnv;
        mat.envMapIntensity = 1.3 * (1 - this.night * 0.8);
        this.metalMats.add(mat);
      }
      // after dark, glowing materials (gilt, lamps) light themselves: emissive = colour x glow x night
      const nu = this.nightUniform;
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uNight = nu;
        sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float glow;\nvarying float vGlow;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = glow;");
        sh.fragmentShader = sh.fragmentShader
          .replace("#include <common>", "#include <common>\nuniform float uNight;\nvarying float vGlow;")
          .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vColor.rgb * vGlow * uNight * 1.1;");
      };
      const mesh = new THREE.Mesh(tm.geometry, mat);
      mesh.castShadow = !tm.transparent;
      mesh.receiveShadow = true;
      mesh.visible = !tm.guess || this.showGuesses;
      mesh.userData.order = order.get(tm.tag) ?? 0;
      this.group.add(mesh);
      this.parts.push({ mesh, tag: tm.tag, guess: tm.guess, faceVox: tm.faceVox });
      if (animate && !before.has(tm.tag)) fresh.push(mesh);
    }
    // Each new element grows up out of the ground, in the order the program built them.
    fresh.sort((a, b) => a.userData.order - b.userData.order);
    const step = Math.min(220, 4000 / Math.max(1, fresh.length));
    for (const r of this.rising) this.group.remove(r.scan);
    fresh.forEach((m, i) => {
      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox!;
      const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), bb.min.y - 0.01);
      (m.material as THREE.Material).clippingPlanes = [plane];
      const scan = new THREE.Mesh(new THREE.BoxGeometry(bb.max.x - bb.min.x + 0.3, 0.06, bb.max.z - bb.min.z + 0.3), this.scanMat);
      scan.position.set((bb.min.x + bb.max.x) / 2, bb.min.y, (bb.min.z + bb.max.z) / 2);
      scan.visible = false;
      this.group.add(scan);
      this.rising.push({ mesh: m, at: now + i * step, plane, y0: bb.min.y, y1: bb.max.y + 0.05, scan });
    });
    this.updateSolid();
    this.rebuildLabels();
    if (this.highlighted) this.highlight(this.highlighted);
    this.placeEnvironment();
    this.fitShadow();
    // haze starts well beyond the place, however big it is
    const fog = this.scene.fog as THREE.Fog;
    // the island's far edge melts into a haze the colour of the horizon, so the world never visibly ends
    fog.near = this.setting === "village" ? this.groundRadius * 0.8 : Math.max(60, this.groundRadius * 1.15);
    fog.far = Math.max(220, this.groundRadius * 2.6);
    this.camera.far = Math.max(700, this.groundRadius * 6);
    this.camera.updateProjectionMatrix();
    this.placeNightLights();
  }

  // Water surfaces become real water: one rippled mirror per water level, shaped exactly like the water voxels'
  // tops. Looking down you see into it; looking across it you see the buildings reflected, as people remember.
  private makeWater(water: Block[], s: number) {
    for (const m of this.mirrors) {
      this.group.remove(m);
      m.dispose();
    }
    this.mirrors = [];
    if (!water.length) return;
    this.normalMaps ??= [rippleMap(1), rippleMap(2)];
    this.waterUniforms.tNormal.value = this.normalMaps[0];
    const occupied = new Set(water.map((b) => `${b[0]},${b[1]},${b[2]}`));
    const byLevel = new Map<number, number[]>();
    for (const [x, y, z] of water) {
      if (occupied.has(`${x},${y + 1},${z}`)) continue;
      const list = byLevel.get(y) ?? byLevel.set(y, []).get(y)!;
      // a quad in the local XY plane (the water mesh is turned flat: local y = -world z)
      const x0 = x * s, x1 = (x + 1) * s, y0 = -(z + 1) * s, y1 = -z * s;
      list.push(x0, y0, x1, y0, x1, y1, x0, y1);
    }
    for (const [y, q] of byLevel) {
      const pos: number[] = [], idx: number[] = [];
      for (let i = 0; i < q.length; i += 8) {
        const base = pos.length / 3;
        for (let c = 0; c < 4; c++) pos.push(q[i + c * 2], q[i + c * 2 + 1], 0);
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      const mirror = new Reflector(geo, { textureWidth: HQ ? 1024 : 512, textureHeight: HQ ? 1024 : 512, clipBias: 0.003, shader: waterShader(this.waterUniforms) });
      // Reflector copies the shader's uniforms; share ours instead so time, colour and textures stay live
      Object.assign((mirror.material as THREE.ShaderMaterial).uniforms, this.waterUniforms);
      // where the mirror sees only open sky it leaves alpha at 0, and the water shader paints the backdrop
      // there itself (the backdrop dome cannot be drawn through a mirror's tilted clipping)
      const draw = mirror.onBeforeRender;
      mirror.onBeforeRender = (...args: Parameters<typeof draw>) => {
        const alpha = this.renderer.getClearAlpha(), dome = this.dome.visible;
        this.renderer.setClearAlpha(0);
        this.dome.visible = false;
        draw.apply(mirror, args);
        this.renderer.setClearAlpha(alpha);
        this.dome.visible = dome;
      };
      mirror.rotation.x = -Math.PI / 2;
      mirror.position.y = (y + 1) * s - 0.03;
      this.group.add(mirror);
      this.mirrors.push(mirror);
    }
  }

  // Soft blocky clouds drifting around the diorama.
  private makeClouds() {
    for (const c of [...this.clouds.children]) this.clouds.remove(c);
    const b = this.bounds();
    if (!b) return;
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, size = Math.max(b.x1 - b.x0, b.z1 - b.z0, 20);
    let seed = 3;
    const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
    const mat = new THREE.MeshStandardMaterial({ color: "#e9e3da", roughness: 1, transparent: true, opacity: 0.5, depthWrite: false });
    const cube = new THREE.BoxGeometry(1, 1, 1);
    for (let n = 0; n < 14; n++) {
      const a = rnd() * Math.PI * 2, d = size * (0.5 + rnd() * 1.1);
      const ox = cx + Math.cos(a) * d, oz = cz + Math.sin(a) * d, oy = -6 - size * (0.12 + rnd() * 0.18);
      const cells = 6 + Math.floor(rnd() * 10), cs = Math.max(2, size / 22);
      const inst = new THREE.InstancedMesh(cube, mat, cells * 3);
      const o = new THREE.Object3D();
      let k = 0;
      for (let i = 0; i < cells; i++) {
        const px = (rnd() - 0.5) * cs * 5, pz = (rnd() - 0.5) * cs * 3;
        for (let j = 0; j < 3; j++) {
          o.position.set(ox + px + (rnd() - 0.5) * cs, oy + (j === 2 ? cs * 0.6 : 0), oz + pz + (rnd() - 0.5) * cs);
          o.scale.set(cs * (1.4 + rnd()), cs * 0.6, cs * (1.2 + rnd()));
          o.updateMatrix();
          inst.setMatrixAt(k++, o.matrix);
        }
      }
      inst.count = k;
      inst.userData.drift = 0.15 + rnd() * 0.25;
      this.clouds.add(inst);
    }
  }

  private updateSolid() {
    this.solid.clear();
    this.flightSolid.clear();
    this.hoverGrid.clear();
    const hb = this.hoverBox;
    hb.x0 = hb.y0 = hb.z0 = Infinity;
    hb.x1 = hb.y1 = hb.z1 = -Infinity;
    for (const b of this.blocks) {
      if (b[3] !== "water" && (this.showGuesses || !(b[4].startsWith("unsaid") || b[4].startsWith("known:")))) {
        this.hoverGrid.set(hoverKey(b[0], b[1], b[2]), b[4]);
        if (b[0] < hb.x0) hb.x0 = b[0]; if (b[0] > hb.x1) hb.x1 = b[0];
        if (b[1] < hb.y0) hb.y0 = b[1]; if (b[1] > hb.y1) hb.y1 = b[1];
        if (b[2] < hb.z0) hb.z0 = b[2]; if (b[2] > hb.z1) hb.z1 = b[2];
      }
      if (b[3] !== "water") this.flightSolid.add(`${b[0]},${b[1]},${b[2]}`);
      if (PASSABLE.has(b[3])) continue;
      if ((b[4].startsWith("unsaid") || b[4].startsWith("known:")) && !this.showGuesses) continue;
      this.solid.add(`${b[0]},${b[1]},${b[2]}`);
    }
  }

  bounds(): Box | null {
    if (!this.boxes.size) return null;
    const b: Box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
    for (const x of this.boxes.values()) {
      b.x0 = Math.min(b.x0, x.x0); b.x1 = Math.max(b.x1, x.x1); b.y0 = Math.min(b.y0, x.y0); b.y1 = Math.max(b.y1, x.y1); b.z0 = Math.min(b.z0, x.z0); b.z1 = Math.max(b.z1, x.z1);
    }
    return b;
  }

  private fitShadow() {
    const b = this.bounds();
    if (!b) return;
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, r = Math.max(Math.max(b.x1 - b.x0, b.z1 - b.z0, 10) * 0.75 + 4, this.groundRadius * 1.05);
    const d = this.sun.userData.dir as THREE.Vector3;
    this.sun.position.set(cx + d.x * r * 3, d.y * r * 3, cz + d.z * r * 3);
    this.sun.target.position.set(cx, 0, cz);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -r;
    cam.right = cam.top = r;
    cam.near = 0.5;
    cam.far = r * 7;
    cam.updateProjectionMatrix();
  }

  // Fixed views used for review renders and thumbnails.
  view(name: "overview" | "entrance" | "plan" | "back", entranceTag: string | null) {
    const b = this.bounds();
    if (!b) return;
    this.rising = [];
    this.finishRising();
    this.mode = "orbit";
    const c = new THREE.Vector3((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
    const size = Math.max(b.x1 - b.x0, b.z1 - b.z0, 8);
    if (name === "overview") this.frameOverview();
    if (name === "plan") {
      this.orbit.target.copy(c);
      this.camera.position.set(c.x, size * 1.35, c.z - 0.01);
      this.orbit.update();
    }
    if (name === "back") {
      this.orbit.target.set(c.x, 1, c.z);
      this.camera.position.set(c.x - size * 0.55, size * 0.5, b.z1 + size * 0.6);
      this.orbit.update();
    }
    if (name === "entrance") {
      const e = (entranceTag && this.boxes.get(entranceTag)) || null;
      const x = e ? (e.x0 + e.x1) / 2 : c.x;
      const z = (e ? e.z0 : b.z0) - 2.5;
      this.orbit.target.set(x, 1.4, z + 8);
      this.camera.position.set(x, 1.7, z);
      this.orbit.update();
    }
  }

  focusTag: string | null = null;
  setFocus(tag: string | null) {
    this.focusTag = tag;
    this.placeNightLights();
  }

  // A building's full height includes whatever stands on it (its dome, its spire).
  private heightOver(f: Box) {
    let fh = Math.max(4, f.y1);
    for (const o of this.boxes.values()) {
      const ox = (o.x0 + o.x1) / 2, oz = (o.z0 + o.z1) / 2;
      if (ox >= f.x0 && ox <= f.x1 && oz >= f.z0 && oz <= f.z1 && o.y0 >= f.y1 - 1) fh = Math.max(fh, o.y1);
    }
    return fh;
  }

  frameOverview() {
    const b = this.bounds();
    if (!b) return;
    // a low three-quarter view from in front, framed on the main building so it fills about a third of the
    // frame, with the rest of the place around it and the skyline against the sky
    const f = (this.focusTag && this.boxes.get(this.focusTag)) || b;
    const fh = this.heightOver(f);
    const c = new THREE.Vector3((f.x0 + f.x1) / 2, fh * 0.35, (f.z0 + f.z1) / 2);
    const d = Math.max(fh * 3.1, Math.max(f.x1 - f.x0, f.z1 - f.z0) * 2.2, 26), el = THREE.MathUtils.degToRad(18), az = THREE.MathUtils.degToRad(30);
    this.orbit.target.copy(c);
    this.camera.position.set(c.x + Math.sin(az) * Math.cos(el) * d, c.y + Math.sin(el) * d, c.z - Math.cos(az) * Math.cos(el) * d);
    this.orbit.update();
  }

  // Stand a few steps outside the entrance, looking in.
  walkIn(entranceTag: string | null) {
    const b = this.bounds();
    if (!b) return;
    const e = (entranceTag && this.boxes.get(entranceTag)) || null;
    const x = e ? (e.x0 + e.x1) / 2 : (b.x0 + b.x1) / 2;
    const z = (e ? e.z0 : b.z0) - 3.5;
    this.camera.position.set(x, EYE + 0.01, z);
    this.camera.lookAt(x, EYE, z + 10);
    this.vel.set(0, 0, 0);
    this.setMode("walk");
    this.walk.lock();
  }

  // A cinematic flight computed from the build: high and wide, down to the entrance, in along the axis to the
  // main building, up past it, and round to a final wide view.
  flyThrough(entranceTag: string | null, focusTag: string | null, seconds = 30, done?: () => void) {
    const b = this.bounds();
    if (!b) return;
    const c = new THREE.Vector3((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
    const size = Math.max(b.x1 - b.x0, b.z1 - b.z0, 10);
    const e = (entranceTag && this.boxes.get(entranceTag)) || { x0: c.x - 1, x1: c.x + 1, y0: 0, y1: 2.5, z0: b.z0, z1: b.z0 + 1 };
    const f = (focusTag && this.boxes.get(focusTag)) || b;
    const fx = (f.x0 + f.x1) / 2, fz = (f.z0 + f.z1) / 2, ex = (e.x0 + e.x1) / 2;
    const fh = this.heightOver(f);
    const fr = Math.max(f.x1 - f.x0, f.z1 - f.z0) / 2 + 2;
    const eye = 1.7;
    const over = Math.max(e.y1 + 2.5, 6);
    // never so close to the main building that one wall fills the frame
    const D = Math.max(fh * 1.5, fr * 2.4, 12, size * 0.6);
    // ahead of the way in (never back out past it); if that is close, look down on it from higher
    const Df = Math.min(D, Math.max(fz - e.z0 - 4, fr * 1.6));
    const orbit = (deg: number, r: number, y: number) => {
      const a = THREE.MathUtils.degToRad(deg);
      return new THREE.Vector3(fx + Math.sin(a) * r, y, fz - Math.cos(a) * r);
    };
    // how much stands between a camera spot and the main building (trees included)
    const blockedView = (p: THREE.Vector3) => {
      let n = 0;
      const to = new THREE.Vector3(fx, fh * 0.5, fz);
      for (let i = 1; i < 40; i++) {
        const q = p.clone().lerp(to, i / 40);
        if (this.flightSolid.has(`${Math.floor(q.x / this.size)},${Math.floor(q.y / this.size)},${Math.floor(q.z / this.size)}`)) n++;
      }
      return n;
    };
    // the two orbit spots: on one side, at the angles with the clearest view of the main building
    const best = (lo: number, hi: number, r: number, y: number, sgn: number) => {
      let a = lo, n = Infinity;
      for (let d = lo; d <= hi; d += 10) {
        const k = blockedView(orbit(sgn * d, r, y)) + (this.nearSolid(orbit(sgn * d, r, y)) ? 5 : 0);
        if (k < n) (n = k), (a = d);
      }
      return { a: sgn * a, n };
    };
    const L1 = best(35, 80, D * 1.1, fh * 0.8 + 3, -1), L2 = best(95, 150, D * 1.25, fh * 1.1 + 5, -1);
    const R1 = best(35, 80, D * 1.1, fh * 0.8 + 3, 1), R2 = best(95, 150, D * 1.25, fh * 1.1 + 5, 1);
    const [o1, o2] = L1.n + L2.n <= R1.n + R2.n ? [L1.a, L2.a] : [R1.a, R2.a];
    // can a person's eye pass straight through the way in? then the camera walks through it at head height
    let walkable = true;
    for (let z = e.z0 - 3; z <= e.z1 + 3 && walkable; z += 0.25) if (this.nearSolid(new THREE.Vector3(ex, eye, z), 0.6)) walkable = false;
    const inside = Math.min(e.z1 + 4 + (fz - e.z1) * 0.3, fz - fr - 2);
    const tight = new Set<THREE.Vector3>();
    const at = (x: number, y: number, z: number, isTight = false) => {
      const p = new THREE.Vector3(x, y, z);
      if (isTight) tight.add(p);
      return p;
    };
    // A shot list from the memory itself: the wide view, the walk in, the main building, then the things the
    // speaker talked about most, each from the angle with the clearest view of it; then a crane up and away.
    const shots = this.subjects(entranceTag, focusTag).slice(0, size > 60 ? 2 : 3);
    const pos = [
      at(c.x + size * 0.7, size * 0.45 + 6, b.z0 - size * 0.7), // high and wide
      at(ex, eye + 1.2, e.z0 - Math.max(14, size * 0.18)), // low on the axis, out in front: the hero view
      at(ex, eye + 1.5, e.z0 - 6), at(ex, over + 1.5, e.z0 - 2), // walk up to the way in, and rise over it: the reveal
      ...(walkable ? [at(ex, eye + 1.2, Math.max(e.z1 + 4, inside))] : []), // and down to head height on the far side, looking on in
      orbit(0, Df, fh * 0.55 + 2 + (D - Df) * 0.6), // in front of the main building, framing all of it
      orbit(o1, D * 1.1, fh * 0.8 + 3), // round it, rising, on whichever side the view is clearer
    ];
    const lookAt: (THREE.Vector3 | null)[] = pos.map(() => null);
    for (const sh of shots) {
      pos.push(sh.from, sh.to);
      lookAt.push(sh.target, sh.target);
    }
    pos.push(orbit(o2, D * 1.25, fh * 1.1 + 5), at(c.x - size * 0.75, size * 0.5 + 8, c.z + size * 0.35)); // up and out to a final wide view
    lookAt.push(null, null);
    // never fly through anything: lift any waypoint that sits in or right above a solid (the gate passage
    // needs only room for a head)
    for (const p of pos) {
      for (let tries = 0; tries < 60 && this.nearSolid(p, tight.has(p) ? 0.6 : 2); tries++) p.y += 1;
    }
    const hero = new THREE.Vector3(fx, fh * 0.45, fz);
    const look = pos.map((p, i) => lookAt[i]?.clone() ?? (i === 0 || i === pos.length - 1 ? new THREE.Vector3(c.x, 2, c.z) : p.y < eye + 1 ? new THREE.Vector3(fx, Math.min(fh * 0.4, eye + 3), fz) : hero.clone()));
    // and never let the path between waypoints pass through anything: sample it, lift the nearest waypoint
    for (let round = 0; round < 40; round++) {
      const curve = new THREE.CatmullRomCurve3(pos, false, "centripetal");
      let hit = -1;
      for (let i = 0; i <= 400; i++) {
        const t = i / 400;
        const near = pos[Math.round(t * (pos.length - 1))];
        if (this.nearSolid(curve.getPoint(t), tight.has(near) ? 0.6 : 2.5)) { hit = t; break; }
      }
      if (hit < 0) break;
      const k = Math.min(pos.length - 2, Math.max(1, Math.round(hit * (pos.length - 1))));
      pos[k].y += tight.has(pos[k]) ? 0.25 : 1.5;
    }
    this.flight = { pos: new THREE.CatmullRomCurve3(pos, false, "centripetal"), look: new THREE.CatmullRomCurve3(look, false, "centripetal"), start: performance.now(), ms: Math.max(seconds, new THREE.CatmullRomCurve3(pos, false, "centripetal").getLength() / 7) * 1000, done }; // about 7 m a second
    this.rising = [];
    this.finishRising();
    this.mode = "fly";
    this.orbit.enabled = false;
    this.onModeChange("fly");
  }

  // The described things worth a shot of their own, most talked about first (not the way in or the main
  // building, which the flight already visits; not grounds, walls or roofs), each with the camera spot that
  // sees it most clearly: a ring of candidate angles and heights, ranked by what stands in between.
  private subjects(entranceTag: string | null, focusTag: string | null) {
    const SKIP = new Set(["courtyard", "compound", "path", "street", "field", "wall", "boundary_wall", "roof", "roof_terrace", "drain", "other", "pond"]);
    const list = [...this.elements.values()].filter((e) => e.id !== entranceTag && e.id !== focusTag && !SKIP.has(e.kind) && this.boxes.has(e.id));
    list.sort((a, b) => (b.mentions ?? 1) - (a.mentions ?? 1));
    const out: { from: THREE.Vector3; to: THREE.Vector3; target: THREE.Vector3 }[] = [];
    for (const e of list) {
      const bx = this.boxes.get(e.id)!;
      const t = new THREE.Vector3((bx.x0 + bx.x1) / 2, (bx.y0 + bx.y1) / 2, (bx.z0 + bx.z1) / 2);
      const ext = Math.max(bx.x1 - bx.x0, bx.y1 - bx.y0, bx.z1 - bx.z0);
      const r = Math.max(4.5, ext * 1.6);
      const covered = this.roofOver(new THREE.Vector3(t.x, bx.y1 + 0.3, t.z));
      let best: THREE.Vector3 | null = null, blocked = Infinity;
      for (let az = -150; az <= 150; az += 15) for (const el of [12, 25, 40]) {
        const a = THREE.MathUtils.degToRad(az), e2 = THREE.MathUtils.degToRad(el);
        const p = new THREE.Vector3(t.x + Math.sin(a) * Math.cos(e2) * r, Math.max(1.4, t.y + Math.sin(e2) * r), t.z - Math.cos(a) * Math.cos(e2) * r);
        if (this.nearSolid(p, 0.8)) continue;
        // a thing out in the open is shot from out in the open (never from inside some other building);
        // a thing under a roof may be shot from under that roof
        if (!covered && this.roofOver(p)) continue;
        let blocked = 0;
        for (let i = 1; i < 30; i++) {
          const q = p.clone().lerp(t, i / 30);
          const k = `${Math.floor(q.x / this.size)},${Math.floor(q.y / this.size)},${Math.floor(q.z / this.size)}`;
          if (this.flightSolid.has(k) && !(q.x >= bx.x0 && q.x <= bx.x1 && q.y >= bx.y0 && q.y <= bx.y1 && q.z >= bx.z0 && q.z <= bx.z1)) blocked++;
        }
        const k = blocked * 10 + Math.abs(az - 25) / 30 + Math.abs(el - 25) / 15;
        if (k < blocked) (blocked = k), (best = p);
      }
      if (!best || blocked >= 10) continue; // nowhere with a clear view of it
      const from = best.clone().sub(t).multiplyScalar(1.35).add(t); // start a little further out and push in
      if (this.nearSolid(from, 0.8)) from.copy(best);
      out.push({ from, to: best, target: t });
    }
    return out;
  }

  // Is there anything solid overhead (within 25 m)?
  private roofOver(p: THREE.Vector3) {
    const s = this.size;
    for (let y = p.y; y < p.y + 25; y += s) if (this.flightSolid.has(`${Math.floor(p.x / s)},${Math.floor(y / s)},${Math.floor(p.z / s)}`)) return true;
    return false;
  }

  // Is anything solid within r metres of p (sampled every half metre)?
  private nearSolid(p: THREE.Vector3, r = 2) {
    const s = this.size, st = Math.min(0.5, r);
    for (let dx = -r; dx <= r + 1e-6; dx += st) for (let dz = -r; dz <= r + 1e-6; dz += st) for (let dy = -r; dy <= r + 1e-6; dy += st) {
      if (this.sceneryFlight.has(`${Math.floor((p.x + dx) / this.groundS)},${Math.floor((p.y + dy) / this.groundS)},${Math.floor((p.z + dz) / this.groundS)}`)) return true;
      if (this.flightSolid.has(`${Math.floor((p.x + dx) / s)},${Math.floor((p.y + dy) / s)},${Math.floor((p.z + dz) / s)}`)) return true;
    }
    return false;
  }

  private finishRising() {
    for (const r of this.rising) {
      (r.mesh.material as THREE.Material).clippingPlanes = null;
      this.group.remove(r.scan);
    }
    this.rising = [];
  }

  stopFlight() {
    if (!this.flight) return;
    const d = this.flight.done;
    this.flight = null;
    this.setMode("orbit");
    d?.();
  }

  setMode(m: "orbit" | "walk" | "fly") {
    if (this.mode === m) return;
    this.mode = m;
    this.orbit.enabled = m === "orbit";
    if (m === "orbit") {
      if (this.walk.isLocked) this.walk.unlock();
      this.frameOverview();
    }
    this.onModeChange(m);
  }

  setShowGuesses(v: boolean) {
    this.showGuesses = v;
    this.shadowDirty = Math.max(this.shadowDirty, 3);
    for (const p of this.parts) if (p.guess || p.tag.startsWith("known:")) p.mesh.visible = v;
    this.updateSolid();
  }

  // Day to night: a moonlit blue world where gilt and lamps glow and the water turns to black glass.
  setNight(on: boolean) {
    this.shadowDirty = Math.max(this.shadowDirty, 3);
    this.dusk = null;
    this.setTimeOfDay(on ? 1 : 0);
    this.placeNightLights();
  }

  // 0 is late afternoon, 0.5 sunset, 1 night. Everything blends: light, sky, fog, water, glow.
  setTimeOfDay(t: number) {
    this.shadowDirty = Math.max(this.shadowDirty, 2);
    t = Math.max(0, Math.min(1, t));
    const mix = (a: string, b: string, k: number) => new THREE.Color(a).lerp(new THREE.Color(b), k);
    const k1 = Math.min(1, t * 2), k2 = Math.max(0, t * 2 - 1); // day to sunset, sunset to night
    this.night = t;
    this.nightUniform.value = Math.max(0, (t - 0.35) / 0.65);
    // golden hour: a low orange key and a cool blue fill; night: a pale blue moon and deep blue shade
    this.sun.color.copy(t < 0.5 ? mix("#ffdcae", "#ff8c42", k1) : mix("#ff8c42", "#a9c2f0", k2));
    this.sun.intensity = t < 0.5 ? 4.0 + 0.6 * k1 : 4.6 - 2.6 * k2; // the moon stays bright enough to make marble glow
    this.hemi.color.copy(t < 0.5 ? mix("#bcd4ee", "#7f98cc", k1) : mix("#7f98cc", "#2a3d66", k2));
    this.hemi.groundColor.copy(t < 0.5 ? mix("#8a6f4c", "#5a3d2a", k1) : mix("#5a3d2a", "#0c0d14", k2));
    this.hemi.intensity = t < 0.5 ? 1.1 - 0.45 * k1 : 0.65;
    this.scene.environmentIntensity = 0.06 * (1 - t) + 0.012 * t;
    this.renderer.toneMappingExposure = t < 0.5 ? 0.64 + 0.2 * k1 : 0.84 + 0.2 * k2;
    // only the brightest things bloom by day; after dark, gilt and lamps do
    this.bloom.threshold = t < 0.5 ? 1.6 : 1.6 - 0.75 * k2;
    this.bloom.strength = 0.22 + 0.2 * Math.max(0, t - 0.5) * 2;
    this.sceneryUniforms.uHaze.value.copy(t < 0.5 ? mix("#d9dde0", "#e0a888", k1) : mix("#e0a888", "#0b1120", k2));
    (this.scene.fog as THREE.Fog).color.copy(t < 0.5 ? mix("#a9c0db", "#e6a27a", k1) : mix("#e6a27a", "#18223c", k2));
    this.waterUniforms.waterColor.value.copy(mix("#3a8aa3", "#03070c", t));
    this.waterUniforms.skyTop.value.copy(t < 0.5 ? mix("#4d86c8", "#6a7fb0", k1) : mix("#6a7fb0", "#0a1430", k2));
    this.waterUniforms.skyLow.value.copy(t < 0.5 ? mix("#b9d0e6", "#f2b27c", k1) : mix("#f2b27c", "#1c2848", k2));
    for (const m of this.metalMats) m.envMapIntensity = 1.3 * (1 - t * 0.8);
    // the sun drops to the horizon through golden hour and sets; the light then becomes the moon, higher up
    const sunElev = t < 0.5 ? 22 - 16 * k1 : 6 - 14 * k2;
    const lightElev = t < 0.5 ? sunElev : 6 + 32 * k2;
    const at = (e: number, az: number) => new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - e), THREE.MathUtils.degToRad(az));
    // toward sunset the sun swings round behind the place, so its glow and the long shadows face the viewer
    // toward sunset the sun swings round to the side: long shadows across the ground, the warm side of every
    // wall lit, and the glow at the edge of the sky
    const sunAz = t < 0.5 ? 140 - 60 * k1 : 80;
    (this.sun.userData.dir as THREE.Vector3).copy(at(lightElev, t < 0.5 ? sunAz : 80 + 120 * k2));
    this.sky.material.uniforms.sunPosition.value.copy(at(sunElev, sunAz));
    this.skyGain.value = t < 0.5 ? 0.6 + 1.3 * k1 * k1 : 1.9;
    this.skyBlue.value = 0.7 * Math.max(0, 1 - k1 * 1.6);
    this.grade.uniforms.amount.value = t < 0.5 ? 0.15 + 0.75 * Math.sin(k1 * Math.PI * 0.5) : 0.9 * (1 - k2);
    // a thicker, warmer atmosphere toward sunset spreads the glow across the whole sky
    const su = this.sky.material.uniforms;
    su.turbidity.value = 3.5 + 8.5 * k1;
    su.rayleigh.value = 2.4 + 1.4 * k1;
    su.mieDirectionalG.value = 0.86 - 0.18 * k1;
    this.fitShadow();
    for (const c of this.clouds.children) ((c as THREE.InstancedMesh).material as THREE.MeshStandardMaterial).color.copy(t < 0.5 ? mix("#f4f1ec", "#f2a77e", k1) : mix("#f2a77e", "#3a4560", k2));
    this.paintBackdrop(t);
    this.life.night = t;
    for (const l of this.nightLights.children) if ((l as THREE.Light).isLight) (l as THREE.PointLight).intensity = (l.userData.full as number) * Math.max(0, (t - 0.45) / 0.55);
  }

  // A dusk you can watch: the sun goes down and the lamps come on, over `seconds`.
  playDusk(seconds = 10) {
    if (!this.nightLights.children.length) { this.night = 1; this.placeNightLights(); }
    this.dusk = { start: performance.now(), ms: seconds * 1000 };
  }
  private dusk: { start: number; ms: number } | null = null;

  // The overview backdrop at any time of day: afternoon gradient, sunset, then night with stars.
  private paintBackdrop(t: number) {
    const c = this.backdropCanvas;
    const g = c.getContext("2d")!;
    const stops = (a: string[], b: string[], k: number) => a.map((x, i) => "#" + mixHex(x, b[i], k));
    // painted on a dome: the top is the zenith, the middle the horizon, the bottom below the island
    const day = ["#4f86c0", "#9dbfdc", "#eedfc6", "#e2b48a", "#c98f62"];
    const sunset = ["#24406e", "#a77f9c", "#f8b874", "#d77848", "#9a5634"];
    const night = ["#02050d", "#08102a", "#1a2440", "#0e1424", "#06080f"];
    const cols = t < 0.5 ? stops(day, sunset, t * 2) : stops(sunset, night, t * 2 - 1);
    const grad = g.createLinearGradient(0, 0, 0, c.height);
    [0, 0.36, 0.5, 0.62, 1].forEach((p, i) => grad.addColorStop(p, cols[i]));
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
    if (t > 0.55) {
      const a = (t - 0.55) / 0.45;
      void this.stars;
      // the moon, with a soft halo, where the moonlight comes from
      // low over the horizon in the direction the overview looks, where a wide shot catches it
      const mdx = -0.35, mdz = 0.94, elev = THREE.MathUtils.degToRad(6);
      const mx = (((Math.atan2(mdz, -mdx) / (Math.PI * 2)) + 1) % 1) * c.width, my = (0.5 - elev / Math.PI) * c.height;
      const halo = g.createRadialGradient(mx, my, 2, mx, my, 40);
      halo.addColorStop(0, `rgba(200,212,240,${0.22 * a})`);
      halo.addColorStop(1, "rgba(220,230,255,0)");
      g.fillStyle = halo;
      g.fillRect(mx - 40, my - 40, 80, 80);
      g.fillStyle = `rgba(214,214,204,${a})`;
      g.beginPath();
      g.arc(mx, my, 3.5, 0, Math.PI * 2);
      g.fill();
    }
    this.backdrop.needsUpdate = true;
  }
  private backdropCanvas = document.createElement("canvas");
  private stars: [number, number, number][] = Array.from({ length: 900 }, () => [Math.random() * 1024, Math.random() * 252, Math.random() < 0.12 ? 2 : 1]);

  // After dark, homes glow from inside: a warm lamp in each described room, and firelight at stoves.
  private placeNightLights() {
    for (const l of [...this.nightLights.children]) this.nightLights.remove(l);
    if (!this.night) return;
    const lit: { box: Box; fire: boolean }[] = [];
    for (const [id, e] of this.elements) {
      const b = this.boxes.get(id);
      if (!b) continue;
      if (["room", "kitchen", "verandah", "upper_floor", "building", "corridor"].includes(e.kind)) lit.push({ box: b, fire: false });
      if (["stove", "tandoor"].includes(e.kind)) lit.push({ box: b, fire: true });
    }
    // a warm floodlight washing up the main building's front, the way monuments are lit at night
    const f = this.focusTag ? this.boxes.get(this.focusTag) : null;
    if (f) {
      const fh = this.heightOver(f), w = Math.max(f.x1 - f.x0, f.z1 - f.z0);
      for (const dx of [-0.35, 0.35]) {
        const spot = new THREE.SpotLight("#ffd9a8", 0, w * 3 + fh * 2, 0.75, 0.6, 1.2);
        spot.userData.full = 60 + fh * fh * 1.2;
        spot.position.set((f.x0 + f.x1) / 2 + dx * w, 0.6, f.z0 - w * 0.8 - 3);
        spot.target.position.set((f.x0 + f.x1) / 2, fh * 0.5, (f.z0 + f.z1) / 2);
        this.nightLights.add(spot, spot.target);
      }
    }
    for (const { box, fire } of lit.slice(0, 12)) {
      const full = fire ? 9 : 14;
      const light = new THREE.PointLight(fire ? "#ff8a3c" : "#ffc77a", full * Math.max(0, (this.night - 0.45) / 0.55), fire ? 5 : Math.max(6, (box.x1 - box.x0) * 1.4), 1.6);
      light.userData.full = full;
      light.position.set((box.x0 + box.x1) / 2, fire ? box.y1 + 0.3 : box.y0 + Math.min(1.5, (box.y1 - box.y0) * 0.45), (box.z0 + box.z1) / 2);
      this.nightLights.add(light);
    }
  }

  setShowLabels(v: boolean) {
    this.showLabels = v;
    this.labelGroup.visible = v;
  }

  highlight(tag: string | null) {
    this.highlighted = tag;
    for (const p of this.parts) {
      const m = p.mesh.material as THREE.MeshStandardMaterial;
      m.emissive.set(tag && p.tag === tag ? "#ffb347" : "#000000");
      m.emissiveIntensity = tag && p.tag === tag ? 0.35 : 0;
    }
  }

  private rebuildLabels() {
    for (const c of [...this.labelGroup.children]) {
      this.labelGroup.remove(c);
      (c as CSS2DObject).element.remove();
    }
    for (const [id, e] of this.elements) {
      const b = this.boxes.get(id);
      if (!b) continue;
      const div = document.createElement("div");
      div.className = "label";
      const second = e.original && e.original.toLowerCase() !== e.name.toLowerCase() ? e.original : null; // "castle castle" reads as a bug
      div.innerHTML = `<b></b>${second ? "<i></i>" : ""}`;
      div.querySelector("b")!.textContent = e.name;
      if (second) div.querySelector("i")!.textContent = second;
      div.onclick = () => this.onSelect(id);
      const o = new CSS2DObject(div);
      o.position.set((b.x0 + b.x1) / 2, b.y1 + 0.5, (b.z0 + b.z1) / 2);
      this.labelGroup.add(o);
    }
  }

  // What is under the cursor, checked every frame: the ray walks the block grid cell by cell, so the cost
  // depends on how far it travels, not on how many triangles the place has. Clicks still use pick().
  private hoverGrid = new Map<number, string>();
  private hoverBox = { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 };
  private hoverNdc = new THREE.Vector2();
  private pickFast(): string | null {
    if (!this.hoverGrid.size) return null;
    this.raycaster.setFromCamera(this.mode === "walk" ? this.hoverNdc.set(0, 0) : this.pointer, this.camera);
    const { origin, direction } = this.raycaster.ray;
    const s = this.size, b = this.hoverBox;
    const o = [origin.x / s, origin.y / s, origin.z / s], d = [direction.x, direction.y, direction.z];
    const lo = [b.x0, b.y0, b.z0], hi = [b.x1 + 1, b.y1 + 1, b.z1 + 1];
    // enter the box around all blocks
    let t0 = 0, t1 = Infinity;
    for (let i = 0; i < 3; i++) {
      if (d[i] === 0) { if (o[i] < lo[i] || o[i] > hi[i]) return null; continue; }
      const a = (lo[i] - o[i]) / d[i], c = (hi[i] - o[i]) / d[i];
      t0 = Math.max(t0, Math.min(a, c));
      t1 = Math.min(t1, Math.max(a, c));
    }
    if (t0 > t1) return null;
    const inside = t0 === 0;
    const e = t0 + 1e-6;
    let x = Math.floor(o[0] + d[0] * e), y = Math.floor(o[1] + d[1] * e), z = Math.floor(o[2] + d[2] * e);
    const stepX = d[0] > 0 ? 1 : -1, stepY = d[1] > 0 ? 1 : -1, stepZ = d[2] > 0 ? 1 : -1;
    const dx = d[0] ? Math.abs(1 / d[0]) : Infinity, dy = d[1] ? Math.abs(1 / d[1]) : Infinity, dz = d[2] ? Math.abs(1 / d[2]) : Infinity;
    let tx = d[0] ? ((d[0] > 0 ? x + 1 : x) - o[0]) / d[0] : Infinity;
    let ty = d[1] ? ((d[1] > 0 ? y + 1 : y) - o[1]) / d[1] : Infinity;
    let tz = d[2] ? ((d[2] > 0 ? z + 1 : z) - o[2]) / d[2] : Infinity;
    // a camera standing inside a block (leaves, say) looks out through it, as the meshes' one-sided faces do
    let skip = inside;
    for (let n = 0; n < 4096; n++) {
      if (!skip) {
        const tag = this.hoverGrid.get(hoverKey(x, y, z));
        if (tag !== undefined) return tag;
      }
      skip = false;
      if (tx < ty && tx < tz) { x += stepX; tx += dx; }
      else if (ty < tz) { y += stepY; ty += dy; }
      else { z += stepZ; tz += dz; }
      if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1 || z < b.z0 || z > b.z1) return null;
    }
    return null;
  }

  private pick(): string | null {
    this.raycaster.setFromCamera(this.mode === "walk" ? new THREE.Vector2(0, 0) : this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.parts.filter((p) => p.mesh.visible).map((p) => p.mesh), false);
    for (const h of hits) {
      const p = this.parts.find((x) => x.mesh === h.object);
      if (p && h.faceIndex != null) return p.faceVox[Math.floor(h.faceIndex / 2)]?.t ?? p.tag;
    }
    return null;
  }

  // Is any solid voxel inside the player's body at feet height y (metres)?
  private blocked(x: number, y: number, z: number) {
    const s = this.size;
    const cx0 = Math.floor((x - RADIUS) / s), cx1 = Math.floor((x + RADIUS) / s);
    const cz0 = Math.floor((z - RADIUS) / s), cz1 = Math.floor((z + RADIUS) / s);
    const cy0 = Math.floor((y + 0.01) / s), cy1 = Math.floor((y + HEIGHT - 0.01) / s);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) for (let cy = cy0; cy <= cy1; cy++) if (this.solid.has(`${cx},${cy},${cz}`)) return true;
    return false;
  }

  // Highest solid top under the player between two heights, or null.
  private support(x: number, from: number, to: number) {
    const s = this.size;
    const cx0 = Math.floor((x - RADIUS) / s), cx1 = Math.floor((x + RADIUS) / s);
    const p = this.camera.position;
    const cz0 = Math.floor((p.z - RADIUS) / s), cz1 = Math.floor((p.z + RADIUS) / s);
    for (let cy = Math.floor((from - 0.001) / s); cy >= Math.floor(to / s); cy--) {
      const top = (cy + 1) * s;
      if (top > from + 1e-6 || top < to - 1e-6) continue;
      for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) if (this.solid.has(`${cx},${cy},${cz}`)) return top;
    }
    return null;
  }

  private step(dt: number) {
    const speed = this.keys.has("ShiftLeft") ? 5 : 2.6;
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
    const move = new THREE.Vector3();
    const p0 = this.camera.position;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) move.add(fwd);
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) move.sub(fwd);
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) move.add(right);
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) move.sub(right);
    if (move.lengthSq()) move.normalize().multiplyScalar(speed * dt);
    // stay on the diorama
    if (!this.islandTop.has(`${Math.floor((p0.x + move.x) / this.groundS)},${Math.floor((p0.z + move.z) / this.groundS)}`)) move.set(0, 0, 0);
    if (this.keys.has("Space") && this.onGround) {
      this.vel.y = 4.2;
      this.onGround = false;
    }
    this.vel.y -= 12 * dt;
    const p = this.camera.position;
    let feet = p.y - EYE;
    for (const axis of ["x", "z"] as const) {
      const d = move[axis];
      if (!d) continue;
      const nx = axis === "x" ? p.x + d : p.x, nz = axis === "z" ? p.z + d : p.z;
      if (!this.blocked(nx, feet, nz)) p[axis] += d;
      else if (this.onGround) {
        // Walk up a ledge (a plinth, a step) if it is low enough.
        for (let up = this.size; up <= STEP + 1e-6; up += this.size) {
          if (!this.blocked(nx, feet + up, nz)) {
            p[axis] += d;
            feet += up;
            break;
          }
        }
      }
    }
    let ny = feet + this.vel.y * dt;
    this.onGround = false;
    if (this.vel.y <= 0) {
      const top = this.support(p.x, feet, ny);
      if (top !== null) {
        ny = top;
        this.vel.y = 0;
        this.onGround = true;
      }
    } else if (this.blocked(p.x, ny, p.z)) {
      this.vel.y = 0;
      ny = feet;
    }
    if (ny <= 0 && this.islandTop.has(`${Math.floor(p.x / this.groundS)},${Math.floor(p.z / this.groundS)}`)) {
      ny = 0;
      this.vel.y = 0;
      this.onGround = true;
    }
    p.y = ny + EYE;
  }

  private frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    if (this.mode === "walk") this.step(dt);
    else if (this.mode === "fly" && this.flight) {
      const t = Math.min(1, (performance.now() - this.flight.start) / this.flight.ms);
      const k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease in and out
      // steady speed along the path (a short passage through a gate goes by quickly, a long glide takes its time)
      const u = this.flight.pos.getUtoTmapping(k, 0);
      this.camera.position.copy(this.flight.pos.getPoint(u));
      this.camera.lookAt(this.flight.look.getPoint(u));
      if (t >= 1) this.stopFlight();
    } else this.orbit.update();
    if (this.rising.length) {
      const now = performance.now();
      this.rising = this.rising.filter((r) => {
        if (now < r.at) return true;
        const dur = 500 + (r.y1 - r.y0) * 90; // taller things take a little longer
        const t = Math.min(1, (now - r.at) / dur);
        const h = r.y0 + (r.y1 - r.y0) * (1 - Math.pow(1 - t, 2));
        r.plane.constant = h;
        r.scan.visible = t < 1;
        r.scan.position.y = h;
        if (t >= 1) {
          (r.mesh.material as THREE.Material).clippingPlanes = null;
          this.group.remove(r.scan);
          r.scan.geometry.dispose();
        }
        return t < 1;
      });
    }
    const tag = this.pickFast();
    if (tag !== this.lastHover) {
      this.lastHover = tag;
      this.onHover(tag);
    }
    if (this.showLabels) {
      this.labelTick++;
      for (const o of this.labelGroup.children) {
        const el = (o as CSS2DObject).element;
        const far = this.mode === "walk" && o.position.distanceTo(this.camera.position) > 8;
        // Every few frames: a label that would be cut off by the side panel waits until it is clear of it.
        if (this.labelTick % 12 === 0) {
          const edge = document.querySelector(".panel")?.getBoundingClientRect();
          o.userData.underPanel = !!edge && edge.width > 0 && el.getBoundingClientRect().right > edge.left;
        }
        el.style.opacity = far || o.userData.underPanel ? "0" : "1";
      }
    }
    for (const c of this.clouds.children) c.position.x += (c.userData.drift as number) * dt;
    this.waterUniforms.time.value = performance.now() / 1000;
    this.life.camera = this.camera.position;
    this.life.update(performance.now() / 1000);
    const flying = this.mode === "fly";
    // high in a flight the clean overview look reads best; near the ground, the real sky
    const overview = this.mode === "orbit" || (flying && this.camera.position.y > 15);
    if (this.dusk) {
      const t = Math.min(1, (performance.now() - this.dusk.start) / this.dusk.ms);
      this.setTimeOfDay(t * t * (3 - 2 * t));
      if (t >= 1) this.dusk = null;
    }
    // one physical sky, with drifting clouds, in every view by day; the starry dome fades in at night
    this.sky.visible = this.night < 0.75;
    this.sky.position.copy(this.camera.position);
    this.sky.material.uniforms.time.value = performance.now() / 1000;
    this.dome.visible = this.night > 0.6;
    this.starField.visible = this.night > 0.6;
    this.starField.position.copy(this.camera.position);
    (this.starField.material as THREE.PointsMaterial).opacity = Math.min(1, (this.night - 0.6) / 0.3);
    this.dome.position.copy(this.camera.position);
    void flying;
    this.bokeh.enabled = HQ && this.mode === "orbit" && this.night < 0.5;
    this.lantern.intensity = overview || flying ? 0 : 6 - 3.5 * this.night;
    this.ao.blendIntensity = overview ? 0.85 : 0.55;
    if (overview) {
      const u = this.bokeh.uniforms as Record<string, { value: number }>;
      const b = this.bounds();
      const size = b ? Math.max(b.x1 - b.x0, b.z1 - b.z0, 10) : 20;
      u.focus.value = this.camera.position.distanceTo(this.orbit.target);
      u.aperture.value = 0.00015 * Math.min(1, 25 / size);
    }
    if (!HQ) this.keepFrameRate();
    if (this.direct) this.renderer.render(this.scene, this.camera);
    else this.composer.render();
    this.labels.render(this.scene, this.camera);
  }

  // Visitors' machines: shadows only when something changed, and quality steps down if frames run long.
  private shadowDirty = 180;
  private frameTimes: number[] = [];
  private frameSum = 0;
  private lastFrame = 0; // 0 means the next frame only restarts the clock (after a hidden tab or a new build)
  private qualityStep = 0;
  private lastStep = 0;
  private direct = false;
  private keepFrameRate() {
    if (this.shadowDirty > 0) {
      this.shadowDirty--;
      this.renderer.shadowMap.needsUpdate = true;
      this.life.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = false; });
    }
    const now = performance.now();
    if (!this.lastFrame) { this.lastFrame = now; this.frameTimes = []; this.frameSum = 0; return; }
    const dt = now - this.lastFrame;
    this.lastFrame = now;
    this.frameTimes.push(dt);
    this.frameSum += dt;
    // decide every 45 frames, or sooner when frames are slow; the median ignores one-off stalls
    if (this.frameTimes.length < 45 && !(this.frameSum > 1500 && this.frameTimes.length >= 3)) return;
    const median = [...this.frameTimes].sort((a, b) => a - b)[this.frameTimes.length >> 1];
    this.frameTimes = [];
    this.frameSum = 0;
    if (median < 26 || now - this.lastStep < 800 || this.qualityStep >= 5) return;
    this.lastStep = now;
    // the slower the machine, the bigger the step, so nobody sits through a slideshow
    this.qualityStep = Math.min(5, median > 120 ? 5 : median > 60 ? this.qualityStep + 2 : this.qualityStep + 1);
    this.applyQuality();
  }
  private applyQuality() {
    const q = this.qualityStep;
    if (q >= 1) this.ao.enabled = false;
    if (q >= 2) this.bloom.enabled = false;
    if (q >= 4) for (const m of this.mirrors) m.onBeforeRender = () => {}; // water keeps its last reflection
    if (q >= 5) {
      this.direct = true; // no post-processing at all
      this.sun.castShadow = false;
      if (this.tufts) this.tufts.visible = false;
    }
    if (q >= 3) {
      const ratio = q === 3 ? 1 : q === 4 ? 0.75 : 0.6;
      this.renderer.setPixelRatio(ratio);
      this.composer.setPixelRatio(ratio);
      this.resize();
    }
  }

  snapshot(): string {
    return this.renderer.domElement.toDataURL("image/png");
  }
}

// A tileable normal map of small ripples, painted in code (no texture files).
function rippleMap(seed: number) {
  const N = 256;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d")!;
  const img = g.createImageData(N, N);
  const waves: [number, number, number, number][] = [];
  let s = seed * 9301;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 7; i++) waves.push([1 + Math.floor(rnd() * 5), 1 + Math.floor(rnd() * 5), rnd() * Math.PI * 2, 0.4 + rnd() * 0.6]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let dx = 0, dy = 0;
    for (const [kx, ky, ph, amp] of waves) {
      const t = ((x * kx + y * ky) / N) * Math.PI * 2 + ph;
      dx += Math.cos(t) * kx * amp;
      dy += Math.cos(t) * ky * amp;
    }
    const n = new THREE.Vector3(-dx * 0.08, -dy * 0.08, 1).normalize();
    const i = (y * N + x) * 4;
    img.data[i] = (n.x * 0.5 + 0.5) * 255;
    img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
    img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function mixHex(a: string, b: string, k: number) {
  return new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();
}

// Rippled mirror water: the reflection is pushed around by two drifting ripple layers, and mixed with the
// water's own colour by angle (straight down you see the water, at a glance you see the sky and buildings).
function waterShader(u: { time: { value: number }; waterColor: { value: THREE.Color }; tNormal: { value: THREE.Texture | null }; tSky: { value: THREE.Texture | null }; skyTop: { value: THREE.Color }; skyLow: { value: THREE.Color } }) {
  return {
    name: "RippleWater",
    uniforms: { color: { value: new THREE.Color("#ffffff") }, tDiffuse: { value: null }, textureMatrix: { value: null }, ...u },
    vertexShader: `
      uniform mat4 textureMatrix;
      varying vec4 vUv;
      varying vec3 vWorld;
      varying vec2 vTex;
      void main() {
        vUv = textureMatrix * vec4(position, 1.0);
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        vTex = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform sampler2D tNormal;
      uniform sampler2D tSky;
      uniform vec3 skyTop;
      uniform vec3 skyLow;
      uniform vec3 waterColor;
      uniform float time;
      varying vec4 vUv;
      varying vec3 vWorld;
      varying vec2 vTex;
      void main() {
        vec3 n1 = texture2D(tNormal, vTex / 6.0 + vec2(time * 0.018, time * 0.011)).xyz * 2.0 - 1.0;
        vec3 n2 = texture2D(tNormal, vTex / 2.3 - vec2(time * 0.013, -time * 0.02)).xyz * 2.0 - 1.0;
        vec2 d = (n1.xy + n2.xy * 0.6) * 0.02;
        vec4 uv = vUv;
        uv.xy += d * uv.w;
        vec4 seen = texture2DProj(tDiffuse, uv);
        vec3 v = normalize(cameraPosition - vWorld);
        // open sky in the reflection: the backdrop at the reflected elevation
        // open sky in the reflection: a simple gradient by the reflected elevation, set by the time of day
        vec3 sky = mix(skyLow, skyTop, smoothstep(0.0, 0.7, clamp(v.y + d.y, 0.0, 1.0))) * 1.4;
        vec3 refl = mix(sky, seen.rgb, seen.a);
        float fres = 0.62 + 0.38 * pow(1.0 - clamp(v.y, 0.0, 1.0), 2.0);
        // the water's own colour is lit like the scene's surfaces (unlit, it would read as ink)
        gl_FragColor = vec4(mix(waterColor * 2.6, refl, fres), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  };
}
