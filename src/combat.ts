import minecraftData from 'minecraft-data';
import prismarineBlock from 'prismarine-block';
import { Physics, PlayerState } from 'prismarine-physics';
import { Vec3 } from 'vec3';

// Project-specific combat planner code. External Prismarine libraries provide
// Minecraft data, blocks, vectors, and physics simulation, but the MCTS logic,
// reward shaping, and algorithm variations below are implemented in this repo.
export type ControlState = {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  sprint: boolean;
  sneak: boolean;
};

export type CombatIntent = {
  controls: ControlState;
  attack: boolean;
  yaw: number;
  distance: number;
  horizontalDistance: number;
};

export type CombatIntentConfig = {
  attackReach: number;
  engageDistance: number;
  sprintDistance: number;
  iterations: number;
  rolloutDepth: number;
  exploration: number;
  heuristicWeight: number;
  riskBias: number;
};

export type CombatSearchResult = CombatIntent & {
  action: MctsAction;
  score: number;
  visits: number;
};

export type DuelEpisode = {
  tick: number;
  side: 'left' | 'right';
  actor: string;
  opponent: string;
  action: string;
  attack: boolean;
  score: number;
  visits: number;
  distance: number;
  healthDiff: number;
  actorCooldown: number;
  opponentCooldown: number;
  actorHealth: number;
  opponentHealth: number;
  actorPosition: { x: number; y: number; z: number };
  opponentPosition: { x: number; y: number; z: number };
  controls: ControlState;
};

export type SimulatedFighter = {
  name: string;
  version: string;
  entity: {
    position: Vec3;
    velocity: Vec3;
    onGround: boolean;
    isInWater: boolean;
    isInLava: boolean;
    isInWeb: boolean;
    isCollidedHorizontally: boolean;
    isCollidedVertically: boolean;
    elytraFlying: boolean;
    yaw: number;
    pitch: number;
    attributes: Record<string, unknown>;
    effects: Record<string, unknown>;
  };
  inventory: {
    slots: Array<unknown>;
  };
  jumpTicks: number;
  jumpQueued: boolean;
  fireworkRocketDuration: number;
  health: number;
  attackCooldown: number;
};

type WorldLike = {
  getBlock(position: Vec3): any;
};

type SimulatedState = {
  self: SimulatedFighter;
  target: SimulatedFighter;
};

type MctsAction = {
  name: string;
  controls: ControlState;
  attack: boolean;
  priority: number;
};

type MctsNode = {
  state: SimulatedState;
  parent?: MctsNode;
  action?: MctsAction;
  children: MctsNode[];
  untriedActions: MctsAction[];
  visits: number;
  totalScore: number;
};

const defaultCombatConfig: CombatIntentConfig = {
  attackReach: 3.05,
  engageDistance: 2.25,
  sprintDistance: 4,
  iterations: 48,
  rolloutDepth: 4,
  exploration: Math.SQRT2,
  heuristicWeight: 0,
  riskBias: 1,
};

export type DuelTraceOptions = {
  version?: string;
  leftName?: string;
  rightName?: string;
  maxTicks?: number;
  attackDamage?: number;
  leftAttackDamage?: number;
  rightAttackDamage?: number;
  episodeLimit?: number;
  leftStart?: Vec3;
  rightStart?: Vec3;
  leftHealth?: number;
  rightHealth?: number;
  leftConfig?: Partial<CombatIntentConfig>;
  rightConfig?: Partial<CombatIntentConfig>;
};

export function createControlState(): ControlState {
  return {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
    sneak: false,
  };
}

export function decideCombatIntent(
  currentPosition: Vec3,
  targetPosition: Vec3,
  config: Partial<CombatIntentConfig> = {},
): CombatIntent {
  const merged = { ...defaultCombatConfig, ...config };
  const delta = targetPosition.minus(currentPosition);
  const horizontalDistance = Math.sqrt(delta.x ** 2 + delta.z ** 2);
  const distance = Math.hypot(delta.x, delta.y, delta.z);
  const yaw = Math.atan2(-delta.x, -delta.z);
  const verticalGap = delta.y;

  return {
    controls: {
      forward: horizontalDistance > merged.engageDistance,
      back: false,
      left: false,
      right: false,
      jump: verticalGap > 0.6,
      sprint: horizontalDistance > merged.sprintDistance,
      sneak: verticalGap < -1.5,
    },
    attack: horizontalDistance <= merged.attackReach && Math.abs(verticalGap) < 1.8,
    yaw,
    distance,
    horizontalDistance,
  };
}

