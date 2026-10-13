/**
 * Blocks, a Ghostly mini-app. The runner gives it `window.ghostly` (the broker, see src/vendor/miniApp.ts); opened
 * outside the runner in a dev server, it runs alone on a stand-in broker that keeps nothing.
 *
 * Looking around is by dragging: the runner's sandbox has no `allow-pointer-lock`, so the mouse is never captured.
 * The block under the cursor (or under the centre, for keys and touch) is the one acted on.
 */
import type { MiniAppApi, MiniAppContext } from "./vendor/miniApp.ts";
import { AIR, BLOCKS, PALETTE, WATER } from "./blocks.ts";
import { Core } from "./core.ts";
import { Player, EYE } from "./player.ts";
import { raycast, type Hit } from "./raycast.ts";
import { FOV, Renderer, type Ghost } from "./render/renderer.ts";
import { project, rayThrough, type Vec3 } from "./render/math.ts";
import { Sound } from "./sound.ts";
import { stringsFor } from "./strings.ts";
import type { Contact } from "./sync.ts";
import { inWorld, SIZE_X, SIZE_Y, SIZE_Z, spawnPoint } from "./terrain.ts";
import { Ui } from "./ui.ts";
import "./style.css";

/** Where the person stood, kept per chat so they come back to it. */
const ME_KEY = "me";
const LOOK = 0.0055;
const TURN = 2.2;

/** A broker that keeps nothing, for `vite` in a browser tab. */
function standIn(): MiniAppApi {
  const store = new Map<string, unknown>();
  return {
    context: async () => ({ version: "dev", inChat: false, peer: null }),
    file: async () => new ArrayBuffer(0),
    storage: {
      get: async (key) => store.get(key) as never,
      set: async (key, value) => void store.set(key, value),
      delete: async (key) => void store.delete(key),
      keys: async () => [...store.keys()],
    },
    chat: { send: async () => Promise.reject(new Error("not-allowed")), on: () => () => {} },
    close: async () => {},
  };
}

