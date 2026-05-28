import { PongGame, WORLD, createInputState } from "./engine.mjs";

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
  up: ["KeyW", "ArrowUp"],
  down: ["KeyS", "ArrowDown"],
};

const BLOCKED_KEYS = new Set(["ArrowUp", "ArrowDown", "Space"]);
const keys = new Set();
const justPressed = new Set();
const touchHeld = new Set();

const LOBBY_DEFAULT_MESSAGE = "创建球台，或加入一个等待中的对手。";
const CONNECTION_LABELS = {
  connecting: "连接中",
  online: "联机可用",
  offline: "联机断开",
};

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

const offlineGame = new PongGame({ online: false });
let latestSnapshot = offlineGame.consumeSnapshot();
latestSnapshot.events = [];

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
    paddle: [360, 0.04, "square", 0.05],
    wall: [240, 0.035, "triangle", 0.04],
    score: [520, 0.1, "sawtooth", 0.045],
    serve: [230, 0.08, "triangle", 0.04],
    start: [420, 0.08, "sawtooth", 0.03],
    win: [600, 0.22, "square", 0.05],
  }[type] || [280, 0.05, "square", 0.04];

  osc.type = settings[2];
  osc.frequency.setValueAtTime(settings[0], now);
  osc.frequency.exponentialRampToValueAtTime(settings[0] * 1.4, now + settings[1]);
  gain.gain.setValueAtTime(settings[3], now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + settings[1]);
  osc.connect(gain).connect(audioContext.destination);
  osc.start(now);
  osc.stop(now + settings[1] + 0.03);
}

function hasAny(codeList, source) {
  return codeList.some((code) => source.has(code));
}

function makeHumanInput(includeTouch = false) {
  const input = createInputState();
  input.hold.up = hasAny(P1_CONTROLS.up, keys) || (includeTouch && touchHeld.has("up"));
  input.hold.down = hasAny(P1_CONTROLS.down, keys) || (includeTouch && touchHeld.has("down"));
  return input;
}

function connectSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${window.location.host}/ws/neon-ping-pong`);
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
      showLobby("连接已断开，仍可进入单机练球。");
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
  createRoomButton.textContent = inWaitingRoom ? "离开球台" : "创建球台";
  createRoomButton.disabled = connectionState !== "online" && !inWaitingRoom;
}

function renderRooms(rooms) {
  if (!rooms.length) {
    roomList.innerHTML = '<div class="room-empty">暂无等待中的球台。创建一个球台等待对手加入。</div>';
    renderRoomControls();
    return;
  }

  roomList.innerHTML = rooms
    .map((room) => {
      const joinable = room.status === "waiting" && room.players < room.capacity && (!currentRoom || currentRoom.id !== room.id);
      const label = room.status === "waiting" ? "等待中" : "对打中";
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
  const input = makeHumanInput(true);
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
    }, 900);
  }
}

function updateDeckStatus() {
  if (mode === "online") {
    matchStatus.textContent = currentSeat === 1 ? "联机左台" : "联机右台";
    startButton.textContent = "对打中";
    return;
  }

  if (mode === "offline") {
    matchStatus.textContent = "单机练球";
    startButton.textContent = latestSnapshot.matchOver ? "再来一局" : latestSnapshot.paused ? "继续" : "暂停";
    return;
  }

  matchStatus.textContent = currentRoom ? "等待中" : "大厅";
  startButton.textContent = "练球";
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
    offlineGame.update(dt, makeHumanInput(true));
    latestSnapshot = offlineGame.consumeSnapshot();
    processEvents(latestSnapshot.events);
  } else if (mode === "online") {
    if (justPressed.has("KeyR")) sendSocket({ type: "restart" });
    maybeSendInput(now);
  }

  drawGame(latestSnapshot);
  justPressed.clear();
  updateDeckStatus();
  requestAnimationFrame(frame);
}

function drawGame(gameState) {
  ctx.save();
  drawArena(ctx, gameState);
  drawScoreBoard(ctx, gameState);
  drawPaddle(ctx, gameState.p1, false);
  drawPaddle(ctx, gameState.p2, true);
  drawBall(ctx, gameState.ball);
  ctx.restore();

  if (gameState.paused) {
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    ctx.fillStyle = "#dff8ff";
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

function drawArena(context, gameState) {
  const sky = context.createLinearGradient(0, 0, 0, WORLD.height);
  sky.addColorStop(0, "#07101a");
  sky.addColorStop(0.44, "#081725");
  sky.addColorStop(1, "#02050b");
  context.fillStyle = sky;
  context.fillRect(0, 0, WORLD.width, WORLD.height);

  for (let i = 0; i < 18; i += 1) {
    const alpha = i % 2 === 0 ? 0.1 : 0.05;
    context.fillStyle = `rgba(92,232,242,${alpha})`;
    context.fillRect(0, WORLD.ceiling + i * 30, WORLD.width, 1);
  }

  context.save();
  context.globalAlpha = 0.55;
  context.fillStyle = "#08131d";
  roundRect(context, 84, WORLD.ceiling + 24, WORLD.width - 168, WORLD.floor - WORLD.ceiling - 48, 32);
  context.fill();
  context.strokeStyle = "rgba(223,248,255,0.16)";
  context.lineWidth = 2;
  context.stroke();
  context.restore();

  context.save();
  context.strokeStyle = "rgba(223,248,255,0.26)";
  context.lineWidth = 4;
  context.setLineDash([18, 16]);
  context.beginPath();
  context.moveTo(WORLD.width / 2, WORLD.ceiling + 48);
  context.lineTo(WORLD.width / 2, WORLD.floor - 48);
  context.stroke();
  context.setLineDash([]);
  context.restore();

  context.save();
  context.strokeStyle = "rgba(92,232,242,0.14)";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(WORLD.width / 2, WORLD.height / 2, 116, 0, Math.PI * 2);
  context.stroke();
  context.restore();

  context.save();
  context.fillStyle = "rgba(255,106,79,0.12)";
  context.fillRect(94, WORLD.ceiling + 34, 14, WORLD.floor - WORLD.ceiling - 68);
  context.fillStyle = "rgba(92,232,242,0.12)";
  context.fillRect(WORLD.width - 108, WORLD.ceiling + 34, 14, WORLD.floor - WORLD.ceiling - 68);
  context.restore();

  if (gameState.flash > 0) {
    context.save();
    context.globalAlpha = gameState.flash * 0.8;
    context.fillStyle = "#dff8ff";
    context.fillRect(0, 0, WORLD.width, WORLD.height);
    context.restore();
  }
}

function drawScoreBoard(context, gameState) {
  context.save();
  context.font = "22px Impact, Haettenschweiler, sans-serif";
  context.textBaseline = "middle";
  context.textAlign = "center";

  roundRect(context, WORLD.width / 2 - 180, 28, 360, 78, 26);
  context.fillStyle = "rgba(5, 10, 18, 0.86)";
  context.fill();
  context.strokeStyle = "rgba(223,248,255,0.18)";
  context.lineWidth = 2;
  context.stroke();

  context.fillStyle = "#dff8ff";
  context.fillText(gameState.p1.shortName, WORLD.width / 2 - 108, 52);
  context.fillText(gameState.p2.shortName, WORLD.width / 2 + 108, 52);

  context.font = "54px Impact, Haettenschweiler, sans-serif";
  context.fillStyle = gameState.p1.color;
  context.fillText(String(gameState.p1.score), WORLD.width / 2 - 108, 82);
  context.fillStyle = gameState.p2.color;
  context.fillText(String(gameState.p2.score), WORLD.width / 2 + 108, 82);

  context.font = "24px Impact, Haettenschweiler, sans-serif";
  context.fillStyle = "rgba(223,248,255,0.54)";
  context.fillText("对打", WORLD.width / 2, 80);
  context.restore();
}

function drawPaddle(context, paddle, right) {
  const x = paddle.x - paddle.width / 2;
  const y = paddle.y - paddle.height / 2;

  context.save();
  context.shadowColor = paddle.glow;
  context.shadowBlur = 18 + paddle.flash * 22;
  context.fillStyle = paddle.color;
  roundRect(context, x, y, paddle.width, paddle.height, 10);
  context.fill();
  context.shadowBlur = 0;
  context.fillStyle = paddle.edge;
  roundRect(context, right ? x : x + paddle.width - 6, y + 8, 6, paddle.height - 16, 3);
  context.fill();

  if (paddle.flash > 0) {
    context.globalAlpha = paddle.flash * 0.5;
    context.fillStyle = "#ffffff";
    roundRect(context, x - 10, y - 10, paddle.width + 20, paddle.height + 20, 18);
    context.fill();
  }

  context.restore();
}

function drawBall(context, ball) {
  context.save();

  for (let i = 1; i <= 5; i += 1) {
    const trailX = ball.x - ball.vx * 0.012 * i;
    const trailY = ball.y - ball.vy * 0.012 * i;
    context.globalAlpha = 0.12 * (1 - i / 6);
    context.fillStyle = i % 2 === 0 ? "#5ce8f2" : "#ffb16f";
    context.beginPath();
    context.arc(trailX, trailY, ball.radius - i * 1.4, 0, Math.PI * 2);
    context.fill();
  }

  context.globalAlpha = 1;
  context.shadowColor = ball.glow > 0.1 ? "#ffffff" : "#5ce8f2";
  context.shadowBlur = 16 + ball.glow * 24;
  context.fillStyle = "#f8ffff";
  context.beginPath();
  context.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;
  context.fillStyle = "rgba(92,232,242,0.35)";
  context.beginPath();
  context.arc(ball.x - 3, ball.y - 4, ball.radius * 0.45, 0, Math.PI * 2);
  context.fill();

  context.restore();
}

window.addEventListener("resize", resizeCanvas);
window.addEventListener("keydown", (event) => {
  initAudio();
  if (!keys.has(event.code)) justPressed.add(event.code);
  keys.add(event.code);
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
    showLobby("你已离开球台。");
    return;
  }
  if (sendSocket({ type: "createRoom" })) {
    showLobby("正在创建球台...");
  } else {
    showLobby("联机不可用，可以先玩单机练球。");
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

  const release = () => {
    touchHeld.delete(action);
    button.classList.remove("is-held");
  };

  button.addEventListener("pointerdown", (event) => {
    initAudio();
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    touchHeld.add(action);
    button.classList.add("is-held");
  });

  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", release);
});

resizeCanvas();
connectSocket();
showLobby(LOBBY_DEFAULT_MESSAGE);
requestAnimationFrame(frame);