export function searchCombatIntent(input: {
  self: SimulatedFighter;
  target: SimulatedFighter;
  physics: any;
  world: WorldLike;
  config?: Partial<CombatIntentConfig>;
}): CombatSearchResult {
  const merged = { ...defaultCombatConfig, ...input.config };
  const rootState = {
    self: cloneFighter(input.self),
    target: cloneFighter(input.target),
  };
  const root: MctsNode = {
    state: rootState,
    children: [],
    untriedActions: buildActions(rootState.self, rootState.target, merged),
    visits: 0,
    totalScore: 0,
  };

  for (let iteration = 0; iteration < merged.iterations; iteration++) {
    let node = root;

    while (node.untriedActions.length === 0 && node.children.length > 0) {
      node = selectChild(node, merged);
    }

    if (node.untriedActions.length > 0) {
      const actionIndex = iteration % node.untriedActions.length;
      const [action] = node.untriedActions.splice(actionIndex, 1);
      const nextState = simulateStep(node.state, action, input.physics, input.world, merged);
      const child: MctsNode = {
        state: nextState,
        parent: node,
        action,
        children: [],
        untriedActions: buildActions(nextState.self, nextState.target, merged),
        visits: 0,
        totalScore: 0,
      };

      node.children.push(child);
      node = child;
    }

    const score = rollout(node.state, input.physics, input.world, merged)
      + merged.heuristicWeight * heuristicActionValue(node.state.self, node.state.target, node.action, merged);
    backpropagate(node, score);
  }

  const bestNode = root.children.sort((left, right) => scoredNode(right) - scoredNode(left))[0]
    ?? root.children[0]
    ?? null;
  const bestAction = bestNode?.action ?? buildActions(rootState.self, rootState.target, merged)[0];

  const intent = actionToIntent(bestAction, rootState.self, rootState.target, merged);
  return {
    ...intent,
    action: bestAction,
    score: bestNode ? averageScore(bestNode) : 0,
    visits: bestNode?.visits ?? 0,
  };
}

export function createSimulatedFighter(name: string, version: string, position: Vec3): SimulatedFighter {
  return {
    name,
    version,
    entity: {
      position: position.clone(),
      velocity: new Vec3(0, 0, 0),
      onGround: false,
      isInWater: false,
      isInLava: false,
      isInWeb: false,
      isCollidedHorizontally: false,
      isCollidedVertically: false,
      elytraFlying: false,
      yaw: 0,
      pitch: 0,
      attributes: {},
      effects: {},
    },
    inventory: {
      slots: new Array(46).fill(null),
    },
    jumpTicks: 0,
    jumpQueued: false,
    fireworkRocketDuration: 0,
    health: 20,
    attackCooldown: 0,
  };
}

export function cloneFighter(fighter: SimulatedFighter): SimulatedFighter {
  return {
    name: fighter.name,
    version: fighter.version,
    entity: {
      position: fighter.entity.position.clone(),
      velocity: fighter.entity.velocity.clone(),
      onGround: fighter.entity.onGround,
      isInWater: fighter.entity.isInWater,
      isInLava: fighter.entity.isInLava,
      isInWeb: fighter.entity.isInWeb,
      isCollidedHorizontally: fighter.entity.isCollidedHorizontally,
      isCollidedVertically: fighter.entity.isCollidedVertically,
      elytraFlying: fighter.entity.elytraFlying,
      yaw: fighter.entity.yaw,
      pitch: fighter.entity.pitch,
      attributes: { ...fighter.entity.attributes },
      effects: { ...fighter.entity.effects },
    },
    inventory: {
      slots: [...fighter.inventory.slots],
    },
    jumpTicks: fighter.jumpTicks,
    jumpQueued: fighter.jumpQueued,
    fireworkRocketDuration: fighter.fireworkRocketDuration,
    health: fighter.health,
    attackCooldown: fighter.attackCooldown,
  };
}

