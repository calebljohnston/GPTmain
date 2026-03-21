const GRID_SIZE = 17;
const VIEW_SIZE = 11;
const DIRECTIONS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const upgrades = [
  {
    key: "vigor",
    name: "Vigor Core",
    description: "+8 max HP and heal 8 instantly.",
    apply: (state) => {
      state.player.maxHp += 8;
      state.player.hp = Math.min(state.player.maxHp, state.player.hp + 8);
    },
  },
  {
    key: "edge",
    name: "Sharpened Edge",
    description: "+2 attack for stronger basic hits.",
    apply: (state) => {
      state.player.attack += 2;
    },
  },
  {
    key: "guard",
    name: "Aegis Plating",
    description: "+2 defense to reduce incoming damage.",
    apply: (state) => {
      state.player.defense += 2;
    },
  },
  {
    key: "focus",
    name: "Focus Battery",
    description: "+2 max energy and refill it.",
    apply: (state) => {
      state.player.maxEnergy += 2;
      state.player.energy = state.player.maxEnergy;
    },
  },
  {
    key: "alchemy",
    name: "Field Alchemy",
    description: "+1 potion and +5 heal value.",
    apply: (state) => {
      state.player.potions += 1;
      state.player.healPower += 5;
    },
  },
];

const state = {
  floor: 1,
  turn: 0,
  map: [],
  rooms: [],
  items: [],
  enemies: [],
  exit: null,
  pendingUpgrade: null,
  log: [],
  player: {},
};

const elements = {
  map: document.getElementById("map"),
  log: document.getElementById("log"),
  floor: document.getElementById("floor-label"),
  turn: document.getElementById("turn-label"),
  goal: document.getElementById("goal-label"),
  hp: document.getElementById("hp-label"),
  attack: document.getElementById("attack-label"),
  defense: document.getElementById("defense-label"),
  energy: document.getElementById("energy-label"),
  potions: document.getElementById("potions-label"),
  relics: document.getElementById("relics-label"),
  xp: document.getElementById("xp-label"),
  xpBar: document.getElementById("xp-bar"),
  upgrades: document.getElementById("upgrade-options"),
  newRun: document.getElementById("new-run"),
};

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(list) {
  return [...list].sort(() => Math.random() - 0.5);
}

function createInitialPlayer() {
  return {
    x: 0,
    y: 0,
    hp: 30,
    maxHp: 30,
    attack: 6,
    defense: 1,
    energy: 3,
    maxEnergy: 3,
    potions: 2,
    healPower: 12,
    relics: 0,
    xp: 0,
    level: 1,
    xpToNext: 18,
  };
}

function addLog(message, tone = "") {
  state.log.unshift({ message, tone });
  state.log = state.log.slice(0, 10);
}

function carveRoom(room) {
  for (let y = room.y; y < room.y + room.h; y += 1) {
    for (let x = room.x; x < room.x + room.w; x += 1) {
      state.map[y][x] = "floor";
    }
  }
}

function carveHallway(from, to) {
  let x = from.centerX;
  let y = from.centerY;

  while (x !== to.centerX) {
    state.map[y][x] = "floor";
    x += x < to.centerX ? 1 : -1;
  }

  while (y !== to.centerY) {
    state.map[y][x] = "floor";
    y += y < to.centerY ? 1 : -1;
  }

  state.map[y][x] = "floor";
}

