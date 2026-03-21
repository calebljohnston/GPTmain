# Dungeon Thread

Dungeon Thread is a mobile-first, single-page roguelike RPG starter project.
It replaces the old button demo with a procedural dungeon crawler you can expand
into a deeper game loop.

## Current foundation
- Procedural multi-room dungeon floors.
- Turn-based movement and enemy AI.
- XP, leveling, relics, potions, and energy-based skills.
- Floor-complete upgrade choices for build variety.
- Large touch-friendly controls and a compact viewport for phones.

## Run locally
Open `index.html` directly in a browser, or serve the repo with any static server.

Example:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Good next steps for iteration
- Add classes with unique active/passive abilities.
- Save unlocks and meta-progression in local storage.
- Add ranged enemies, bosses, traps, and quest events.
- Replace tile divs with sprite sheets or canvas rendering.
- Add procedural loot tables, status effects, and equipment slots.
