// ============================================================
// COMBAT.JS — Turn-based combat engine
// ============================================================

class CombatEngine {
  constructor(player, enemyId, onEnd) {
    this.player   = player;
    this.enemyDef = { ...DATA.enemies[enemyId] };
    this.enemy    = {
      id:       this.enemyDef.id,
      name:     this.enemyDef.name,
      sprite:   this.enemyDef.sprite,
      isBoss:   this.enemyDef.isBoss || false,
      maxHp:    this.enemyDef.hp,
      hp:       this.enemyDef.hp,
      atk:      this.enemyDef.atk,
      def:      this.enemyDef.def,
      effects:  [],
    };
    this.onEnd     = onEnd;   // callback(result) where result = { won, fled, loot, exp, gold }
    this.log       = [];
    this.turn      = 1;
    this.playerTurn = true;
    this.ended     = false;
  }

  // ---- PUBLIC ACTIONS ----

  attack() {
    if (!this.playerTurn || this.ended) return;
    this._playerAttack();
    if (!this.ended) this._enemyTurn();
  }

  useSkill(skillId) {
    if (!this.playerTurn || this.ended) return;
    const skill = DATA.skills[skillId];
    if (!skill) return;
    if (this.player.mp < skill.mpCost) {
      this._addLog(`Not enough MP!`, 'bad');
      return;
    }
    this.player.mp -= skill.mpCost;
    this._applySkill(skill);
    if (!this.ended) this._enemyTurn();
  }

  useItem(invIndex) {
    if (!this.playerTurn || this.ended) return;
    const item = this.player.inventory[invIndex];
    if (!item || item.type !== 'consumable') return;
    const results = this.player.useConsumable(invIndex);
    if (results) {
      results.forEach(r => this._addLog(r, 'good'));
      UI.renderAll();
      if (!this.ended) this._enemyTurn();
    }
  }

  flee() {
    if (!this.playerTurn || this.ended) return;
    const chance = this.player.hasEffect('smokescreen') ? 80 : 40 + this.player.dex;
    if (Math.random() * 100 < chance) {
      this._addLog('You fled successfully!', 'info');
      this._end({ won: false, fled: true });
    } else {
      this._addLog('Failed to flee!', 'bad');
      this._enemyTurn();
    }
  }

  // ---- INTERNAL ----

  _playerAttack(multiplier = 1, forceCrit = false, isMagic = false) {
    // Dodge check
    if (Math.random() * 100 < this.enemy.effects.some(e => e.name === 'blind') ? 30 : 5) {
      this._addLog(`${this.enemy.name} dodged your attack!`, 'bad');
      return 0;
    }

    const base = isMagic ? this.player.matk : this.player.atk;
    let dmg = Math.max(1, base - Math.floor(this.enemy.def * 0.6));
    dmg = Math.floor(dmg * multiplier);

    // Crit check
    const critRoll = forceCrit || Math.random() * 100 < this.player.critChance;
    if (critRoll) {
      dmg = Math.floor(dmg * 1.8);
      this._addLog(`Critical hit! ${dmg} damage!`, 'good');
    } else {
      this._addLog(`You deal ${dmg} damage to ${this.enemy.name}.`, 'good');
    }

    this.enemy.hp = Math.max(0, this.enemy.hp - dmg);
    this.player.totalDamage += dmg;

    // Weapon proc effects
    const weapon = this.player.equipped.weapon;
    if (weapon?.effect?.burn && Math.random() < weapon.effect.burn) {
      this._addEffect(this.enemy, 'burn', 3);
      this._addLog(`${this.enemy.name} is set on fire!`, 'good');
    }

    if (this.enemy.hp <= 0) this._victory();
    return dmg;
  }

  _applySkill(skill) {
    this._addLog(`${this.player.name} uses ${skill.icon} ${skill.name}!`, 'info');

    if (skill.target === 'self') {
      if (skill.effect) {
        this.player.addEffect(skill.effect, skill.effectTurns);
        this._addLog(`${skill.effect} applied for ${skill.effectTurns} turns.`, 'info');
      }
      return;
    }

    // Damage skills
    if (skill.multiplier) {
      const dmg = this._playerAttack(skill.multiplier, skill.forceCrit || false, skill.type === 'magic');
      if (dmg > 0 && skill.effect && this.enemy.hp > 0) {
        this._addEffect(this.enemy, skill.effect, skill.effectTurns);
        this._addLog(`${this.enemy.name} is ${skill.effect}ed!`, 'info');
      }
    }
  }

