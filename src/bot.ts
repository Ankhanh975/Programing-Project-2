import mineflayer, { type Bot } from 'mineflayer';
import minecraftData from 'minecraft-data';
import prismarineBlock from 'prismarine-block';
import { Physics, PlayerState } from 'prismarine-physics';
import { Vec3 } from 'vec3';

type BotConfigInput = {
  host?: string;
  port?: string;
  username?: string;
  version?: string;
  targetName?: string;
  flySpeed?: string;
  followRadius?: string;
};

type BotConfig = {
  host: string;
  port: number;
  username: string;
  version?: string;
  targetName?: string;
  flySpeed: number;
  followRadius: number;
};

type ControlState = {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  sprint: boolean;
  sneak: boolean;
};

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveConfig(input: BotConfigInput): BotConfig {
  return {
    host: input.host ?? 'localhost',
    port: parseNumber(input.port, 25565),
    username: input.username ?? 'SwordAgent',
    version: input.version && input.version !== 'auto' ? input.version : undefined,
    targetName: input.targetName,
    flySpeed: parseNumber(input.flySpeed, 0.15),
    followRadius: parseNumber(input.followRadius, 3),
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

  attachLifecycle(bot, config);
  return bot;
}

function attachLifecycle(bot: Bot, config: BotConfig) {
  let followTimer: ReturnType<typeof setInterval> | undefined;

  bot.once('spawn', () => {
    const mcData = minecraftData(bot.version);
    const Block = prismarineBlock(mcData as any);
    const flatWorld = createFlatWorld(mcData, Block);
    const physicsEngine = Physics(mcData, flatWorld);

    bot.chat('Sword agent online.');

    const onChat = (username: string, message: string) => {
      if (username === bot.username) {
        return;
      }

      if (message === '!stop') {
        config.targetName = undefined;
        bot.clearControlStates();
        bot.chat('Stopping follow mode.');
        return;
      }

      if (message === '!follow') {
        config.targetName = username;
        bot.chat(`Following ${username}.`);
        return;
      }

      if (message.startsWith('!target ')) {
        const nextTarget = message.slice('!target '.length).trim();
        config.targetName = nextTarget || undefined;
        bot.chat(config.targetName ? `Target set to ${config.targetName}.` : 'Target cleared.');
      }
    };

    bot.on('chat', onChat);

    followTimer = setInterval(() => {
      const target = findTarget(bot, config.targetName);
      if (!target) {
        bot.clearControlStates();
        return;
      }

      const targetPosition = target.position.clone();
      const controls = buildControls(bot.entity.position, targetPosition, config.followRadius, config.flySpeed);
      applyControls(bot, controls);
      void bot.lookAt(targetPosition.offset(0, 1.5, 0), true).catch(() => undefined);

      const playerState = new PlayerState(snapshotPlayer(bot, controls) as any, controls as any);
      void physicsEngine.simulatePlayer(playerState, flatWorld);
    }, 50);
  });

  bot.on('end', () => {
    if (followTimer) {
      clearInterval(followTimer);
      followTimer = undefined;
    }
  });

  bot.on('kicked', (reason) => {
    console.log('Bot kicked:', reason);
  });

  bot.on('error', (error) => {
    console.error('Bot error:', error);
  });
}

function findTarget(bot: Bot, targetName?: string) {
  if (targetName) {
    return bot.players[targetName]?.entity;
  }

  const nearbyPlayers = Object.values(bot.players)
    .map((entry) => entry.entity)
    .filter((entity): entity is NonNullable<typeof entity> => Boolean(entity) && entity.username !== bot.username);

  return nearbyPlayers[0];
}

function buildControls(
  currentPosition: Vec3,
  targetPosition: Vec3,
  followRadius: number,
  flySpeed: number,
): ControlState {
  const delta = targetPosition.minus(currentPosition);
  const horizontalDistance = Math.sqrt(delta.x ** 2 + delta.z ** 2);
  const verticalThreshold = Math.max(0.5, flySpeed * 4);

  return {
    forward: horizontalDistance > followRadius * 0.6,
    back: false,
    left: false,
    right: false,
    jump: delta.y > verticalThreshold,
    sprint: horizontalDistance > followRadius * (1 + flySpeed),
    sneak: delta.y < -verticalThreshold * 2,
  };
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

function snapshotPlayer(bot: Bot, controls: ControlState) {
  const entity = bot.entity as any;

  return {
    entity: {
      position: entity.position.clone(),
      velocity: entity.velocity.clone(),
      onGround: entity.onGround,
      isInWater: entity.isInWater,
      isInLava: entity.isInLava,
      isInWeb: entity.isInWeb,
      isCollidedHorizontally: entity.isCollidedHorizontally,
      isCollidedVertically: entity.isCollidedVertically,
      elytraFlying: entity.elytraFlying,
      yaw: entity.yaw,
      pitch: entity.pitch,
    },
    jumpTicks: entity.jumpTicks ?? 0,
    jumpQueued: controls.jump,
    fireworkRocketDuration: 0,
  };
}

function createFlatWorld(mcData: any, Block: any) {
  const biome = mcData.biomesByName.plains ?? Object.values(mcData.biomesByName)[0];
  const airBlock = new Block(mcData.blocksByName.air, biome, 0);
  const stoneBlock = new Block(mcData.blocksByName.stone, biome, 0);
  const dirtBlock = new Block(mcData.blocksByName.dirt, biome, 0);
  const grassBlock = new Block(mcData.blocksByName.grass_block ?? mcData.blocksByName.grass, biome, 0);

  return {
    getBlock(position: Vec3) {
      if (position.y < 62) {
        return stoneBlock;
      }

      if (position.y === 62) {
        return dirtBlock;
      }

      if (position.y === 63) {
        return grassBlock;
      }

      return airBlock;
    },
  };
}
