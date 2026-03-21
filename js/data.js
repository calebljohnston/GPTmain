// ============================================================
// DATA.JS — All static game data: classes, items, enemies, areas
// ============================================================

const DATA = {

  // ---- CLASSES ----
  classes: {
    warrior: {
      name: 'Warrior',
      icon: '🗡️',
      baseStats: { hp: 120, mp: 30, str: 12, dex: 7, int: 5, def: 10 },
      mpRegen: 3,
      skills: ['power_strike', 'shield_bash'],
      description: 'Tough melee fighter with high HP and defense.',
    },
    rogue: {
      name: 'Rogue',
      icon: '🗗',
      baseStats: { hp: 85, mp: 45, str: 9, dex: 14, int: 7, def: 6 },
      mpRegen: 5,
      skills: ['backstab', 'smoke_bomb'],
      description: 'Swift striker with high crit and dodge chance.',
    },
    mage: {
      name: 'Mage',
      icon: '🔮',
      baseStats: { hp: 65, mp: 90, str: 5, dex: 8, int: 15, def: 4 },
      mpRegen: 12,
      skills: ['fireball', 'ice_lance'],
      description: 'Fragile spellcaster with devastating magic.',
    },
  },

  // ---- SKILLS ----
  skills: {
    power_strike: {
      name: 'Power Strike',
      mpCost: 8,
      icon: '💥',
      desc: 'Deal 150% physical damage.',
      type: 'physical',
      multiplier: 1.5,
      target: 'enemy',
    },
    shield_bash: {
      name: 'Shield Bash',
      mpCost: 10,
      icon: '🛡',
      desc: 'Deal damage and stun enemy for 1 turn.',
      type: 'physical',
      multiplier: 0.8,
      effect: 'stun',
      effectTurns: 1,
      target: 'enemy',
    },
    backstab: {
      name: 'Backstab',
      mpCost: 12,
      icon: '🗡',
      desc: 'Deal 200% damage, always crits.',
      type: 'physical',
      multiplier: 2.0,
      forceCrit: true,
      target: 'enemy',
    },
    smoke_bomb: {
      name: 'Smoke Bomb',
      mpCost: 15,
      icon: '💨',
      desc: 'Greatly increase flee chance for 2 turns.',
      type: 'utility',
      effect: 'smokescreen',
      effectTurns: 2,
      target: 'self',
    },
    fireball: {
      name: 'Fireball',
      mpCost: 18,
      icon: '🔥',
      desc: 'Deal 200% magic damage. Burns for 3 turns.',
      type: 'magic',
      multiplier: 2.0,
      effect: 'burn',
      effectTurns: 3,
      target: 'enemy',
    },
    ice_lance: {
      name: 'Ice Lance',
      mpCost: 14,
      icon: '❄️',
      desc: 'Deal 160% magic damage. Slows enemy.',
      type: 'magic',
      multiplier: 1.6,
      effect: 'slow',
      effectTurns: 2,
      target: 'enemy',
    },
  },

  // ---- ITEMS ----
  items: {
    // Consumables
    health_potion: {
      id: 'health_potion', name: 'Health Potion', icon: '🧪',
      type: 'consumable', rarity: 'common',
      desc: 'Restores 40 HP.', effect: { heal: 40 },
      value: 20,
    },
    greater_health_potion: {
      id: 'greater_health_potion', name: 'Greater Health Potion', icon: '🧪',
      type: 'consumable', rarity: 'uncommon',
      desc: 'Restores 100 HP.', effect: { heal: 100 },
      value: 60,
    },
    mana_potion: {
      id: 'mana_potion', name: 'Mana Potion', icon: '💙',
      type: 'consumable', rarity: 'common',
      desc: 'Restores 30 MP.', effect: { mana: 30 },
      value: 20,
    },
    elixir: {
      id: 'elixir', name: 'Elixir', icon: '✨',
      type: 'consumable', rarity: 'rare',
      desc: 'Restores 80 HP and 40 MP.', effect: { heal: 80, mana: 40 },
      value: 120,
    },

    // Weapons
    rusty_sword: {
      id: 'rusty_sword', name: 'Rusty Sword', icon: '🗡️',
      type: 'weapon', rarity: 'common',
      desc: 'A worn but serviceable blade.', slot: 'weapon',
      stats: { atk: 4 }, value: 40,
    },
    iron_sword: {
      id: 'iron_sword', name: 'Iron Sword', icon: '🗡️',
      type: 'weapon', rarity: 'common',
      desc: 'Solid iron sword.', slot: 'weapon',
      stats: { atk: 8 }, value: 120,
    },
    steel_sword: {
      id: 'steel_sword', name: 'Steel Sword', icon: '⚔️',
      type: 'weapon', rarity: 'uncommon',
      desc: 'Sharp and well-balanced.', slot: 'weapon',
      stats: { atk: 14, str: 2 }, value: 300,
    },
    assassin_dagger: {
      id: 'assassin_dagger', name: "Assassin's Dagger", icon: '🗡️',
      type: 'weapon', rarity: 'uncommon',
      desc: '+15% crit chance.', slot: 'weapon',
      stats: { atk: 10, crit: 15 }, value: 280,
    },
    magic_staff: {
      id: 'magic_staff', name: 'Magic Staff', icon: '🪄',
      type: 'weapon', rarity: 'uncommon',
      desc: 'Amplifies magic damage.', slot: 'weapon',
      stats: { atk: 6, int: 5, matk: 12 }, value: 320,
    },
    flame_blade: {
      id: 'flame_blade', name: 'Flame Blade', icon: '🔥',
      type: 'weapon', rarity: 'rare',
      desc: 'Attacks may burn the target.', slot: 'weapon',
      stats: { atk: 18, str: 3 }, effect: { burn: 0.2 }, value: 700,
    },
    arcane_tome: {
      id: 'arcane_tome', name: 'Arcane Tome', icon: '📕',
      type: 'weapon', rarity: 'rare',
      desc: 'Ancient spellbook. High magic power.', slot: 'weapon',
      stats: { atk: 4, int: 10, matk: 20 }, value: 750,
    },

    // Armor
    leather_armor: {
      id: 'leather_armor', name: 'Leather Armor', icon: '🥋',
      type: 'armor', rarity: 'common',
      desc: 'Basic protection.', slot: 'armor',
      stats: { def: 4 }, value: 50,
    },
    chainmail: {
      id: 'chainmail', name: 'Chainmail', icon: '🛡',
      type: 'armor', rarity: 'common',
      desc: 'Metal rings woven together.', slot: 'armor',
      stats: { def: 9 }, value: 180,
    },
    plate_armor: {
      id: 'plate_armor', name: 'Plate Armor', icon: '⚙️',
      type: 'armor', rarity: 'uncommon',
      desc: 'Heavy but highly protective.', slot: 'armor',
      stats: { def: 16, str: 1 }, value: 400,
    },
    mage_robe: {
      id: 'mage_robe', name: "Mage's Robe", icon: '👘',
      type: 'armor', rarity: 'uncommon',
      desc: 'Enhances magical ability.', slot: 'armor',
      stats: { def: 5, int: 4, mp: 30 }, value: 350,
    },
    dragon_scale: {
      id: 'dragon_scale', name: 'Dragon Scale Armor', icon: '🐉',
      type: 'armor', rarity: 'epic',
      desc: 'Forged from dragon scales.', slot: 'armor',
      stats: { def: 28, str: 4, hp: 40 }, value: 2000,
    },

    // Accessories
    ring_strength: {
      id: 'ring_strength', name: 'Ring of Strength', icon: '💍',
      type: 'accessory', rarity: 'uncommon',
      desc: '+4 Strength.', slot: 'accessory',
      stats: { str: 4 }, value: 200,
    },
    amulet_vitality: {
      id: 'amulet_vitality', name: 'Amulet of Vitality', icon: '📿',
      type: 'accessory', rarity: 'uncommon',
      desc: '+30 max HP.', slot: 'accessory',
      stats: { hp: 30 }, value: 250,
    },
    lucky_charm: {
      id: 'lucky_charm', name: 'Lucky Charm', icon: '🍀',
      type: 'accessory', rarity: 'rare',
      desc: '+10% crit, +5% dodge.', slot: 'accessory',
      stats: { crit: 10, dodge: 5 }, value: 600,
    },
  },

  // ---- ENEMIES ----
  enemies: {
    // Area 0 - Village Outskirts
    rat: {
      id: 'rat', name: 'Giant Rat', sprite: '🐀',
      hp: 18, atk: 4, def: 1, exp: 12, gold: [1,4],
      loot: [{ id: 'health_potion', chance: 0.15 }],
    },
    goblin: {
      id: 'goblin', name: 'Goblin', sprite: '👺',
      hp: 28, atk: 7, def: 2, exp: 20, gold: [2,8],
      loot: [
        { id: 'health_potion', chance: 0.2 },
        { id: 'rusty_sword', chance: 0.08 },
      ],
    },
    wolf: {
      id: 'wolf', name: 'Forest Wolf', sprite: '🐺',
      hp: 35, atk: 9, def: 3, exp: 28, gold: [3,10],
      loot: [{ id: 'health_potion', chance: 0.15 }],
    },

    // Area 1 - Dark Forest
    goblin_shaman: {
      id: 'goblin_shaman', name: 'Goblin Shaman', sprite: '🧙',
      hp: 45, atk: 12, def: 4, exp: 45, gold: [6,16],
      loot: [
        { id: 'mana_potion', chance: 0.3 },
        { id: 'leather_armor', chance: 0.1 },
      ],
    },
    orc: {
      id: 'orc', name: 'Orc Warrior', sprite: '👹',
      hp: 65, atk: 15, def: 7, exp: 55, gold: [8,20],
      loot: [
        { id: 'health_potion', chance: 0.2 },
        { id: 'iron_sword', chance: 0.08 },
        { id: 'chainmail', chance: 0.06 },
      ],
    },
    bandit: {
      id: 'bandit', name: 'Bandit', sprite: '🦹',
      hp: 52, atk: 14, def: 5, exp: 48, gold: [10,25],
      loot: [
        { id: 'health_potion', chance: 0.25 },
        { id: 'rusty_sword', chance: 0.15 },
      ],
    },

    // Area 2 - Ruins
    skeleton: {
      id: 'skeleton', name: 'Skeleton', sprite: '💀',
      hp: 80, atk: 18, def: 8, exp: 70, gold: [10,28],
      loot: [
        { id: 'health_potion', chance: 0.2 },
        { id: 'iron_sword', chance: 0.1 },
      ],
    },
    ghost: {
      id: 'ghost', name: 'Wraith', sprite: '👻',
      hp: 70, atk: 22, def: 5, exp: 80, gold: [12,30],
      loot: [
        { id: 'mana_potion', chance: 0.3 },
        { id: 'mage_robe', chance: 0.07 },
      ],
    },
    golem: {
      id: 'golem', name: 'Stone Golem', sprite: '🪨',
      hp: 120, atk: 16, def: 18, exp: 95, gold: [15,35],
      loot: [
        { id: 'greater_health_potion', chance: 0.2 },
        { id: 'ring_strength', chance: 0.06 },
      ],
    },

    // Area 3 - Dragon's Lair
    wyvern: {
      id: 'wyvern', name: 'Wyvern', sprite: '🦎',
      hp: 160, atk: 28, def: 15, exp: 150, gold: [25,60],
      loot: [
        { id: 'greater_health_potion', chance: 0.3 },
        { id: 'flame_blade', chance: 0.05 },
      ],
    },
    demon: {
      id: 'demon', name: 'Demon Knight', sprite: '😈',
      hp: 180, atk: 32, def: 18, exp: 180, gold: [30,70],
      loot: [
        { id: 'elixir', chance: 0.2 },
        { id: 'plate_armor', chance: 0.08 },
        { id: 'dragon_scale', chance: 0.03 },
      ],
    },

    // BOSSES
    goblin_king: {
      id: 'goblin_king', name: 'Goblin King', sprite: '👑',
      hp: 150, atk: 20, def: 10, exp: 200, gold: [30,60],
      isBoss: true,
      loot: [
        { id: 'steel_sword', chance: 0.5 },
        { id: 'chainmail', chance: 0.5 },
        { id: 'elixir', chance: 0.4 },
      ],
    },
    lich: {
      id: 'lich', name: 'The Lich', sprite: '🧟',
      hp: 300, atk: 35, def: 20, exp: 500, gold: [80,150],
      isBoss: true,
      loot: [
        { id: 'arcane_tome', chance: 0.6 },
        { id: 'amulet_vitality', chance: 0.5 },
        { id: 'dragon_scale', chance: 0.2 },
      ],
    },
    ancient_dragon: {
      id: 'ancient_dragon', name: 'Ancient Dragon', sprite: '🐉',
      hp: 600, atk: 50, def: 30, exp: 1200, gold: [200,400],
      isBoss: true,
      loot: [
        { id: 'dragon_scale', chance: 0.8 },
        { id: 'flame_blade', chance: 0.6 },
        { id: 'lucky_charm', chance: 0.4 },
      ],
    },
  },

  // ---- AREAS ----
  areas: [
    {
      id: 'village_outskirts',
      name: 'Village Outskirts',
      icon: '🌿',
      desc: 'Rolling hills and farmland near the village.',
      levelReq: 1,
      enemies: ['rat', 'goblin', 'wolf'],
      bossEnemy: 'goblin_king',
      bossAt: 10, // boss appears after N encounters
      shopItems: ['health_potion', 'mana_potion', 'rusty_sword', 'leather_armor', 'health_potion', 'health_potion'],
    },
    {
      id: 'dark_forest',
      name: 'Dark Forest',
      icon: '🌲',
      desc: 'A gloomy forest teeming with dangerous creatures.',
      levelReq: 5,
      enemies: ['goblin_shaman', 'orc', 'bandit'],
      bossEnemy: 'goblin_king',
      bossAt: 8,
      shopItems: ['health_potion', 'greater_health_potion', 'mana_potion', 'iron_sword', 'chainmail', 'assassin_dagger'],
    },
    {
      id: 'ancient_ruins',
      name: 'Ancient Ruins',
      icon: '🏛️',
      desc: 'Crumbling ruins haunted by the undead.',
      levelReq: 10,
      enemies: ['skeleton', 'ghost', 'golem'],
      bossEnemy: 'lich',
      bossAt: 8,
      shopItems: ['greater_health_potion', 'elixir', 'mana_potion', 'steel_sword', 'plate_armor', 'mage_robe', 'magic_staff', 'ring_strength', 'amulet_vitality'],
    },
    {
      id: 'dragons_lair',
      name: "Dragon's Lair",
      icon: '🔥',
      desc: "The dragon's volcanic stronghold.",
      levelReq: 18,
      enemies: ['wyvern', 'demon'],
      bossEnemy: 'ancient_dragon',
      bossAt: 6,
      shopItems: ['elixir', 'greater_health_potion', 'flame_blade', 'arcane_tome', 'dragon_scale', 'lucky_charm'],
    },
  ],

  // ---- LEVEL UP TABLE ----
  // exp needed to reach level N
  expTable: [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200, 4000,
             5000, 6200, 7600, 9200, 11000, 13200, 15700, 18500, 21600, 25000],

  // ---- REST OPTIONS ----
  restCost: 20, // gold cost to rest and restore HP/MP
};