  _enemyTurn() {
    this.turn++;
    this.playerTurn = false;

    // Tick enemy effects
    const efMsgs = this._tickEnemyEffects();
    efMsgs.forEach(m => this._addLog(m.text, m.type));
    if (this.ended) return;

    // Stunned = skip turn
    if (this.enemy.effects.some(e => e.name === 'stun')) {
      this._addLog(`${this.enemy.name} is stunned and skips their turn!`, 'info');
      this._endEnemyTurn();
      return;
    }

    // Slowed = -30% atk
    let atkMod = 1.0;
    if (this.enemy.effects.some(e => e.name === 'slow')) atkMod = 0.7;

    // Enemy attack
    if (Math.random() * 100 < this.player.dodgeChance) {
      this._addLog(`You dodge ${this.enemy.name}'s attack!`, 'good');
    } else {
      let rawDmg = Math.max(1, Math.floor(this.enemy.atk * atkMod) - Math.floor(this.player.def * 0.5));
      // Boss attacks hit harder occasionally
      if (this.enemy.isBoss && Math.random() < 0.25) {
        rawDmg = Math.floor(rawDmg * 1.5);
        this._addLog(`${this.enemy.name} uses a powerful attack! ${rawDmg} damage!`, 'bad');
      } else {
        this._addLog(`${this.enemy.name} attacks for ${rawDmg} damage.`, 'bad');
      }
      this.player.hp = Math.max(0, this.player.hp - rawDmg);
    }

    // Tick player effects
    const pEfMsgs = this.player.tickEffects();
    pEfMsgs.forEach(m => this._addLog(m.text, m.type));

    if (this.player.hp <= 0) {
      this._addLog(`You have been defeated!`, 'bad');
      this._end({ won: false, fled: false });
      return;
    }

    // MP regen
    const regen = this.player.classData.mpRegen;
    this.player.mp = Math.min(this.player.maxMp, this.player.mp + regen);

    this._endEnemyTurn();
  }

  _endEnemyTurn() {
    this.playerTurn = true;
    UI.renderAll();
    UI.renderCombat(this);
  }

  _addEffect(target, name, turns) {
    const existing = target.effects.find(e => e.name === name);
    if (existing) existing.turns = Math.max(existing.turns, turns);
    else target.effects.push({ name, turns });
  }

  _tickEnemyEffects() {
    const msgs = [];
    for (const ef of this.enemy.effects) {
      ef.turns--;
      if (ef.name === 'burn') {
        const dmg = Math.max(1, Math.floor(this.enemy.maxHp * 0.05));
        this.enemy.hp = Math.max(0, this.enemy.hp - dmg);
        msgs.push({ text: `${this.enemy.name} burns for ${dmg} damage!`, type: 'good' });
        if (this.enemy.hp <= 0) { this._victory(); }
      }
    }
    this.enemy.effects = this.enemy.effects.filter(e => e.turns > 0);
    return msgs;
  }

  _victory() {
    if (this.ended) return;
    const goldEarned = this._rollGold();
    const loot       = this._rollLoot();
    const expEarned  = this.enemyDef.exp;

    this._addLog(`${this.enemy.name} is defeated!`, 'good');
    this._addLog(`+${expEarned} EXP  +${goldEarned} Gold`, 'gold');

    this.player.kills++;
    if (this.enemy.isBoss) this.player.bossKills++;

    this._end({ won: true, fled: false, exp: expEarned, gold: goldEarned, loot });
  }

  _rollGold() {
    const [min, max] = this.enemyDef.gold;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  _rollLoot() {
    const drops = [];
    for (const entry of (this.enemyDef.loot || [])) {
      if (Math.random() < entry.chance) {
        drops.push(entry.id);
      }
    }
    return drops;
  }

  _end(result) {
    this.ended = true;
    this.onEnd(result);
  }

  _addLog(text, type = '') {
    this.log.push({ text, type });
    const el = document.getElementById('combat-log');
    if (el) {
      const line = document.createElement('div');
      line.className = `log-line ${type}`;
      line.textContent = text;
      el.appendChild(line);
      el.scrollTop = el.scrollHeight;
    }
  }
}
