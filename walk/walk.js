// walk.js — free walking through the Hatzav house in its true 3D model (2026-11-17, Eliran: «I want a fully interactive 3D
// Walkaround visualization, not a 3D 360° panorama»). The plan-exact Blender model with its daylight and lamps baked into texture
// atlases (scripts/blender/walk_bake.py, adapted from the apt846 walk3d), so every step is drawn from where the visitor stands.
// Desktop: ↑/W walk · ↓/S back · ←/→ (A/D) turn · mouse drag looks · click the floor to walk there.
// Phone (no on-screen arrows, Eliran 2026-11-11): one finger drag — up walks, sideways turns; a tap on the floor walks there.
// The visitor stays on the free floor (walk-grid.png: walls and furniture kept clear) and slides along walls. Eye level 1.55 m;
// the look stays near eye level (Eliran 2026-11-17: a look tilted down reads as a security camera).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const EYE = 1.55, WALK = 1.3, BACK = 0.8, TURN = 80, STEP = 0.68, BOB = 0.018;
const phone = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
const $ = (id) => document.getElementById(id);
$('hint').innerHTML = phone
  ? 'גררו אצבע למעלה כדי ללכת · לצדדים כדי לפנות · הקישו על הרצפה כדי ללכת אליה'
  : 'חיצים / WASD: הליכה ופנייה · גרירה בעכבר: הסתכלות · לחיצה על הרצפה: הליכה אליה';
setTimeout(() => { $('hint').style.opacity = '0'; }, 9000);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, phone ? 1.75 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcfd6da);
new THREE.TextureLoader().load('./model/sky.jpg', (t) => { t.colorSpace = THREE.SRGBColorSpace; t.mapping = THREE.EquirectangularReflectionMapping; scene.background = t; });
// live light only for what is not baked (lawn, plants): the scene's sun, from the same direction as the bake
const SUN_AZ = THREE.MathUtils.degToRad(-142), SUN_EL = THREE.MathUtils.degToRad(22.5);
const hemi = new THREE.HemisphereLight(0xe9eef2, 0x6f6a58, 1.5); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 1.6);
sun.position.set(Math.cos(SUN_EL) * Math.cos(SUN_AZ) * 50, Math.sin(SUN_EL) * 50, Math.cos(SUN_EL) * Math.sin(SUN_AZ) * 50);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(phone ? 74 : 68, innerWidth / innerHeight, 0.05, 2000);
camera.rotation.order = 'YXZ';

// ---- the free floor (frame: u,v in cm = x*100, z*100)
const grid = await (await fetch('./walk-grid.json')).json();
const free = await new Promise((res) => {
  const im = new Image();
  im.onload = () => {
    const c = document.createElement('canvas'); c.width = grid.w; c.height = grid.h;
    const g = c.getContext('2d'); g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, grid.w, grid.h).data; const a = new Uint8Array(grid.w * grid.h);
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4] > 127 ? 1 : 0;
    res(a);
  };
  im.src = './walk-grid.png';
});
const ok = (xm, zm) => {
  const c = Math.round((xm * 100 - grid.x0) / grid.cell), r = Math.round((zm * 100 - grid.y0) / grid.cell);
  return r >= 0 && c >= 0 && r < grid.h && c < grid.w && free[r * grid.w + c] === 1;
};
const inPoly = (x, y, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > y) !== (p[j][1] > y) && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; return c; };
const roomAt = (xm, zm) => { const r = grid.rooms.find((q) => inPoly(xm * 100, zm * 100, q.loop)); return r ? r.he : ''; };

