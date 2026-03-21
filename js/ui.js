// ============================================================
// UI.JS — All DOM rendering
// ============================================================

const UI = {

  // ---- SCREENS ----

  showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  },

  showView(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  },

  // ---- FULL RENDER ----

  renderAll() {
    if (!window.game || !game.player) return;
    this.renderPlayerStats(game.player);
    this.renderInventory(game.player);
    this.renderSkills(game.player);
  },

  // ---- PLAYER STATS ----

  renderPlayerStats(p) {
    document.getElementById('ui-player-name').textContent = p.name;
    document.getElementById('ui-player-class').textContent = p.classData.icon + ' ' + p.classData.name;
    document.getElementById('ui-level').textContent = p.level;

    // EXP bar
    const expPct = Math.min(100, Math.round(p.expProgress * 100));
    document.getElementById('bar-exp').style.width = expPct + '%';
    const prevExp = DATA.expTable[p.level - 1] || 0;
    document.getElementById('ui-exp-text').textContent =
      `${p.exp - prevExp}/${p.expToNext - prevExp}`;

    // HP bar
    const hpPct = Math.min(100, Math.round((p.hp / p.maxHp) * 100));
    document.getElementById('bar-hp').style.width = hpPct + '%';
    document.getElementById('ui-hp-text').textContent = `${p.hp}/${p.maxHp}`;

    // MP bar
    const mpPct = Math.min(100, Math.round((p.mp / p.maxMp) * 100));
    document.getElementById('bar-mp').style.width = mpPct + '%';
    document.getElementById('ui-mp-text').textContent = `${p.mp}/${p.maxMp}`;

    document.getElementById('ui-atk').textContent  = p.atk;
    document.getElementById('ui-def').textContent  = p.def;
    document.getElementById('ui-gold').textContent = p.gold;
  },

  // ---- SKILLS ----

  renderSkills(p) {
    const list = document.getElementById('skill-list');
    list.innerHTML = '';
    for (const sid of p.skills) {
      const sk = DATA.skills[sid];
      if (!sk) continue;
      const el = document.createElement('div');
      el.className = 'skill-entry';
      el.innerHTML = `
        <span class="skill-name">${sk.icon} ${sk.name}</span>
        <span class="skill-cost">${sk.mpCost} MP</span>
        <div class="skill-desc">${sk.desc}</div>`;
      list.appendChild(el);
    }
  },

  // ---- INVENTORY ----

  renderInventory(p) {
    // Inventory list
    const invEl = document.getElementById('inventory-list');
    invEl.innerHTML = '';
    if (p.inventory.length === 0) {
      invEl.innerHTML = '<div style="color:var(--dim);font-size:0.72rem;">Empty</div>';
    }
    p.inventory.forEach((item, idx) => {
      const el = this._buildInvItemEl(item, idx, p, false);
      invEl.appendChild(el);
    });

    // Equipped slots
    const eqEl = document.getElementById('equipped-list');
    eqEl.innerHTML = '';
    const slots = { weapon: '⚔ Weapon', armor: '🛡 Armor', accessory: '💍 Accessory' };
    for (const [slot, label] of Object.entries(slots)) {
      const item = p.equipped[slot];
      if (item) {
        const el = this._buildInvItemEl(item, slot, p, true);
        eqEl.appendChild(el);
      } else {
        const el = document.createElement('div');
        el.className = 'inv-item';
        el.style.color = 'var(--dim)';
        el.textContent = label + ': —';
        eqEl.appendChild(el);
      }
    }
  },

  _buildInvItemEl(item, idxOrSlot, p, isEquipped) {
    const el = document.createElement('div');
    el.className = `inv-item ${isEquipped ? 'equipped' : ''}`;
    const qty = item.qty && item.qty > 1 ? ` ×${item.qty}` : '';
    const rarityClass = 'rarity-' + (item.rarity || 'common');
    let statsStr = '';
    if (item.stats) {
      statsStr = Object.entries(item.stats).map(([k, v]) => `${k.toUpperCase()}+${v}`).join(' ');
    }
    el.innerHTML = `
      <div class="inv-item-name ${rarityClass}">${item.icon || ''} ${item.name}${qty}</div>
      <div class="inv-item-type">${item.type}${item.slot ? ' · ' + item.slot : ''}</div>
      ${statsStr ? `<div class="inv-item-stats">${statsStr}</div>` : ''}
      <div class="item-actions"></div>`;

    const actionsEl = el.querySelector('.item-actions');

    if (isEquipped) {
      const btn = document.createElement('button');
      btn.className = 'item-action-btn';
      btn.textContent = 'Unequip';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        p.unequipSlot(idxOrSlot);
        this.renderAll();
      });
      actionsEl.appendChild(btn);
    } else {
      if (item.type === 'consumable') {
        const btn = document.createElement('button');
        btn.className = 'item-action-btn use';
        btn.textContent = 'Use';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const realIdx = p.inventory.indexOf(item);
          const msgs = p.useConsumable(realIdx);
          if (msgs) msgs.forEach(m => game.log(m, 'good'));
          this.renderAll();
        });
        actionsEl.appendChild(btn);
      }
      if (item.slot) {
        const btn = document.createElement('button');
        btn.className = 'item-action-btn';
        btn.textContent = 'Equip';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const realIdx = p.inventory.indexOf(item);
          p.equipItem(realIdx);
          this.renderAll();
        });
        actionsEl.appendChild(btn);
      }
      const drop = document.createElement('button');
      drop.className = 'item-action-btn drop';
      drop.textContent = 'Drop';
      drop.addEventListener('click', (e) => {
        e.stopPropagation();
        const realIdx = p.inventory.indexOf(item);
        p.dropItem(realIdx);
        this.renderAll();
        game.log(`Dropped ${item.name}.`, 'dim');
      });
      actionsEl.appendChild(drop);
    }
    return el;
  },

  // ---- COMBAT ----

  renderCombat(combat) {
    const e = combat.enemy;
    document.getElementById('ui-enemy-name').textContent =
      (e.isBoss ? '★ BOSS ★ ' : '') + e.name;
    document.getElementById('ui-enemy-sprite').textContent = e.sprite;

    const hpPct = Math.max(0, Math.round((e.hp / e.maxHp) * 100));
    document.getElementById('bar-enemy-hp').style.width = hpPct + '%';
    document.getElementById('ui-enemy-hp').textContent  = `${e.hp}/${e.maxHp}`;

    // Skill buttons
    const skillsEl = document.getElementById('combat-skills');
    skillsEl.innerHTML = '';
    for (const sid of combat.player.skills) {
      const sk = DATA.skills[sid];
      if (!sk) continue;
      const btn = document.createElement('button');
      btn.className = 'combat-btn skill-btn';
      btn.textContent = `${sk.icon} ${sk.name} (${sk.mpCost}MP)`;
      btn.disabled = combat.player.mp < sk.mpCost || !combat.playerTurn;
      btn.addEventListener('click', () => combat.useSkill(sid));
      skillsEl.appendChild(btn);
    }

    // Enable/disable action buttons
    const busy = !combat.playerTurn;
    document.getElementById('btn-attack').disabled = busy;
    document.getElementById('btn-item').disabled   = busy;
    document.getElementById('btn-flee').disabled   = busy;
  },

  // ---- SHOP ----

  renderShop(area, player) {
    const el = document.getElementById('shop-inventory');
    el.innerHTML = '';
    for (const itemId of area.shopItems) {
      const item = DATA.items[itemId];
      if (!item) continue;
      const row = document.createElement('div');
      row.className = 'shop-item';
      let statsStr = '';
      if (item.stats) {
        statsStr = Object.entries(item.stats).map(([k,v]) => `${k}+${v}`).join(' ');
      }
      row.innerHTML = `
        <div class="shop-item-info">
          <div class="shop-item-name rarity-${item.rarity}">${item.icon || ''} ${item.name}</div>
          <div class="shop-item-desc">${item.desc}${statsStr ? ' · ' + statsStr : ''}</div>
        </div>
        <span class="shop-item-price">💰 ${item.value}</span>`;
      const btn = document.createElement('button');
      btn.className = 'shop-item-buy';
      btn.textContent = 'Buy';
      btn.disabled = player.gold < item.value;
      btn.addEventListener('click', () => {
        if (player.gold < item.value) return;
        player.gold -= item.value;
        player.addItem(item.id);
        game.log(`Bought ${item.name} for ${item.value} gold.`, 'gold');
        this.renderAll();
        this.renderShop(area, player); // refresh
      });
      row.appendChild(btn);
      el.appendChild(row);
    }
  },

  // ---- TRAVEL ----

  renderTravel(currentAreaIdx, player) {
    const el = document.getElementById('area-list');
    el.innerHTML = '';
    DATA.areas.forEach((area, idx) => {
      const locked = player.level < area.levelReq;
      const isCurrent = idx === currentAreaIdx;
      const div = document.createElement('div');
      div.className = `area-option ${locked ? 'locked' : ''}`;
      div.innerHTML = `
        <div>
          <div class="area-name">${area.icon} ${area.name} ${isCurrent ? '(current)' : ''}</div>
          <div class="area-desc">${area.desc}</div>
          ${locked ? `<div class="area-req">Requires Level ${area.levelReq}</div>` : ''}
        </div>
        <div class="area-level">Lvl ${area.levelReq}+</div>`;
      if (!locked && !isCurrent) {
        div.addEventListener('click', () => game.travelTo(idx));
      }
      el.appendChild(div);
    });
  },

  // ---- LOOT OVERLAY ----

  showLoot(lootIds, onClose) {
    const overlay = document.getElementById('loot-overlay');
    const list    = document.getElementById('loot-list');
    list.innerHTML = '';
    if (lootIds.length === 0) {
      list.innerHTML = '<div class="loot-entry"><span class="loot-name">Nothing dropped.</span></div>';
    } else {
      for (const id of lootIds) {
        const item = DATA.items[id];
        if (!item) continue;
        const el = document.createElement('div');
        el.className = 'loot-entry';
        el.innerHTML = `<span class="loot-name rarity-${item.rarity}">${item.icon || ''} ${item.name}</span>
          <div class="loot-desc">${item.desc}</div>`;
        list.appendChild(el);
      }
    }
    overlay.classList.remove('hidden');
    document.getElementById('btn-loot-ok').onclick = () => {
      overlay.classList.add('hidden');
      onClose();
    };
  },

  // ---- LEVEL UP OVERLAY ----

  showLevelUp(levelResults, onClose) {
    const overlay = document.getElementById('levelup-overlay');
    const msg     = document.getElementById('levelup-msg');
    const choices = document.getElementById('levelup-stat-choices');

    // Show all gained levels
    const lines = levelResults.map(r => `Level ${r.level}!`).join('  ');
    msg.textContent = lines;

    // Stat choice: pick one bonus stat to boost
    choices.innerHTML = '';
    const bonusOptions = [
      { label: '+15 Max HP', apply: p => { p.baseHp += 15; p.hp = Math.min(p.hp + 15, p.maxHp); } },
      { label: '+8 Max MP',  apply: p => { p.baseMp += 8;  p.mp = Math.min(p.mp + 8, p.maxMp); } },
      { label: '+3 STR',     apply: p => { p.baseStr += 3; } },
      { label: '+3 DEX',     apply: p => { p.baseDex += 3; } },
      { label: '+3 INT',     apply: p => { p.baseInt += 3; } },
      { label: '+2 DEF',     apply: p => { p.baseDef += 2; } },
    ];
    bonusOptions.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'stat-choice-btn';
      btn.textContent = opt.label;
      btn.addEventListener('click', () => {
        opt.apply(game.player);
        UI.renderAll();
        overlay.classList.add('hidden');
        onClose();
      });
      choices.appendChild(btn);
    });

    overlay.classList.remove('hidden');
    document.getElementById('btn-levelup-ok').onclick = null; // must pick a stat
  },

  // ---- WORLD MAP ----

  renderWorldMap(areaIdx) {
    const grid = document.getElementById('world-map-grid');
    grid.innerHTML = '';
    // Simple 5×5 grid representation
    const icons = ['🌿','🌲','🏛️','🔥','🏔️','🌊','🏜️','🌾','🗻','❄️',
                   '🏕️','🌉','🏚️','⛩️','🌙','🌄','🦌','🍄','🪨','🌺'];
    for (let i = 0; i < 25; i++) {
      const cell = document.createElement('div');
      cell.className = 'map-cell';
      if (i === 12) {
        cell.textContent = '🧍'; // player in center
        cell.classList.add('player');
      } else {
        const area = DATA.areas[areaIdx];
        cell.textContent = icons[(i + areaIdx * 3) % icons.length];
        cell.classList.add('explored');
      }
      grid.appendChild(cell);
    }
  },

  // ---- LOCATION BAR ----

  updateLocation(area) {
    document.getElementById('ui-location').textContent = area.icon + ' ' + area.name;
    document.getElementById('ui-area-level').textContent = `Recommended Lvl ${area.levelReq}+`;
  },
};
