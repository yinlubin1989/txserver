const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const announcer = document.getElementById("announcer");
const startButton = document.getElementById("startButton");
const resetButton = document.getElementById("resetButton");
const muteButton = document.getElementById("muteButton");

const WORLD = {
  width: 1280,
  height: 720,
  floor: 606,
  leftWall: 70,
  rightWall: 1210,
  gravity: 2300,
};

const ATTACKS = {
  punch: {
    name: "jab",
    duration: 0.3,
    startup: 0.055,
    active: 0.1,
    range: 72,
    height: 64,
    y: 116,
    damage: 6.5,
    chip: 1.1,
    stun: 0.2,
    blockStun: 0.12,
    knock: 190,
    meter: 8,
    shake: 6,
  },
  kick: {
    name: "roundhouse",
    duration: 0.43,
    startup: 0.1,
    active: 0.13,
    range: 104,
    height: 56,
    y: 82,
    damage: 10,
    chip: 2,
    stun: 0.27,
    blockStun: 0.18,
    knock: 260,
    meter: 11,
    shake: 9,
  },
  elbow: {
    name: "elbow",
    duration: 0.52,
    startup: 0.14,
    active: 0.14,
    range: 92,
    height: 78,
    y: 108,
    damage: 13,
    chip: 2.4,
    stun: 0.33,
    blockStun: 0.21,
    knock: 320,
    meter: 14,
    shake: 12,
  },
  super: {
    name: "circuit breaker",
    duration: 0.66,
    startup: 0.18,
    active: 0.18,
    range: 132,
    height: 98,
    y: 112,
    damage: 19,
    chip: 4,
    stun: 0.42,
    blockStun: 0.26,
    knock: 440,
    meter: 0,
    shake: 18,
  },
};

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

const BLOCKED_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Space",
]);

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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
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

function makeHumanCommand(controls, includeTouch = false) {
  return {
    hold(action) {
      return hasAny(controls[action] || [], keys) || (includeTouch && (touchHeld.has(action) || hasTouchPulse(action)));
    },
    press(action) {
      return hasAny(controls[action] || [], justPressed) || (includeTouch && touchPressed.has(action));
    },
  };
}

class CPUCommand {
  constructor() {
    this.holds = new Set();
    this.presses = new Set();
    this.cooldown = 0.2;
    this.blockWindow = 0;
    this.jumpClock = 1.8;
  }

  update(dt, self, foe) {
    this.holds.clear();
    this.presses.clear();
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.blockWindow = Math.max(0, this.blockWindow - dt);
    this.jumpClock = Math.max(0, this.jumpClock - dt);

    const distance = Math.abs(foe.x - self.x);
    const foeThreat = foe.attack && foe.isAttackActive() && distance < 180;
    const projectileThreat = game.projectiles.some(
      (projectile) => projectile.owner !== self && Math.abs(projectile.x - self.x) < 220
    );

    if ((foeThreat || projectileThreat) && Math.random() < 0.08) {
      this.blockWindow = 0.28;
    }

    if (this.blockWindow > 0 && self.onGround) {
      this.holds.add("block");
    }

    if (distance > 165 && !foe.attack) {
      this.holds.add(foe.x < self.x ? "left" : "right");
    } else if (distance < 72) {
      this.holds.add(foe.x < self.x ? "right" : "left");
    }

    if (this.jumpClock === 0 && distance < 230 && Math.random() < 0.22) {
      this.presses.add("up");
      this.jumpClock = 2.3 + Math.random() * 1.7;
    }

    if (this.cooldown > 0 || self.attack || self.hitstun > 0 || self.blockstun > 0) return;

    if (self.meter >= 38 && distance > 185 && distance < 560 && Math.random() < 0.72) {
      this.presses.add("special");
      this.cooldown = 0.78 + Math.random() * 0.28;
      return;
    }

    if (distance < 95) {
      this.presses.add(Math.random() < 0.54 ? "punch" : "kick");
      this.cooldown = 0.45 + Math.random() * 0.25;
    } else if (distance < 150 && Math.random() < 0.62) {
      this.presses.add("kick");
      this.cooldown = 0.58 + Math.random() * 0.28;
    } else if (self.meter >= 20 && distance < 250 && Math.random() < 0.32) {
      this.presses.add("special");
      this.cooldown = 0.76;
    }
  }