export function createFlatWorld(version: string) {
  const mcData = minecraftData(version);
  if (!mcData) {
    throw new Error(`Unsupported Minecraft version for physics duel: ${version}`);
  }

  const Block = prismarineBlock(version);
  const airId = mcData.blocksByName.air.id;
  const stoneId = mcData.blocksByName.stone.id;
  const dirtId = mcData.blocksByName.dirt.id;
  const grassId = (mcData.blocksByName.grass_block ?? mcData.blocksByName.grass).id;

  return {
    mcData,
    Block,
    world: {
      getBlock(position: Vec3) {
        let type = airId;

        if (position.y < 62) {
          type = stoneId;
        } else if (position.y === 62) {
          type = dirtId;
        } else if (position.y === 63) {
          type = grassId;
        }

        const block = new Block(type, 0, 0);
        block.position = position.clone();
        return block;
      },
    },
  };
}

function buildActions(self: SimulatedFighter, target: SimulatedFighter, config: CombatIntentConfig): MctsAction[] {
  const distance = target.entity.position.minus(self.entity.position);
  const horizontalDistance = Math.sqrt(distance.x ** 2 + distance.z ** 2);
  const jump = distance.y > 0.6;
  const canAttack = self.attackCooldown <= 0 && horizontalDistance <= config.attackReach && Math.abs(distance.y) < 1.8;
  const tooClose = horizontalDistance < config.attackReach * 0.65;
  const shouldEngage = horizontalDistance > config.engageDistance;

  const actions: MctsAction[] = [
    {
      name: 'close-attack',
      controls: { ...createControlState(), forward: shouldEngage },
      attack: canAttack,
      priority: canAttack ? 5 : 2,
    },
    {
      name: 'hold-attack',
      controls: createControlState(),
      attack: canAttack,
      priority: canAttack && !tooClose ? 4 : -1,
    },
    {
      name: 'advance',
      controls: { ...createControlState(), forward: true },
      attack: canAttack,
      priority: shouldEngage ? 3 : 0,
    },
    {
      name: 'sprint-advance',
      controls: { ...createControlState(), forward: true, sprint: true },
      attack: canAttack,
      priority: horizontalDistance > config.sprintDistance ? 4 : 1,
    },
    {
      name: 'strafe-left',
      controls: { ...createControlState(), left: true },
      attack: canAttack,
      priority: canAttack ? 3 : -2,
    },
    {
      name: 'strafe-right',
      controls: { ...createControlState(), right: true },
      attack: canAttack,
      priority: canAttack ? 3 : -2,
    },
    {
      name: 'sprint-strafe-left',
      controls: { ...createControlState(), left: true, sprint: true },
      attack: canAttack,
      priority: canAttack ? 2 : -3,
    },
    {
      name: 'sprint-strafe-right',
      controls: { ...createControlState(), right: true, sprint: true },
      attack: canAttack,
      priority: canAttack ? 2 : -3,
    },
    {
      name: 'jump-advance',
      controls: { ...createControlState(), forward: true, jump },
      attack: canAttack,
      priority: shouldEngage || jump ? 2 : -1,
    },
    {
      name: 'jump-sprint',
      controls: { ...createControlState(), forward: true, sprint: true, jump },
      attack: canAttack,
      priority: horizontalDistance > config.sprintDistance || jump ? 3 : -1,
    },
    {
      name: 'jump-strafe-left',
      controls: { ...createControlState(), left: true, jump },
      attack: canAttack,
      priority: jump ? 1 : -2,
    },
    {
      name: 'jump-strafe-right',
      controls: { ...createControlState(), right: true, jump },
      attack: canAttack,
      priority: jump ? 1 : -2,
    },
    {
      name: 'retreat-left',
      controls: { ...createControlState(), back: true, left: true },
      attack: false,
      priority: tooClose || self.health < target.health ? 2 : -1,
    },
    {
      name: 'retreat-right',
      controls: { ...createControlState(), back: true, right: true },
      attack: false,
      priority: tooClose || self.health < target.health ? 2 : -1,
    },
    {
      name: 'retreat-sprint',
      controls: { ...createControlState(), back: true, sprint: true },
      attack: false,
      priority: tooClose || self.health + 4 < target.health ? 1 : -2,
    },
    {
      name: 'retreat',
      controls: { ...createControlState(), back: true },
      attack: false,
      priority: -2,
    },
    {
      name: 'idle',
      controls: createControlState(),
      attack: false,
      priority: -4,
    },
  ];

  if (canAttack) {
    return actions;
  }

  return actions.filter((action) => {
    const movesTowardTarget = action.controls.forward || action.controls.sprint;
    const givesGround = action.controls.back || action.name === 'idle' || action.name === 'hold-attack';
    const circlesOutOfRange = action.controls.left || action.controls.right;
    return movesTowardTarget && !givesGround && !circlesOutOfRange;
  });
}

