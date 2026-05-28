import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import next from "next";
import { WebSocket, WebSocketServer } from "ws";
import {
  ACTIONS as FIGHT_ACTIONS,
  BattleGame,
  clearPresses as clearFightPresses,
  createInputState as createFightInputState,
  normalizeInput as normalizeFightInput,
} from "./public/iron-circuit-clash/engine.mjs";
import {
  ACTIONS as PONG_ACTIONS,
  PongGame,
  clearPresses as clearPongPresses,
  createInputState as createPongInputState,
  normalizeInput as normalizePongInput,
} from "./public/neon-ping-pong/engine.mjs";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "127.0.0.1";
const port = readPort();

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

const server = createServer((req, res) => {
  handle(req, res);
});

const upgradeHandler = app.getUpgradeHandler();
const services = [createFightService(), createPongService()];
const serviceByPath = new Map(services.map((service) => [service.path, service]));

server.on("upgrade", (req, socket, head) => {
  let pathname = "";
  try {
    pathname = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`).pathname;
  } catch {
    socket.destroy();
    return;
  }

  const service = serviceByPath.get(pathname);
  if (service) {
    service.wss.handleUpgrade(req, socket, head, (ws) => {
      service.wss.emit("connection", ws, req);
    });
    return;
  }

  upgradeHandler(req, socket, head);
});

server.listen(port, hostname, () => {
  console.log(`> Server listening at http://${hostname}:${port}`);
});

function readPort() {
  const envPort = Number.parseInt(process.env.PORT || "", 10);
  if (Number.isFinite(envPort) && envPort > 0) return envPort;

  const flagIndex = process.argv.findIndex((arg) => arg === "-p" || arg === "--port");
  if (flagIndex !== -1) {
    const cliPort = Number.parseInt(process.argv[flagIndex + 1] || "", 10);
    if (Number.isFinite(cliPort) && cliPort > 0) return cliPort;
  }

  return 3000;
}

function createClient(ws) {
  return {
    id: randomUUID(),
    name: "玩家",
    ws,
    roomId: null,
    seat: null,
  };
}

function createRoomId(rooms) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = Math.random().toString(36).slice(2, 8).toUpperCase();
    if (!rooms.has(id)) return id;
  }
  return randomUUID().slice(0, 6).toUpperCase();
}

function sanitizeName(name) {
  const value = String(name || "玩家").trim();
  return value ? value.slice(0, 24) : "玩家";
}

function send(client, message) {
  if (client.ws.readyState !== WebSocket.OPEN) return;
  client.ws.send(JSON.stringify(message));
}