// ---- the house
const loader = new GLTFLoader();
const SKIN = new URLSearchParams(location.search).get('skin');   // a photo-skinned atlas set (project_photos.py) under ./<skin>/
loader.manager.setURLModifier((u) => (SKIN ? u.replace(/^(.*\/)?(bake_\d+)\.jpg$/, `./${SKIN}/$2.jpg`) : phone ? u.replace(/(bake_\d+)\.jpg$/, '$1_1k.jpg') : u));
const gltf = await loader.loadAsync('./model/walk.gltf', (e) => { if (e.total) $('prog').style.width = Math.round((100 * e.loaded) / e.total) + '%'; });
const floorMeshes = [];
function mixMat(map) {   // day-night-keyframes skill (mode B): MeshBasic whose map is mix(map, map2, uMix) — two lighting keyframes, linear light
  const mat = new THREE.MeshBasicMaterial({ map });
  // + the photo skin (project_photos.py): the realistic texture, re-lit by the hour = skin * (hour light / the light the skin was made in)
  mat.userData.u = { map2: { value: map }, uMix: { value: 0 }, skinMap: { value: map }, refMap: { value: map }, uSkin: { value: 0 } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, mat.userData.u);
    sh.fragmentShader = ['uniform sampler2D map2;', 'uniform float uMix;', 'uniform sampler2D skinMap;', 'uniform sampler2D refMap;', 'uniform float uSkin;',
      sh.fragmentShader.replace('#include <map_fragment>', [
      '#ifdef USE_MAP',
      ' vec4 sampledDiffuseColor = mix(texture2D(map, vMapUv), texture2D(map2, vMapUv), uMix);',
      ' if (uSkin > 0.5) { vec4 ref = texture2D(refMap, vMapUv); sampledDiffuseColor = texture2D(skinMap, vMapUv) * clamp(sampledDiffuseColor / max(ref, vec4(0.03)), 0.0, 3.0); }',
      ' diffuseColor *= sampledDiffuseColor;',
      '#endif'].join(String.fromCharCode(10)))].join(String.fromCharCode(10));
  };
  return mat;
}
gltf.scene.traverse((o) => {
  if (!o.isMesh) return;
  const m = o.material, n = (m && m.name) || '';
  if (n.startsWith('WALK_baked')) { o.material = mixMat(m.map); o.material.userData.group = +n.split('_').pop(); o.material.userData.proto = m.map; m.dispose(); floorMeshes.push(o); }
  else if (n === 'WALK_glass') { o.material = new THREE.MeshBasicMaterial({ color: 0xe4ecee, transparent: true, opacity: 0.08, depthWrite: false }); o.renderOrder = 2; }
  else if (/curtain/i.test(o.name) || /curtain|sheer/i.test(n)) { o.material = new THREE.MeshBasicMaterial({ color: 0xeeeae2, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false }); o.renderOrder = 3; }
  else if (/downlight_glow|lamp_shade/i.test(n)) { o.material = new THREE.MeshBasicMaterial({ color: 0xfff1dc }); }
  else if (/lawn/i.test(n)) { floorMeshes.push(o); }
  if (o.material && 'side' in o.material && !o.material.transparent) o.material.side = THREE.FrontSide;
});
scene.add(gltf.scene);
// the dry rooms' floor has its own atlas + a shading map (walk_bake.py), so items.js can swap the finish and keep the baked light
const floorCfg = await (await fetch('./model/floor.json').catch(() => null))?.json?.().catch(() => null) ?? null;
if (floorCfg) {
  const shade = await new THREE.TextureLoader().loadAsync(`./model/bake_${floorCfg.group}_shade.png`).catch(() => null);
  gltf.scene.traverse((o) => {
    if (!o.isMesh || !o.name.startsWith('WALK_floor')) return;
    o.material.userData.surface = 'floor';
    if (shade) { shade.channel = 0; shade.flipY = false; o.material.userData.light = shade; o.material.userData.lightIntensity = floorCfg.lightMapIntensity; o.material.userData.bakedMap = o.material.map; }
  });
}

// ---- the visitor
const me = { x: grid.start.x / 100, z: grid.start.y / 100, yaw: 0, pitch: -0.03, dist: 0, goal: null };
const setYaw = (deg) => { me.yaw = -Math.PI / 2 - THREE.MathUtils.degToRad(deg); };   // plan yaw (0 = +u, positive toward +v) -> camera yaw
setYaw(grid.start.yaw_deg);
const keys = new Set();
addEventListener('keydown', (e) => { const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; if (k.startsWith('Arrow') || 'wasd'.includes(k)) { keys.add(k); me.goal = null; e.preventDefault(); } });
addEventListener('keyup', (e) => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
addEventListener('blur', () => keys.clear());
let drag = null, walkIn = 0, turnIn = 0;
const cv = renderer.domElement;
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function floorAt(cx, cy) {   // the free floor point under a screen position, or null
  ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(floorMeshes, false).find((h) => h.point.y < 0.08 && h.face && h.face.normal.y > 0.5);
  const p = hit ? hit.point : null;
  if (!p) { const t = -camera.position.y / ray.ray.direction.y; if (!(t > 0) || t > 25) return null; return ray.ray.at(t, new THREE.Vector3()); }
  return p;
}
cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, id: e.pointerId, touch: e.pointerType !== 'mouse', t: performance.now(), moved: 0 }; cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.x, e.clientY - drag.y));
  if (drag.touch) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    walkIn = Math.abs(dy) < 14 ? 0 : THREE.MathUtils.clamp(-dy / 110, -1, 1);
    turnIn = Math.abs(dx) < 14 ? 0 : THREE.MathUtils.clamp(dx / 140, -1, 1);
    if (walkIn || turnIn) me.goal = null;
  } else {
    me.yaw -= (e.clientX - drag.lx) * 0.0042;
    me.pitch = THREE.MathUtils.clamp(me.pitch - (e.clientY - drag.ly) * 0.0035, -0.55, 0.45);
  }
  drag.lx = e.clientX; drag.ly = e.clientY;
});
const up = (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (drag.moved < 8 && performance.now() - drag.t < 400 && !(window.__walk?.tapOverride && window.__walk.tapOverride(e))) {   // a click / tap: walk to that floor point
    const p = floorAt(e.clientX, e.clientY);
    if (p && ok(p.x, p.z)) me.goal = { x: p.x, z: p.z };
  }
  drag = null; walkIn = 0; turnIn = 0;
};
cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

