import { pathToFileURL } from 'node:url';
import mineflayer, { type Bot } from 'mineflayer';
import { Physics } from 'prismarine-physics';
import { createFlatWorld, createSimulatedFighter, runPhysicsDuel, searchCombatIntent, type ControlState } from './combat.js';

type RuntimeMode = 'server' | 'physics';

type BotConfigInput = {
  host?: string;
  port?: string;
  username?: string;
  version?: string;
  opponent?: string;
  mode?: string;
  attackReach?: string;
  tickMs?: string;
  fightTimeoutMs?: string;
  mctsIterations?: string;
  rolloutDepth?: string;
};

type BotConfig = {
  host: string;
  port: number;
  username: string;
  version?: string;
  opponent?: string;
  mode: RuntimeMode;
  attackReach: number;
  tickMs: number;
  fightTimeoutMs: number;
  mctsIterations: number;
  rolloutDepth: number;
};

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseMode(value: string | undefined): RuntimeMode {
  return value === 'physics' ? 'physics' : 'server';
}

function resolveConfig(input: BotConfigInput): BotConfig {
  return {
    host: input.host ?? 'localhost',
    port: parseNumber(input.port, 25565),
    username: input.username ?? 'SwordAgent',
    version: input.version && input.version !== 'auto' ? input.version : undefined,
    opponent: input.opponent,
    mode: parseMode(input.mode),
    attackReach: parseNumber(input.attackReach, 3.05),
    tickMs: parseNumber(input.tickMs, 100),
    fightTimeoutMs: parseNumber(input.fightTimeoutMs, 0),
    mctsIterations: parseNumber(input.mctsIterations, 10),
    rolloutDepth: parseNumber(input.rolloutDepth, 2),
  };
}

export function createBot(input: BotConfigInput) {
  const config = resolveConfig(input);
  const bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    version: config.version,
  });

  attachCombatLoop(bot, config);
  return bot;
}

export function runRuntime(input: BotConfigInput) {
  const config = resolveConfig(input);

  if (config.mode === 'physics') {
    return runPhysicsDuel({
      version: config.version,
      leftName: `${config.username}-A`,
      rightName: config.opponent ?? `${config.username}-B`,
    });
  }

  return createBot(input);
}

function attachCombatLoop(bot: Bot, config: BotConfig) {
  let fightTimer: ReturnType<typeof setInterval> | undefined;
  let fightStartTime = 0;

  bot.once('spawn', () => {
    void equipBestSword(bot);
    bot.chat('Sword duel bot online.');

    const arena = createFlatWorld(bot.version);
    const physics = Physics(arena.mcData, arena.world);

    fightStartTime = Date.now();
    fightTimer = setInterval(() => {
      if (config.fightTimeoutMs > 0 && Date.now() - fightStartTime > config.fightTimeoutMs) {
        bot.chat('Fight timeout reached.');
        bot.quit();
        return;
      }

      const target = findTarget(bot, config.opponent);
      if (!target) {
        bot.clearControlStates();
        return;
      }

      const botEntity = bot.entity as any;
      const targetEntity = target as any;

      const selfSnapshot = createSimulatedFighter(bot.username, bot.version, bot.entity.position);
      selfSnapshot.entity.velocity = botEntity.velocity.clone();
      selfSnapshot.entity.onGround = botEntity.onGround;
      selfSnapshot.entity.isInWater = botEntity.isInWater ?? false;
      selfSnapshot.entity.isInLava = botEntity.isInLava ?? false;
      selfSnapshot.entity.isInWeb = botEntity.isInWeb ?? false;
      selfSnapshot.entity.isCollidedHorizontally = botEntity.isCollidedHorizontally ?? false;
      selfSnapshot.entity.isCollidedVertically = botEntity.isCollidedVertically ?? false;
      selfSnapshot.entity.elytraFlying = botEntity.elytraFlying ?? false;
      selfSnapshot.entity.yaw = botEntity.yaw;
      selfSnapshot.entity.pitch = botEntity.pitch;
      selfSnapshot.jumpTicks = botEntity.jumpTicks ?? 0;
      selfSnapshot.jumpQueued = (bot as any).jumpQueued ?? false;
      selfSnapshot.fireworkRocketDuration = (bot as any).fireworkRocketDuration ?? 0;

      const targetSnapshot = createSimulatedFighter(target.username ?? config.opponent ?? 'Opponent', bot.version, target.position);
      targetSnapshot.entity.velocity = targetEntity.velocity.clone();
      targetSnapshot.entity.onGround = targetEntity.onGround;
      targetSnapshot.entity.isInWater = targetEntity.isInWater ?? false;
      targetSnapshot.entity.isInLava = targetEntity.isInLava ?? false;
      targetSnapshot.entity.isInWeb = targetEntity.isInWeb ?? false;
      targetSnapshot.entity.isCollidedHorizontally = targetEntity.isCollidedHorizontally ?? false;
      targetSnapshot.entity.isCollidedVertically = targetEntity.isCollidedVertically ?? false;
      targetSnapshot.entity.elytraFlying = targetEntity.elytraFlying ?? false;
      targetSnapshot.entity.yaw = targetEntity.yaw;
      targetSnapshot.entity.pitch = targetEntity.pitch;

      const intent = searchCombatIntent({
        self: selfSnapshot,
        target: targetSnapshot,
        physics,
        world: arena.world,
        config: {
          attackReach: config.attackReach,
          iterations: config.mctsIterations,
          rolloutDepth: config.rolloutDepth,
        },
      });

      applyControls(bot, intent.controls);
      void bot.lookAt(target.position.offset(0, 1.5, 0), true).catch(() => undefined);

      if (intent.attack) {
        void bot.attack(target);
      }
    }, config.tickMs);
  });

  bot.on('end', () => {
    if (fightTimer) {
      clearInterval(fightTimer);
      fightTimer = undefined;
    }
  });

  bot.on('kicked', (reason) => {
    console.log('Bot kicked:', reason);
  });

  bot.on('error', (error) => {
    console.error('Bot error:', error);
  });
}