function createFightService() {
  const path = "/ws/iron-circuit-clash";
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Map();
  const rooms = new Map();

  wss.on("connection", (ws) => {
    const client = createClient(ws);
    clients.set(client.id, client);

    send(client, { type: "welcome", clientId: client.id });
    send(client, { type: "rooms", rooms: roomList() });

    ws.on("message", (raw) => {
      let message = null;
      try {
        message = JSON.parse(String(raw));
      } catch {
        sendError(client, "消息格式错误。");
        return;
      }

      handleClientMessage(client, message);
    });

    ws.on("close", () => {
      leaveRoom(client, { notifySelf: false });
      clients.delete(client.id);
      broadcastRooms();
    });

    ws.on("error", () => {
      leaveRoom(client, { notifySelf: false });
      clients.delete(client.id);
      broadcastRooms();
    });
  });

  function handleClientMessage(client, message) {
    switch (message?.type) {
      case "hello":
        client.name = sanitizeName(message.name);
        send(client, { type: "welcome", clientId: client.id });
        send(client, { type: "rooms", rooms: roomList() });
        break;
      case "listRooms":
        send(client, { type: "rooms", rooms: roomList() });
        break;
      case "createRoom":
        createRoom(client);
        break;
      case "joinRoom":
        joinRoom(client, String(message.roomId || ""));
        break;
      case "leaveRoom":
        leaveRoom(client);
        broadcastRooms();
        break;
      case "input":
        updateInput(client, message.input);
        break;
      case "restart":
        restartRoom(client);
        break;
      default:
        sendError(client, "未知消息类型。");
        break;
    }
  }

  function createRoom(client) {
    leaveRoom(client, { notifySelf: false });

    const id = createRoomId(rooms);
    const room = {
      id,
      name: `房间 ${id}`,
      status: "waiting",
      createdAt: Date.now(),
      seats: { 1: client.id, 2: null },
      inputs: { 1: createFightInputState(), 2: createFightInputState() },
      game: null,
      loop: null,
      lastTick: 0,
      sequence: 0,
    };

    rooms.set(id, room);
    client.roomId = id;
    client.seat = 1;

    send(client, { type: "roomJoined", room: publicRoom(room), seat: 1 });
    broadcastRooms();
  }

  function joinRoom(client, roomId) {
    const room = rooms.get(roomId);
    if (!room) {
      sendError(client, "房间不存在。");
      return;
    }

    if (room.status !== "waiting" || room.seats[2]) {
      sendError(client, "房间已满。");
      return;
    }

    leaveRoom(client, { notifySelf: false });

    room.seats[2] = client.id;
    room.status = "playing";
    client.roomId = room.id;
    client.seat = 2;

    send(client, { type: "roomJoined", room: publicRoom(room), seat: 2 });
    const host = clients.get(room.seats[1]);
    if (host) {
      send(host, { type: "roomJoined", room: publicRoom(room), seat: 1 });
    }

    startMatch(room);
    broadcastRooms();
  }

  function leaveRoom(client, { notifySelf = true } = {}) {
    if (!client.roomId) return;

    const room = rooms.get(client.roomId);
    const seat = client.seat;
    client.roomId = null;
    client.seat = null;

    if (!room) return;

    room.seats[seat] = null;

    if (room.status === "playing") {
      const opponentSeat = seat === 1 ? 2 : 1;
      const opponent = clients.get(room.seats[opponentSeat]);
      stopRoom(room);
      rooms.delete(room.id);

      if (opponent) {
        opponent.roomId = null;
        opponent.seat = null;
        send(opponent, { type: "matchEnd", reason: "opponentLeft", message: "对手已离开对局。" });
        send(opponent, { type: "rooms", rooms: roomList() });
      }
    } else {
      stopRoom(room);
      rooms.delete(room.id);
    }

    if (notifySelf) {
      send(client, { type: "rooms", rooms: roomList() });
    }
  }

  function startMatch(room) {
    stopRoom(room);
    room.game = new BattleGame({ online: true });
    room.inputs = { 1: createFightInputState(), 2: createFightInputState() };
    room.lastTick = Date.now();
    room.sequence = 0;

    const initialSnapshot = room.game.consumeSnapshot();
    broadcastRoom(room, { type: "matchStart", room: publicRoom(room), snapshot: initialSnapshot });

    room.loop = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(0.05, (now - room.lastTick) / 1000);
      room.lastTick = now;

      room.game.update(dt, room.inputs[1], room.inputs[2]);
      clearFightPresses(room.inputs[1]);
      clearFightPresses(room.inputs[2]);

      const snapshot = room.game.consumeSnapshot();
      room.sequence += 1;
      broadcastRoom(room, { type: "state", sequence: room.sequence, snapshot });

      if (room.game.matchOver && room.game.roundState === "over" && room.game.finalAnnounced) {
        finishRoom(room, "matchComplete", room.game.winnerName || "平局");
      }
    }, 1000 / 60);
  }

  function restartRoom(client) {
    const room = client.roomId ? rooms.get(client.roomId) : null;
    if (!room || room.status !== "playing" || !room.seats[1] || !room.seats[2]) {
      sendError(client, "当前房间无法重新开始。");
      return;
    }

    startMatch(room);
  }

  function finishRoom(room, reason, message) {
    stopRoom(room);
    rooms.delete(room.id);

    for (const seat of [1, 2]) {
      const client = clients.get(room.seats[seat]);
      if (!client) continue;
      client.roomId = null;
      client.seat = null;
      send(client, { type: "matchEnd", reason, message });
      send(client, { type: "rooms", rooms: roomList() });
    }

    broadcastRooms();
  }

  function stopRoom(room) {
    if (room.loop) {
      clearInterval(room.loop);
      room.loop = null;
    }
  }

  function updateInput(client, input) {
    const room = client.roomId ? rooms.get(client.roomId) : null;
    if (!room || room.status !== "playing" || !client.seat) return;

    const normalized = normalizeFightInput(input);
    const stored = room.inputs[client.seat];
    for (const action of FIGHT_ACTIONS) {
      stored.hold[action] = normalized.hold[action];
      if (normalized.press[action]) {
        stored.press[action] = true;
      }
    }
  }

  function broadcastRoom(room, message) {
    for (const seat of [1, 2]) {
      const client = clients.get(room.seats[seat]);
      if (client) send(client, message);
    }
  }

  function broadcastRooms() {
    const roomsPayload = roomList();
    for (const client of clients.values()) {
      send(client, { type: "rooms", rooms: roomsPayload });
    }
  }

  function roomList() {
    return [...rooms.values()].map(publicRoom);
  }

  function publicRoom(room) {
    return {
      id: room.id,
      name: room.name,
      status: room.status,
      players: [room.seats[1], room.seats[2]].filter(Boolean).length,
      capacity: 2,
      createdAt: room.createdAt,
    };
  }

  function sendError(client, message) {
    send(client, { type: "error", message });
  }

  function shutdown() {
    for (const room of rooms.values()) stopRoom(room);
    wss.close();
  }

  return { path, wss, shutdown };
}

