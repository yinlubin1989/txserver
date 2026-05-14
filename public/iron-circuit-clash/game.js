import { ACTIONS, BattleGame, WORLD, clamp, createInputState } from "./engine.mjs";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const announcer = document.getElementById("announcer");
const startButton = document.getElementById("startButton");
const resetButton = document.getElementById("resetButton");
const muteButton = document.getElementById("muteButton");
const lobbyPanel = document.getElementById("lobbyPanel");
const connectionStatus = document.getElementById("connectionStatus");
const lobbyMessage = document.getElementById("lobbyMessage");
const practiceButton = document.getElementById("practiceButton");
const createRoomButton = document.getElementById("createRoomButton");
const refreshRoomsButton = document.getElementById("refreshRoomsButton");
const roomList = document.getElementById("roomList");
const matchStatus = document.getElementById("matchStatus");

const P1_CONTROLS = {
  left: ["KeyA"],
  right: ["KeyD"],
  up: ["KeyW"],
  down: ["KeyS"],
  block: ["Space"],
  punch: ["KeyJ"],
  kick: ["KeyK"],
  special: ["KeyL"],
};

const P2_CONTROLS = {
  left: ["ArrowLeft"],
  right: ["ArrowRight"],
  up: ["ArrowUp"],
  down: ["ArrowDown"],
  block: ["Enter", "ShiftRight"],
  punch: ["Numpad1", "Comma", "Digit1"],
  kick: ["Numpad2", "Period", "Digit2"],
  special: ["Numpad3", "Slash", "Digit3"],
};

const BLOCKED_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"]);
const p2ControlCodes = new Set(Object.values(P2_CONTROLS).flat());
const keys = new Set();
const justPressed = new Set();
const touchHeld = new Set();
const touchPressed = new Set();
const touchPulseUntil = new Map();
const pulseTouchActions = new Set(["left", "right", "down"]);
const TOUCH_HOLD_PULSE_MS = 220;
const TOUCH_TAP_PULSE_MS = 620;

let audioContext = null;
let muted = false;
let announcementTimer = null;
let mode = "lobby";
let socket = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let currentRoom = null;
let currentSeat = null;
let lastSentInput = "";
let lastInputSentAt = 0;
let connectionState = "connecting";

const offlineGame = new BattleGame({ online: false });
let latestSnapshot = offlineGame.consumeSnapshot();
latestSnapshot.events = [];

const LOBBY_DEFAULT_MESSAGE = "创建房间，或加入一个等待中的对手。";
const CONNECTION_LABELS = {
  connecting: "连接中",
  online: "联机可用",
  offline: "联机断开",
};

function initAudio() {
  if (!audioContext && !muted) {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (AudioCtor) audioContext = new AudioCtor();
  }
}

function beep(type) {
  if (muted || !audioContext) return;

  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const now = audioContext.currentTime;
  const settings = {
    hit: [120, 0.08, "square", 0.08],
    block: [240, 0.04, "triangle", 0.04],
    start: [460, 0.08, "sawtooth", 0.035],
    win: [520, 0.2, "square", 0.045],
    super: [90, 0.22, "sawtooth", 0.07],
  }[type] || [180, 0.05, "square", 0.04];

  osc.type = settings[2];
  osc.frequency.setValueAtTime(settings[0], now);
  osc.frequency.exponentialRampToValueAtTime(settings[0] * 1.8, now + settings[1]);
  gain.gain.setValueAtTime(settings[3], now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + settings[1]);
  osc.connect(gain).connect(audioContext.destination);
  osc.start(now);
  osc.stop(now + settings[1] + 0.02);
}

function hasAny(codeList, source) {
  return codeList.some((code) => source.has(code));
}

function hasTouchPulse(action) {
  return (touchPulseUntil.get(action) || 0) > performance.now();
}

function pulseTouch(action, duration = TOUCH_HOLD_PULSE_MS) {
  touchPressed.add(action);
  if (pulseTouchActions.has(action)) {
    touchPulseUntil.set(action, performance.now() + duration);
  }
}

function makeHumanInput(controls, includeTouch = false) {
  const input = createInputState();
  for (const action of ACTIONS) {
    input.hold[action] = hasAny(controls[action] || [], keys) || (includeTouch && (touchHeld.has(action) || hasTouchPulse(action)));
    input.press[action] = hasAny(controls[action] || [], justPressed) || (includeTouch && touchPressed.has(action));
  }
  return input;
}

function connectSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${window.location.host}/ws/iron-circuit-clash`);
  setConnectionStatus("connecting");

  socket.addEventListener("open", () => {
    reconnectAttempts = 0;
    setConnectionStatus("online");
    sendSocket({ type: "hello", name: "玩家" });
    sendSocket({ type: "listRooms" });
  });

  socket.addEventListener("message", (event) => {
    let message = null;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    handleServerMessage(message);
  });

  socket.addEventListener("close", () => {
    setConnectionStatus("offline");
    if (mode === "online" || currentRoom) {
      currentRoom = null;
      currentSeat = null;
      mode = "lobby";
      showLobby("连接已断开，仍可进入单机练习。");
    }
    scheduleReconnect();
  });

  socket.addEventListener("error", () => {
    setConnectionStatus("offline");
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = Math.min(5000, 800 + reconnectAttempts * 600);
  reconnectAttempts += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connectSocket();
  }, delay);
}

function sendSocket(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
}

function handleServerMessage(message) {
  switch (message.type) {
    case "welcome":
      sendSocket({ type: "listRooms" });
      break;
    case "rooms":
      renderRooms(message.rooms || []);
      break;
    case "roomJoined":
      currentRoom = message.room;
      currentSeat = message.seat;
      mode = "lobby";
      showLobby(currentSeat === 1 ? `你已创建 ${currentRoom.name}，等待对手加入。` : `你已加入 ${currentRoom.name}。`);
      renderRoomControls();
      break;
    case "matchStart":
      currentRoom = message.room || currentRoom;
      mode = "online";
      latestSnapshot = message.snapshot || latestSnapshot;
      lastSentInput = "";
      lastInputSentAt = 0;
      hideLobby();
      processEvents(latestSnapshot.events);
      updateDeckStatus();
      break;
    case "state":
      if (mode === "online") {
        latestSnapshot = message.snapshot;
        processEvents(latestSnapshot.events);
      }
      break;
    case "matchEnd":
      mode = "lobby";
      currentRoom = null;
      currentSeat = null;
      showAnnouncement(message.message || "对局结束", true);
      showLobby(message.message || "对局结束。");
      renderRoomControls();
      sendSocket({ type: "listRooms" });
      break;
    case "error":
      showLobby(message.message || "网络错误。");
      break;
    default:
      break;
  }
}

function startOfflinePractice() {
  initAudio();
  sendSocket({ type: "leaveRoom" });
  currentRoom = null;
  currentSeat = null;
  mode = "offline";
  offlineGame.resetMatch();
  latestSnapshot = offlineGame.consumeSnapshot();
  processEvents(latestSnapshot.events);
  hideLobby();
  updateDeckStatus();
}

function showLobby(message) {
  mode = mode === "online" ? "lobby" : mode;
  lobbyPanel.classList.remove("is-hidden");
  lobbyMessage.textContent = message || LOBBY_DEFAULT_MESSAGE;
  renderRoomControls();
  updateDeckStatus();
}

function hideLobby() {
  lobbyPanel.classList.add("is-hidden");
  updateDeckStatus();
}

function setConnectionStatus(state) {
  connectionState = state;
  connectionStatus.textContent = CONNECTION_LABELS[state] || state;
  refreshRoomsButton.disabled = state !== "online";
  if (!currentRoom) createRoomButton.disabled = state !== "online";
}

function renderRoomControls() {
  const inWaitingRoom = currentRoom && mode !== "online";
  createRoomButton.textContent = inWaitingRoom ? "离开房间" : "创建房间";
  createRoomButton.disabled = connectionState !== "online" && !inWaitingRoom;
}

function renderRooms(rooms) {
  if (!rooms.length) {
    roomList.innerHTML = '<div class="room-empty">暂无等待中的房间。创建一个房间等待对手加入。</div>';
    renderRoomControls();
    return;
  }

  roomList.innerHTML = rooms
    .map((room) => {
      const joinable = room.status === "waiting" && room.players < room.capacity && (!currentRoom || currentRoom.id !== room.id);
      const label = room.status === "waiting" ? "等待中" : "对战中";
      return `
        <div class="room-row">
          <div>
            <div class="room-title">${escapeHtml(room.name)}</div>
            <div class="room-meta">${room.players}/${room.capacity} 人</div>
          </div>
          <div class="room-badge">${label}</div>
          <button type="button" data-room-id="${escapeHtml(room.id)}" ${joinable ? "" : "disabled"}>加入</button>
        </div>
      `;
    })
    .join("");
  renderRoomControls();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function maybeSendInput(now) {
  const input = makeHumanInput(P1_CONTROLS, true);
  const serialized = JSON.stringify(input);
  if (serialized !== lastSentInput || now - lastInputSentAt > 80) {
    sendSocket({ type: "input", input });
    lastSentInput = serialized;
    lastInputSentAt = now;
  }
}

function processEvents(events = []) {
  for (const event of events) {
    if (event.type === "announce") showAnnouncement(event.text, event.show);
    if (event.type === "sound") beep(event.name);
  }
}

function showAnnouncement(text, show) {
  announcer.textContent = text;
  announcer.classList.toggle("is-visible", show);
  window.clearTimeout(announcementTimer);
  if (show) {
    announcementTimer = window.setTimeout(() => {
      announcer.classList.remove("is-visible");
    }, 940);
  }
}

function updateDeckStatus() {
  if (mode === "online") {
    matchStatus.textContent = currentSeat === 1 ? "联机一号" : "联机二号";
    startButton.textContent = "对战中";
    return;
  }

  if (mode === "offline") {
    matchStatus.textContent = "单机练习";
    startButton.textContent = latestSnapshot.matchOver ? "再来一局" : latestSnapshot.paused ? "继续" : "暂停";
    return;
  }

  matchStatus.textContent = currentRoom ? "等待中" : "大厅";
  startButton.textContent = "开始";
}

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = WORLD.width * dpr;
  canvas.height = WORLD.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

let lastTime = performance.now();
function frame(now) {
  const dt = Math.min(0.032, (now - lastTime) / 1000);
  lastTime = now;

  if (mode === "offline") {
    if (justPressed.has("KeyR")) offlineGame.resetMatch();
    if (justPressed.has("KeyP")) offlineGame.togglePaused();

    const p1Input = makeHumanInput(P1_CONTROLS, true);
    const p2Input = makeHumanInput(P2_CONTROLS, false);
    offlineGame.update(dt, p1Input, p2Input);
    latestSnapshot = offlineGame.consumeSnapshot();
    processEvents(latestSnapshot.events);
  } else if (mode === "online") {
    if (justPressed.has("KeyR")) sendSocket({ type: "restart" });
    maybeSendInput(now);
  }

  drawGame(latestSnapshot);
  justPressed.clear();
  touchPressed.clear();
  updateDeckStatus();
  requestAnimationFrame(frame);
}

function drawGame(gameState) {
  ctx.save();
  if (gameState.cameraShake > 0) {
    ctx.translate((Math.random() - 0.5) * gameState.cameraShake, (Math.random() - 0.5) * gameState.cameraShake);
  }
  drawStage(ctx, gameState.timer);
  gameState.projectiles.forEach((projectile) => drawProjectile(ctx, projectile));
  drawFighter(ctx, gameState.p1);
  drawFighter(ctx, gameState.p2);
  gameState.particles.forEach((particle) => drawParticle(ctx, particle));
  ctx.restore();

  if (gameState.flash > 0) {
    ctx.save();
    ctx.globalAlpha = gameState.flash * 1.8;
    ctx.fillStyle = "#fff2b8";
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    ctx.restore();
  }

  drawHud(ctx, gameState);

  if (gameState.paused) {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    ctx.fillStyle = "#f6ead0";
    ctx.font = "72px Impact, Haettenschweiler, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("已暂停", WORLD.width / 2, WORLD.height / 2);
    ctx.restore();
  }
}

function roundRect(context, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + w, y, x + w, y + h, radius);
  context.arcTo(x + w, y + h, x, y + h, radius);
  context.arcTo(x, y + h, x, y, radius);
  context.arcTo(x, y, x + w, y, radius);
  context.closePath();
}

function drawStage(context, timer) {
  const sky = context.createLinearGradient(0, 0, 0, WORLD.height);
  sky.addColorStop(0, "#140d11");
  sky.addColorStop(0.36, "#1b1512");
  sky.addColorStop(0.68, "#402017");
  sky.addColorStop(1, "#0b0806");
  context.fillStyle = sky;
  context.fillRect(0, 0, WORLD.width, WORLD.height);

  context.save();
  context.globalAlpha = 0.34;
  for (let i = 0; i < 38; i += 1) {
    const x = (i * 73 + (timer * 8) % 73) % WORLD.width;
    const h = 120 + ((i * 47) % 160);
    context.fillStyle = i % 3 === 0 ? "#1d3936" : "#1c1716";
    context.fillRect(x, WORLD.floor - 220 - h * 0.22, 46, h);
    context.fillStyle = i % 4 === 0 ? "#d29647" : "#3fb3a6";
    for (let y = WORLD.floor - 190; y > WORLD.floor - 220 - h * 0.22; y -= 24) {
      if ((i + y) % 3 === 0) context.fillRect(x + 10, y, 8, 7);
      if ((i + y) % 4 === 0) context.fillRect(x + 28, y + 4, 8, 7);
    }
  }
  context.restore();

  context.save();
  context.globalAlpha = 0.85;
  drawNeonSign(context, 112, 150, "全天", "#f0b64f");
  drawNeonSign(context, 1015, 176, "对决", "#42cab8");
  drawNeonSign(context, 555, 118, "钢铁", "#c7352d");
  context.restore();

  context.save();
  context.strokeStyle = "rgba(246, 234, 208, 0.15)";
  context.lineWidth = 2;
  for (let i = 0; i < 9; i += 1) {
    const y = WORLD.floor - 22 + i * 16;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(WORLD.width, y + i * 8);
    context.stroke();
  }
  for (let i = -10; i < 18; i += 1) {
    context.beginPath();
    context.moveTo(WORLD.width / 2 + i * 82, WORLD.floor - 22);
    context.lineTo(WORLD.width / 2 + i * 180, WORLD.height);
    context.stroke();
  }
  context.restore();

  const floorGradient = context.createLinearGradient(0, WORLD.floor - 46, 0, WORLD.height);
  floorGradient.addColorStop(0, "#403020");
  floorGradient.addColorStop(0.15, "#20120e");
  floorGradient.addColorStop(1, "#070504");
  context.fillStyle = floorGradient;
  context.fillRect(0, WORLD.floor - 28, WORLD.width, WORLD.height - WORLD.floor + 28);

  context.fillStyle = "rgba(240, 182, 79, 0.36)";
  context.fillRect(0, WORLD.floor - 30, WORLD.width, 4);
  context.fillStyle = "rgba(66, 202, 184, 0.28)";
  context.fillRect(0, WORLD.floor - 20, WORLD.width, 2);
}

function drawNeonSign(context, x, y, text, color) {
  context.save();
  context.strokeStyle = color;
  context.fillStyle = "rgba(0,0,0,0.45)";
  context.shadowColor = color;
  context.shadowBlur = 18;
  context.lineWidth = 3;
  roundRect(context, x - 20, y - 42, 122, 64, 4);
  context.fill();
  context.stroke();
  context.font = "34px Impact, Haettenschweiler, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#fff4ce";
  context.fillText(text, x + 41, y - 10);
  context.restore();
}

function drawFighter(context, fighter) {
  const bob = Math.sin(fighter.anim * 7) * (fighter.state === "idle" ? 3 : 1);
  const walk = Math.sin(fighter.anim * 13);
  const crouch = fighter.state === "crouch" || fighter.state === "blockLow";
  const guardingPose = fighter.state === "block" || fighter.state === "blockLow" || fighter.state === "backGuard";
  const hurtLean = fighter.state === "hit" ? -fighter.facing * 13 : 0;
  const attackProgress = fighter.attack ? fighter.attack.elapsed / fighter.attack.duration : 0;

  context.save();
  context.translate(fighter.x, fighter.y);
  context.scale(fighter.facing, 1);

  context.save();
  context.globalAlpha = 0.24;
  context.fillStyle = "#000";
  context.beginPath();
  context.ellipse(0, 6, 58, 14, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();

  context.translate(0, crouch ? 28 : bob);
  context.rotate((hurtLean * Math.PI) / 360);

  if (fighter.guardFlash > 0 || guardingPose) {
    context.save();
    context.globalAlpha = fighter.guardFlash > 0 ? 0.38 : 0.2;
    context.strokeStyle = fighter.glow;
    context.lineWidth = fighter.guardFlash > 0 ? 6 : 4;
    context.beginPath();
    context.arc(16, -92, 62, -1.15, 1.15);
    context.stroke();
    context.restore();
  }

  if (fighter.superFlash > 0) {
    context.save();
    context.globalAlpha = 0.5 + Math.sin(fighter.anim * 80) * 0.2;
    context.strokeStyle = "#fff6c9";
    context.lineWidth = 5;
    context.beginPath();
    context.arc(0, -98, 76 + fighter.superFlash * 50, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  const torsoY = crouch ? -86 : -108;
  const headY = crouch ? -142 : -174;
  const legY = crouch ? -56 : -58;
  const armReach = fighter.attack && fighter.attack.kind === "punch" && attackProgress > 0.18 && attackProgress < 0.62 ? 45 : 0;
  const kickReach = fighter.attack && fighter.attack.kind === "kick" && attackProgress > 0.2 && attackProgress < 0.68 ? 54 : 0;
  const heavyReach =
    fighter.attack && (fighter.attack.kind === "elbow" || fighter.attack.kind === "super") && attackProgress > 0.22 && attackProgress < 0.66
      ? 58
      : 0;
  const charging = fighter.attack && (fighter.attack.kind === "wave" || fighter.attack.kind === "super");

  context.lineCap = "round";
  context.lineJoin = "round";

  context.strokeStyle = fighter.dark;
  context.lineWidth = 18;
  context.beginPath();
  context.moveTo(-19, legY);
  context.lineTo(-32 - walk * 8, -16);
  context.moveTo(19, legY);
  context.lineTo(33 + walk * 8 + kickReach, -18 - kickReach * 0.15);
  context.stroke();

  context.strokeStyle = fighter.color;
  context.lineWidth = 10;
  context.beginPath();
  context.moveTo(-19, legY);
  context.lineTo(-32 - walk * 8, -16);
  context.moveTo(19, legY);
  context.lineTo(33 + walk * 8 + kickReach, -18 - kickReach * 0.15);
  context.stroke();

  context.fillStyle = fighter.dark;
  roundRect(context, -34, torsoY - 36, 68, crouch ? 70 : 86, 8);
  context.fill();
  context.fillStyle = fighter.color;
  roundRect(context, -28, torsoY - 33, 56, crouch ? 63 : 78, 7);
  context.fill();

  context.fillStyle = fighter.accent;
  context.fillRect(-28, torsoY - 7, 56, 8);
  context.fillRect(-18, torsoY - 31, 36, 7);

  context.strokeStyle = fighter.dark;
  context.lineWidth = 15;
  context.beginPath();
  context.moveTo(-27, torsoY - 24);
  context.lineTo(-62, torsoY + 11);
  context.moveTo(27, torsoY - 25);
  context.lineTo(66 + armReach + heavyReach, torsoY - 25 + (charging ? Math.sin(fighter.anim * 35) * 4 : 0));
  context.stroke();

  context.strokeStyle = fighter.color;
  context.lineWidth = 9;
  context.beginPath();
  context.moveTo(-27, torsoY - 24);
  context.lineTo(-62, torsoY + 11);
  context.moveTo(27, torsoY - 25);
  context.lineTo(66 + armReach + heavyReach, torsoY - 25 + (charging ? Math.sin(fighter.anim * 35) * 4 : 0));
  context.stroke();

  context.fillStyle = fighter.accent;
  context.beginPath();
  context.arc(70 + armReach + heavyReach, torsoY - 25, 14 + (charging ? 3 : 0), 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.arc(-63, torsoY + 12, 12, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = fighter.skin;
  roundRect(context, -24, headY - 28, 48, 48, 12);
  context.fill();
  context.fillStyle = fighter.dark;
  context.fillRect(-28, headY - 32, 56, 17);
  context.fillStyle = "#1b1210";
  context.fillRect(5, headY - 8, 18, 5);
  context.fillRect(-20, headY - 8, 13, 5);

  context.fillStyle = fighter.accent;
  context.fillRect(24, headY - 29, 10, 43);
  context.fillRect(-34, headY - 29, 10, 43);

  if (charging) {
    context.save();
    context.globalAlpha = 0.7;
    context.strokeStyle = fighter.glow;
    context.lineWidth = 3;
    for (let i = 0; i < 3; i += 1) {
      context.beginPath();
      context.arc(72 + i * 7, torsoY - 25, 20 + i * 13 + Math.sin(fighter.anim * 14) * 4, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
  }

  if (fighter.state === "ko") {
    context.save();
    context.globalAlpha = 0.18;
    context.fillStyle = "#fff";
    context.fillRect(-34, headY - 5, 68, 5);
    context.restore();
  }

  context.restore();
}

function drawProjectile(context, projectile) {
  context.save();
  context.translate(projectile.x, projectile.y);
  context.scale(Math.sign(projectile.vx), 1);
  const gradient = context.createLinearGradient(-42, 0, 54, 0);
  gradient.addColorStop(0, "rgba(255,255,255,0.05)");
  gradient.addColorStop(0.45, projectile.color);
  gradient.addColorStop(1, "rgba(255,244,190,0.9)");
  context.fillStyle = gradient;
  context.beginPath();
  context.moveTo(-44, 0);
  context.quadraticCurveTo(-18, -30, 38, -16);
  context.quadraticCurveTo(66, -4, 42, 15);
  context.quadraticCurveTo(-12, 32, -44, 0);
  context.fill();
  context.globalAlpha = 0.45;
  context.strokeStyle = "#fff7d4";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(-26, -8);
  context.quadraticCurveTo(8, -22, 46, -6);
  context.stroke();
  context.restore();
}

function drawParticle(context, particle) {
  context.save();
  context.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1);
  context.fillStyle = particle.color;
  context.fillRect(particle.x, particle.y, particle.size, particle.size);
  context.restore();
}

function drawHud(context, gameState) {
  const leftHealth = gameState.p1.health / 100;
  const rightHealth = gameState.p2.health / 100;

  context.save();
  context.font = "24px Impact, Haettenschweiler, sans-serif";
  context.textBaseline = "middle";

  drawBar(context, 54, 34, 462, 30, leftHealth, "#c7352d", "#f0b64f", false);
  drawBar(context, WORLD.width - 516, 34, 462, 30, rightHealth, "#287a76", "#e9f4d6", true);
  drawBar(context, 92, 84, 280, 14, gameState.p1.meter / 100, "#f0b64f", "#fff3bd", false);
  drawBar(context, WORLD.width - 372, 84, 280, 14, gameState.p2.meter / 100, "#42cab8", "#e9f4d6", true);

  context.fillStyle = "#f6ead0";
  context.textAlign = "left";
  context.fillText(gameState.p1.shortName, 54, 21);
  context.textAlign = "right";
  context.fillText(gameState.p2.shortName, WORLD.width - 54, 21);

  context.fillStyle = "#080705";
  context.fillRect(WORLD.width / 2 - 62, 24, 124, 66);
  context.strokeStyle = "rgba(246,234,208,0.45)";
  context.lineWidth = 2;
  context.strokeRect(WORLD.width / 2 - 62, 24, 124, 66);
  context.fillStyle = "#f6ead0";
  context.font = "58px Impact, Haettenschweiler, sans-serif";
  context.textAlign = "center";
  context.fillText(String(Math.ceil(gameState.timer)).padStart(2, "0"), WORLD.width / 2, 57);

  drawWins(context, 394, 91, gameState.p1.wins, "#f0b64f");
  drawWins(context, WORLD.width - 394, 91, gameState.p2.wins, "#42cab8");

  if (gameState.p1.combo >= 2) drawCombo(context, 96, 152, gameState.p1.combo, "#f0b64f");
  if (gameState.p2.combo >= 2) drawCombo(context, WORLD.width - 96, 152, gameState.p2.combo, "#42cab8", true);

  if (gameState.mode !== "online" && gameState.p2HumanTimer <= 0) {
    context.font = "18px Impact, Haettenschweiler, sans-serif";
    context.fillStyle = "rgba(246,234,208,0.72)";
    context.textAlign = "right";
    context.fillText("电脑", WORLD.width - 54, 104);
  }

  context.restore();
}

function drawBar(context, x, y, w, h, value, color, tip, reverse) {
  context.save();
  context.fillStyle = "rgba(8,7,5,0.86)";
  roundRect(context, x, y, w, h, 4);
  context.fill();
  context.strokeStyle = "rgba(246,234,208,0.34)";
  context.lineWidth = 2;
  context.stroke();

  const fillW = Math.max(0, w * value);
  const fillX = reverse ? x + w - fillW : x;
  const gradient = context.createLinearGradient(fillX, y, fillX + fillW, y);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, tip);
  context.fillStyle = gradient;
  roundRect(context, fillX, y, fillW, h, 4);
  context.fill();

  context.globalAlpha = 0.35;
  context.fillStyle = "#fff";
  context.fillRect(fillX, y + 4, fillW, 4);
  context.restore();
}

function drawWins(context, x, y, wins, color) {
  context.save();
  for (let i = 0; i < 2; i += 1) {
    context.beginPath();
    context.arc(x + i * 18, y, 6, 0, Math.PI * 2);
    context.fillStyle = i < wins ? color : "rgba(246,234,208,0.22)";
    context.fill();
  }
  context.restore();
}

function drawCombo(context, x, y, combo, color, right = false) {
  context.save();
  context.textAlign = right ? "right" : "left";
  context.font = "48px Impact, Haettenschweiler, sans-serif";
  context.fillStyle = color;
  context.shadowColor = color;
  context.shadowBlur = 16;
  context.fillText(`${combo} 连击`, x, y);
  context.restore();
}

window.addEventListener("resize", resizeCanvas);
window.addEventListener("keydown", (event) => {
  initAudio();
  if (!keys.has(event.code)) justPressed.add(event.code);
  keys.add(event.code);
  if (mode === "offline" && p2ControlCodes.has(event.code)) offlineGame.markP2Human();
  if (BLOCKED_KEYS.has(event.code)) event.preventDefault();
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.code);
  if (BLOCKED_KEYS.has(event.code)) event.preventDefault();
});

startButton.addEventListener("click", () => {
  initAudio();
  if (mode === "lobby") {
    startOfflinePractice();
  } else if (mode === "offline") {
    if (latestSnapshot.matchOver) offlineGame.resetMatch();
    else offlineGame.togglePaused();
  }
});

resetButton.addEventListener("click", () => {
  initAudio();
  if (mode === "online") {
    sendSocket({ type: "restart" });
  } else if (mode === "offline") {
    offlineGame.resetMatch();
  }
});

muteButton.addEventListener("click", () => {
  muted = !muted;
  muteButton.classList.toggle("is-muted", muted);
  muteButton.textContent = muted ? "静" : "音";
});

practiceButton.addEventListener("click", startOfflinePractice);

createRoomButton.addEventListener("click", () => {
  initAudio();
  if (currentRoom && mode !== "online") {
    sendSocket({ type: "leaveRoom" });
    currentRoom = null;
    currentSeat = null;
    showLobby("你已离开房间。");
    return;
  }
  if (sendSocket({ type: "createRoom" })) {
    showLobby("正在创建房间...");
  } else {
    showLobby("联机不可用，可以先玩单机练习。");
  }
});

refreshRoomsButton.addEventListener("click", () => {
  sendSocket({ type: "listRooms" });
});

roomList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-room-id]");
  if (!button || button.disabled) return;
  initAudio();
  sendSocket({ type: "joinRoom", roomId: button.dataset.roomId });
});

document.querySelectorAll("[data-touch]").forEach((button) => {
  const action = button.dataset.touch;
  let lastPointerAt = 0;
  const release = () => {
    touchHeld.delete(action);
    button.classList.remove("is-held");
  };

  button.addEventListener("pointerdown", (event) => {
    initAudio();
    event.preventDefault();
    lastPointerAt = performance.now();
    button.setPointerCapture(event.pointerId);
    touchHeld.add(action);
    pulseTouch(action);
    button.classList.add("is-held");
  });

  button.addEventListener("click", (event) => {
    event.preventDefault();
    initAudio();
    if (pulseTouchActions.has(action)) {
      pulseTouch(action, TOUCH_TAP_PULSE_MS);
    } else if (performance.now() - lastPointerAt > 180) {
      pulseTouch(action);
    }
  });

  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", release);
});

resizeCanvas();
connectSocket();
showLobby(LOBBY_DEFAULT_MESSAGE);
requestAnimationFrame(frame);
