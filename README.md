# Minecraft Sword PvP Agent

This repo now has one consistent goal: a sword-duel bot that can run against a real Minecraft server or in a local prismarine-physics duel harness.

The decision-making layer now uses a small MCTS planner. In local physics mode, both fighters search over a handful of candidate combat actions and roll out short futures before choosing a move. In server mode, the same search is used against a flat-world approximation so the runtime stays consistent.

## What it does

- Runs a Mineflayer bot that seeks the nearest player or a named opponent and fights with a sword.
- Reuses the same combat decision logic in a local prismarine-physics duel between two simulated fighters.
- Keeps one entrypoint: [src/bot.ts](src/bot.ts).

## Run modes

Server mode:

```bash
npm run dev
```

Physics duel mode:

```bash
npm run dev -- --mode physics
```

## Configuration

Common options come from environment variables or CLI flags:

- `MC_HOST` / `--host` - server hostname, default `localhost`
- `MC_PORT` / `--port` - server port, default `25565`
- `MC_USERNAME` / `--username` - bot username, default `SwordAgent`
- `MC_VERSION` / `--version` - Minecraft version, default `auto`
- `MC_TARGET` / `--opponent` - opponent player name, otherwise the nearest player is used
- `RUN_MODE` / `--mode` - `server` or `physics`
- `DUEL_ATTACK_REACH` / `--attack-reach` - melee range threshold, default `3.05`
- `DUEL_TICK_MS` / `--tick-ms` - combat loop interval in server mode, default `100`
- `DUEL_TIMEOUT_MS` / `--fight-timeout-ms` - optional timeout in server mode
- `MCTS_ITERATIONS` / `--mcts-iterations` - search budget per decision, default `10`
- `MCTS_ROLLOUT_DEPTH` / `--rollout-depth` - rollout horizon for search, default `2`

## Notes

- Server mode is for real multiplayer fights against another bot or player.
- Physics mode is a local simulation and is useful for tuning movement and melee intent without connecting to a server.
- The shared combat logic lives in [src/combat.ts](src/combat.ts).
