// Life in the scene: small block people strolling back and forth on open ground, and a flock of birds
// wheeling overhead. Like the scenery, nobody described them; they give scale and make the place breathe.
import * as THREE from "three";

export type Walk = { a: THREE.Vector3; b: THREE.Vector3 }; // a short stretch of open ground, metres

const CLOTHES = ["#f4f1ea", "#f4f1ea", "#2f5d9a", "#e08a2e", "#c4475a", "#e6c94a", "#5b8c5a", "#7a4a8c", "#d9d2c4", "#3a3a40"];
const HEADWEAR = ["#e08a2e", "#1f3a7a", "#f4f1ea", "#c4475a", "#e6c94a", "#2b2b30"]; // turbans and dupattas
const SKIN = ["#8a5a3c", "#a06a45", "#74492f", "#b07a52"];

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

export class Life {
  group = new THREE.Group();
  private parts: THREE.InstancedMesh[] = [];
  private people: { walk: Walk; phase: number; speed: number; len: number; bob: number }[] = [];
  private birds: THREE.InstancedMesh | null = null;
  private flock: { r: number; h: number; phase: number; speed: number; tilt: number }[] = [];
  private flockCentre = new THREE.Vector3();
  private o = new THREE.Object3D();
  private smoke: THREE.Points | null = null;
  private smokeFrom: THREE.Vector3[] = [];
  private flies: THREE.Points | null = null;
  private flyBase: Float32Array | null = null;
  night = 0;