function findTarget(bot: Bot, opponentName?: string) {
  if (opponentName) {
    return bot.players[opponentName]?.entity;
  }

  const nearbyPlayers = Object.values(bot.players)
    .map((entry) => entry.entity)
    .filter((entity): entity is NonNullable<typeof entity> => Boolean(entity) && entity.username !== bot.username);

  return nearbyPlayers[0];
}

function applyControls(bot: Bot, controls: ControlState) {
  bot.setControlState('forward', controls.forward);
  bot.setControlState('back', controls.back);
  bot.setControlState('left', controls.left);
  bot.setControlState('right', controls.right);
  bot.setControlState('jump', controls.jump);
  bot.setControlState('sprint', controls.sprint);
  bot.setControlState('sneak', controls.sneak);
}

async function equipBestSword(bot: Bot) {
  const preferredSwords = ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword', 'golden_sword'];
  const sword = bot.inventory.items().find((item) => preferredSwords.includes(item.name));

  if (!sword) {
    console.log('No sword found in inventory; fighting bare-handed.');
    return;
  }

  await bot.equip(sword, 'hand');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  runRuntime({
    host: firstDefined(args.host, process.env.MC_HOST),
    port: firstDefined(args.port, process.env.MC_PORT),
    username: firstDefined(args.username, process.env.MC_USERNAME),
    version: firstDefined(args.version, process.env.MC_VERSION),
    opponent: firstDefined(args.opponent, process.env.MC_TARGET),
    mode: firstDefined(args.mode, process.env.RUN_MODE),
    attackReach: firstDefined(args['attack-reach'], process.env.DUEL_ATTACK_REACH),
    tickMs: firstDefined(args['tick-ms'], process.env.DUEL_TICK_MS),
    fightTimeoutMs: firstDefined(args['fight-timeout-ms'], process.env.DUEL_TIMEOUT_MS),
    mctsIterations: firstDefined(args['mcts-iterations'], process.env.MCTS_ITERATIONS),
    rolloutDepth: firstDefined(args['rollout-depth'], process.env.MCTS_ROLLOUT_DEPTH),
  });
}

function parseArgs(argv: string[]) {
  const parsed: Record<string, string> = {};

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    if (value && !value.startsWith('--')) {
      parsed[key] = value;
      index += 1;
    } else {
      parsed[key] = 'true';
    }
  }

  return parsed;
}

function firstDefined(...values: Array<string | undefined>) {
  return values.find((value) => value !== undefined);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (error) {
    console.error('Bot startup failed:', error);
    process.exitCode = 1;
  }
}