function createPongService() {
  const path = "/ws/neon-ping-pong";
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Map();
  const rooms = new Map();

  wss.on("connection", (ws) => {
    const client = createClient(ws);
    clients.set(client.id, client);

    send(client, { type: "welcome", clientId: client.id });
    send(client, { type: "rooms", rooms: roomList() });

    ws.on("message", (raw) => {
      let message = null;
      try {
        message = JSON.parse(String(raw));
      } catch {
        sendError(client, "消息格式错误。");
        return;
      }

      handleClientMessage(client, message);
    });

    ws.on("close", () => {
      leaveRoom(client, { notifySelf: false });
      clients.delete(client.id);
      broadcastRooms();
    });

    ws.on("error", () => {
      leaveRoom(client, { notifySelf: false });
      clients.delete(client.id);
      broadcastRooms();
    });
  });

  function handleClientMessage(client, message) {
    switch (message?.type) {
      case "hello":
        client.name = sanitizeName(message.name);
        send(client, { type: "welcome", clientId: client.id });
        send(client, { type: "rooms", rooms: roomList() });
        break;
      case "listRooms":
        send(client, { type: "rooms", rooms: roomList() });
        break;
      case "createRoom":
        createRoom(client);
        break;
      case "joinRoom":
        joinRoom(client, String(message.roomId || ""));
        break;
      case "leaveRoom":
        leaveRoom(client);
        broadcastRooms();
        break;
      case "input":
        updateInput(client, message.input);
        break;
      case "restart":
        restartRoom(client);
        break;
      default:
        sendError(client, "未知消息类型。");
        break;
    }
  }

  function createRoom(client) {
    leaveRoom(client, { notifySelf: false });

    const id = createRoomId(rooms);
    const room = {
      id,
      name: `球台 ${id}`,
      status: "waiting",
      createdAt: Date.now(),
      seats: { 1: client.id, 2: null },
      inputs: { 1: createPongInputState(), 2: createPongInputState() },
      game: null,
      loop: null,
      lastTick: 0,
      sequence: 0,
    };

    rooms.set(id, room);
    client.roomId = id;
    client.seat = 1;

    send(client, { type: "roomJoined", room: publicRoom(room), seat: 1 });
    broadcastRooms();
  }

  function joinRoom(client, roomId) {
    const room = rooms.get(roomId);
    if (!room) {
      sendError(client, "球台不存在。");
      return;
    }

    if (room.status !== "waiting" || room.seats[2]) {
      sendError(client, "球台已满。");
      return;
    }

    leaveRoom(client, { notifySelf: false });

    room.seats[2] = client.id;
    room.status = "playing";
    client.roomId = room.id;
    client.seat = 2;

    send(client, { type: "roomJoined", room: publicRoom(room), seat: 2 });
    const host = clients.get(room.seats[1]);
    if (host) {
      send(host, { type: "roomJoined", room: publicRoom(room), seat: 1 });
    }

    startMatch(room);
    broadcastRooms();
  }

  function leaveRoom(client, { notifySelf = true } = {}) {
    if (!client.roomId) return;

    const room = rooms.get(client.roomId);
    const seat = client.seat;
    client.roomId = null;
    client.seat = null;

    if (!room) return;

    room.seats[seat] = null;

    if (room.status === "playing") {
      const opponentSeat = seat === 1 ? 2 : 1;
      const opponent = clients.get(room.seats[opponentSeat]);
      stopRoom(room);
      rooms.delete(room.id);

      if (opponent) {
        opponent.roomId = null;
        opponent.seat = null;
        send(opponent, { type: "matchEnd", reason: "opponentLeft", message: "对手离开球台，对局结束。" });
        send(opponent, { type: "rooms", rooms: roomList() });
      }
    } else {
      stopRoom(room);
      rooms.delete(room.id);
    }

    if (notifySelf) {
      send(client, { type: "rooms", rooms: roomList() });
    }
  }

  function startMatch(room) {
    stopRoom(room);
    room.game = new PongGame({ online: true });
    room.inputs = { 1: createPongInputState(), 2: createPongInputState() };
    room.lastTick = Date.now();
    room.sequence = 0;

    const initialSnapshot = room.game.consumeSnapshot();
    broadcastRoom(room, { type: "matchStart", room: publicRoom(room), snapshot: initialSnapshot });

    room.loop = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(0.05, (now - room.lastTick) / 1000);
      room.lastTick = now;

      room.game.update(dt, room.inputs[1], room.inputs[2]);
      clearPongPresses(room.inputs[1]);
      clearPongPresses(room.inputs[2]);

      const snapshot = room.game.consumeSnapshot();
      room.sequence += 1;
      broadcastRoom(room, { type: "state", sequence: room.sequence, snapshot });

      if (room.game.matchOver && room.game.roundState === "over" && room.game.finalAnnounced) {
        finishRoom(room, "matchComplete", room.game.winnerName || "平局");
      }
    }, 1000 / 60);
  }

  function restartRoom(client) {
    const room = client.roomId ? rooms.get(client.roomId) : null;
    if (!room || room.status !== "playing" || !room.seats[1] || !room.seats[2]) {
      sendError(client, "当前球台无法重新开始。");
      return;
    }

    startMatch(room);
  }

  function finishRoom(room, reason, message) {
    stopRoom(room);
    rooms.delete(room.id);

    for (const seat of [1, 2]) {
      const client = clients.get(room.seats[seat]);
      if (!client) continue;
      client.roomId = null;
      client.seat = null;
      send(client, { type: "matchEnd", reason, message });
      send(client, { type: "rooms", rooms: roomList() });
    }

    broadcastRooms();
  }

  function stopRoom(room) {
    if (room.loop) {
      clearInterval(room.loop);
      room.loop = null;
    }
  }

  function updateInput(client, input) {
    const room = client.roomId ? rooms.get(client.roomId) : null;
    if (!room || room.status !== "playing" || !client.seat) return;

    const normalized = normalizePongInput(input);
    const stored = room.inputs[client.seat];
    for (const action of PONG_ACTIONS) {
      stored.hold[action] = normalized.hold[action];
      if (normalized.press[action]) {
        stored.press[action] = true;
      }
    }
  }

  function broadcastRoom(room, message) {
    for (const seat of [1, 2]) {
      const client = clients.get(room.seats[seat]);
      if (client) send(client, message);
    }
  }

  function broadcastRooms() {
    const roomsPayload = roomList();
    for (const client of clients.values()) {
      send(client, { type: "rooms", rooms: roomsPayload });
    }
  }

  function roomList() {
    return [...rooms.values()].map(publicRoom);
  }

  function publicRoom(room) {
    return {
      id: room.id,
      name: room.name,
      status: room.status,
      players: [room.seats[1], room.seats[2]].filter(Boolean).length,
      capacity: 2,
      createdAt: room.createdAt,
    };
  }

  function sendError(client, message) {
    send(client, { type: "error", message });
  }

  function shutdown() {
    for (const room of rooms.values()) stopRoom(room);
    wss.close();
  }

  return { path, wss, shutdown };
}

function shutdown() {
  for (const service of services) service.shutdown();
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
