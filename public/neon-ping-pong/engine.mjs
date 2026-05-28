export const WORLD = {
  width: 1280,
  height: 720,
  ceiling: 88,
  floor: 632,
  paddleInset: 74,
};

export const ACTIONS = ["up", "down"];

const PADDLE = {
  width: 22,
  height: 144,
  speed: 710,
};

const BALL = {
  radius: 14,
  baseSpeed: 560,
  maxSpeed: 1120,
};

const PLAYER_CONFIGS = {
  p1: {
    name: "赤拍",
    shortName: "赤拍",
    color: "#ff6a4f",
    edge: "#ffd06f",
    glow: "#ff8c6c",
    x: WORLD.paddleInset,
  },
  p2: {
    name: "青拍",
    shortName: "青拍",
    color: "#49d6da",
    edge: "#d9fff3",
    glow: "#67f1e7",
    x: WORLD.width - WORLD.paddleInset,
  },
};

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function createInputState() {
  const input = { hold: {}, press: {} };
  for (const action of ACTIONS) {
    input.hold[action] = false;
    input.press[action] = false;
  }
  return input;
}

export function normalizeInput(input) {
  const normalized = createInputState();
  for (const action of ACTIONS) {
    normalized.hold[action] = Boolean(input?.hold?.[action]);
    normalized.press[action] = Boolean(input?.press?.[action]);
  }
  return normalized;
}

export function clearPresses(input) {
  for (const action of ACTIONS) {
    input.press[action] = false;
  }
}

class Paddle {
  constructor(config) {
    this.name = config.name;
    this.shortName = config.shortName;
    this.color = config.color;
    this.edge = config.edge;
    this.glow = config.glow;
    this.x = config.x;
    this.width = PADDLE.width;
    this.height = PADDLE.height;
    this.y = WORLD.height / 2;
    this.vy = 0;
    this.score = 0;
    this.flash = 0;
  }

  reset() {
    this.y = WORLD.height / 2;
    this.vy = 0;
    this.flash = 0;
  }

  update(dt, input) {
    const up = input?.hold?.up;
    const down = input?.hold?.down;
    const direction = (down ? 1 : 0) - (up ? 1 : 0);
    this.vy = direction * PADDLE.speed;
    this.y = clamp(this.y + this.vy * dt, WORLD.ceiling + this.height / 2, WORLD.floor - this.height / 2);
    this.flash = Math.max(0, this.flash - dt * 3.2);
  }
}

export class PongGame {
  constructor({ online = false } = {}) {
    this.online = online;
    this.events = [];
    this.p1 = new Paddle(PLAYER_CONFIGS.p1);
    this.p2 = new Paddle(PLAYER_CONFIGS.p2);
    this.ball = {
      x: WORLD.width / 2,
      y: WORLD.height / 2,
      vx: BALL.baseSpeed,
      vy: 0,
      radius: BALL.radius,
      speed: BALL.baseSpeed,
      glow: 0,
      spin: 0,
    };
    this.servingSeat = 1;
    this.nextServeSeat = 1;
    this.roundState = "serve";
    this.stateClock = 0;
    this.matchOver = false;
    this.finalAnnounced = false;
    this.paused = false;
    this.message = "准备发球";
    this.flash = 0;
    this.resetMatch();
  }

  resetMatch() {
    this.p1.score = 0;
    this.p2.score = 0;
    this.p1.reset();
    this.p2.reset();
    this.matchOver = false;
    this.finalAnnounced = false;
    this.paused = false;
    this.setupServe(Math.random() < 0.5 ? 1 : 2);
  }

  setPaused(paused) {
    if (this.online) return;
    this.paused = Boolean(paused);
  }

  togglePaused() {
    if (this.online) return;
    this.paused = !this.paused;
  }

  setupServe(seat) {
    const tilt = (Math.random() * 0.7 - 0.35) * Math.PI;
    const dir = seat === 1 ? 1 : -1;

    this.servingSeat = seat;
    this.nextServeSeat = seat;
    this.roundState = "serve";
    this.stateClock = 0.95;
    this.finalAnnounced = false;
    this.p1.reset();
    this.p2.reset();

    this.ball.x = WORLD.width / 2;
    this.ball.y = WORLD.height / 2 + (Math.random() * 120 - 60);
    this.ball.speed = BALL.baseSpeed;
    this.ball.vx = Math.cos(tilt) * BALL.baseSpeed * dir;
    this.ball.vy = Math.sin(tilt) * BALL.baseSpeed * 0.55;
    this.ball.glow = 0;
    this.ball.spin = 0;

    this.flash = 0.1;
    this.announce(seat === 1 ? "赤拍发球" : "青拍发球", true);
    this.emitSound("serve");
  }

  cpuInput() {
    const input = createInputState();
    const target = this.ball.vx > 0 ? this.ball.y : WORLD.height / 2;
    if (target < this.p2.y - 18) input.hold.up = true;
    if (target > this.p2.y + 18) input.hold.down = true;
    return input;
  }

