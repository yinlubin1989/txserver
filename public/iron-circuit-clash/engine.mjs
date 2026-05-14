export const WORLD = {
  width: 1280,
  height: 720,
  floor: 606,
  leftWall: 70,
  rightWall: 1210,
  gravity: 2300,
};

export const ACTIONS = ["left", "right", "up", "down", "block", "punch", "kick", "special"];

export const ATTACKS = {
  punch: {
    name: "刺拳",
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
    name: "回旋踢",
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
    name: "肘击",
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
    name: "电路爆裂",
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

export const FIGHTER_CONFIGS = {
  p1: {
    name: "瑞文",
    shortName: "瑞文",
    x: 330,
    facing: 1,
    color: "#c7352d",
    dark: "#35110d",
    accent: "#f0b64f",
    skin: "#d9a178",
    glow: "#ffcf5a",
  },
  p2: {
    name: "凯洛",
    shortName: "凯洛",
    x: 950,
    facing: -1,
    color: "#287a76",
    dark: "#0d3130",
    accent: "#e9f4d6",
    skin: "#b98466",
    glow: "#4ee4d0",
  },
};

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

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

class InputCommand {
  constructor(input) {
    this.input = input || createInputState();
  }

  hold(action) {
    return Boolean(this.input.hold[action]);
  }

  press(action) {
    return Boolean(this.input.press[action]);
  }
}

function commandFromInput(input) {
  return new InputCommand(input);
}

class CPUCommand {
  constructor() {
    this.holds = new Set();
    this.presses = new Set();
    this.cooldown = 0.2;
    this.blockWindow = 0;
    this.jumpClock = 1.8;
  }

  update(dt, self, foe, gameState) {
    this.holds.clear();
    this.presses.clear();
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.blockWindow = Math.max(0, this.blockWindow - dt);
    this.jumpClock = Math.max(0, this.jumpClock - dt);

    const distance = Math.abs(foe.x - self.x);
    const foeThreat = foe.attack && foe.isAttackActive() && distance < 180;
    const projectileThreat = gameState.projectiles.some(
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
        gameState.emitSound("super");
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
      gameState.emitSound("block");
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
    gameState.emitSound("hit");
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
      gameState.emitSound("super");
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
}

export class BattleGame {
  constructor({ online = false } = {}) {
    this.online = online;
    this.events = [];
    this.p1 = new Fighter(FIGHTER_CONFIGS.p1);
    this.p2 = new Fighter(FIGHTER_CONFIGS.p2);
    this.cpu = new CPUCommand();
    this.p2HumanTimer = online ? 18 : 0;
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
    this.message = "第 1 回合";
    this.finalAnnounced = false;
    this.resetMatch();
  }

  resetMatch() {
    this.p1.wins = 0;
    this.p2.wins = 0;
    this.p1.meter = 0;
    this.p2.meter = 0;
    this.round = 1;
    this.matchOver = false;
    this.finalAnnounced = false;
    this.paused = false;
    this.startRound();
  }

  markP2Human() {
    if (!this.online) this.p2HumanTimer = 18;
  }

  startRound() {
    this.timer = 99;
    this.projectiles = [];
    this.particles = [];
    this.p1.resetForRound(330, 1);
    this.p2.resetForRound(950, -1);
    this.roundState = "ready";
    this.stateClock = 1.1;
    this.message = `第 ${this.round} 回合`;
    this.finalAnnounced = false;
    this.announce(this.message, true);
    this.emitSound("start");
  }

  setPaused(paused) {
    if (this.online) return;
    this.paused = Boolean(paused);
  }

  togglePaused() {
    if (this.online) return;
    this.paused = !this.paused;
  }

  update(dt, p1Input = createInputState(), p2Input = createInputState()) {
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
        this.announce("开战", true);
      } else if (this.roundState === "over" && this.stateClock <= 0) {
        if (this.matchOver) {
          if (!this.finalAnnounced) {
            this.announce(this.winnerName || "平局", true);
            this.finalAnnounced = true;
          }
        } else {
          this.round += 1;
          this.startRound();
        }
      }
      this.updateParticles(dt);
      return;
    }

    this.timer = Math.max(0, this.timer - dt);

    const p1Command = commandFromInput(normalizeInput(p1Input));
    let p2Command = commandFromInput(normalizeInput(p2Input));
    if (!this.online && this.p2HumanTimer <= 0) {
      this.cpu.update(dt, this.p2, this.p1, this);
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

    const text = winner ? `${winner.shortName} 胜出` : "双双倒地";
    this.announce(text, true);
    this.emitSound("win");
  }

  get winnerName() {
    if (!this.matchOver) return null;
    if (this.p1.wins > this.p2.wins) return "瑞文获胜";
    if (this.p2.wins > this.p1.wins) return "凯洛获胜";
    return "平局";
  }

  announce(text, show) {
    this.message = text;
    this.events.push({ type: "announce", text, show: Boolean(show) });
  }

  emitSound(name) {
    this.events.push({ type: "sound", name });
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

  snapshot() {
    return {
      mode: this.online ? "online" : "offline",
      round: this.round,
      timer: this.timer,
      roundState: this.roundState,
      stateClock: this.stateClock,
      hitStop: this.hitStop,
      cameraShake: this.cameraShake,
      flash: this.flash,
      paused: this.paused,
      matchOver: this.matchOver,
      message: this.message,
      p2HumanTimer: this.p2HumanTimer,
      winnerName: this.winnerName,
      p1: fighterSnapshot(this.p1),
      p2: fighterSnapshot(this.p2),
      projectiles: this.projectiles.map((projectile) => projectileSnapshot(projectile, this)),
      particles: this.particles.map(particleSnapshot),
      events: [],
    };
  }

  consumeSnapshot() {
    const snapshot = this.snapshot();
    snapshot.events = this.events.splice(0);
    return snapshot;
  }
}

function fighterSnapshot(fighter) {
  return {
    name: fighter.name,
    shortName: fighter.shortName,
    x: fighter.x,
    y: fighter.y,
    width: fighter.width,
    height: fighter.height,
    crouchHeight: fighter.crouchHeight,
    currentHeight: fighter.currentHeight,
    color: fighter.color,
    dark: fighter.dark,
    accent: fighter.accent,
    skin: fighter.skin,
    glow: fighter.glow,
    health: fighter.health,
    meter: fighter.meter,
    wins: fighter.wins,
    vx: fighter.vx,
    vy: fighter.vy,
    facing: fighter.facing,
    onGround: fighter.onGround,
    state: fighter.state,
    combo: fighter.combo,
    anim: fighter.anim,
    guardFlash: fighter.guardFlash,
    superFlash: fighter.superFlash,
    attack: fighter.attack
      ? {
          kind: fighter.attack.kind,
          elapsed: fighter.attack.elapsed,
          duration: fighter.attack.def.duration,
        }
      : null,
  };
}

function projectileSnapshot(projectile, gameState) {
  return {
    owner: projectile.owner === gameState.p1 ? 1 : 2,
    x: projectile.x,
    y: projectile.y,
    vx: projectile.vx,
    life: projectile.life,
    w: projectile.w,
    h: projectile.h,
    color: projectile.color,
    hit: projectile.hit,
  };
}

function particleSnapshot(particle) {
  return {
    x: particle.x,
    y: particle.y,
    color: particle.color,
    life: particle.life,
    maxLife: particle.maxLife,
    size: particle.size,
  };
}