async function main(): Promise<void> {
  const host = document.getElementById("app")!;
  const api = (window as { ghostly?: MiniAppApi }).ghostly ?? standIn();
  let renderer: Renderer | null = null;
  let player: Player | null = null;
  let ghost: (Ghost & { target: Vec3; targetYaw: number }) | null = null;
  let ui: Ui | null = null;
  const sound = new Sound();
  let strings = stringsFor(undefined).strings;
  const contactName = (contact: Contact | null) => contact?.name ?? strings.yourContact;
  let lastContact: string | null = null;

  const showPeer = (state: string, contact: Contact | null) => {
    host.dataset.peer = state;
    if (!ui) return;
    if (state === "alone") ui.setStatus(strings.alone);
    else if (state === "waiting") ui.setStatus(strings.waiting);
    else ui.setStatus(strings.together(contactName(contact)));
  };

  // Made before anything is awaited: it hears the contact from the start.
  const core = new Core(api, {
    onBlock: (cell) => {
      const x = cell % SIZE_X;
      const z = Math.floor(cell / SIZE_X) % SIZE_Z;
      const y = Math.floor(cell / (SIZE_X * SIZE_Z));
      renderer?.markCell(x, y, z);
    },
    onWorld: (id) => {
      renderer?.markAll();
      host.dataset.ground = core.world.groundHash.toString(16);
      host.dataset.seed = String(id.seed);
    },
    onPeer: (state, contact) => {
      showPeer(state, contact);
      if (state === "here" && lastContact === null) {
        lastContact = contactName(contact);
        ui?.notice(strings.contactCame(lastContact), 2500);
        sound.hello();
      } else if (state !== "here" && lastContact !== null) {
        ui?.notice(strings.contactLeft(lastContact));
        lastContact = null;
        ghost = null;
      }
    },
    onPose: (contact) => {
      if (!contact.pose) return;
      const [x, y, z, yaw] = contact.pose;
      if (!ghost) ghost = { at: [x, y, z], yaw, tint: [0.86, 0.84, 1], target: [x, y, z], targetYaw: yaw };
      ghost.target = [x, y, z];
      ghost.targetYaw = yaw;
    },
    onIncompatible: () => ui?.notice(strings.incompatible, 8000),
  });

  const context: MiniAppContext = await core.limiter.run(() => api.context());
  const dark = context.theme ? context.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const language = stringsFor(context.locale ?? navigator.language);
  strings = language.strings;
  document.documentElement.lang = language.lang;
  document.title = strings.title;

  let selected = 0;
  let placing = false;
  const held = { forward: false, back: false, left: false, right: false, jump: false, down: false };
  ui = new Ui(host, strings, {
    select: (i) => choose(i),
    newWorld: () => {
      void core.newWorld().then(() => respawn());
    },
    toggleSound: () => (sound.enabled = !sound.enabled),
    toggleFly: () => toggleFly(),
    toggleMode: () => {
      placing = !placing;
      ui!.setPlacing(placing);
    },
    hold: (key, down) => {
      held[key] = down;
      sound.wake();
    },
  });

  try {
    renderer = new Renderer(ui.canvas);
  } catch {
    ui.fatal(strings.noWebgl);
    host.dataset.state = "no-webgl";
    return;
  }

  await core.open(context);
  if (core.newer) {
    ui.fatal(strings.newer);
    host.dataset.state = "newer";
    return;
  }
  const world = core.world;
  let firstTime = false;
  const saved = await core.limiter.run(() => api.storage.get(ME_KEY)).catch(() => undefined);
  // A small step aside, at random: two people arriving together start next to each other, not inside each other.
  const aside = (): number => Math.floor(Math.random() * 7) - 3;
  const spawn = () => spawnPoint(world.cells, aside(), aside());
  player = new Player(spawn());
  if (Array.isArray(saved) && saved.length === 6 && saved.every((n) => typeof n === "number" && Number.isFinite(n))) {
    const [x, y, z, yaw, pitch, flying] = saved as number[];
    if (x >= 0 && z >= 0 && x <= SIZE_X && z <= SIZE_Z && y >= 0 && y <= SIZE_Y + 20) {
      Object.assign(player, { x, y, z, yaw, pitch: Math.max(-1.55, Math.min(1.55, pitch)), flying: flying === 1 });
    }
  } else {
    // The first time in this chat: how to play. Where the person stands is kept from now on, so it shows once.
    ui.showHelp(true);
    firstTime = true;
  }
  player.unstick(world);
  ui.setFlying(player.flying);
  showPeer(core.session.state, core.session.contact);

  function respawn(): void {
    if (!player) return;
    [player.x, player.y, player.z] = spawn();
    player.vx = player.vy = player.vz = 0;
  }

  function choose(i: number): void {
    selected = (i + PALETTE.length) % PALETTE.length;
    const kind = BLOCKS[PALETTE[selected]];
    ui!.select(selected, kind ? strings.blocks[kind.key] : "");
  }
  choose(0);

  function toggleFly(): void {
    player!.flying = !player!.flying;
    player!.vy = 0;
    ui!.setFlying(player!.flying);
  }

  // Where the person points: the cursor while a mouse is over the world, the centre otherwise.
  let aim: [number, number] | null = null;
  let pointed: Hit | null = null;

  function target(at: [number, number] | null): Hit | null {
    const rect = ui!.canvas.getBoundingClientRect();
    const ndcX = at ? ((at[0] - rect.left) / rect.width) * 2 - 1 : 0;
    const ndcY = at ? 1 - ((at[1] - rect.top) / rect.height) * 2 : 0;
    const dir = rayThrough(player!.yaw, player!.pitch, FOV, rect.width / Math.max(1, rect.height), ndcX, ndcY);
    return raycast(world, [player!.x, player!.y + EYE, player!.z], dir);
  }

  function act(place: boolean, at: [number, number] | null): void {
    sound.wake();
    const hit = target(at);
    if (!hit) return;
    if (place) {
      const [x, y, z] = hit.before;
      const block = PALETTE[selected];
      if (!inWorld(x, y, z)) return;
      if (BLOCKS[block]?.solid && player!.overlaps(x, y, z)) return;
      if (ghost && BLOCKS[block]?.solid && Math.abs(ghost.at[0] - (x + 0.5)) < 0.7 && Math.abs(ghost.at[2] - (z + 0.5)) < 0.7 && y >= Math.floor(ghost.at[1]) && y < ghost.at[1] + 1.5) return;
      if (core.place(x, y, z, block)) sound.place(BLOCKS[block]!.sound);
      else if (world.full) ui!.notice(strings.worldFull);
    } else {
      const [x, y, z] = hit.cell;
      const block = world.get(x, y, z);
      if (BLOCKS[block]?.fixed) return;
      if (core.place(x, y, z, AIR)) sound.breakBlock(BLOCKS[block]?.sound ?? "stone");
    }
  }

  // Pointer: drag to look; a click (or a tap) that did not drag acts.
  const canvas = ui.canvas;
  const pointers = new Map<number, { x: number; y: number; startX: number; startY: number; moved: boolean; button: number; type: string }>();
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    canvas.focus();
    sound.wake();
    ui!.closeMenus();
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false, button: e.button, type: e.pointerType });
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse") aim = [e.clientX, e.clientY];
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (!p.moved && Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > 6) p.moved = true;
    if (p.moved && [...pointers.keys()][0] === e.pointerId) {
      const k = p.type === "mouse" ? LOOK : LOOK * 1.4;
      player!.yaw -= dx * k;
      player!.pitch = Math.max(-1.55, Math.min(1.55, player!.pitch - dy * k));
    }
  });
  const release = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (!p || p.moved || e.type === "pointercancel") return;
    if (p.type === "mouse") act(p.button === 2, [e.clientX, e.clientY]);
    else act(placing, [e.clientX, e.clientY]);
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse") aim = null;
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    choose(selected + (e.deltaY > 0 ? 1 : -1));
  }, { passive: false });

  const keys = new Set<string>();
  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLButtonElement && (e.code === "Space" || e.code === "Enter")) return;
    sound.wake();
    if (e.code === "Escape") return ui!.closeMenus();
    if (ui!.menuOpen) return;
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if (e.repeat) return;
    const digit = /^Digit(\d)$/.exec(e.code);
    if (digit) choose(digit[1] === "0" ? 9 : Number(digit[1]) - 1);
    else if (e.code === "Minus") choose(10);
    else if (e.code === "Equal") choose(11);
    else if (e.code === "KeyF") toggleFly();
    else if (e.code === "KeyQ") act(false, null);
    else if (e.code === "KeyE") act(true, null);
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => {
    keys.clear();
    for (const k of Object.keys(held) as (keyof typeof held)[]) held[k] = false;
  });

  // Where the person stands is kept every few seconds and when the page goes.
  let savedPose = "";
  const savePose = () => {
    const p = player!;
    const value = [p.x, p.y, p.z, p.yaw, p.pitch, p.flying ? 1 : 0].map((n) => Math.round(n * 100) / 100);
    const text = JSON.stringify(value);
    if (text === savedPose) return;
    savedPose = text;
    void core.limiter.run(() => api.storage.set(ME_KEY, value)).catch(() => (savedPose = ""));
  };
  setInterval(savePose, 5000);
  if (firstTime) savePose();
  const leave = () => {
    savePose();
    void core.store.flush();
  };
  window.addEventListener("pagehide", leave);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && leave());

  let noticedFull = false;
  setInterval(() => {
    if (core.store.storageFull && !noticedFull) ui!.notice(strings.storageFull, 8000);
    if (core.store.failed && !noticedFull) ui!.notice(strings.storageFailed, 8000);
    noticedFull = core.store.storageFull || core.store.failed;
  }, 1000);

  renderer.markAll();
  renderer.rebuild(world, [player.x, player.y, player.z]);
  host.dataset.state = "ready";
  host.dataset.ground = world.groundHash.toString(16);
  host.dataset.edits = String(world.edits.size);

  let last = performance.now();
  let lastScene = "";
  let shownEdits = world.edits.size;
  let stepAt = 0;
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const p = player!;
    const down = (...codes: string[]) => codes.some((c) => keys.has(c));
    if (down("ArrowLeft")) p.yaw += TURN * dt;
    if (down("ArrowRight")) p.yaw -= TURN * dt;
    if (down("ArrowUp")) p.pitch = Math.min(1.55, p.pitch + TURN * 0.6 * dt);
    if (down("ArrowDown")) p.pitch = Math.max(-1.55, p.pitch - TURN * 0.6 * dt);
    const forward = (down("KeyW") || held.forward ? 1 : 0) - (down("KeyS") || held.back ? 1 : 0);
    const strafe = (down("KeyD") || held.right ? 1 : 0) - (down("KeyA") || held.left ? 1 : 0);
    p.update(world, { forward, strafe, jump: down("Space") || held.jump, down: down("ShiftLeft", "ShiftRight") || held.down }, dt);
    p.unstick(world);
    if (p.walked - stepAt > 2.1) {
      stepAt = p.walked;
      sound.step(BLOCKS[world.get(Math.floor(p.x), Math.floor(p.y - 0.1), Math.floor(p.z))]?.sound);
    }
    core.session.move([p.x, p.y, p.z, p.yaw, p.pitch]);

    const eye: Vec3 = [p.x, p.y + EYE, p.z];
    const rebuilt = renderer!.rebuild(world, eye, 8) > 0;
    // How many cells were changed, for the tests (and anyone curious with the inspector).
    if (world.edits.size !== shownEdits) host.dataset.edits = String((shownEdits = world.edits.size));
    pointed = target(aim);
    const ghosts: Ghost[] = [];
    if (ghost) {
      const k = 1 - Math.exp(-dt * 12);
      for (let i = 0; i < 3; i++) ghost.at[i] += (ghost.target[i] - ghost.at[i]) * k;
      let turn = ghost.targetYaw - ghost.yaw;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      ghost.yaw += turn * k;
      const bob = 0.12 + Math.sin(now / 400) * 0.06;
      // A ghost right where the camera is would fill the screen: it shows once it is a step away.
      const near = Math.hypot(ghost.at[0] - eye[0], ghost.at[1] + 1 - eye[1], ghost.at[2] - eye[2]) < 1.2;
      if (!near) ghosts.push({ at: [ghost.at[0], ghost.at[1] + bob, ghost.at[2]], yaw: ghost.yaw, tint: ghost.tint });
    }
    const underwater = world.get(Math.floor(eye[0]), Math.floor(eye[1]), Math.floor(eye[2])) === WATER;
    // Drawn only when something on screen changed: an idle world costs no GPU time (and no battery).
    const rect = canvas.getBoundingClientRect();
    const scene = JSON.stringify([eye.map((v) => v.toFixed(3)), p.yaw.toFixed(4), p.pitch.toFixed(4), ghosts.map((g) => [g.at.map((v) => v.toFixed(2)), g.yaw.toFixed(2)]), pointed?.cell, underwater, rect.width, rect.height, devicePixelRatio]);
    if (rebuilt || scene !== lastScene) renderer!.draw(eye, p.yaw, p.pitch, ghosts, pointed ? pointed.cell : null, underwater);
    lastScene = scene;
    if (ghost) {
      ui!.placeName(contactName(core.session.contact), project(renderer!.viewProjection, [ghost.at[0], ghost.at[1] + 1.95, ghost.at[2]], rect.width, rect.height));
    } else ui!.placeName("", null);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  canvas.focus();
}

void main();