  // Smoke curling up from each fire (a chulha, a tandoor); fireflies over the fields after dark.
  addFires(fires: THREE.Vector3[], fliesAround: { x0: number; x1: number; z0: number; z1: number } | null) {
    this.smokeFrom = fires;
    if (fires.length) {
      const per = 40, n = fires.length * per;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute("fade", new THREE.Float32BufferAttribute(new Float32Array(n), 1));
      // each puff grows and fades as it rises: thin and faint at the fire, wide and gone at the top
      this.smoke = new THREE.Points(g, new THREE.ShaderMaterial({
        uniforms: { map: { value: softDot() }, color: { value: new THREE.Color("#e4e0da") } },
        vertexShader: `attribute float fade; varying float vA;
          void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vA = fade;
            gl_PointSize = (0.5 + 2.6 * fade) * 340.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform sampler2D map; uniform vec3 color; varying float vA;
          void main() { float a = texture2D(map, gl_PointCoord).a * sin(3.14159 * vA) * 0.22; gl_FragColor = vec4(color, a); }`,
        transparent: true, depthWrite: false,
      }));
      this.smoke.frustumCulled = false;
      this.group.add(this.smoke);
    }
    if (fliesAround) {
      const n = 160, r = rng(31), base = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        base[i * 3] = fliesAround.x0 + r() * (fliesAround.x1 - fliesAround.x0);
        base[i * 3 + 1] = 0.6 + r() * 2.2;
        base[i * 3 + 2] = fliesAround.z0 + r() * (fliesAround.z1 - fliesAround.z0);
      }
      this.flyBase = base;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(base.slice(), 3));
      this.flies = new THREE.Points(g, new THREE.PointsMaterial({ color: "#ffe9a0", size: 0.35, map: softDot(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.flies.frustumCulled = false;
      this.group.add(this.flies);
    }
  }

  clear() {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      (c as THREE.Mesh).geometry.dispose();
      ((c as THREE.Mesh).material as THREE.Material).dispose();
    }
    this.parts = [];
    this.people = [];
    this.smoke = null;
    this.flies = null;
    this.birds = null;
    this.flock = [];
  }

  populate(walks: Walk[], birdsAt: THREE.Vector3 | null, birdRadius: number) {
    this.clear();
    const r = rng(7);
    const n = walks.length;
    if (n) {
      // legs, body, head, headwear: one instanced mesh each, a colour per person
      const geos = [new THREE.BoxGeometry(0.3, 0.8, 0.2).translate(0, 0.4, 0), new THREE.BoxGeometry(0.42, 0.68, 0.26).translate(0, 1.12, 0), new THREE.BoxGeometry(0.24, 0.26, 0.24).translate(0, 1.6, 0), new THREE.BoxGeometry(0.28, 0.12, 0.28).translate(0, 1.76, 0)];
      this.parts = geos.map((g) => {
        const m = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ roughness: 0.9 }), n);
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false; // people walk away from where their culling sphere was measured
        this.group.add(m);
        return m;
      });
      const c = new THREE.Color();
      for (let i = 0; i < n; i++) {
        const cloth = CLOTHES[Math.floor(r() * CLOTHES.length)];
        this.parts[0].setColorAt(i, c.set(r() < 0.6 ? cloth : "#3a3532"));
        this.parts[1].setColorAt(i, c.set(cloth));
        this.parts[2].setColorAt(i, c.set(SKIN[Math.floor(r() * SKIN.length)]));
        this.parts[3].setColorAt(i, c.set(HEADWEAR[Math.floor(r() * HEADWEAR.length)]));
        const w = walks[i];
        this.people.push({ walk: w, phase: r() * Math.PI * 2, speed: 0.9 + r() * 0.5, len: w.a.distanceTo(w.b), bob: r() });
      }
      for (const p of this.parts) p.instanceColor!.needsUpdate = true;
    }
    if (birdsAt) {
      const wing = new THREE.BoxGeometry(0.45, 0.04, 0.16);
      this.birds = new THREE.InstancedMesh(wing, new THREE.MeshStandardMaterial({ color: "#8d9096", roughness: 1 }), 2 * 14);
      this.birds.castShadow = true;
      this.birds.frustumCulled = false; // the flock circles, so a culling sphere measured once goes stale
      this.group.add(this.birds);
      this.flockCentre.copy(birdsAt);
      for (let i = 0; i < 14; i++) this.flock.push({ r: birdRadius * (0.55 + r() * 0.5), h: r() * 6, phase: (i / 14) * 0.6 + r() * 0.15, speed: 0.11 + r() * 0.02, tilt: r() - 0.5 });
    }
    this.update(0);
  }

  camera: THREE.Vector3 | null = null;

  update(t: number) {
    const o = this.o;
    if (this.smoke) {
      // each puff rises about 4 m over 6 s, drifting with the wind and spreading as it goes
      const pos = this.smoke.geometry.attributes.position as THREE.BufferAttribute, per = 40;
      const fade = this.smoke.geometry.attributes.fade as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        // each puff on its own clock (a scrambled phase), so the column is a soft plume, not a dotted line
        const ph = ((i * 0.618034) % 1), f = this.smokeFrom[Math.floor(i / per)], k = (t / 7 + ph) % 1;
        const spread = 0.08 + k * k * 1.2;
        pos.setXYZ(i, f.x + k * k * 2.2 + Math.sin(i * 12.9 + t * 0.6) * spread, f.y + 0.3 + k * 5, f.z + Math.cos(i * 7.3 + t * 0.5) * spread);
        fade.setX(i, k);
      }
      pos.needsUpdate = true;
      fade.needsUpdate = true;
    }
    if (this.flies && this.flyBase) {
      const pos = this.flies.geometry.attributes.position as THREE.BufferAttribute, b = this.flyBase;
      for (let i = 0; i < pos.count; i++) pos.setXYZ(i, b[i * 3] + Math.sin(t * 0.4 + i) * 0.8, b[i * 3 + 1] + Math.sin(t * 0.9 + i * 3) * 0.3, b[i * 3 + 2] + Math.cos(t * 0.35 + i * 2) * 0.8);
      pos.needsUpdate = true;
      (this.flies.material as THREE.PointsMaterial).opacity = Math.max(0, (this.night - 0.6) / 0.4) * (0.6 + 0.4 * Math.sin(t * 3));
    }
    this.people.forEach((p, i) => {
      // there and back along the stretch, easing at each end, turning to face the way they walk
      const cycle = (t * p.speed) / Math.max(0.5, p.len) + p.phase;
      const k = 0.5 - 0.5 * Math.cos(cycle);
      const goingOut = Math.sin(cycle) > 0;
      o.position.lerpVectors(p.walk.a, p.walk.b, k);
      o.position.y += Math.abs(Math.sin(t * 6 * p.speed + p.bob * 9)) * 0.04;
      const dir = goingOut ? p.walk.b.clone().sub(p.walk.a) : p.walk.a.clone().sub(p.walk.b);
      o.rotation.set(0, Math.atan2(dir.x, dir.z), 0);
      o.scale.setScalar(0.92 + p.bob * 0.16);
      o.updateMatrix();
      for (const part of this.parts) part.setMatrixAt(i, o.matrix);
    });
    for (const part of this.parts) part.instanceMatrix.needsUpdate = true;
    if (this.birds) {
      this.flock.forEach((b, i) => {
        const a = t * b.speed + b.phase * Math.PI * 2;
        const x = this.flockCentre.x + Math.cos(a) * b.r, z = this.flockCentre.z + Math.sin(a) * b.r;
        const y = this.flockCentre.y + b.h + Math.sin(a * 3 + i) * 1.5;
        const flap = Math.sin(t * 14 + i * 1.7) * 0.6;
        for (const side of [-1, 1]) {
          o.position.set(x, y, z);
          o.rotation.set(0, -a, b.tilt * 0.4 + side * flap);
          o.translateX(side * 0.33);
          // a bird right in front of the lens reads as a glitch: birds keep their distance from the camera
          o.scale.setScalar(this.camera && this.camera.distanceTo(o.position) < 18 ? 0 : 1);
          o.updateMatrix();
          this.birds!.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), o.matrix);
        }
      });
      this.birds.instanceMatrix.needsUpdate = true;
    }
  }
}

let dot: THREE.Texture | null = null;
function softDot() {
  if (dot) return dot;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return (dot = new THREE.CanvasTexture(c));
}