function actionToIntent(action: MctsAction, self: SimulatedFighter, target: SimulatedFighter, config: CombatIntentConfig): CombatIntent {
  const delta = target.entity.position.minus(self.entity.position);
  const horizontalDistance = Math.sqrt(delta.x ** 2 + delta.z ** 2);
  const distance = Math.hypot(delta.x, delta.y, delta.z);
  const canAttack = self.attackCooldown <= 0 && horizontalDistance <= config.attackReach && Math.abs(delta.y) < 1.8;

  return {
    controls: action.controls,
    attack: action.attack && canAttack,
    yaw: Math.atan2(-delta.x, -delta.z),
    distance,
    horizontalDistance,
  };
}

function simulateStep(state: SimulatedState, action: MctsAction, physics: any, world: WorldLike, config: CombatIntentConfig): SimulatedState {
  const self = cloneFighter(state.self);
  const target = cloneFighter(state.target);

  applyAction(self, target, action, physics, world, config);
  const targetAction = chooseHeuristicAction(target, self, config);
  applyAction(target, self, targetAction, physics, world, config);

  applyActionDamage(self, target, action, config.attackReach, 4);
  applyActionDamage(target, self, targetAction, config.attackReach, 4);

  return { self, target };
}

function rollout(state: SimulatedState, physics: any, world: WorldLike, config: CombatIntentConfig): number {
  let current = {
    self: cloneFighter(state.self),
    target: cloneFighter(state.target),
  };

  let score = evaluateState(current.self, current.target, config);

  for (let depth = 0; depth < config.rolloutDepth; depth++) {
    const selfAction = chooseHeuristicAction(current.self, current.target, config);
    applyAction(current.self, current.target, selfAction, physics, world, config);

    const targetAction = chooseHeuristicAction(current.target, current.self, config);
    applyAction(current.target, current.self, targetAction, physics, world, config);

    applyActionDamage(current.self, current.target, selfAction, config.attackReach, 4);
    applyActionDamage(current.target, current.self, targetAction, config.attackReach, 4);

    score += evaluateState(current.self, current.target, config);

    if (current.self.health <= 0 || current.target.health <= 0) {
      break;
    }
  }

  return score;
}

function chooseHeuristicAction(self: SimulatedFighter, target: SimulatedFighter, config: CombatIntentConfig): MctsAction {
  const intent = decideCombatIntent(self.entity.position, target.entity.position, config);
  return {
    name: 'heuristic',
    controls: intent.controls,
    attack: intent.attack && self.attackCooldown <= 0,
    priority: intent.attack ? 4 : intent.controls.forward ? 3 : intent.controls.sprint ? 2 : 0,
  };
}

function applyAction(
  actor: SimulatedFighter,
  target: SimulatedFighter,
  action: MctsAction,
  physics: any,
  world: WorldLike,
  config: CombatIntentConfig,
) {
  if (actor.health <= 0) {
    return;
  }

  const intent = actionToIntent(action, actor, target, config);
  actor.entity.yaw = intent.yaw;
  actor.entity.pitch = 0;
  actor.jumpQueued = action.controls.jump;

  const playerState = new PlayerState(actor as any, action.controls as any);
  physics.simulatePlayer(playerState, world).apply(actor as any);

  if (actor.attackCooldown > 0) {
    actor.attackCooldown -= 1;
  }
}