  hold(action) {
    return this.holds.has(action);
  }

  press(action) {
    return this.presses.has(action);
  }
}

class Fighter {
  constructor(config) {
    this.name = config.name;
    this.shortName = config.shortName;
    this.x = config.x;
    this.y = WORLD.floor;
    this.spawnX = config.x;
    this.width = 74;
    this.height = 154;
    this.crouchHeight = 104;
    this.color = config.color;
    this.dark = config.dark;
    this.accent = config.accent;
    this.skin = config.skin;
    this.glow = config.glow;
    this.controls = config.controls;
    this.health = 100;
    this.meter = 0;
    this.wins = 0;
    this.vx = 0;
    this.vy = 0;
    this.facing = config.facing;
    this.onGround = true;
    this.attack = null;
    this.hitstun = 0;
    this.blockstun = 0;
    this.invulnerable = 0;
    this.state = "idle";
    this.combo = 0;
    this.comboTimer = 0;
    this.anim = 0;
    this.guardFlash = 0;
    this.superFlash = 0;
  }

  resetForRound(x, facing) {
    this.x = x;
    this.y = WORLD.floor;
    this.spawnX = x;
    this.vx = 0;
    this.vy = 0;
    this.facing = facing;
    this.health = 100;
    this.meter = clamp(this.meter, 0, 45);
    this.attack = null;
    this.hitstun = 0;
    this.blockstun = 0;
    this.invulnerable = 0;
    this.state = "idle";
    this.combo = 0;
    this.comboTimer = 0;
    this.guardFlash = 0;
    this.superFlash = 0;
  }

  get currentHeight() {
    return this.state === "crouch" || this.state === "blockLow" ? this.crouchHeight : this.height;
  }

  get hurtbox() {
    const h = this.currentHeight;
    return {
      x: this.x - this.width / 2,
      y: this.y - h,
      w: this.width,
      h,
    };
  }

  get centerY() {
    return this.y - this.currentHeight * 0.52;
  }

  canAct() {
    return this.health > 0 && this.hitstun <= 0 && this.blockstun <= 0 && !this.attack;
  }

  isAttackActive() {
    if (!this.attack) return false;
    const { def, elapsed } = this.attack;
    return elapsed >= def.startup && elapsed <= def.startup + def.active;
  }

  isGuarding(command) {
    if (!this.onGround || this.attack || this.hitstun > 0 || this.health <= 0) return false;
    const holdingBack = this.facing === 1 ? command.hold("left") : command.hold("right");
    return command.hold("block") || holdingBack;
  }

  startAttack(kind, gameState) {
    if (!this.canAct()) return;

    let attackKind = kind;
    if (kind === "special") {
      if (this.meter >= 42) {
        attackKind = "super";
        this.meter -= 42;
        this.superFlash = 0.3;
        gameState.flash = 0.18;
        beep("super");
      } else if (this.meter >= 22) {
        this.meter -= 22;
        this.attack = {
          kind: "wave",
          def: {
            ...ATTACKS.elbow,
            duration: 0.42,
            startup: 0.16,
            active: 0.08,
            damage: 8,
          },
          elapsed: 0,
          hitTargets: new Set(),
          spawned: false,
        };
        this.state = "attack";
        return;
      } else {
        attackKind = "elbow";
      }
    }

    this.attack = {
      kind: attackKind,
      def: ATTACKS[attackKind],
      elapsed: 0,
      hitTargets: new Set(),
      spawned: false,
    };
    this.state = "attack";
  }