function generateFloor() {
  state.map = Array.from({ length: GRID_SIZE }, () => Array.from({ length: GRID_SIZE }, () => "wall"));
  state.rooms = [];
  state.items = [];
  state.enemies = [];

  let attempts = 0;
  while (state.rooms.length < 5 && attempts < 40) {
    attempts += 1;
    const room = {
      x: randomInt(1, GRID_SIZE - 6),
      y: randomInt(1, GRID_SIZE - 6),
      w: randomInt(3, 5),
      h: randomInt(3, 5),
    };
    room.centerX = Math.floor(room.x + room.w / 2);
    room.centerY = Math.floor(room.y + room.h / 2);

    const overlaps = state.rooms.some(
      (other) =>
        room.x <= other.x + other.w + 1 &&
        room.x + room.w + 1 >= other.x &&
        room.y <= other.y + other.h + 1 &&
        room.y + room.h + 1 >= other.y,
    );

    if (!overlaps) {
      carveRoom(room);
      if (state.rooms.length > 0) {
        carveHallway(state.rooms[state.rooms.length - 1], room);
      }
      state.rooms.push(room);
    }
  }

  const startRoom = state.rooms[0];
  const finalRoom = state.rooms[state.rooms.length - 1];
  state.player.x = startRoom.centerX;
  state.player.y = startRoom.centerY;
  state.exit = { x: finalRoom.centerX, y: finalRoom.centerY };

  state.rooms.slice(1, -1).forEach((room, index) => {
    if (index < state.floor + 1) {
      state.enemies.push({
        x: room.centerX,
        y: room.centerY,
        hp: 10 + state.floor * 3,
        maxHp: 10 + state.floor * 3,
        attack: 4 + state.floor,
        defense: Math.floor(state.floor / 2),
        xp: 8 + state.floor * 2,
      });
    }
  });

  const itemRooms = shuffle(state.rooms.slice(1, -1));
  itemRooms.slice(0, 2).forEach((room, index) => {
    state.items.push({
      x: room.centerX,
      y: room.centerY + (index % 2),
      type: index === 0 ? "potion" : "relic",
    });
  });

  addLog(`Floor ${state.floor} generated. Hunt relics, gather XP, and find the exit.`, "positive");
}

function gainXp(amount) {
  state.player.xp += amount;
  while (state.player.xp >= state.player.xpToNext) {
    state.player.xp -= state.player.xpToNext;
    state.player.level += 1;
    state.player.xpToNext = Math.floor(state.player.xpToNext * 1.3);
    state.player.maxHp += 4;
    state.player.hp = state.player.maxHp;
    state.player.attack += 1;
    state.player.defense += 1;
    addLog(`Level up! You are now level ${state.player.level}. Stats improved across the board.`, "positive");
  }
}

function getEnemyAt(x, y) {
  return state.enemies.find((enemy) => enemy.x === x && enemy.y === y);
}

function getItemAt(x, y) {
  return state.items.find((item) => item.x === x && item.y === y);
}

function removeItem(target) {
  state.items = state.items.filter((item) => item !== target);
}

function isWalkable(x, y) {
  return x >= 0 && y >= 0 && x < GRID_SIZE && y < GRID_SIZE && state.map[y][x] === "floor";
}

function applyEnemyTurn() {
  state.enemies.forEach((enemy) => {
    const deltaX = state.player.x - enemy.x;
    const deltaY = state.player.y - enemy.y;
    const distance = Math.abs(deltaX) + Math.abs(deltaY);

    if (distance === 1) {
      const damage = Math.max(1, enemy.attack - state.player.defense);
      state.player.hp -= damage;
      addLog(`Enemy hits you for ${damage}.`, "danger");
      return;
    }

    if (distance <= 6) {
      const stepX = deltaX === 0 ? 0 : deltaX / Math.abs(deltaX);
      const stepY = deltaY === 0 ? 0 : deltaY / Math.abs(deltaY);
      const options = [
        { x: enemy.x + stepX, y: enemy.y },
        { x: enemy.x, y: enemy.y + stepY },
      ];

      const destination = options.find(
        (candidate) =>
          isWalkable(candidate.x, candidate.y) &&
          !getEnemyAt(candidate.x, candidate.y) &&
          !(candidate.x === state.player.x && candidate.y === state.player.y),
      );

      if (destination) {
        enemy.x = destination.x;
        enemy.y = destination.y;
      }
    }
  });

  if (state.player.hp <= 0) {
    addLog("You were defeated. Tap New Run to try another build.", "danger");
  }
}