function applyDamage(attacker: SimulatedFighter, target: SimulatedFighter, attackReach: number, damage: number) {
  if (attacker.health <= 0 || target.health <= 0 || attacker.attackCooldown > 0) {
    return;
  }

  const delta = target.entity.position.minus(attacker.entity.position);
  const horizontalDistance = Math.sqrt(delta.x ** 2 + delta.z ** 2);
  if (horizontalDistance > attackReach || Math.abs(delta.y) > 1.8) {
    return;
  }

  target.health = Math.max(0, target.health - damage);
  attacker.attackCooldown = 10;
}

function applyActionDamage(
  attacker: SimulatedFighter,
  target: SimulatedFighter,
  action: MctsAction,
  attackReach: number,
  damage: number,
) {
  if (!action.attack) {
    return;
  }

  applyDamage(attacker, target, attackReach, damage);
}

function fighterDistance(left: SimulatedFighter, right: SimulatedFighter) {
  const delta = right.entity.position.minus(left.entity.position);
  return Math.sqrt(delta.x ** 2 + delta.z ** 2);
}

function heuristicActionValue(
  self: SimulatedFighter,
  target: SimulatedFighter,
  action: MctsAction | undefined,
  config: CombatIntentConfig,
) {
  // Hybrid MCTS variation: add a small domain heuristic to the simulated
  // rollout score without replacing the tree search.
  const delta = target.entity.position.minus(self.entity.position);
  const horizontalDistance = Math.sqrt(delta.x ** 2 + delta.z ** 2);
  const canAttack = self.attackCooldown <= 0 && horizontalDistance <= config.attackReach && Math.abs(delta.y) < 1.8;
  const approachValue = action?.controls.forward ? Math.max(0, horizontalDistance - config.engageDistance) : 0;
  const attackValue = action?.attack && canAttack ? 12 : 0;
  const cooldownValue = canAttack ? 4 : -Math.max(0, config.attackReach - horizontalDistance);
  const spacingValue = -Math.abs(horizontalDistance - config.attackReach * 0.9);

  return approachValue + attackValue + cooldownValue + spacingValue + (action?.priority ?? 0);
}

function evaluateState(self: SimulatedFighter, target: SimulatedFighter, config: CombatIntentConfig): number {
  const delta = target.entity.position.minus(self.entity.position);
  const horizontalDistance = Math.sqrt(delta.x ** 2 + delta.z ** 2);
  const healthDiff = self.health - target.health;

  if (self.health <= 0) {
    return -1000;
  }

  if (target.health <= 0) {
    return 1000;
  }

  const lowHealth = self.health < target.health;
  const retreatTarget = lowHealth ? config.attackReach * (1.5 + config.riskBias) : config.attackReach * 1.5;
  const idealDistance = lowHealth ? config.attackReach * (0.85 + 0.55 * config.riskBias) : config.attackReach * 0.85;
  const spacingScore = 14 - Math.abs(horizontalDistance - idealDistance) * 5;
  const pressureScore = -Math.abs(delta.y) * 2 - Math.max(0, horizontalDistance - retreatTarget) * 2;
  const healthScore = healthDiff * 12;
  const cautionScore = lowHealth && horizontalDistance > config.attackReach ? horizontalDistance * 2 * config.riskBias : 0;
  const cooldownScore = self.attackCooldown <= target.attackCooldown ? 2 : -2;
  const attackWindowScore = horizontalDistance <= config.attackReach && self.attackCooldown <= 0 ? 10 : 0;

  return spacingScore + pressureScore + healthScore + cautionScore + cooldownScore + attackWindowScore;
}

function selectChild(node: MctsNode, config: CombatIntentConfig): MctsNode {
  return node.children.reduce((best, candidate) => {
    const bestScore = upperConfidenceBound(best, config.exploration);
    const candidateScore = upperConfidenceBound(candidate, config.exploration);
    return candidateScore > bestScore ? candidate : best;
  });
}

function upperConfidenceBound(node: MctsNode, exploration: number): number {
  if (node.visits === 0) {
    return Number.POSITIVE_INFINITY;
  }

  const average = node.totalScore / node.visits;
  const parentVisits = Math.max(1, node.parent?.visits ?? 1);
  return average + exploration * Math.sqrt(Math.log(parentVisits) / node.visits);
}