function move(dx, dz) {
  let nx = me.x, nz = me.z;
  if (ok(me.x + dx, me.z + dz)) { nx += dx; nz += dz; } else if (ok(me.x + dx, me.z)) nx += dx; else if (ok(me.x, me.z + dz)) nz += dz; else return false;
  me.dist += Math.hypot(nx - me.x, nz - me.z); me.x = nx; me.z = nz; return true;
}
function step(dt) {
  const fwd = (keys.has('ArrowUp') || keys.has('w') ? 1 : 0) - (keys.has('ArrowDown') || keys.has('s') ? 1 : 0) + walkIn;
  const turn = (keys.has('ArrowRight') || keys.has('d') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('a') ? 1 : 0) + turnIn;
  me.yaw -= THREE.MathUtils.degToRad(TURN) * THREE.MathUtils.clamp(turn, -1, 1) * dt;
  const f = THREE.MathUtils.clamp(fwd, -1, 1), v = (f >= 0 ? WALK : BACK) * f * dt;
  if (v) move(-Math.sin(me.yaw) * v, -Math.cos(me.yaw) * v);
  else if (me.goal) {   // walk to a clicked point: turn toward it while walking
    const gx = me.goal.x - me.x, gz = me.goal.z - me.z, d = Math.hypot(gx, gz);
    if (d < 0.06) me.goal = null;
    else {
      const want = Math.atan2(-gx, -gz); let dy = ((want - me.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      me.yaw += THREE.MathUtils.clamp(dy, -3 * dt, 3 * dt);
      const s = Math.min(d, WALK * dt * (Math.abs(dy) > 1.2 ? 0.3 : 1));
      if (!move((gx / d) * s, (gz / d) * s)) me.goal = null;
    }
  }
  const ph = (me.dist / STEP) * Math.PI;
  camera.position.set(me.x, EYE + Math.abs(Math.sin(ph)) * BOB - BOB / 2, me.z);
  camera.rotation.set(me.pitch, me.yaw, Math.sin(ph) * 0.003);
}

// ---- named places
const NAMES = { entrance: 'כניסה', living: 'סלון', kitchen: 'מטבח', dining: 'פינת אוכל', hall: 'מבואה', bedroom: 'חדר שינה', saferoom: 'ממ"ד', bath: 'חדר רחצה', deck: 'דק', garden: 'גינה' };
const goTo = (k) => {   // the room strip and the room capsule (items.js) jump here
  const [u, v, yaw] = grid.views[k];
  $('fade').style.opacity = '1';
  setTimeout(() => { me.x = u / 100; me.z = v / 100; setYaw(yaw); me.pitch = -0.03; me.goal = null; $('fade').style.opacity = '0'; }, 280);
};
let last = performance.now(), roomShown = '';
const hooks = [];
const overlay = new THREE.Scene();   // movable pieces: no sun or sky on them, only the captured room (items.js envFor)   // features (items.js) run here each frame, after the step and before the draw
renderer.setAnimationLoop((t) => {
  const dt = Math.min(0.05, (t - last) / 1000); last = t; step(dt);
  for (const h of hooks) h(dt);
  renderer.render(scene, camera);
  if (overlay.children.length) { renderer.autoClear = false; renderer.render(overlay, camera); renderer.autoClear = true; }   // the AI pieces: lit only by the room they stand in (items.js), depth shared
  const r = roomAt(me.x, me.z); if (r !== roomShown) { roomShown = r; if (r) $('room').textContent = r; window.__walk?.onRoom?.(r); }
});
const baked = [];
gltf.scene.traverse((o) => { if (o.isMesh && o.material && o.material.isMeshBasicMaterial && o.material.map) baked.push(o.material); });
window.__walk = { THREE, me, ok, scene, renderer, camera, grid, setYaw, roomAt, floorMeshes, shell: gltf.scene, baked, hooks, loader, NAMES, goTo, hemi, sun, phone, overlay,
  tapOverride: null, ready: true, info: () => renderer.info.render };
dispatchEvent(new Event('walk-ready'));
$('load').classList.add('hidden');