  getAttackBox() {
    if (!this.attack || this.attack.kind === "wave") return null;
    const def = this.attack.def;
    const h = def.height;
    const w = def.range;
    return {
      x: this.facing === 1 ? this.x + this.width * 0.18 : this.x - this.width * 0.18 - w,
      y: this.y - def.y - h * 0.5,
      w,
      h,
    };
  }

  applyHit(def, attacker, blocked, gameState) {
    const damage = blocked ? def.chip : def.damage;
    this.health = clamp(this.health - damage, 0, 100);
    this.invulnerable = blocked ? 0.05 : 0.08;

    if (blocked) {
      this.blockstun = def.blockStun;
      this.guardFlash = 0.18;
      this.vx = attacker.facing * def.knock * 0.28;
      this.meter = clamp(this.meter + 5, 0, 100);
      attacker.meter = clamp(attacker.meter + def.meter * 0.28, 0, 100);
      gameState.addGuardSpark(this.x - this.facing * 34, this.centerY);
      beep("block");
      return;
    }

    this.hitstun = def.stun;
    this.state = "hit";
    this.vx = attacker.facing * def.knock;
    if (!this.onGround || def.damage >= 13) this.vy = Math.min(this.vy, -230);
    this.combo += 1;
    this.comboTimer = 1.05;
    attacker.meter = clamp(attacker.meter + def.meter, 0, 100);
    gameState.hitStop = Math.max(gameState.hitStop, 0.045);
    gameState.cameraShake = Math.max(gameState.cameraShake, def.shake);
    gameState.addHitSpark(this.x - this.facing * 28, this.centerY, attacker.facing, def.damage >= 13);
    beep("hit");
  }

  update(dt, opponent, command, opponentCommand, gameState) {
    this.anim += dt;
    this.facing = opponent.x > this.x ? 1 : -1;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.guardFlash = Math.max(0, this.guardFlash - dt);
    this.superFlash = Math.max(0, this.superFlash - dt);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.comboTimer === 0) this.combo = 0;

    if (this.health <= 0) {
      this.state = "ko";
      this.attack = null;
      this.vx *= 0.95;
      this.applyPhysics(dt);
      return;
    }

    if (this.hitstun > 0) {
      this.hitstun = Math.max(0, this.hitstun - dt);
      this.applyPhysics(dt);
      if (this.hitstun === 0) this.state = this.onGround ? "idle" : "jump";
      return;
    }

    if (this.blockstun > 0) {
      this.blockstun = Math.max(0, this.blockstun - dt);
      this.state = "block";
      this.applyPhysics(dt);
      if (this.blockstun === 0) this.state = "idle";
      return;
    }

    if (this.attack) {
      this.attack.elapsed += dt;
      this.updateAttack(opponent, opponentCommand, gameState);
      this.applyPhysics(dt, 0.76);
      if (this.attack && this.attack.elapsed >= this.attack.def.duration) {
        this.attack = null;
        this.state = this.onGround ? "idle" : "jump";
      }
      return;
    }

    if (command.press("punch")) this.startAttack("punch", gameState);
    else if (command.press("kick")) this.startAttack("kick", gameState);
    else if (command.press("special")) this.startAttack("special", gameState);

    if (this.attack) {
      this.updateAttack(opponent, opponentCommand, gameState);
      return;
    }

    const left = command.hold("left");
    const right = command.hold("right");
    const down = command.hold("down");
    const backInput = this.facing === 1 ? left && !right : right && !left;
    const blockInput = command.hold("block");
    if (command.press("up") && this.onGround && !down && !blockInput) {
      this.vy = -860;
      this.onGround = false;
      this.state = "jump";
    }