function spendTurn() {
  if (state.player.hp <= 0) {
    render();
    return;
  }

  state.turn += 1;
  state.player.energy = Math.min(state.player.maxEnergy, state.player.energy + 1);
  applyEnemyTurn();
  render();
}

function attackEnemy(enemy, modifier = 0) {
  const baseDamage = Math.max(1, state.player.attack + modifier - enemy.defense);
  enemy.hp -= baseDamage;
  addLog(`You strike for ${baseDamage} damage.`, "positive");

  if (enemy.hp <= 0) {
    addLog(`Enemy defeated. +${enemy.xp} XP.`, "positive");
    gainXp(enemy.xp);
    state.enemies = state.enemies.filter((candidate) => candidate !== enemy);
  }
}

function collectItem(item) {
  if (item.type === "potion") {
    state.player.potions += 1;
    addLog("You found an extra potion.", "positive");
  }
  if (item.type === "relic") {
    state.player.relics += 1;
    state.player.attack += 1;
    addLog("Relic claimed. Attack permanently increased by 1.", "positive");
  }
  removeItem(item);
}

function movePlayer(direction) {
  if (state.pendingUpgrade || state.player.hp <= 0) {
    return;
  }

  const delta = DIRECTIONS[direction];
  const targetX = state.player.x + delta.x;
  const targetY = state.player.y + delta.y;

  if (!isWalkable(targetX, targetY)) {
    addLog("A wall blocks your route.", "warning");
    render();
    return;
  }

  const enemy = getEnemyAt(targetX, targetY);
  if (enemy) {
    attackEnemy(enemy);
    spendTurn();
    return;
  }

  state.player.x = targetX;
  state.player.y = targetY;

  const item = getItemAt(targetX, targetY);
  if (item) {
    collectItem(item);
  }

  if (targetX === state.exit.x && targetY === state.exit.y) {
    state.pendingUpgrade = shuffle(upgrades).slice(0, 3);
    elements.goal.textContent = "Choose an upgrade to descend";
    addLog("Exit reached. Choose one upgrade to continue deeper.", "warning");
    render();
    return;
  }

  spendTurn();
}

function usePotion() {
  if (state.pendingUpgrade || state.player.hp <= 0) {
    return;
  }
  if (state.player.potions <= 0) {
    addLog("No potions left.", "warning");
    render();
    return;
  }

  state.player.potions -= 1;
  state.player.hp = Math.min(state.player.maxHp, state.player.hp + state.player.healPower);
  addLog(`Potion used. Restored ${state.player.healPower} HP.`, "positive");
  spendTurn();
}

function waitTurn() {
  if (state.pendingUpgrade || state.player.hp <= 0) {
    return;
  }
  state.player.hp = Math.min(state.player.maxHp, state.player.hp + 2);
  addLog("You hold position and recover 2 HP.", "positive");
  spendTurn();
}

function burstStrike() {
  if (state.pendingUpgrade || state.player.hp <= 0) {
    return;
  }
  if (state.player.energy < 2) {
    addLog("Not enough energy for Burst Strike.", "warning");
    render();
    return;
  }

  const nearbyEnemy = state.enemies.find(
    (enemy) => Math.abs(enemy.x - state.player.x) + Math.abs(enemy.y - state.player.y) === 1,
  );

  if (!nearbyEnemy) {
    addLog("Burst Strike needs an adjacent enemy.", "warning");
    render();
    return;
  }

  state.player.energy -= 2;
  attackEnemy(nearbyEnemy, 4);
  addLog("Burst Strike lands with extra force.", "positive");
  spendTurn();
}

function chooseUpgrade(key) {
  const picked = state.pendingUpgrade?.find((upgrade) => upgrade.key === key);
  if (!picked) {
    return;
  }

  picked.apply(state);
  addLog(`${picked.name} installed. Descending to floor ${state.floor + 1}.`, "positive");
  state.floor += 1;
  state.pendingUpgrade = null;
  elements.goal.textContent = "Reach the exit";
  generateFloor();
  render();
}

