// Cenas 3D da Home (bola e taça do Blender), extraídas do protótipo aprovado.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const loader = new GLTFLoader();
const webgl = (() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } })();

function makeStage(host, { fov = 30, dist = 4.2, rim = 0x5aa0ff }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.9;
  const key = new THREE.DirectionalLight(0xfff4e6, 2.4); key.position.set(3, 4, 5); scene.add(key);
  const back = new THREE.DirectionalLight(rim, 3.2); back.position.set(-4, 2, -3); scene.add(back);
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 100);
  camera.position.set(0, 0, dist);
  const fit = () => { const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  const ro = new ResizeObserver(fit); ro.observe(host); fit();
  let visible = true;
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }); io.observe(host);
  const dispose = () => { renderer.setAnimationLoop(null); ro.disconnect(); io.disconnect(); renderer.dispose(); pmrem.dispose(); renderer.domElement.remove(); };
  return { renderer, scene, camera, get visible() { return visible; }, dispose };
}

function normalize(root) {
  const box = new THREE.Box3().setFromObject(root);
  root.position.sub(box.getCenter(new THREE.Vector3()));
  const g = new THREE.Group(); g.add(root); g.scale.setScalar(1 / (box.getSize(new THREE.Vector3()).length() / 2));
  return g;
}

// Bola que gira sozinha e pode ser arrastada. Sem WebGL, mostra a imagem renderizada.
export function mountBall(host) {
  if (!webgl) { host.insertAdjacentHTML('beforeend', '<img src="assets/ball.png" alt="" style="width:100%;position:relative;z-index:1">'); return () => {}; }
  const st = makeStage(host, { fov: 28, dist: 4.6 });
  let alive = true;
  loader.load('assets/ball.glb', (gltf) => {
    if (!alive) return;
    const ball = normalize(gltf.scene); ball.scale.multiplyScalar(1.45); st.scene.add(ball);
    let vy = reduce ? 0 : 0.5, vx = 0, drag = null; const auto = reduce ? 0 : 0.5;
    host.onpointerdown = (e) => { drag = { x: e.clientX, y: e.clientY, t: performance.now() }; host.setPointerCapture(e.pointerId); };
    host.onpointermove = (e) => {
      if (!drag) return;
      const n = performance.now(), dt = Math.max(1, n - drag.t) / 1000;
      vy = (e.clientX - drag.x) * 0.072 / dt * 0.016; vx = (e.clientY - drag.y) * 0.072 / dt * 0.016;
      ball.rotation.y += (e.clientX - drag.x) * 0.012; ball.rotation.x += (e.clientY - drag.y) * 0.012;
      drag = { x: e.clientX, y: e.clientY, t: n };
    };
    host.onpointerup = host.onpointercancel = () => { drag = null; };
    const clock = new THREE.Clock();
    st.renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
      if (!st.visible) return;
      if (!drag) { ball.rotation.y += vy * dt; ball.rotation.x += vx * dt; vy += (auto - vy) * Math.min(1, dt * 1.2); vx *= 1 - Math.min(1, dt * 1.6); }
      if (!reduce) ball.position.y = Math.sin(t * 1.6) * 0.04;
      st.renderer.render(st.scene, st.camera);
    });
  });
  return () => { alive = false; st.dispose(); };
}

// Taça que sobe girando ao aparecer; replay() repete a revelação.
export function mountTrophy(host, burstEl) {
  if (!webgl) { host.insertAdjacentHTML('beforeend', '<img src="assets/trophy.png" alt="" style="width:100%">'); return { dispose() {}, replay() {} }; }
  const st = makeStage(host, { fov: 26, dist: 5.2, rim: 0xf6dc94 });
  st.camera.position.set(0, 0.55, 5.2); st.camera.lookAt(0, 0.05, 0);
  let alive = true, revealAt = -1, base = 1, trophy = null, seen = false;
  const clock = new THREE.Clock();
  const replay = () => { revealAt = clock.elapsedTime; if (burstEl) { burstEl.classList.remove('burst'); void burstEl.offsetWidth; burstEl.classList.add('burst'); } };
  const io = new IntersectionObserver(([e]) => { if (e.isIntersecting && !seen && trophy) { seen = true; replay(); } }, { threshold: 0.4 });
  io.observe(host);
  loader.load('assets/trophy.glb', (gltf) => {
    if (!alive) return;
    trophy = normalize(gltf.scene); trophy.scale.multiplyScalar(1.12); base = trophy.scale.x; st.scene.add(trophy);
    const ease = (x) => 1 - Math.pow(1 - x, 3); let spin = 0;
    st.renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
      if (!st.visible) return;
      let k = revealAt < 0 ? 0 : Math.min(1, (t - revealAt) / 1.6); if (reduce && revealAt >= 0) k = 1;
      const e = ease(k); spin += dt * (reduce ? 0 : 0.45);
      trophy.rotation.y = spin + (1 - e) * Math.PI * 2.5;
      trophy.position.y = (1 - e) * -0.9 + (reduce ? 0 : Math.sin(t * 1.3) * 0.03 * e);
      trophy.scale.setScalar(base * (0.55 + 0.45 * e));
      st.renderer.render(st.scene, st.camera);
    });
  });
  return { dispose() { alive = false; io.disconnect(); st.dispose(); }, replay };
}
