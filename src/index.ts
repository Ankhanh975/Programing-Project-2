import { createBot } from './bot.js';

const runtime = globalThis as typeof globalThis & {
  process?: {
    env: Record<string, string | undefined>;
    exitCode?: number;
  };
};

try {
  createBot({
    host: runtime.process?.env.MC_HOST,
    port: runtime.process?.env.MC_PORT,
    username: runtime.process?.env.MC_USERNAME,
    version: runtime.process?.env.MC_VERSION,
    targetName: runtime.process?.env.MC_TARGET,
    flySpeed: runtime.process?.env.MC_FLY_SPEED,
    followRadius: runtime.process?.env.MC_FOLLOW_RADIUS,
  });
} catch (error) {
  console.error('Bot startup failed:', error);
  if (runtime.process) {
    runtime.process.exitCode = 1;
  }
}
