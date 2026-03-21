// ============================================================
// PLAYER.JS — Player character, stats, leveling, inventory
// ============================================================

class Player {
  constructor(name, className) {
    const cls = DATA.classes[className];
    const base = cls.baseStats;

    this.name      = name;
    this.className = className;
    this.classData = cls;

    // Base stats (from class + permanent upgrades)
    this.baseHp    = base.hp;
    this.baseMp    = base.mp;
    this.baseStr   = base.str;
    this.baseDex   = base.dex;
    this.baseInt   = base.int;
    this.baseDef   = base.def;

    // Level / progression
    this.level  = 1;
    this.exp    = 0;

    // Resources
    this.hp     = this.maxHp;
    this.mp     = this.maxMp;
    this.gold   = 50;

    // Inventory & equipment
    this.inventory = [];
    this.equipped  = { weapon: null, armor: null, accessory: null };

    // Skills
    this.skills = [...cls.skills];

    // Status effects
    this.effects = [];

    // Counters
    this.kills        = 0;
    this.bossKills    = 0;
    this.totalDamage  = 0;
  }

  // ---- COMPUTED STATS ----

  get maxHp() {
    let v = this.baseHp + (this.level - 1) * 8;
    v += this._equipBonus('hp');
    return v;
  }
  get maxMp() {
    let v = this.baseMp + (this.level - 1) * 4;
    v += this._equipBonus('mp');
    return v;
  }
  get str() { return this.baseStr + this._equipBonus('str'); }
  get dex() { return this.baseDex + this._equipBonus('dex'); }
  get int() { return this.baseInt + this._equipBonus('int'); }

  get def() {
    let v = this.baseDef + this._equipBonus('def');
    if (this.hasEffect('slow')) v = Math.floor(v * 0.8);
    return v;
  }

  get atk() {
    const weaponAtk = this._equipBonus('atk');
    const baseAtk = Math.floor(this.str * 1.2) + weaponAtk;
    return baseAtk;
  }

  get matk() {
    return Math.floor(this.int * 1.5) + this._equipBonus('matk');
  }

  get critChance() {
    // base 5% + dex scaling + equipment
    return 5 + Math.floor(this.dex * 0.5) + this._equipBonus('crit');
  }

  get dodgeChance() {
    // base 3% + dex scaling + equipment
    let v = 3 + Math.floor(this.dex * 0.4) + this._equipBonus('dodge');
    if (this.hasEffect('smokescreen')) v += 40;
    return Math.min(v, 60);
  }

  _equipBonus(stat) {
    let total = 0;
    for (const slot of Object.values(this.equipped)) {
      if (slot && slot.stats && slot.stats[stat]) {
        total += slot.stats[stat];
      }
    }
    return total;
  }

  // ---- LEVELING ----

  get expToNext() {
    const table = DATA.expTable;
    return this.level < table.length ? table[this.level] : Infinity;
  }

  get expProgress() {
    const prev = DATA.expTable[this.level - 1] || 0;
    const next = this.expToNext;
    return (this.exp - prev) / (next - prev);
  }

  gainExp(amount) {
    this.exp += amount;
    const results = [];
    while (this.exp >= this.expToNext && this.level < DATA.expTable.length - 1) {
      this.level++;
      // Restore HP/MP on level up
      this.hp = Math.min(this.hp + Math.floor(this.maxHp * 0.3), this.maxHp);
      this.mp = Math.min(this.mp + Math.floor(this.maxMp * 0.3), this.maxMp);
      results.push(this._levelUpGains());
    }
    return results; // array of gain objects for each level gained
  }

  _levelUpGains() {
    // Per-level stat gains by class
    const gains = {
      warrior: { hp: 10, mp: 2, str: 2, dex: 1, int: 0, def: 2 },
      rogue:   { hp: 6,  mp: 3, str: 1, dex: 3, int: 1, def: 1 },
      mage:    { hp: 4,  mp: 6, str: 0, dex: 1, int: 3, def: 0 },
    };
    const g = gains[this.className];
    this.baseHp  += g.hp;
    this.baseMp  += g.mp;
    this.baseStr += g.str;
    this.baseDex += g.dex;
    this.baseInt += g.int;
    this.baseDef += g.def;
    return { level: this.level, gains: g };
  }

  // ---- INVENTORY ----

  addItem(itemId) {
    const item = DATA.items[itemId];
    if (!item) return false;
    // Stack consumables
    const existing = this.inventory.find(i => i.id === itemId && i.type === 'consumable');
    if (existing) {
      existing.qty = (existing.qty || 1) + 1;
    } else {
      this.inventory.push({ ...item, qty: item.type === 'consumable' ? 1 : undefined });
    }
    return true;
  }

