// ============================================================
// GAME.JS — Main game loop, state machine, event wiring
// ============================================================

const game = {
  player:       null,
  combat:       null,
  areaIndex:    0,
  encounters:   0,   // encounters in current area (tracks boss threshold)
  selectedClass: null,

  // ---- INIT ----

  init() {
    this._bindTitleScreen();
    this._bindGameButtons();
    this._bindOverlays();
    this._tryLoadSave();
  },

  _tryLoadSave() {
    const saved = localStorage.getItem('rpg_save');
    if (saved) {
      try {
        this.player = Player.load(saved);
        this.areaIndex = parseInt(localStorage.getItem('rpg_area') || '0', 10);
        this.encounters = parseInt(localStorage.getItem('rpg_enc') || '0', 10);
        this._startGame();
        this.log('Welcome back, ' + this.player.name + '!', 'info');
        return;
      } catch(e) {
        localStorage.clear();
      }
    }
  },

  _save() {
    if (!this.player) return;
    localStorage.setItem('rpg_save', this.player.save());
    localStorage.setItem('rpg_area', this.areaIndex);
    localStorage.setItem('rpg_enc', this.encounters);
  },

  // ---- TITLE SCREEN BINDING ----

  _bindTitleScreen() {
    // Class card selection
    document.querySelectorAll('.class-card').forEach(card => {
      card.addEventListener('click', () => {
        document.querySelectorAll('.class-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        game.selectedClass = card.dataset.class;
        document.getElementById('name-form').style.display = 'block';
        document.getElementById('player-name-input').focus();
      });
    });

    // Start button
    document.getElementById('btn-start').addEventListener('click', () => {
      const name = document.getElementById('player-name-input').value.trim();
      if (!name) {
        document.getElementById('player-name-input').placeholder = 'Enter a name!';
        return;
      }
      if (!game.selectedClass) return;
      game.newGame(name, game.selectedClass);
    });

    // Enter key on name input
    document.getElementById('player-name-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('btn-start').click();
    });

    // Restart button
    document.getElementById('btn-restart').addEventListener('click', () => {
      localStorage.clear();
      location.reload();
    });
  },

  // ---- GAME BUTTON BINDING ----

  _bindGameButtons() {
    document.getElementById('btn-explore').addEventListener('click', () => game.explore());
    document.getElementById('btn-shop').addEventListener('click',    () => game.openShop());
    document.getElementById('btn-rest').addEventListener('click',    () => game.rest());
    document.getElementById('btn-travel').addEventListener('click',  () => game.openTravel());

    document.getElementById('btn-shop-close').addEventListener('click', () => {
      UI.showView('view-world');
      UI.renderWorldMap(game.areaIndex);
    });
    document.getElementById('btn-travel-close').addEventListener('click', () => {
      UI.showView('view-world');
    });

    // Combat buttons
    document.getElementById('btn-attack').addEventListener('click', () => {
      if (game.combat) game.combat.attack();
    });
    document.getElementById('btn-item').addEventListener('click', () => {
      game._showCombatItemPicker();
    });
    document.getElementById('btn-flee').addEventListener('click', () => {
      if (game.combat) game.combat.flee();
    });
  },

  _bindOverlays() {
    // loot/levelup handled dynamically in UI methods
  },

  // ---- NEW GAME ----

  newGame(name, className) {
    this.player     = new Player(name, className);
    this.areaIndex  = 0;
    this.encounters = 0;
    // Starting gear
    this.player.addItem('health_potion');
    this.player.addItem('health_potion');
    if (className === 'warrior') this.player.addItem('rusty_sword');
    if (className === 'mage')    this.player.addItem('mana_potion');
    this._startGame();
    this.log(`Welcome, ${name} the ${DATA.classes[className].name}!`, 'info');
    this.log('Use Explore to find enemies, Shop to buy gear, Rest to heal.', 'dim');
    this._save();
  },

  _startGame() {
    UI.showScreen('screen-game');
    UI.showView('view-world');
    UI.renderAll();
    const area = DATA.areas[this.areaIndex];
    UI.updateLocation(area);
    UI.renderWorldMap(this.areaIndex);
  },

  // ---- EXPLORE ----

  explore() {
    const area = DATA.areas[this.areaIndex];

    // Check if boss encounter threshold reached
    const bossReady = this.encounters > 0 && this.encounters % area.bossAt === 0;
    const enemyId   = bossReady
      ? area.bossEnemy
      : area.enemies[Math.floor(Math.random() * area.enemies.length)];

    const enemy = DATA.enemies[enemyId];
    this.encounters++;
    this.log(`You venture into ${area.name}...`, 'dim');
    this.log(`A ${enemy.name} appears!${enemy.isBoss ? ' ★ BOSS ★' : ''}`, enemy.isBoss ? 'gold' : 'bad');
    this._save();
    this._startCombat(enemyId);
  },

  // ---- COMBAT ----

  _startCombat(enemyId) {
    UI.showView('view-combat');
    document.getElementById('combat-log').innerHTML = '';

    this.combat = new CombatEngine(this.player, enemyId, (result) => {
      this._onCombatEnd(result);
    });
    UI.renderAll();
    UI.renderCombat(this.combat);
  },

  _onCombatEnd(result) {
    this.combat = null;

    if (!result.won && !result.fled) {
      // Player died
      this._gameOver();
      return;
    }

    if (result.fled) {
      UI.showView('view-world');
      UI.renderWorldMap(this.areaIndex);
      UI.renderAll();
      this._save();
      return;
    }

    // Won — apply rewards
    this.player.gold += result.gold;
    const levelResults = this.player.gainExp(result.exp);
    UI.renderAll();
    this._save();

    // Show loot first, then level up if applicable
    UI.showLoot(result.loot, () => {
      // Add loot to inventory
      for (const id of result.loot) {
        this.player.addItem(id);
      }
      UI.renderAll();
      this._save();

      if (levelResults.length > 0) {
        UI.showLevelUp(levelResults, () => {
          this._postCombat();
        });
      } else {
        this._postCombat();
      }
    });
  },

  _postCombat() {
    UI.showView('view-world');
    UI.renderWorldMap(this.areaIndex);
    UI.renderAll();
    const area = DATA.areas[this.areaIndex];
    this.log(`You are in ${area.name}.`, 'dim');

    // Auto-save
    this._save();

    // Low HP warning
    const hpPct = this.player.hp / this.player.maxHp;
    if (hpPct < 0.3) {
      this.log('⚠ Low HP! Consider resting or using a potion.', 'bad');
    }
  },

  _showCombatItemPicker() {
    const consumables = this.player.inventory
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => item.type === 'consumable');

    if (consumables.length === 0) {
      this.combat._addLog('No usable items!', 'bad');
      return;
    }

    // Build a small inline picker above the combat buttons
    const existing = document.getElementById('combat-item-picker');
    if (existing) { existing.remove(); return; } // toggle off if already open

    const picker = document.createElement('div');
    picker.id = 'combat-item-picker';
    picker.style.cssText = `
      background:var(--bg2); border:1px solid var(--border); border-radius:6px;
      padding:8px; margin-bottom:8px; display:flex; flex-wrap:wrap; gap:6px;
      grid-column: 1 / -1;`;

    consumables.forEach(({ item, idx }) => {
      const btn = document.createElement('button');
      btn.className = 'combat-btn';
      btn.style.fontSize = '0.75rem';
      btn.textContent = `${item.icon || ''} ${item.name}${item.qty > 1 ? ' ×' + item.qty : ''}`;
      btn.addEventListener('click', () => {
        picker.remove();
        this.combat.useItem(idx);
      });
      picker.appendChild(btn);
    });

    const actionsEl = document.getElementById('combat-actions');
    actionsEl.insertBefore(picker, actionsEl.firstChild);
  },

  // ---- SHOP ----

  openShop() {
    const area = DATA.areas[this.areaIndex];
    UI.showView('view-shop');
    UI.renderShop(area, this.player);
    this._save();
  },

  // ---- REST ----

  rest() {
    const cost = DATA.restCost;
    if (this.player.gold < cost) {
      this.log(`Not enough gold to rest! (${cost} gold needed)`, 'bad');
      return;
    }
    this.player.rest();
    this.log(`You rest at the inn. Fully restored! (-${cost} gold)`, 'good');
    UI.renderAll();
    this._save();
  },

  // ---- TRAVEL ----

  openTravel() {
    UI.showView('view-travel');
    UI.renderTravel(this.areaIndex, this.player);
  },

  travelTo(areaIdx) {
    const area = DATA.areas[areaIdx];
    if (this.player.level < area.levelReq) return;
    this.areaIndex  = areaIdx;
    this.encounters = 0;
    UI.updateLocation(area);
    UI.showView('view-world');
    UI.renderWorldMap(areaIdx);
    this.log(`Traveled to ${area.name}.`, 'info');
    this._save();
  },

  // ---- GAME OVER ----

  _gameOver() {
    const p = this.player;
    document.getElementById('gameover-msg').textContent =
      `${p.name} the ${p.classData.name} fell in battle. ` +
      `Reached Level ${p.level} with ${p.kills} kills.`;
    UI.showScreen('screen-gameover');
    localStorage.clear();
  },

  // ---- LOG ----

  log(msg, type = '') {
    const el = document.getElementById('event-log');
    if (!el) return;
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    line.textContent = msg;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
    // Keep log from getting too long
    while (el.children.length > 80) el.removeChild(el.firstChild);
  },
};

// Boot
document.addEventListener('DOMContentLoaded', () => game.init());