function backpropagate(node: MctsNode, score: number) {
  let current: MctsNode | undefined = node;
  while (current) {
    current.visits += 1;
    current.totalScore += score;
    current = current.parent;
  }
}

function averageScore(node: MctsNode) {
  return node.visits === 0 ? Number.NEGATIVE_INFINITY : node.totalScore / node.visits;
}

function scoredNode(node: MctsNode) {
  return averageScore(node) + (node.action?.priority ?? 0) * 1.5;
}

export function runPhysicsDuel(options: {
  version?: string;
  leftName?: string;
  rightName?: string;
  maxTicks?: number;
  attackDamage?: number;
  leftAttackDamage?: number;
  rightAttackDamage?: number;
  leftStart?: Vec3;
  rightStart?: Vec3;
  leftHealth?: number;
  rightHealth?: number;
  leftConfig?: Partial<CombatIntentConfig>;
  rightConfig?: Partial<CombatIntentConfig>;
}) {
  const version = options.version ?? '1.20.4';
  const arena = createFlatWorld(version);
  const physics = Physics(arena.mcData, arena.world);
  const left = createSimulatedFighter(options.leftName ?? 'Alpha', version, options.leftStart ?? new Vec3(-3, 64, 0));
  const right = createSimulatedFighter(options.rightName ?? 'Bravo', version, options.rightStart ?? new Vec3(3, 64, 0));
  const maxTicks = options.maxTicks ?? 120;
  const attackDamage = options.attackDamage ?? 4;
  const leftAttackDamage = options.leftAttackDamage ?? attackDamage + 1;
  const rightAttackDamage = options.rightAttackDamage ?? attackDamage - 1;
  const leftConfig: CombatIntentConfig = {
    ...defaultCombatConfig,
    engageDistance: 2.0,
    sprintDistance: 3.4,
    iterations: 64,
    rolloutDepth: 5,
    ...options.leftConfig,
  };
  const rightConfig: CombatIntentConfig = {
    ...defaultCombatConfig,
    engageDistance: 2.8,
    sprintDistance: 4.8,
    iterations: 48,
    rolloutDepth: 4,
    ...options.rightConfig,
  };

  left.health = options.leftHealth ?? 22;
  right.health = options.rightHealth ?? 18;

  console.log(`Starting prismarine-physics duel on ${version}`);

  for (let tick = 1; tick <= maxTicks; tick++) {
    const leftDecision = stepFighter(left, right, physics, arena.world, leftConfig);
    if (leftDecision.attack) {
      applyDamage(left, right, leftConfig.attackReach, leftAttackDamage);
    }

    if (right.health <= 0) {
      console.log(`${left.name} won in ${tick} ticks`);
      return { winner: left.name, ticks: tick };
    }

    const rightDecision = stepFighter(right, left, physics, arena.world, rightConfig);
    if (rightDecision.attack) {
      applyDamage(right, left, rightConfig.attackReach, rightAttackDamage);
    }

    if (left.health <= 0) {
      console.log(`${right.name} won in ${tick} ticks`);
      return { winner: right.name, ticks: tick };
    }
  }

  const winner = left.health === right.health ? 'draw' : left.health > right.health ? left.name : right.name;
  console.log(`Duel ended in a ${winner}`);
  return { winner, ticks: maxTicks };
}