  removeItem(invIndex) {
    const item = this.inventory[invIndex];
    if (!item) return null;
    if (item.type === 'consumable' && item.qty > 1) {
      item.qty--;
      return { ...item };
    }
    return this.inventory.splice(invIndex, 1)[0];
  }

  dropItem(invIndex) {
    // Unequip first if needed
    const item = this.inventory[invIndex];
    if (item && item.slot) {
      if (this.equipped[item.slot] === item) this.equipped[item.slot] = null;
    }
    return this.inventory.splice(invIndex, 1)[0];
  }

  equipItem(invIndex) {
    const item = this.inventory[invIndex];
    if (!item || !item.slot) return null;
    // Unequip current in that slot
    if (this.equipped[item.slot]) {
      this.unequipSlot(item.slot);
    }
    this.equipped[item.slot] = item;
    // Remove from inventory list (it's "equipped" now, shown separately)
    this.inventory.splice(invIndex, 1);
    // Clamp HP/MP
    this.hp = Math.min(this.hp, this.maxHp);
    this.mp = Math.min(this.mp, this.maxMp);
    return item;
  }

  unequipSlot(slot) {
    const item = this.equipped[slot];
    if (!item) return null;
    this.equipped[slot] = null;
    this.inventory.push(item);
    this.hp = Math.min(this.hp, this.maxHp);
    this.mp = Math.min(this.mp, this.maxMp);
    return item;
  }

  useConsumable(invIndex) {
    const item = this.inventory[invIndex];
    if (!item || item.type !== 'consumable') return null;
    const results = [];
    if (item.effect.heal) {
      const healed = Math.min(item.effect.heal, this.maxHp - this.hp);
      this.hp += healed;
      results.push(`Restored ${healed} HP.`);
    }
    if (item.effect.mana) {
      const restored = Math.min(item.effect.mana, this.maxMp - this.mp);
      this.mp += restored;
      results.push(`Restored ${restored} MP.`);
    }
    this.removeItem(invIndex);
    return results;
  }

  // ---- STATUS EFFECTS ----

  addEffect(name, turns) {
    const existing = this.effects.find(e => e.name === name);
    if (existing) {
      existing.turns = Math.max(existing.turns, turns);
    } else {
      this.effects.push({ name, turns });
    }
  }

  hasEffect(name) {
    return this.effects.some(e => e.name === name);
  }

  tickEffects() {
    const msgs = [];
    for (const ef of this.effects) {
      ef.turns--;
      if (ef.name === 'burn') {
        const dmg = Math.max(1, Math.floor(this.maxHp * 0.04));
        this.hp = Math.max(0, this.hp - dmg);
        msgs.push({ text: `You are burning! -${dmg} HP`, type: 'bad' });
      }
      if (ef.name === 'regen') {
        const heal = Math.max(1, Math.floor(this.maxHp * 0.05));
        this.hp = Math.min(this.maxHp, this.hp + heal);
        msgs.push({ text: `HP regenerated: +${heal}`, type: 'good' });
      }
    }
    this.effects = this.effects.filter(e => e.turns > 0);
    return msgs;
  }

  clearEffects() { this.effects = []; }

  // ---- REST ----

  rest() {
    if (this.gold < DATA.restCost) return false;
    this.gold -= DATA.restCost;
    this.hp = this.maxHp;
    this.mp = this.maxMp;
    this.clearEffects();
    return true;
  }

  // ---- SERIALIZATION ----

  save() {
    return JSON.stringify({
      name: this.name, className: this.className,
      baseHp: this.baseHp, baseMp: this.baseMp,
      baseStr: this.baseStr, baseDex: this.baseDex,
      baseInt: this.baseInt, baseDef: this.baseDef,
      level: this.level, exp: this.exp, hp: this.hp, mp: this.mp,
      gold: this.gold, inventory: this.inventory,
      equippedIds: {
        weapon:    this.equipped.weapon?.id    || null,
        armor:     this.equipped.armor?.id     || null,
        accessory: this.equipped.accessory?.id || null,
      },
      skills: this.skills, effects: this.effects,
      kills: this.kills, bossKills: this.bossKills,
    });
  }

  static load(json) {
    const d = JSON.parse(json);
    const p = new Player(d.name, d.className);
    Object.assign(p, {
      baseHp: d.baseHp, baseMp: d.baseMp,
      baseStr: d.baseStr, baseDex: d.baseDex,
      baseInt: d.baseInt, baseDef: d.baseDef,
      level: d.level, exp: d.exp, hp: d.hp, mp: d.mp,
      gold: d.gold, inventory: d.inventory,
      skills: d.skills, effects: d.effects || [],
      kills: d.kills || 0, bossKills: d.bossKills || 0,
    });
    // Re-link equipped items by id
    for (const [slot, id] of Object.entries(d.equippedIds)) {
      p.equipped[slot] = id ? DATA.items[id] : null;
    }
    return p;
  }
}