    if (blockInput && !backInput) {
      this.vx *= 0.62;
      this.state = down ? "blockLow" : "block";
    } else if (down && this.onGround) {
      this.vx *= 0.58;
      this.state = "crouch";
    } else {
      const speed = this.onGround ? 430 : 315;
      if (left && !right) this.vx = -speed;
      else if (right && !left) this.vx = speed;
      else this.vx *= this.onGround ? 0.74 : 0.94;

      if (!this.onGround) this.state = "jump";
      else if (backInput) this.state = "backGuard";
      else if (Math.abs(this.vx) > 42) this.state = "walk";
      else this.state = "idle";
    }

    this.applyPhysics(dt);
  }

  updateAttack(opponent, opponentCommand, gameState) {
    if (!this.attack) return;
    const { def, elapsed, hitTargets, kind } = this.attack;

    if (kind === "wave" && elapsed >= def.startup && !this.attack.spawned) {
      gameState.projectiles.push(new Projectile(this));
      this.attack.spawned = true;
      beep("super");
    }

    if (!this.isAttackActive() || hitTargets.has(opponent)) return;

    const attackBox = this.getAttackBox();
    if (!attackBox || !rectsOverlap(attackBox, opponent.hurtbox) || opponent.invulnerable > 0) return;

    const blocked = opponent.isGuarding(opponentCommand);
    opponent.applyHit(def, this, blocked, gameState);
    hitTargets.add(opponent);
  }

  applyPhysics(dt, frictionScale = 1) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (!this.onGround) this.vy += WORLD.gravity * dt;

    if (this.y >= WORLD.floor) {
      this.y = WORLD.floor;
      this.vy = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    this.x = clamp(this.x, WORLD.leftWall, WORLD.rightWall);
    const friction = this.onGround ? 0.86 * frictionScale : 0.985;
    this.vx *= friction;
    if (Math.abs(this.vx) < 7) this.vx = 0;
  }

  draw(context) {
    const bob = Math.sin(this.anim * 7) * (this.state === "idle" ? 3 : 1);
    const walk = Math.sin(this.anim * 13);
    const crouch = this.state === "crouch" || this.state === "blockLow";
    const guardingPose = this.state === "block" || this.state === "blockLow" || this.state === "backGuard";
    const hurtLean = this.state === "hit" ? -this.facing * 13 : 0;
    const attackProgress = this.attack ? this.attack.elapsed / this.attack.def.duration : 0;

    context.save();
    context.translate(this.x, this.y);
    context.scale(this.facing, 1);

    context.save();
    context.globalAlpha = 0.24;
    context.fillStyle = "#000";
    context.beginPath();
    context.ellipse(0, 6, 58, 14, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();

    context.translate(0, crouch ? 28 : bob);
    context.rotate((hurtLean * Math.PI) / 360);

    if (this.guardFlash > 0 || guardingPose) {
      context.save();
      context.globalAlpha = this.guardFlash > 0 ? 0.38 : 0.2;
      context.strokeStyle = this.glow;
      context.lineWidth = this.guardFlash > 0 ? 6 : 4;
      context.beginPath();
      context.arc(16, -92, 62, -1.15, 1.15);
      context.stroke();
      context.restore();
    }

    if (this.superFlash > 0) {
      context.save();
      context.globalAlpha = 0.5 + Math.sin(this.anim * 80) * 0.2;
      context.strokeStyle = "#fff6c9";
      context.lineWidth = 5;
      context.beginPath();
      context.arc(0, -98, 76 + this.superFlash * 50, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }

    const torsoY = crouch ? -86 : -108;
    const headY = crouch ? -142 : -174;
    const legY = crouch ? -56 : -58;
    const armReach = this.attack && this.attack.kind === "punch" && attackProgress > 0.18 && attackProgress < 0.62 ? 45 : 0;
    const kickReach = this.attack && this.attack.kind === "kick" && attackProgress > 0.2 && attackProgress < 0.68 ? 54 : 0;
    const heavyReach =
      this.attack && (this.attack.kind === "elbow" || this.attack.kind === "super") && attackProgress > 0.22 && attackProgress < 0.66
        ? 58
        : 0;
    const charging = this.attack && (this.attack.kind === "wave" || this.attack.kind === "super");

    context.lineCap = "round";
    context.lineJoin = "round";

    context.strokeStyle = this.dark;
    context.lineWidth = 18;
    context.beginPath();
    context.moveTo(-19, legY);
    context.lineTo(-32 - walk * 8, -16);
    context.moveTo(19, legY);
    context.lineTo(33 + walk * 8 + kickReach, -18 - kickReach * 0.15);
    context.stroke();

    context.strokeStyle = this.color;
    context.lineWidth = 10;
    context.beginPath();
    context.moveTo(-19, legY);
    context.lineTo(-32 - walk * 8, -16);
    context.moveTo(19, legY);
    context.lineTo(33 + walk * 8 + kickReach, -18 - kickReach * 0.15);
    context.stroke();

    context.fillStyle = this.dark;
    roundRect(context, -34, torsoY - 36, 68, crouch ? 70 : 86, 8);
    context.fill();
    context.fillStyle = this.color;
    roundRect(context, -28, torsoY - 33, 56, crouch ? 63 : 78, 7);
    context.fill();

    context.fillStyle = this.accent;
    context.fillRect(-28, torsoY - 7, 56, 8);
    context.fillRect(-18, torsoY - 31, 36, 7);

    context.strokeStyle = this.dark;
    context.lineWidth = 15;
    context.beginPath();
    context.moveTo(-27, torsoY - 24);
    context.lineTo(-62, torsoY + 11);
    context.moveTo(27, torsoY - 25);
    context.lineTo(66 + armReach + heavyReach, torsoY - 25 + (charging ? Math.sin(this.anim * 35) * 4 : 0));
    context.stroke();

    context.strokeStyle = this.color;
    context.lineWidth = 9;
    context.beginPath();
    context.moveTo(-27, torsoY - 24);
    context.lineTo(-62, torsoY + 11);
    context.moveTo(27, torsoY - 25);
    context.lineTo(66 + armReach + heavyReach, torsoY - 25 + (charging ? Math.sin(this.anim * 35) * 4 : 0));
    context.stroke();

    context.fillStyle = this.accent;
    context.beginPath();
    context.arc(70 + armReach + heavyReach, torsoY - 25, 14 + (charging ? 3 : 0), 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.arc(-63, torsoY + 12, 12, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = this.skin;
    roundRect(context, -24, headY - 28, 48, 48, 12);
    context.fill();
    context.fillStyle = this.dark;
    context.fillRect(-28, headY - 32, 56, 17);
    context.fillStyle = "#1b1210";
    context.fillRect(5, headY - 8, 18, 5);
    context.fillRect(-20, headY - 8, 13, 5);

    context.fillStyle = this.accent;
    context.fillRect(24, headY - 29, 10, 43);
    context.fillRect(-34, headY - 29, 10, 43);

    if (charging) {
      context.save();
      context.globalAlpha = 0.7;
      context.strokeStyle = this.glow;
      context.lineWidth = 3;
      for (let i = 0; i < 3; i += 1) {
        context.beginPath();
        context.arc(72 + i * 7, torsoY - 25, 20 + i * 13 + Math.sin(this.anim * 14) * 4, 0, Math.PI * 2);
        context.stroke();
      }
      context.restore();
    }

    if (this.state === "ko") {
      context.save();
      context.globalAlpha = 0.18;
      context.fillStyle = "#fff";
      context.fillRect(-34, headY - 5, 68, 5);
      context.restore();
    }

    context.restore();
  }
}

class Projectile {
  constructor(owner) {
    this.owner = owner;
    this.x = owner.x + owner.facing * 74;
    this.y = owner.y - 112;
    this.vx = owner.facing * 640;
    this.life = 1.55;
    this.w = 70;
    this.h = 42;
    this.color = owner.glow;
    this.hit = false;
  }

  get box() {
    return { x: this.x - this.w / 2, y: this.y - this.h / 2, w: this.w, h: this.h };
  }

  update(dt) {
    this.x += this.vx * dt;
    this.life -= dt;
    return this.life > 0 && this.x > -120 && this.x < WORLD.width + 120 && !this.hit;
  }

  draw(context) {
    context.save();
    context.translate(this.x, this.y);
    context.scale(Math.sign(this.vx), 1);
    const gradient = context.createLinearGradient(-42, 0, 54, 0);
    gradient.addColorStop(0, "rgba(255,255,255,0.05)");
    gradient.addColorStop(0.45, this.color);
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
}

class Particle {
  constructor(x, y, color, vx, vy, life, size) {
    this.x = x;
    this.y = y;
    this.color = color;
    this.vx = vx;
    this.vy = vy;
    this.life = life;
    this.maxLife = life;
    this.size = size;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy += 760 * dt;
    this.life -= dt;
    return this.life > 0;
  }

  draw(context) {
    context.save();
    context.globalAlpha = clamp(this.life / this.maxLife, 0, 1);
    context.fillStyle = this.color;
    context.fillRect(this.x, this.y, this.size, this.size);
    context.restore();
  }
}

class Game {
  constructor() {
    this.p1 = new Fighter({
      name: "Riven",
      shortName: "RIVEN",
      x: 330,
      facing: 1,
      color: "#c7352d",
      dark: "#35110d",
      accent: "#f0b64f",
      skin: "#d9a178",
      glow: "#ffcf5a",
      controls: P1_CONTROLS,
    });
    this.p2 = new Fighter({
      name: "Kairo",
      shortName: "KAIRO",
      x: 950,
      facing: -1,
      color: "#287a76",
      dark: "#0d3130",
      accent: "#e9f4d6",
      skin: "#b98466",
      glow: "#4ee4d0",
      controls: P2_CONTROLS,
    });
    this.cpu = new CPUCommand();
    this.p2HumanTimer = 0;
    this.projectiles = [];
    this.particles = [];
    this.round = 1;
    this.timer = 99;
    this.roundState = "ready";
    this.stateClock = 1.25;
    this.hitStop = 0;
    this.cameraShake = 0;
    this.flash = 0;
    this.paused = false;
    this.matchOver = false;
    this.message = "ROUND 1";
    this.announce("ROUND 1", true);
  }

  resetMatch() {
    this.p1.wins = 0;
    this.p2.wins = 0;
    this.p1.meter = 0;
    this.p2.meter = 0;
    this.round = 1;
    this.matchOver = false;
    this.startRound();
  }

  startRound() {
    this.timer = 99;
    this.projectiles = [];
    this.particles = [];
    this.p1.resetForRound(330, 1);
    this.p2.resetForRound(950, -1);
    this.roundState = "ready";
    this.stateClock = 1.1;
    this.message = `ROUND ${this.round}`;
    this.announce(this.message, true);
    beep("start");
  }

  update(dt) {
    if (justPressed.has("KeyR")) this.resetMatch();
    if (justPressed.has("KeyP")) this.paused = !this.paused;
    if (this.paused) return;

    this.flash = Math.max(0, this.flash - dt);
    this.cameraShake = Math.max(0, this.cameraShake - 42 * dt);
    this.p2HumanTimer = Math.max(0, this.p2HumanTimer - dt);

    if (this.hitStop > 0) {
      this.hitStop = Math.max(0, this.hitStop - dt);
      return;
    }

    if (this.roundState !== "fight") {
      this.stateClock -= dt;
      if (this.roundState === "ready" && this.stateClock <= 0) {
        this.roundState = "fight";
        this.stateClock = 0;
        this.announce("FIGHT", true);
      } else if (this.roundState === "over" && this.stateClock <= 0) {
        if (this.matchOver) {
          this.announce(this.p1.wins > this.p2.wins ? "RIVEN WINS" : "KAIRO WINS", true);
        } else {
          this.round += 1;
          this.startRound();
        }
      }
      this.updateParticles(dt);
      return;
    }

    this.timer = Math.max(0, this.timer - dt);

    const p1Command = makeHumanCommand(P1_CONTROLS, true);
    let p2Command = makeHumanCommand(P2_CONTROLS, false);
    if (this.p2HumanTimer <= 0) {
      this.cpu.update(dt, this.p2, this.p1);
      p2Command = this.cpu;
    }

    this.p1.update(dt, this.p2, p1Command, p2Command, this);
    this.p2.update(dt, this.p1, p2Command, p1Command, this);
    this.resolveOverlap();
    this.updateProjectiles(dt, p1Command, p2Command);
    this.updateParticles(dt);

    if (this.p1.health <= 0 || this.p2.health <= 0 || this.timer <= 0) {
      this.finishRound();
    }
  }

  resolveOverlap() {
    const gap = this.p2.x - this.p1.x;
    const minGap = 86;
    if (Math.abs(gap) >= minGap) return;

    const push = (minGap - Math.abs(gap)) / 2;
    const direction = gap >= 0 ? 1 : -1;
    this.p1.x = clamp(this.p1.x - direction * push, WORLD.leftWall, WORLD.rightWall);
    this.p2.x = clamp(this.p2.x + direction * push, WORLD.leftWall, WORLD.rightWall);
  }

  updateProjectiles(dt, p1Command, p2Command) {
    for (const projectile of this.projectiles) {
      const target = projectile.owner === this.p1 ? this.p2 : this.p1;
      const targetCommand = target === this.p1 ? p1Command : p2Command;
      if (!projectile.hit && rectsOverlap(projectile.box, target.hurtbox) && target.invulnerable <= 0) {
        const blocked = target.isGuarding(targetCommand);
        target.applyHit(
          {
            ...ATTACKS.elbow,
            damage: 11,
            chip: 2.2,
            stun: 0.28,
            blockStun: 0.18,
            knock: 290,
            meter: 10,
            shake: 11,
          },
          projectile.owner,
          blocked,
          this
        );
        projectile.hit = true;
      }
    }

    for (let i = 0; i < this.projectiles.length; i += 1) {
      for (let j = i + 1; j < this.projectiles.length; j += 1) {
        const a = this.projectiles[i];
        const b = this.projectiles[j];
        if (a.owner !== b.owner && rectsOverlap(a.box, b.box)) {
          a.hit = true;
          b.hit = true;
          this.addGuardSpark((a.x + b.x) / 2, (a.y + b.y) / 2);
        }
      }
    }

    this.projectiles = this.projectiles.filter((projectile) => projectile.update(dt));
  }

  updateParticles(dt) {
    this.particles = this.particles.filter((particle) => particle.update(dt));
  }

  finishRound() {
    if (this.roundState !== "fight") return;
    let winner = null;
    if (this.p1.health > this.p2.health) winner = this.p1;
    if (this.p2.health > this.p1.health) winner = this.p2;

    if (winner) winner.wins += 1;
    this.roundState = "over";
    this.stateClock = 2.4;
    this.matchOver = this.p1.wins >= 2 || this.p2.wins >= 2 || this.round >= 3;

    const text = winner ? `${winner.shortName} TAKES IT` : "DOUBLE KO";
    this.announce(text, true);
    beep("win");
  }

  announce(text, show) {
    announcer.textContent = text;
    announcer.classList.toggle("is-visible", show);
    clearTimeout(this.announceTimer);
    if (show) {
      this.announceTimer = setTimeout(() => {
        announcer.classList.remove("is-visible");
      }, 940);
    }
  }

  addHitSpark(x, y, direction, heavy) {
    const amount = heavy ? 26 : 16;
    for (let i = 0; i < amount; i += 1) {
      const speed = (heavy ? 420 : 300) * (0.35 + Math.random());
      const angle = (Math.random() - 0.5) * 1.5 + (direction === 1 ? 0 : Math.PI);
      this.particles.push(
        new Particle(
          x,
          y,
          Math.random() < 0.55 ? "#fff3bd" : "#ff533f",
          Math.cos(angle) * speed,
          Math.sin(angle) * speed - Math.random() * 170,
          0.22 + Math.random() * 0.18,
          heavy ? 6 : 4
        )
      );
    }
  }

  addGuardSpark(x, y) {
    for (let i = 0; i < 14; i += 1) {
      const angle = (Math.PI * 2 * i) / 14;
      this.particles.push(
        new Particle(
          x,
          y,
          i % 2 ? "#4ee4d0" : "#f0b64f",
          Math.cos(angle) * (130 + Math.random() * 90),
          Math.sin(angle) * (130 + Math.random() * 90),
          0.18 + Math.random() * 0.16,
          4
        )
      );
    }
  }

  draw() {
    ctx.save();
    if (this.cameraShake > 0) {
      ctx.translate((Math.random() - 0.5) * this.cameraShake, (Math.random() - 0.5) * this.cameraShake);
    }
    drawStage(ctx, this.timer);
    this.projectiles.forEach((projectile) => projectile.draw(ctx));
    this.p1.draw(ctx);
    this.p2.draw(ctx);
    this.particles.forEach((particle) => particle.draw(ctx));
    ctx.restore();

    if (this.flash > 0) {
      ctx.save();
      ctx.globalAlpha = this.flash * 1.8;
      ctx.fillStyle = "#fff2b8";
      ctx.fillRect(0, 0, WORLD.width, WORLD.height);
      ctx.restore();
    }

    drawHud(ctx, this);

    if (this.paused) {
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, WORLD.width, WORLD.height);
      ctx.fillStyle = "#f6ead0";
      ctx.font = "72px Impact, Haettenschweiler, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("PAUSED", WORLD.width / 2, WORLD.height / 2);
      ctx.restore();
    }
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
  drawNeonSign(context, 112, 150, "24H", "#f0b64f");
  drawNeonSign(context, 1015, 176, "VS", "#42cab8");
  drawNeonSign(context, 555, 118, "IRON", "#c7352d");
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

  if (gameState.p2HumanTimer <= 0) {
    context.font = "18px Impact, Haettenschweiler, sans-serif";
    context.fillStyle = "rgba(246,234,208,0.72)";
    context.textAlign = "right";
    context.fillText("CPU", WORLD.width - 54, 104);
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
  context.fillText(`${combo} HIT`, x, y);
  context.restore();
}

const game = new Game();
window.ironCircuitGame = game;

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
  game.update(dt);
  game.draw();
  justPressed.clear();
  touchPressed.clear();
  requestAnimationFrame(frame);
}

window.addEventListener("resize", resizeCanvas);
window.addEventListener("keydown", (event) => {
  initAudio();
  if (!keys.has(event.code)) justPressed.add(event.code);
  keys.add(event.code);
  if (p2ControlCodes.has(event.code)) game.p2HumanTimer = 18;
  if (BLOCKED_KEYS.has(event.code)) event.preventDefault();
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.code);
  if (BLOCKED_KEYS.has(event.code)) event.preventDefault();
});

startButton.addEventListener("click", () => {
  initAudio();
  if (game.matchOver) game.resetMatch();
  else game.paused = !game.paused;
});

resetButton.addEventListener("click", () => {
  initAudio();
  game.resetMatch();
});

muteButton.addEventListener("click", () => {
  muted = !muted;
  muteButton.classList.toggle("is-muted", muted);
  muteButton.textContent = muted ? "M" : "S";
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
requestAnimationFrame(frame);