export function recordPhysicsDuelEpisodes(options: DuelTraceOptions) {
  const version = options.version ?? '1.20.4';
  const arena = createFlatWorld(version);
  const physics = Physics(arena.mcData, arena.world);
  const left = createSimulatedFighter(options.leftName ?? 'Alpha', version, options.leftStart ?? new Vec3(-4, 64, -0.75));
  const right = createSimulatedFighter(options.rightName ?? 'Bravo', version, options.rightStart ?? new Vec3(4, 64, 0.75));
  const maxTicks = options.maxTicks ?? 12;
  const episodeLimit = options.episodeLimit ?? maxTicks * 2;
  const attackDamage = options.attackDamage ?? 4;
  const leftAttackDamage = options.leftAttackDamage ?? attackDamage + 1;
  const rightAttackDamage = options.rightAttackDamage ?? attackDamage - 1;
  const leftConfig: CombatIntentConfig = {
    ...defaultCombatConfig,
    engageDistance: 2.0,
    sprintDistance: 3.4,
    iterations: 64,
    rolloutDepth: 5,
    ...options.leftConfig,
  };
  const rightConfig: CombatIntentConfig = {
    ...defaultCombatConfig,
    engageDistance: 2.8,
    sprintDistance: 4.8,
    iterations: 48,
    rolloutDepth: 4,
    ...options.rightConfig,
  };

  left.health = options.leftHealth ?? left.health;
  right.health = options.rightHealth ?? right.health;

  const episodes: DuelEpisode[] = [];

  for (let tick = 1; tick <= maxTicks; tick++) {
    const leftDecision = stepFighter(left, right, physics, arena.world, leftConfig);
    episodes.push({
      tick,
      side: 'left',
      actor: left.name,
      opponent: right.name,
      action: leftDecision.action.name,
      attack: leftDecision.attack,
      score: leftDecision.score,
      visits: leftDecision.visits,
      distance: fighterDistance(left, right),
      healthDiff: left.health - right.health,
      actorCooldown: left.attackCooldown,
      opponentCooldown: right.attackCooldown,
      actorHealth: left.health,
      opponentHealth: right.health,
      actorPosition: { x: left.entity.position.x, y: left.entity.position.y, z: left.entity.position.z },
      opponentPosition: { x: right.entity.position.x, y: right.entity.position.y, z: right.entity.position.z },
      controls: leftDecision.controls,
    });

    if (leftDecision.attack) {
      applyDamage(left, right, leftConfig.attackReach, leftAttackDamage);
    }

    if (right.health <= 0 || episodes.length >= episodeLimit) {
      break;
    }

    const rightDecision = stepFighter(right, left, physics, arena.world, rightConfig);
    episodes.push({
      tick,
      side: 'right',
      actor: right.name,
      opponent: left.name,
      action: rightDecision.action.name,
      attack: rightDecision.attack,
      score: rightDecision.score,
      visits: rightDecision.visits,
      distance: fighterDistance(right, left),
      healthDiff: right.health - left.health,
      actorCooldown: right.attackCooldown,
      opponentCooldown: left.attackCooldown,
      actorHealth: right.health,
      opponentHealth: left.health,
      actorPosition: { x: right.entity.position.x, y: right.entity.position.y, z: right.entity.position.z },
      opponentPosition: { x: left.entity.position.x, y: left.entity.position.y, z: left.entity.position.z },
      controls: rightDecision.controls,
    });

    if (rightDecision.attack) {
      applyDamage(right, left, rightConfig.attackReach, rightAttackDamage);
    }

    if (left.health <= 0 || episodes.length >= episodeLimit) {
      break;
    }
  }

  const winner = left.health === right.health ? 'draw' : left.health > right.health ? left.name : right.name;
  return {
    version,
    winner,
    left: { name: left.name, health: left.health },
    right: { name: right.name, health: right.health },
    episodes,
  };
}

function stepFighter(
  attacker: SimulatedFighter,
  target: SimulatedFighter,
  physics: any,
  world: WorldLike,
  config: CombatIntentConfig,
): CombatSearchResult {
  if (attacker.health <= 0) {
    return {
      controls: createControlState(),
      attack: false,
      yaw: attacker.entity.yaw,
      distance: 0,
      horizontalDistance: 0,
      action: { name: 'dead', controls: createControlState(), attack: false, priority: 0 },
      score: Number.NEGATIVE_INFINITY,
      visits: 0,
    };
  }

  const intent = searchCombatIntent({
    self: attacker,
    target,
    physics,
    world,
    config,
  });

  attacker.entity.yaw = intent.yaw;
  attacker.entity.pitch = 0;
  attacker.jumpQueued = intent.controls.jump;

  const playerState = new PlayerState(attacker as any, intent.controls as any);
  physics.simulatePlayer(playerState, world).apply(attacker as any);

  if (attacker.attackCooldown > 0) {
    attacker.attackCooldown -= 1;
  }

  return intent;
}

