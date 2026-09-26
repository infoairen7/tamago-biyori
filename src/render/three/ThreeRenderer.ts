// Three.js（WebGL 2）による主観視点の調理シーン。
// フライパン・卵・殻・ふた・皿・キッチンは全てプロシージャル形状で、外部モデルなしで起動します。
// 見た目は GameModel の値（T/W/Y/B/D）と run seed の形だけから決まります。
import * as THREE from 'three';
import { GAME_CONFIG, type EggConfig, type OilAmountConfig, type OilConfig } from '../../../shared/config.ts';
import type { FinalCook } from '../../../shared/model.ts';
import { makeEggShape, whiteRadiusAt, type EggShape } from '../../../shared/shape.ts';
import { OIL_LOOK, WhiteSurface, paintShell, shellColors, smoothstep, yolkLook } from '../eggPainter.ts';
import type { QualityLevel, RenderView, RendererCallbacks, SceneRenderer } from '../types.ts';
import { DROP_MS, PLATING_MS } from '../../game/session.ts';
import {
  blobShadowTexture,
  crockTexture,
  environmentCanvas,
  handleWoodTexture,
  panFloorTexture,
  steamTexture,
  tileTexture,
  towelTexture,
  woodTexture,
} from './textures.ts';

const COUNTER_Y = -2.4;
const STOVE_TOP_Y = -1.6;
const PAN_BOTTOM_Y = -0.45;
const RIM_Y = 2.9;
const PAN_R = 9.7;
const EGG_HOVER_Y = 7.4;
const EGG_HOVER_Z = 3.2;
const PLATE_POS = new THREE.Vector3(-37, COUNTER_Y, 2);
const YOLK_DOME = 0.74;
const PLATE_TOP = COUNTER_Y + 0.42;
const HANDLE_ANGLE = (26 * Math.PI) / 180;
/** 油の量ごとの見た目（油だまりの濃さ・広さ・泡の大きさ） */
const OIL_AMOUNT_LOOK = {
  less: { opacity: 0.1, radius: 1.06, bubbles: 0.6 },
  normal: { opacity: 0.2, radius: 1.17, bubbles: 1 },
  more: { opacity: 0.36, radius: 1.32, bubbles: 1.45 },
} as const;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

interface SteamParticle {
  sprite: THREE.Sprite;
  born: number;
  life: number;
  x: number;
  z: number;
  drift: number;
  size: number;
  fromLid: boolean;
  alive: boolean;
}

interface Pose {
  target: THREE.Vector3;
  elev: number;
  dist: number;
}

function eggProfile(len: number, width: number, from: number, to: number, segments: number): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= segments; i++) {
    const phi = from + ((to - from) * i) / segments;
    const y = -Math.cos(phi) * (len / 2);
    const r = Math.sin(phi) * (width / 2) * (1 + 0.09 * Math.cos(phi));
    pts.push(new THREE.Vector2(Math.max(r, 0.0001), y));
  }
  return pts;
}

function whiteHeight(shape: EggShape, x: number, z: number, t: number): number {
  const s = Math.sqrt(shape.scale);
  const base = 0.04 + 0.2 * Math.pow(Math.max(0, 1 - t * t), 0.7);
  const dy = Math.hypot(x - shape.yolkX, z - shape.yolkZ) / shape.yolkRadius;
  const bump = 0.24 * Math.exp(-Math.pow(Math.max(0, dy - 0.9) / 1.3, 2));
  return (base + bump) * s;
}

