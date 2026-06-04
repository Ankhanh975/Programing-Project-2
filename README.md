# Minecraft Sword PvP Agent

A small Mineflayer-based agent scaffold for experimenting with Minecraft combat behavior inspired by AlphaGo-style training loops.

## What this project includes

- A Mineflayer client that can join a server, watch for a target player, and follow them.
- Prismarine Physics wired in for movement simulation and future training logic.
- A flat-world-friendly setup assumption for local testing.
- A clean TypeScript project structure with build and run scripts.

## Requirements

- Node.js 20 or newer
- A Minecraft server or local world the bot can join
- A flat world if you want to match the assumed training environment

## Install

```bash
npm install
```

## Configure

Set environment variables before starting the bot:

- `MC_HOST` - server hostname, default `localhost`
- `MC_PORT` - server port, default `25565`
- `MC_USERNAME` - bot username, default `SwordAgent`
- `MC_VERSION` - Minecraft version, default `auto`
- `MC_TARGET` - player name to follow, default `your username`
- `MC_FLY_SPEED` - follow speed while flying, default `0.15`
- `MC_FOLLOW_RADIUS` - distance to maintain from the target, default `3`

## Run

```bash
npm run dev
```

## Server notes

If you are creating a local training world, configure the server as a flat world. For a vanilla server, that usually means setting the level type to `flat` before first launch.

## Bot controls

The bot listens for these chat commands:

- `!follow` - follow the player who sent the command
- `!target <name>` - follow a specific player
- `!stop` - stop following and clear movement controls

The follow loop uses Prismarine Physics against a flat-world model, so it is ready for future training code. If the server grants creative flight or an equivalent movement mode, the same movement logic can be extended to maintain altitude with you in the air.

## Next steps

This scaffold is intentionally small. From here you can add:

- combat policy training
- replay logging
- scripted duel scenarios
- evaluation metrics for PvP decisions