function getVisibleTiles() {
  const startX = Math.max(0, Math.min(GRID_SIZE - VIEW_SIZE, state.player.x - Math.floor(VIEW_SIZE / 2)));
  const startY = Math.max(0, Math.min(GRID_SIZE - VIEW_SIZE, state.player.y - Math.floor(VIEW_SIZE / 2)));
  const tiles = [];

  for (let y = startY; y < startY + VIEW_SIZE; y += 1) {
    for (let x = startX; x < startX + VIEW_SIZE; x += 1) {
      let kind = state.map[y][x];
      if (x === state.exit.x && y === state.exit.y) kind = "exit";
      if (getItemAt(x, y)?.type === "relic") kind = "relic";
      if (getItemAt(x, y)?.type === "potion") kind = "potion";
      if (getEnemyAt(x, y)) kind = "enemy";
      if (x === state.player.x && y === state.player.y) kind = "hero";
      tiles.push(kind);
    }
  }

  return tiles;
}

function renderMap() {
  const visibleTiles = getVisibleTiles();
  elements.map.innerHTML = visibleTiles
    .map((tile) => `<div class="tile ${tile}" aria-hidden="true"></div>`)
    .join("");
}

function renderStats() {
  elements.floor.textContent = state.floor;
  elements.turn.textContent = state.turn;
  elements.hp.textContent = `${Math.max(0, state.player.hp)} / ${state.player.maxHp}`;
  elements.attack.textContent = state.player.attack;
  elements.defense.textContent = state.player.defense;
  elements.energy.textContent = `${state.player.energy} / ${state.player.maxEnergy}`;
  elements.potions.textContent = state.player.potions;
  elements.relics.textContent = state.player.relics;
  elements.xp.textContent = `${state.player.xp} / ${state.player.xpToNext}`;
  elements.xpBar.style.width = `${(state.player.xp / state.player.xpToNext) * 100}%`;
}

function renderLog() {
  elements.log.innerHTML = state.log
    .map((entry) => `<li class="${entry.tone}">${entry.message}</li>`)
    .join("");
}

function renderUpgrades() {
  if (!state.pendingUpgrade) {
    elements.upgrades.innerHTML = '<p class="hint">Clear a floor, then choose a specialization for the next one.</p>';
    return;
  }

  elements.upgrades.innerHTML = state.pendingUpgrade
    .map(
      (upgrade) => `
        <button class="upgrade-card active" data-upgrade="${upgrade.key}">
          <strong>${upgrade.name}</strong>
          <span>${upgrade.description}</span>
        </button>
      `,
    )
    .join("");
}

function render() {
  renderMap();
  renderStats();
  renderUpgrades();
  renderLog();
}

function startRun() {
  state.floor = 1;
  state.turn = 0;
  state.player = createInitialPlayer();
  state.pendingUpgrade = null;
  state.log = [];
  elements.goal.textContent = "Reach the exit";
  addLog("New run started. Explore carefully and keep your potion for a clutch moment.", "positive");
  generateFloor();
  render();
}

document.querySelectorAll("[data-move]").forEach((button) => {
  button.addEventListener("click", () => movePlayer(button.dataset.move));
});

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.dataset.action;
    if (action === "heal") usePotion();
    if (action === "wait") waitTurn();
    if (action === "burst") burstStrike();
  });
});

elements.upgrades.addEventListener("click", (event) => {
  const button = event.target.closest("[data-upgrade]");
  if (button) {
    chooseUpgrade(button.dataset.upgrade);
  }
});

elements.newRun.addEventListener("click", startRun);

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (key === "arrowup" || key === "w") movePlayer("up");
  if (key === "arrowdown" || key === "s") movePlayer("down");
  if (key === "arrowleft" || key === "a") movePlayer("left");
  if (key === "arrowright" || key === "d") movePlayer("right");
  if (key === " ") {
    event.preventDefault();
    waitTurn();
  }
  if (key === "f") burstStrike();
  if (key === "q") usePotion();
});

startRun();