function buildWhiteGeometry(shape: EggShape, extent: number): THREE.BufferGeometry {
  const A = 112;
  const R = 18;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const push = (x: number, z: number, t: number) => {
    pos.push(x, whiteHeight(shape, x, z, t), z);
    uv.push(0.5 + x / (2 * extent), 0.5 - z / (2 * extent));
  };
  push(0, 0, 0);
  for (let j = 1; j <= R; j++) {
    const t = 1 - Math.pow(1 - j / R, 1.6);
    for (let i = 0; i < A; i++) {
      const th = (i / A) * Math.PI * 2;
      const r = t * whiteRadiusAt(shape, th);
      push(Math.cos(th) * r, Math.sin(th) * r, t);
    }
  }
  for (let i = 0; i < A; i++) idx.push(0, 1 + ((i + 1) % A), 1 + i);
  for (let j = 1; j < R; j++) {
    const a0 = 1 + (j - 1) * A;
    const b0 = 1 + j * A;
    for (let i = 0; i < A; i++) {
      const i1 = (i + 1) % A;
      idx.push(a0 + i, a0 + i1, b0 + i);
      idx.push(a0 + i1, b0 + i1, b0 + i);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class ThreeRenderer implements SceneRenderer {
  readonly kind = '3d' as const;
  readonly canvas: HTMLCanvasElement;
  private gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(34, 1, 0.5, 400);
  private quality: QualityLevel;
  private cb: RendererCallbacks;
  private lost = false;
  private fatal = false;
  private width = 1;
  private height = 1;
  private disposables: { dispose(): void }[] = [];

  // 卵の中身
  private eggGroup = new THREE.Group();
  private whiteMesh: THREE.Mesh | null = null;
  private sheenMesh: THREE.Mesh | null = null;
  private whiteGeom: THREE.BufferGeometry | null = null;
  private whiteMat: THREE.MeshStandardMaterial;
  private sheenMat: THREE.MeshStandardMaterial;
  private yolkMesh: THREE.Mesh;
  private yolkMat: THREE.MeshPhysicalMaterial;
  private glossMat: THREE.MeshBasicMaterial;
  private eggShadow: THREE.Mesh;
  private eggShadowMat: THREE.MeshBasicMaterial;
  private surface: WhiteSurface | null = null;
  private whiteTex: THREE.CanvasTexture | null = null;
  private bubbleMesh: THREE.InstancedMesh;
  private oilMesh: THREE.InstancedMesh;
  private oilMat: THREE.MeshStandardMaterial;
  private oilPool: THREE.Mesh;
  private oilPoolMat: THREE.MeshStandardMaterial;
  private oilKey = '';
  private oilLook: { opacity: number; radius: number; bubbles: number } = OIL_AMOUNT_LOOK.normal;
  private lastSteamS = 0;
  private shape: EggShape | null = null;
  private runKey = '';

  // 殻
  private shellGroup = new THREE.Group();
  private wholeEgg: THREE.Mesh;
  private halfA = new THREE.Group();
  private halfB = new THREE.Group();
  private shellCanvas: HTMLCanvasElement;
  private shellTex: THREE.CanvasTexture;
  private shellMat: THREE.MeshStandardMaterial;
  private shellInnerMat: THREE.MeshStandardMaterial;
  private shellKey = '';
  private shellEggKey = '';

  // ふた・湯気・その他
  private lidGroup = new THREE.Group();
  private lidGlassMat: THREE.MeshStandardMaterial;
  private lidAnim = 0;
  private steam: SteamParticle[] = [];
  private lastSteamAt = 0;
  private tapRing: THREE.Mesh;
  private tapRingMat: THREE.MeshBasicMaterial;
  private animClock = 0;
  private lastTime = -1;
  private lastPaint = 0;
  private frameTimes: number[] = [];
  private dummy = new THREE.Object3D();

  static isSupported(): boolean {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      if (!gl) return false;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return true;
    } catch {
      return false;
    }
  }

  constructor(quality: QualityLevel, callbacks: RendererCallbacks = {}) {
    this.quality = quality;
    this.cb = callbacks;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'scene-canvas';
    this.gl = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.NeutralToneMapping;
    this.gl.toneMappingExposure = 0.95;
    this.gl.setPixelRatio(this.pixelRatio());

    this.canvas.addEventListener('webglcontextlost', this.onLost, false);
    this.canvas.addEventListener('webglcontextrestored', this.onRestored, false);

    const scene = this.scene;
    scene.background = new THREE.Color(0xf3e4cc);
    scene.fog = new THREE.Fog(0xf3e4cc, 75, 180);

    // 環境光（反射）
    const envTex = new THREE.CanvasTexture(environmentCanvas());
    envTex.mapping = THREE.EquirectangularReflectionMapping;
    envTex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(this.gl);
    const envRT = pmrem.fromEquirectangular(envTex);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.6;
    pmrem.dispose();
    envTex.dispose();
    this.disposables.push(envRT);

    // 光：左上から暖かな主光、やわらかな環境光
    scene.add(new THREE.HemisphereLight(0xfff3e0, 0xa98560, 0.62));
    const sun = new THREE.DirectionalLight(0xffe2b8, 2.0);
    sun.position.set(-28, 42, -16);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xfff6ea, 0.28);
    fill.position.set(22, 20, 34);
    scene.add(fill);

    this.buildKitchen();
    this.buildPan();

    // 卵の中身の材質
    this.whiteMat = new THREE.MeshStandardMaterial({ transparent: true, roughness: 0.2, metalness: 0, envMapIntensity: 0.7 });
    this.sheenMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      roughness: 0.06,
      metalness: 0,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      envMapIntensity: 1.8,
    });
    this.yolkMat = new THREE.MeshPhysicalMaterial({ color: 0xffa31a, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 1.2 });
    const yolkGeom = new THREE.SphereGeometry(1, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2);
    this.yolkMesh = new THREE.Mesh(yolkGeom, this.yolkMat);
    this.eggGroup.add(this.yolkMesh);
    // 黄身のつや（窓の映り込み）。固まるほど弱くなる
    this.glossMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, opacity: 0.8 });
    const glossGeom = new THREE.CircleGeometry(1, 24);
    const addGloss = (dir: THREE.Vector3, sx: number, sy: number, opacityScale: number) => {
      const m = new THREE.Mesh(glossGeom, opacityScale === 1 ? this.glossMat : this.glossMat.clone());
      const n = dir.clone().normalize();
      m.position.copy(n).multiplyScalar(1.004);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      m.scale.set(sx, sy, 1);
      m.userData.opacityScale = opacityScale;
      m.renderOrder = 5;
      this.yolkMesh.add(m);
    };
    addGloss(new THREE.Vector3(-0.34, 0.9, 0.2), 0.26, 0.13, 1);
    addGloss(new THREE.Vector3(0.42, 0.72, 0.52), 0.08, 0.05, 0.6);
    this.disposables.push(yolkGeom, glossGeom, this.whiteMat, this.sheenMat, this.yolkMat, this.glossMat);

    const bubbleGeom = new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    const bubbleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.04, transparent: true, opacity: 0.5, envMapIntensity: 1.6, depthWrite: false });
    const oilMat = new THREE.MeshStandardMaterial({ color: 0xe2b467, roughness: 0.08, transparent: true, opacity: 0.6, envMapIntensity: 1.4, depthWrite: false });
    this.oilMat = oilMat;
    this.bubbleMesh = new THREE.InstancedMesh(bubbleGeom, bubbleMat, 14);
    this.oilMesh = new THREE.InstancedMesh(bubbleGeom, oilMat, 28);
    this.bubbleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.oilMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bubbleMesh.frustumCulled = false;
    this.oilMesh.frustumCulled = false;
    this.eggGroup.add(this.bubbleMesh, this.oilMesh);
    this.disposables.push(bubbleGeom, bubbleMat, oilMat);
    scene.add(this.eggGroup);

    // フライパンの油だまり（量と種類で濃さ・広さ・色が変わる）
    this.oilPoolMat = new THREE.MeshStandardMaterial({
      color: 0xd9a94f,
      roughness: 0.05,
      metalness: 0,
      transparent: true,
      opacity: 0.2,
      envMapIntensity: 1.7,
      depthWrite: false,
    });
    const poolGeom = new THREE.CircleGeometry(1, 56);
    this.oilPool = new THREE.Mesh(poolGeom, this.oilPoolMat);
    this.oilPool.rotation.x = -Math.PI / 2;
    this.oilPool.position.y = 0.008;
    this.oilPool.renderOrder = 1;
    scene.add(this.oilPool);
    this.disposables.push(poolGeom, this.oilPoolMat);

    // 殻（全体と割れた2つの半分）
    this.shellCanvas = document.createElement('canvas');
    this.shellCanvas.width = 256;
    this.shellCanvas.height = 128;
    this.shellTex = new THREE.CanvasTexture(this.shellCanvas);
    this.shellTex.colorSpace = THREE.SRGBColorSpace;
    this.shellMat = new THREE.MeshStandardMaterial({ map: this.shellTex, roughness: 0.62, metalness: 0, transparent: true });
    this.shellInnerMat = new THREE.MeshStandardMaterial({ color: 0xf6f1e6, roughness: 0.8, side: THREE.BackSide, transparent: true });
    const wholeGeom = new THREE.LatheGeometry(eggProfile(1, 0.76, 0, Math.PI, 32), 40);
    this.wholeEgg = new THREE.Mesh(wholeGeom, this.shellMat);
    this.shellGroup.add(this.wholeEgg);
    const halfGeomA = new THREE.LatheGeometry(eggProfile(1, 0.76, 0, Math.PI / 2, 16), 40);
    const halfGeomB = new THREE.LatheGeometry(eggProfile(1, 0.76, Math.PI / 2, Math.PI, 16), 40);
    remapV(halfGeomA, 0, 0.5);
    remapV(halfGeomB, 0.5, 1);
    this.halfA.add(new THREE.Mesh(halfGeomA, this.shellMat), new THREE.Mesh(halfGeomA, this.shellInnerMat));
    this.halfB.add(new THREE.Mesh(halfGeomB, this.shellMat), new THREE.Mesh(halfGeomB, this.shellInnerMat));
    this.shellGroup.add(this.halfA, this.halfB);
    scene.add(this.shellGroup);
    this.disposables.push(wholeGeom, halfGeomA, halfGeomB, this.shellTex, this.shellMat, this.shellInnerMat);

    // 着地位置の目印
    this.tapRingMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
    const ringGeom = new THREE.RingGeometry(1.25, 1.55, 48);
    this.tapRing = new THREE.Mesh(ringGeom, this.tapRingMat);
    this.tapRing.rotation.x = -Math.PI / 2;
    this.tapRing.position.y = 0.03;
    scene.add(this.tapRing);
    this.disposables.push(ringGeom, this.tapRingMat);
    this.eggShadowMat = new THREE.MeshBasicMaterial({ map: this.track(blobShadowTexture()), transparent: true, depthWrite: false, opacity: 0.5 });
    const shadowGeom = this.track(new THREE.PlaneGeometry(1, 1));
    this.eggShadow = new THREE.Mesh(shadowGeom, this.eggShadowMat);
    this.eggShadow.rotation.x = -Math.PI / 2;
    this.eggShadow.renderOrder = 1;
    scene.add(this.eggShadow);
    this.disposables.push(this.eggShadowMat);

    this.lidGlassMat = this.buildLid();
    this.buildSteam();
    this.prewarm();
  }

  /** 卵が着地した瞬間に止まらないよう、全ての材質のシェーダーを先にコンパイルしておく */
  private prewarm() {
    try {
      this.ensureRun(GAME_CONFIG.eggs[0], makeEggShape(1, 1));
      const objs: THREE.Object3D[] = [this.eggGroup, this.shellGroup, this.halfA, this.halfB, this.lidGroup, this.bubbleMesh, this.oilMesh, this.eggShadow, this.tapRing];
      const prev = objs.map((o) => o.visible);
      for (const o of objs) o.visible = true;
      for (const p of this.steam) p.sprite.visible = true;
      this.gl.compile(this.scene, this.camera);
      objs.forEach((o, i) => (o.visible = prev[i]));
      for (const p of this.steam) p.sprite.visible = false;
    } catch (e) {
      console.warn('[render3d] prewarm failed', e);
    }
  }

  private pixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 1.5 : 1);
  }

  private onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
    this.cb.onContextLost?.();
  };

  private onRestored = () => {
    this.lost = false;
    this.lastPaint = 0;
    if (this.surface && this.whiteTex) this.whiteTex.needsUpdate = true;
    this.shellTex.needsUpdate = true;
    this.cb.onContextRestored?.();
  };

  // ---- シーン構築 ----

  private track<T extends { dispose(): void }>(o: T): T {
    this.disposables.push(o);
    return o;
  }

  private buildKitchen() {
    const s = this.scene;
    const shadowTex = this.track(blobShadowTexture());
    const blob = (x: number, y: number, z: number, sx: number, sz: number, opacity = 1) => {
      const m = new THREE.Mesh(
        this.track(new THREE.PlaneGeometry(1, 1)),
        this.track(new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity })),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y, z);
      m.scale.set(sx, sz, 1);
      m.renderOrder = 1;
      s.add(m);
      return m;
    };

    // 木のカウンター
    const counter = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(240, 170)),
      this.track(new THREE.MeshStandardMaterial({ map: this.track(woodTexture()), roughness: 0.62, metalness: 0 })),
    );
    counter.rotation.x = -Math.PI / 2;
    counter.position.set(0, COUNTER_Y, 10);
    s.add(counter);

    // 壁のタイル
    const wall = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(240, 80)),
      this.track(new THREE.MeshStandardMaterial({ map: this.track(tileTexture()), roughness: 0.45 })),
    );
    wall.position.set(0, COUNTER_Y + 40, -36);
    s.add(wall);

    // コンロの天板と五徳
    const stoveMat = this.track(new THREE.MeshStandardMaterial({ color: 0xf1ede5, roughness: 0.32, metalness: 0.05 }));
    const stove = new THREE.Mesh(this.track(new THREE.BoxGeometry(38, STOVE_TOP_Y - COUNTER_Y, 32)), stoveMat);
    stove.position.set(0, (STOVE_TOP_Y + COUNTER_Y) / 2, 1);
    s.add(stove);
    const darkMetal = this.track(new THREE.MeshStandardMaterial({ color: 0x232524, roughness: 0.5, metalness: 0.65 }));
    const burner = new THREE.Mesh(this.track(new THREE.CylinderGeometry(3.6, 3.9, 0.5, 32)), darkMetal);
    burner.position.set(0, STOVE_TOP_Y + 0.25, 0);
    s.add(burner);
    const barGeom = this.track(new THREE.BoxGeometry(6.2, 0.38, 0.42));
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const bar = new THREE.Mesh(barGeom, darkMetal);
      const r = 10.6;
      bar.position.set(Math.cos(a) * r, PAN_BOTTOM_Y - 0.28, Math.sin(a) * r);
      bar.rotation.y = -a;
      s.add(bar);
      const leg = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.45, 1.0, 0.45)), darkMetal);
      leg.position.set(Math.cos(a) * 13.3, (STOVE_TOP_Y + PAN_BOTTOM_Y) / 2 - 0.2, Math.sin(a) * 13.3);
      s.add(leg);
    }
    blob(0.6, STOVE_TOP_Y + 0.02, 1.2, 26, 23, 0.85);

    // 皿
    const plateProfile = [
      [0, 0],
      [5.2, 0],
      [5.6, 0.1],
      [7.9, 0.5],
      [9.2, 1.05],
      [9.42, 1.22],
      [9.15, 1.28],
      [7.8, 0.78],
      [6.2, 0.44],
      [0, 0.42],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const plate = new THREE.Mesh(
      this.track(new THREE.LatheGeometry(plateProfile, 72)),
      this.track(new THREE.MeshStandardMaterial({ color: 0xfbfaf6, roughness: 0.24, metalness: 0, envMapIntensity: 0.9 })),
    );
    plate.position.copy(PLATE_POS);
    s.add(plate);
    blob(PLATE_POS.x + 0.8, COUNTER_Y + 0.02, PLATE_POS.z + 1.2, 23, 21, 0.75);

    // 奥の卵のパック（2個）
    const carton = new THREE.Group();
    const pulp = this.track(new THREE.MeshStandardMaterial({ color: 0xe9e0d0, roughness: 0.95 }));
    const tray = new THREE.Mesh(this.track(new THREE.BoxGeometry(11, 2.2, 6.2)), pulp);
    tray.position.y = 1.1;
    carton.add(tray);
    const brownShell = this.track(new THREE.MeshStandardMaterial({ color: 0xc88450, roughness: 0.6 }));
    const eggGeom = this.track(new THREE.LatheGeometry(eggProfile(5.6, 4.3, 0, Math.PI, 20), 24));
    for (const dx of [-2.6, 2.6]) {
      const e = new THREE.Mesh(eggGeom, brownShell);
      e.position.set(dx, 4.2, 0);
      e.rotation.z = dx * 0.05;
      carton.add(e);
    }
    carton.position.set(19, COUNTER_Y, -17);
    carton.rotation.y = -0.15;
    s.add(carton);
    blob(19.5, COUNTER_Y + 0.02, -16, 15, 10, 0.7);

    // 道具立て（右奥）と保存瓶（左奥）
    const crockMat = this.track(new THREE.MeshStandardMaterial({ map: this.track(crockTexture()), roughness: 0.4 }));
    const crock = new THREE.Mesh(this.track(new THREE.CylinderGeometry(3.3, 3.1, 9, 28)), crockMat);
    crock.position.set(29, COUNTER_Y + 4.5, -11);
    s.add(crock);
    const woodMat = this.track(new THREE.MeshStandardMaterial({ color: 0xb98652, roughness: 0.7 }));
    for (let i = 0; i < 3; i++) {
      const stick = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.35, 0.4, 13, 8)), woodMat);
      stick.position.set(29 + (i - 1) * 1.1, COUNTER_Y + 11, -11 + (i % 2) * 0.8);
      stick.rotation.z = (i - 1) * 0.16;
      s.add(stick);
    }
    blob(29.5, COUNTER_Y + 0.02, -10, 11, 9, 0.7);
    const jar = new THREE.Mesh(this.track(new THREE.CylinderGeometry(3.6, 3.6, 6.5, 28)), crockMat);
    jar.position.set(-27, COUNTER_Y + 3.25, -16);
    s.add(jar);
    const lidWood = new THREE.Mesh(this.track(new THREE.CylinderGeometry(3.7, 3.7, 1.2, 28)), woodMat);
    lidWood.position.set(-27, COUNTER_Y + 7.1, -16);
    s.add(lidWood);
    blob(-26.5, COUNTER_Y + 0.02, -15, 12, 10, 0.7);

    // 左手前のふきん
    const towel = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(13, 0.5, 10)),
      this.track(new THREE.MeshStandardMaterial({ map: this.track(towelTexture()), roughness: 0.95 })),
    );
    towel.position.set(-22, COUNTER_Y + 0.25, 19);
    towel.rotation.y = 0.35;
    s.add(towel);
  }

  private buildPan() {
    const pan = new THREE.Group();
    const profile = [
      [0, -0.45],
      [7.3, -0.45],
      [8.0, -0.32],
      [8.55, 0.2],
      [9.05, 1.3],
      [9.5, 2.4],
      [9.72, 2.78],
      [9.66, 2.94],
      [9.42, 2.92],
      [9.0, 2.2],
      [8.45, 1.0],
      [7.9, 0.28],
      [7.45, 0.02],
      [0, 0],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const panMat = this.track(new THREE.MeshStandardMaterial({ color: 0x27292a, roughness: 0.46, metalness: 0.62, envMapIntensity: 0.9 }));
    const body = new THREE.Mesh(this.track(new THREE.LatheGeometry(profile, 96)), panMat);
    pan.add(body);
    const floor = new THREE.Mesh(
      this.track(new THREE.CircleGeometry(7.5, 64)),
      this.track(new THREE.MeshStandardMaterial({ map: this.track(panFloorTexture()), roughness: 0.3, metalness: 0.45, envMapIntensity: 1.0 })),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.004;
    pan.add(floor);

    // 柄（右下へ）
    const dir = new THREE.Vector3(Math.cos(HANDLE_ANGLE), 0, Math.sin(HANDLE_ANGLE));
    const handle = new THREE.Group();
    handle.position.set(dir.x * 9.2, 1.7, dir.z * 9.2);
    handle.rotation.y = -HANDLE_ANGLE;
    handle.rotation.z = 0.16;
    const bracket = new THREE.Mesh(this.track(new THREE.BoxGeometry(4.6, 0.8, 1.4)), panMat);
    bracket.position.x = 1.9;
    handle.add(bracket);
    const woodTex = this.track(handleWoodTexture());
    const woodMat = this.track(new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.55, metalness: 0 }));
    const grip = new THREE.Mesh(this.track(new THREE.CapsuleGeometry(1.05, 12, 8, 20)), woodMat);
    grip.rotation.z = Math.PI / 2;
    grip.position.x = 11;
    grip.scale.set(1, 1, 0.86);
    handle.add(grip);
    const ferrule = new THREE.Mesh(this.track(new THREE.CylinderGeometry(1.08, 1.08, 1.2, 20)), panMat);
    ferrule.rotation.z = Math.PI / 2;
    ferrule.position.x = 4.6;
    handle.add(ferrule);
    pan.add(handle);
    const rivetGeom = this.track(new THREE.SphereGeometry(0.28, 10, 8));
    const brass = this.track(new THREE.MeshStandardMaterial({ color: 0xb59258, roughness: 0.35, metalness: 0.9 }));
    for (const off of [-0.45, 0.45]) {
      const r = new THREE.Mesh(rivetGeom, brass);
      const a = HANDLE_ANGLE + off * 0.12;
      r.position.set(Math.cos(a) * 9.55, 1.75, Math.sin(a) * 9.55);
      pan.add(r);
    }
    this.scene.add(pan);
  }

  private buildLid(): THREE.MeshStandardMaterial {
    const g = this.lidGroup;
    const Rl = 13;
    const theta = Math.asin(9.6 / Rl);
    const glassMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xe4eef0,
        roughness: 0.04,
        metalness: 0,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        side: THREE.DoubleSide,
        envMapIntensity: 1.8,
      }),
    );
    const dome = new THREE.Mesh(this.track(new THREE.SphereGeometry(Rl, 48, 14, 0, Math.PI * 2, 0, theta)), glassMat);
    dome.position.y = RIM_Y + 0.05 - Rl * Math.cos(theta);
    dome.renderOrder = 3;
    g.add(dome);
    const steel = this.track(new THREE.MeshStandardMaterial({ color: 0xa6aba8, roughness: 0.28, metalness: 0.85 }));
    const rim = new THREE.Mesh(this.track(new THREE.TorusGeometry(9.62, 0.26, 8, 72)), steel);
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = RIM_Y + 0.12;
    g.add(rim);
    const knobMat = this.track(new THREE.MeshStandardMaterial({ color: 0x2c2d2b, roughness: 0.45, metalness: 0.2 }));
    const top = RIM_Y + 0.05 + Rl * (1 - Math.cos(theta));
    const stem = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.45, 0.6, 0.9, 16)), knobMat);
    stem.position.y = top + 0.4;
    g.add(stem);
    const knob = new THREE.Mesh(this.track(new THREE.SphereGeometry(1.0, 20, 12)), knobMat);
    knob.scale.set(1, 0.55, 1);
    knob.position.y = top + 1.0;
    g.add(knob);
    g.visible = false;
    this.scene.add(g);
    return glassMat;
  }

  private buildSteam() {
    const tex = this.track(steamTexture());
    for (let i = 0; i < 18; i++) {
      const mat = this.track(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, color: 0xffffff }));
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.renderOrder = 4;
      this.scene.add(sprite);
      this.steam.push({ sprite, born: 0, life: 1, x: 0, z: 0, drift: 0, size: 1, fromLid: false, alive: false });
    }
  }

  // ---- 卵（runごと） ----

  private ensureRun(egg: EggConfig, shape: EggShape) {
    const key = `${egg.id}:${shape.seed}:${shape.scale}:${this.quality}`;
    if (key === this.runKey) return;
    this.runKey = key;
    this.shape = shape;
    // 白身
    if (this.whiteMesh) this.eggGroup.remove(this.whiteMesh);
    if (this.sheenMesh) this.eggGroup.remove(this.sheenMesh);
    this.whiteGeom?.dispose();
    this.whiteTex?.dispose();
    this.surface = new WhiteSurface(shape, this.quality === 'high' ? 384 : 256);
    this.surface.update(0, 0, 0, true);
    this.whiteTex = new THREE.CanvasTexture(this.surface.canvas);
    this.whiteTex.colorSpace = THREE.SRGBColorSpace;
    this.whiteTex.anisotropy = 4;
    this.whiteMat.map = this.whiteTex;
    this.whiteMat.needsUpdate = true;
    this.whiteGeom = buildWhiteGeometry(shape, this.surface.extent);
    this.whiteMesh = new THREE.Mesh(this.whiteGeom, this.whiteMat);
    this.whiteMesh.renderOrder = 2;
    this.sheenMesh = new THREE.Mesh(this.whiteGeom, this.sheenMat);
    this.sheenMesh.position.y = 0.01;
    this.sheenMesh.renderOrder = 3;
    this.eggGroup.add(this.whiteMesh, this.sheenMesh);
    // 黄身
    const yr = shape.yolkRadius;
    this.yolkMesh.scale.set(yr, yr * YOLK_DOME, yr);
    this.yolkMesh.position.set(shape.yolkX, 0.16 * Math.sqrt(shape.scale), shape.yolkZ);
    this.lastPaint = 0;
    this.lidAnim = 0;
    for (const p of this.steam) {
      p.alive = false;
      p.sprite.visible = false;
    }
    // 殻の大きさ
    const len = 5.8 * egg.visualScale;
    this.shellGroup.scale.set(len, len, len);
    this.shellEggKey = `${egg.id}:${shape.seed}`;
    this.shellKey = '';
  }

  private setOil(oil: OilConfig, amount: OilAmountConfig) {
    const key = `${oil.id}:${amount.id}`;
    if (key === this.oilKey) return;
    this.oilKey = key;
    const look = OIL_LOOK[oil.id];
    this.oilLook = OIL_AMOUNT_LOOK[amount.id];
    this.oilPoolMat.color.setRGB(look.pool[0] / 255, look.pool[1] / 255, look.pool[2] / 255, THREE.SRGBColorSpace);
    this.oilMat.color.setRGB(look.bubble[0] / 255, look.bubble[1] / 255, look.bubble[2] / 255, THREE.SRGBColorSpace);
    this.surface?.setTone(oil.id);
  }

  private updateShellTexture(egg: EggConfig, seed: number, cracked: boolean) {
    const key = `${this.shellEggKey}:${cracked}`;
    if (key === this.shellKey) return;
    this.shellKey = key;
    paintShell(this.shellCanvas, egg.id, seed, cracked);
    this.shellTex.needsUpdate = true;
    this.shellInnerMat.color.set(shellColors(egg.id).inner);
  }

  private applyCookLook(W: number, Y: number, B: number, D: number, force: boolean, now: number, wet = 0, F = 0) {
    if (this.surface && this.whiteTex && (force || now - this.lastPaint > 0.12)) {
      if (this.surface.update(W, B, D, force, wet)) this.whiteTex.needsUpdate = true;
      this.lastPaint = now;
    }
    this.whiteMat.roughness = (0.14 + 0.46 * smoothstep(0.1, 0.9, W)) * (1 - 0.4 * wet);
    this.sheenMat.opacity = 0.9 * Math.max(1 - smoothstep(0.15, 0.85, W), 0.5 * wet);
    const look = yolkLook(Y, F);
    this.yolkMat.color.setRGB(look.color[0] / 255, look.color[1] / 255, look.color[2] / 255, THREE.SRGBColorSpace);
    this.yolkMat.emissive.copy(this.yolkMat.color).multiplyScalar(0.06);
    this.yolkMat.roughness = look.roughness;
    this.yolkMat.clearcoat = look.clearcoat;
    for (const child of this.yolkMesh.children) {
      const m = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
      m.opacity = look.gloss * 0.95 * (child.userData.opacityScale ?? 1);
    }
  }

  private updateBubbles(active: boolean, T: number, W: number, t: number, steam = 0) {
    const shape = this.shape;
    if (!shape) return;
    const whiteAct = active ? smoothstep(0.42, 0.62, T) * (1 - smoothstep(0.55, 0.92, W)) : 0;
    // 油が多いほど縁の泡が大きく、差し水の直後は水が沸いて泡立つ
    const oilAct = active ? Math.max(smoothstep(0.45, 0.72, T) * this.oilLook.bubbles, steam * 1.1) : 0;
    const d = this.dummy;
    for (let i = 0; i < this.bubbleMesh.count; i++) {
      const b = shape.bubbles[i % shape.bubbles.length];
      const ph = (t * (0.7 + b.size * 0.9) + b.phase) % 1;
      const s = Math.sin(Math.PI * ph) * whiteAct * (0.12 + b.size * 0.16) * Math.sqrt(shape.scale);
      const r = (0.5 + b.r * 0.42) * whiteRadiusAt(shape, b.theta) * 0.92;
      const x = Math.cos(b.theta) * r;
      const z = Math.sin(b.theta) * r;
      d.position.set(x, whiteHeight(shape, x, z, r / shape.whiteRadius) + 0.01, z);
      d.scale.setScalar(Math.max(s, 0.0001));
      d.updateMatrix();
      this.bubbleMesh.setMatrixAt(i, d.matrix);
    }
    this.bubbleMesh.instanceMatrix.needsUpdate = true;
    this.bubbleMesh.visible = whiteAct > 0.01;
    for (let i = 0; i < this.oilMesh.count; i++) {
      const b = shape.bubbles[i % shape.bubbles.length];
      const theta = b.theta + (i >= shape.bubbles.length ? 0.4 : 0);
      const ph = (t * (1.1 + b.size) + b.phase + i * 0.13) % 1;
      const s = Math.sin(Math.PI * ph) * oilAct * (0.1 + b.size * 0.18);
      const r = (1.0 + 0.11 * b.r * this.oilLook.radius) * whiteRadiusAt(shape, theta);
      d.position.set(Math.cos(theta) * r, 0.02, Math.sin(theta) * r);
      d.scale.set(Math.max(s, 0.0001), Math.max(s * 0.7, 0.0001), Math.max(s, 0.0001));
      d.updateMatrix();
      this.oilMesh.setMatrixAt(i, d.matrix);
    }
    this.oilMesh.instanceMatrix.needsUpdate = true;
    this.oilMesh.visible = oilAct > 0.01;
  }

  private updateSteam(t: number, dt: number, amount: number, lidClosed: boolean, reducedMotion: boolean, burst = 0) {
    const max = reducedMotion ? 5 : this.quality === 'high' ? 18 : 8;
    const interval = (lidClosed ? 0.8 : 0.22) / Math.max(0.15, amount);
    // 差し水の瞬間は、まとめて湯気を立てる
    for (let i = 0; i < burst; i++) this.spawnSteam(t, lidClosed, reducedMotion, max, 1.4);
    if (amount > 0.04 && t - this.lastSteamAt > interval) this.spawnSteam(t, lidClosed, reducedMotion, max, 1);
    this.animateSteam(t, dt, amount, reducedMotion);
  }

  private spawnSteam(t: number, lidClosed: boolean, reducedMotion: boolean, max: number, sizeBoost: number) {
    const alive = this.steam.filter((p) => p.alive).length;
    const slot = this.steam.find((p) => !p.alive);
    if (!slot || alive >= max) return;
    this.lastSteamAt = t;
    const a = Math.random() * Math.PI * 2;
    const r = lidClosed ? PAN_R * 0.98 : Math.random() * 4.5 * (this.shape?.scale ?? 1);
    slot.alive = true;
    slot.born = t;
    slot.life = (reducedMotion ? 3.6 : 2.4) + Math.random() * 1.2;
    slot.x = Math.cos(a) * r;
    slot.z = Math.sin(a) * r;
    slot.drift = (Math.random() - 0.5) * 2;
    slot.size = (2.8 + Math.random() * 2.4) * sizeBoost;
    slot.fromLid = lidClosed;
    slot.sprite.visible = true;
  }

  private animateSteam(t: number, dt: number, amount: number, reducedMotion: boolean) {
    for (const p of this.steam) {
      if (!p.alive) continue;
      const u = (t - p.born) / p.life;
      if (u >= 1 || dt < 0) {
        p.alive = false;
        p.sprite.visible = false;
        continue;
      }
      const y = (p.fromLid ? RIM_Y : 0.6) + u * (reducedMotion ? 8 : 13);
      p.sprite.position.set(p.x + Math.sin(u * 3 + p.drift) * 1.3 + p.drift * u * 1.5, y, p.z - u * 1.5);
      const sc = p.size + u * 5;
      p.sprite.scale.set(sc, sc, sc);
      (p.sprite.material as THREE.SpriteMaterial).opacity = Math.sin(Math.PI * u) * 0.34 * Math.min(1.2, Math.max(0.5, amount * 1.3));
    }
  }

  private hideSteam() {
    for (const p of this.steam) {
      p.alive = false;
      p.sprite.visible = false;
    }
  }

  // ---- カメラ ----

  private panPose(visualScale: number): Pose {
    const zoom = visualScale < 1 ? 0.86 : 1;
    const dist = this.fitDistance(23.5 * zoom, 21.5 * zoom);
    return { target: new THREE.Vector3(0, 1.2, 1.0), elev: (52 * Math.PI) / 180, dist };
  }

  private platePose(aspect = this.camera.aspect): Pose {
    return { target: new THREE.Vector3(PLATE_POS.x, PLATE_TOP, PLATE_POS.z + 0.5), elev: (62 * Math.PI) / 180, dist: this.fitDistance(22.5, 20, aspect) };
  }

  private fitDistance(w: number, h: number, aspect = this.camera.aspect): number {
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    return Math.max(w / 2 / Math.tan(hfov / 2), h / 2 / Math.tan(vfov / 2));
  }

  private applyPose(a: Pose, b: Pose | null, t: number, cam = this.camera) {
    const target = b ? a.target.clone().lerp(b.target, t) : a.target;
    const elev = b ? a.elev + (b.elev - a.elev) * t : a.elev;
    const dist = b ? a.dist + (b.dist - a.dist) * t : a.dist;
    cam.position.set(target.x, target.y + Math.sin(elev) * dist, target.z + Math.cos(elev) * dist);
    cam.lookAt(target);
  }

  // ---- 公開API ----

  setQuality(q: QualityLevel): void {
    if (q === this.quality) return;
    this.quality = q;
    this.gl.setPixelRatio(this.pixelRatio());
    this.gl.setSize(this.width, this.height, false);
    this.runKey = '';
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.gl.setPixelRatio(this.pixelRatio());
    this.gl.setSize(this.width, this.height, false);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  /** 直近フレームの平均描画時間（ミリ秒）。自動画質の判定用 */
  averageFrameMs(): number {
    if (this.frameTimes.length < 30) return 0;
    return this.frameTimes.reduce((a, c) => a + c, 0) / this.frameTimes.length;
  }

  render(view: RenderView): void {
    if (this.lost || this.fatal) return;
    try {
      this.renderInner(view);
    } catch (e) {
      this.fatal = true;
      console.error('[render3d] fatal', e);
      this.cb.onFatal?.(e instanceof Error ? e.message : String(e));
    }
  }

  private renderInner(view: RenderView) {
    const start = performance.now();
    this.ensureRun(view.egg, view.shape);
    this.setOil(view.oil, view.amount);
    const dt = this.lastTime < 0 ? 0 : Math.min(0.1, Math.max(0, view.time - this.lastTime));
    this.lastTime = view.time;
    if (!view.paused) this.animClock += dt;
    const t = this.animClock;
    const phase = view.phase;
    const cook = view.cook;
    const rm = view.reducedMotion;
    const shape = view.shape;

    const inCrack = phase === 'crackReady' || phase === 'cracked';
    const dropT = phase === 'drop' ? clamp01((view.phaseTime * 1000) / DROP_MS) : phase === 'crackReady' || phase === 'cracked' ? 0 : 1;
    const plateT = phase === 'plating' ? clamp01((view.phaseTime * 1000) / PLATING_MS) : phase === 'done' ? 1 : 0;

    // 殻
    this.shellGroup.visible = inCrack || (phase === 'drop' && dropT < 0.95);
    this.tapRing.visible = inCrack || (phase === 'drop' && dropT < 0.4);
    this.tapRingMat.opacity = (0.3 + 0.3 * Math.sin(t * 3)) * (phase === 'drop' ? 1 - dropT / 0.4 : 1);
    this.tapRing.scale.setScalar(view.egg.visualScale * (1 + 0.1 * Math.sin(t * 3)));
    if (this.shellGroup.visible) {
      this.updateShellTexture(view.egg, shape.seed, phase !== 'crackReady');
      const bob = rm ? 0 : Math.sin(t * 2) * 0.25;
      this.shellGroup.position.set(0, EGG_HOVER_Y + bob, EGG_HOVER_Z);
      const shake = phase === 'cracked' && !rm ? Math.sin(view.phaseTime * 55) * Math.max(0, 0.28 - view.phaseTime) * 0.35 : 0;
      this.shellGroup.rotation.set(0.5, rm ? 0 : Math.sin(t * 0.7) * 0.1, -0.62 + shake);
      const splitting = phase === 'drop';
      this.wholeEgg.visible = !splitting;
      this.halfA.visible = this.halfB.visible = splitting;
      if (splitting) {
        const open = easeOut(clamp01((dropT - 0.08) / 0.45));
        const fade = 1 - clamp01((dropT - 0.55) / 0.35);
        this.halfA.position.set(-open * 0.12, -open * 0.32, 0);
        this.halfA.rotation.set(0, 0, -open * 1.1);
        this.halfB.position.set(open * 0.12, open * 0.32, 0);
        this.halfB.rotation.set(0, 0, open * 1.1);
        this.shellMat.opacity = this.shellInnerMat.opacity = fade;
        this.shellGroup.position.y += open * 1.2;
      } else {
        this.shellMat.opacity = this.shellInnerMat.opacity = 1;
      }
    }

    // 浮いている卵の影
    const shadowVis = this.shellGroup.visible ? (phase === 'drop' ? 1 - dropT : 1) : 0;
    this.eggShadow.visible = shadowVis > 0.01;
    if (this.eggShadow.visible) {
      const sc = 4.6 * view.egg.visualScale;
      this.eggShadow.position.set(0.5, 0.03, EGG_HOVER_Z + 0.2);
      this.eggShadow.scale.set(sc * 1.25, sc * 0.8, 1);
      this.eggShadowMat.opacity = 0.42 * shadowVis;
    }

    // 中身
    const showContents = phase === 'cooking' || phase === 'plating' || phase === 'done' || (phase === 'drop' && dropT > 0.14);
    this.eggGroup.visible = showContents;
    if (showContents) {
      if (phase === 'drop') {
        const fall = clamp01((dropT - 0.14) / 0.36);
        const spread = dropT < 0.5 ? 0.22 : 0.22 + 0.78 * easeOut(clamp01((dropT - 0.5) / 0.5));
        this.eggGroup.position.set(0, (EGG_HOVER_Y - 0.5) * (1 - fall * fall), EGG_HOVER_Z * (1 - fall));
        const squash = rm ? 1 : 1 - 0.18 * Math.sin(Math.PI * clamp01((dropT - 0.5) / 0.5));
        this.eggGroup.scale.set(spread, Math.max(0.3, spread) * squash + (1 - spread) * 0.6, spread);
        this.applyCookLook(0, 0, 0, 0, false, t);
      } else {
        const e = rm ? plateT : easeInOut(plateT);
        const target = new THREE.Vector3(PLATE_POS.x, PLATE_TOP + 0.02, PLATE_POS.z);
        this.eggGroup.position.set(target.x * e, target.y * e + (rm ? 0 : Math.sin(Math.PI * e) * 7), target.z * e);
        this.eggGroup.scale.set(1, 1, 1);
        this.eggGroup.rotation.y = e * 0.3;
        this.applyCookLook(cook.W, cook.Y, cook.B, cook.D, phase === 'done', t, cook.wet, cook.F);
        // 黄身のゆれ（固まるほど小さく）
        if (!rm && phase === 'cooking') {
          const wob = 0.012 * (1 - cook.Y) * cook.T * Math.sin(t * 13);
          this.yolkMesh.scale.y = shape.yolkRadius * YOLK_DOME * (1 + wob);
        } else {
          this.yolkMesh.scale.y = shape.yolkRadius * YOLK_DOME;
        }
      }
    }
    this.updateBubbles(phase === 'cooking' && !view.paused && !rm, cook.T, cook.W, t, cook.S);
    // 油だまり（白身の外側にのぞく）
    this.oilPool.visible = phase !== 'idle';
    const poolR = shape.whiteRadius * this.oilLook.radius;
    this.oilPool.scale.set(poolR, poolR, 1);
    this.oilPoolMat.opacity = this.oilLook.opacity * (phase === 'crackReady' || phase === 'cracked' ? 0.7 : 1);

    // ふた
    const lidTarget = phase === 'cooking' && cook.lidClosed ? 1 : 0;
    if (rm) this.lidAnim = lidTarget;
    else if (!view.paused) this.lidAnim = lidTarget > this.lidAnim ? Math.min(1, this.lidAnim + dt / 0.3) : Math.max(0, this.lidAnim - dt / 0.3);
    this.lidGroup.visible = this.lidAnim > 0.001;
    if (this.lidGroup.visible) {
      const ease = easeOut(this.lidAnim);
      this.lidGroup.position.y = (1 - ease) * 16;
      // 蒸し焼き中はガラスが少し曇る（卵は見える程度まで）
      const fog = cook.lidClosed ? Math.min(0.2, smoothstep(0.3, 1, cook.T) * 0.12 + cook.S * 0.16) : 0;
      this.lidGlassMat.opacity = (0.14 + fog) * ease;
    }

    // 湯気
    if (phase === 'cooking' && !view.paused) {
      const amount = smoothstep(0.35, 0.75, cook.T) * (0.35 + 0.65 * Math.min(1, cook.W * 1.4)) + cook.S * 1.1;
      const burst = cook.S > 0.9 && this.lastSteamS < 0.5 ? (rm ? 2 : 6) : 0;
      this.lastSteamS = cook.S;
      this.updateSteam(t, dt, amount, cook.lidClosed, rm, burst);
    } else if (phase !== 'cooking') {
      this.lastSteamS = 0;
      this.hideSteam();
    }

    // カメラ
    const panPose = this.panPose(view.egg.visualScale);
    if (plateT > 0) this.applyPose(panPose, this.platePose(), rm ? plateT : easeInOut(plateT));
    else this.applyPose(panPose, null, 0);

    this.gl.render(this.scene, this.camera);
    this.frameTimes.push(performance.now() - start);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
  }

  snapshotPlate(cook: FinalCook, egg: EggConfig, shape: EggShape, width: number, height: number, oil?: OilConfig): HTMLCanvasElement {
    if (this.lost || this.fatal) throw new Error('3D renderer unavailable');
    this.ensureRun(egg, shape);
    if (oil) this.surface?.setTone(oil.id);
    const prev = {
      pos: this.eggGroup.position.clone(),
      rotY: this.eggGroup.rotation.y,
      scale: this.eggGroup.scale.clone(),
      vis: this.eggGroup.visible,
      shell: this.shellGroup.visible,
      lid: this.lidGroup.visible,
      ring: this.tapRing.visible,
    };
    this.eggGroup.visible = true;
    this.eggGroup.position.set(PLATE_POS.x, PLATE_TOP + 0.02, PLATE_POS.z);
    this.eggGroup.rotation.y = 0.3;
    this.eggGroup.scale.set(1, 1, 1);
    this.yolkMesh.scale.set(shape.yolkRadius, shape.yolkRadius * YOLK_DOME, shape.yolkRadius);
    this.shellGroup.visible = false;
    this.lidGroup.visible = false;
    this.tapRing.visible = false;
    this.hideSteam();
    this.bubbleMesh.visible = this.oilMesh.visible = false;
    this.applyCookLook(cook.W, cook.Y, cook.B, cook.D, true, this.animClock, cook.wet ?? 0, cook.F ?? 0);

    const cam = this.camera.clone();
    cam.aspect = width / height;
    cam.updateProjectionMatrix();
    this.applyPose(this.platePose(width / height), null, 0, cam);
    const prevRatio = this.gl.getPixelRatio();
    this.gl.setPixelRatio(1);
    this.gl.setSize(width, height, false);
    this.gl.render(this.scene, cam);
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    out.getContext('2d')!.drawImage(this.canvas, 0, 0, width, height);
    // 元に戻す
    this.gl.setPixelRatio(prevRatio);
    this.gl.setSize(this.width, this.height, false);
    this.eggGroup.position.copy(prev.pos);
    this.eggGroup.rotation.y = prev.rotY;
    this.eggGroup.scale.copy(prev.scale);
    this.eggGroup.visible = prev.vis;
    this.shellGroup.visible = prev.shell;
    this.lidGroup.visible = prev.lid;
    this.tapRing.visible = prev.ring;
    return out;
  }

  /** テスト・検証用：意図的にコンテキストを失わせる */
  debugLoseContext(): boolean {
    const ext = this.gl.getContext().getExtension('WEBGL_lose_context');
    if (!ext) return false;
    ext.loseContext();
    setTimeout(() => ext.restoreContext(), 1200);
    return true;
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.whiteGeom?.dispose();
    this.whiteTex?.dispose();
    for (const d of this.disposables) d.dispose();
    this.gl.dispose();
    this.canvas.remove();
  }
}

function remapV(geom: THREE.BufferGeometry, from: number, to: number) {
  const uv = geom.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, from + uv.getY(i) * (to - from));
  uv.needsUpdate = true;
}