  update(dt, p1Input = createInputState(), p2Input = createInputState()) {
    if (this.paused) return;

    this.flash = Math.max(0, this.flash - dt * 1.8);
    this.ball.glow = Math.max(0, this.ball.glow - dt * 2.8);

    const p1Command = normalizeInput(p1Input);
    const p2Command = this.online ? normalizeInput(p2Input) : this.cpuInput();

    this.p1.update(dt, p1Command);
    this.p2.update(dt, p2Command);

    if (this.roundState === "serve") {
      this.stateClock -= dt;
      if (this.stateClock <= 0) {
        this.roundState = "play";
        this.stateClock = 0;
        this.announce("开球", true);
        this.emitSound("start");
      }
      return;
    }

    if (this.roundState === "over") {
      this.stateClock -= dt;
      if (this.stateClock <= 0) {
        if (this.matchOver) {
          this.finalAnnounced = true;
        } else {
          this.setupServe(this.nextServeSeat);
        }
      }
      return;
    }

    this.ball.x += this.ball.vx * dt;
    this.ball.y += this.ball.vy * dt;
    this.ball.spin += dt * 8;

    if (this.ball.y - this.ball.radius <= WORLD.ceiling) {
      this.ball.y = WORLD.ceiling + this.ball.radius;
      this.ball.vy = Math.abs(this.ball.vy);
      this.wallBounce();
    }

    if (this.ball.y + this.ball.radius >= WORLD.floor) {
      this.ball.y = WORLD.floor - this.ball.radius;
      this.ball.vy = -Math.abs(this.ball.vy);
      this.wallBounce();
    }

    this.handlePaddleHit(this.p1, 1);
    this.handlePaddleHit(this.p2, -1);

    if (this.ball.x + this.ball.radius < 0) {
      this.scorePoint(2);
      return;
    }

    if (this.ball.x - this.ball.radius > WORLD.width) {
      this.scorePoint(1);
    }
  }

  wallBounce() {
    this.ball.glow = 0.55;
    this.emitSound("wall");
  }

  handlePaddleHit(paddle, direction) {
    if ((direction === 1 && this.ball.vx >= 0) || (direction === -1 && this.ball.vx <= 0)) return;

    const left = paddle.x - paddle.width / 2;
    const right = paddle.x + paddle.width / 2;
    const top = paddle.y - paddle.height / 2;
    const bottom = paddle.y + paddle.height / 2;

    if (
      this.ball.x + this.ball.radius < left ||
      this.ball.x - this.ball.radius > right ||
      this.ball.y + this.ball.radius < top ||
      this.ball.y - this.ball.radius > bottom
    ) {
      return;
    }

    const offset = clamp((this.ball.y - paddle.y) / (paddle.height / 2), -1, 1);
    const angle = offset * 0.95;

    this.ball.speed = Math.min(BALL.maxSpeed, this.ball.speed + 52);
    this.ball.vx = Math.max(360, Math.cos(angle) * this.ball.speed) * direction;
    this.ball.vy = Math.sin(angle) * this.ball.speed + paddle.vy * 0.24;
    this.ball.y += paddle.vy * 0.02;
    this.ball.x = direction === 1 ? right + this.ball.radius : left - this.ball.radius;
    this.ball.glow = 1;
    this.flash = 0.13;
    paddle.flash = 1;

    this.emitSound("paddle");
  }

  scorePoint(seat) {
    const scorer = seat === 1 ? this.p1 : this.p2;
    scorer.score += 1;

    this.roundState = "over";
    this.nextServeSeat = seat === 1 ? 2 : 1;
    this.flash = 0.28;
    this.emitSound(scorer.score >= 5 ? "win" : "score");

    if (scorer.score >= 5) {
      this.matchOver = true;
      this.stateClock = 1.8;
      this.announce(this.winnerName, true);
      return;
    }

    this.stateClock = 1.25;
    this.announce(`${scorer.shortName} 得分`, true);
  }

  get winnerName() {
    if (!this.matchOver) return null;
    if (this.p1.score > this.p2.score) return "赤拍获胜";
    if (this.p2.score > this.p1.score) return "青拍获胜";
    return "平局";
  }

  announce(text, show) {
    this.message = text;
    this.events.push({ type: "announce", text, show: Boolean(show) });
  }

  emitSound(name) {
    this.events.push({ type: "sound", name });
  }

  snapshot() {
    return {
      mode: this.online ? "online" : "offline",
      roundState: this.roundState,
      stateClock: this.stateClock,
      servingSeat: this.servingSeat,
      paused: this.paused,
      matchOver: this.matchOver,
      message: this.message,
      winnerName: this.winnerName,
      flash: this.flash,
      p1: paddleSnapshot(this.p1),
      p2: paddleSnapshot(this.p2),
      ball: ballSnapshot(this.ball),
      events: [],
    };
  }

  consumeSnapshot() {
    const snapshot = this.snapshot();
    snapshot.events = this.events.splice(0);
    return snapshot;
  }
}

function paddleSnapshot(paddle) {
  return {
    name: paddle.name,
    shortName: paddle.shortName,
    x: paddle.x,
    y: paddle.y,
    width: paddle.width,
    height: paddle.height,
    color: paddle.color,
    edge: paddle.edge,
    glow: paddle.glow,
    score: paddle.score,
    vy: paddle.vy,
    flash: paddle.flash,
  };
}

function ballSnapshot(ball) {
  return {
    x: ball.x,
    y: ball.y,
    vx: ball.vx,
    vy: ball.vy,
    radius: ball.radius,
    speed: ball.speed,
    glow: ball.glow,
    spin: ball.spin,
  };
}
