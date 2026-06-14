import minecraftData from 'minecraft-data';
import prismarineBlock from 'prismarine-block';
import { Physics, PlayerState } from 'prismarine-physics';
import { Vec3 } from 'vec3';

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
};

export type CombatSearchResult = CombatIntent & {
  action: MctsAction;
  score: number;
  visits: number;
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
  iterations: 10,
  rolloutDepth: 2,
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
      node = selectChild(node);
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

    const score = rollout(node.state, input.physics, input.world, merged);
    backpropagate(node, score);
  }

  const bestNode = root.children.sort((left, right) => averageScore(right) - averageScore(left))[0]
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

  return [
    { name: 'idle', controls: createControlState(), attack: false },
    {
      name: 'retreat',
      controls: { ...createControlState(), back: true },
      attack: false,
    },
    {
      name: 'retreat-sprint',
      controls: { ...createControlState(), back: true, sprint: true },
      attack: false,
    },
    {
      name: 'retreat-left',
      controls: { ...createControlState(), back: true, left: true },
      attack: false,
    },
    {
      name: 'retreat-right',
      controls: { ...createControlState(), back: true, right: true },
      attack: false,
    },
    {
      name: 'advance',
      controls: { ...createControlState(), forward: true },
      attack: horizontalDistance <= config.attackReach,
    },
    {
      name: 'sprint-advance',
      controls: { ...createControlState(), forward: true, sprint: true },
      attack: horizontalDistance <= config.attackReach,
    },
    {
      name: 'strafe-left',
      controls: { ...createControlState(), left: true },
      attack: horizontalDistance <= config.attackReach,
    },
    {
      name: 'strafe-right',
      controls: { ...createControlState(), right: true },
      attack: horizontalDistance <= config.attackReach,
    },
    {
      name: 'sprint-strafe-left',
      controls: { ...createControlState(), left: true, sprint: true },
      attack: horizontalDistance <= config.attackReach,
    },
    {
      name: 'sprint-strafe-right',
      controls: { ...createControlState(), right: true, sprint: true },
      attack: horizontalDistance <= config.attackReach,
    },
    {
      name: 'jump-advance',
      controls: { ...createControlState(), forward: true, jump },
      attack: horizontalDistance <= config.attackReach,
    },
    {
      name: 'jump-sprint',
      controls: { ...createControlState(), forward: true, sprint: true, jump },
      attack: horizontalDistance <= config.attackReach,
    },
    {
      name: 'jump-strafe-left',
      controls: { ...createControlState(), left: true, jump },
      attack: horizontalDistance <= config.attackReach,
    },
    {
      name: 'jump-strafe-right',
      controls: { ...createControlState(), right: true, jump },
      attack: horizontalDistance <= config.attackReach,
    },
    {
      name: 'close-attack',
      controls: { ...createControlState(), forward: horizontalDistance > config.engageDistance * 0.8 },
      attack: horizontalDistance <= config.attackReach,
    },
  ];
}

function actionToIntent(action: MctsAction, self: SimulatedFighter, target: SimulatedFighter, config: CombatIntentConfig): CombatIntent {
  const delta = target.entity.position.minus(self.entity.position);
  const horizontalDistance = Math.sqrt(delta.x ** 2 + delta.z ** 2);
  const distance = Math.hypot(delta.x, delta.y, delta.z);

  return {
    controls: action.controls,
    attack: action.attack && horizontalDistance <= config.attackReach,
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

  applyDamage(self, target, config.attackReach, 4);
  applyDamage(target, self, config.attackReach, 4);

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

    applyDamage(current.self, current.target, config.attackReach, 4);
    applyDamage(current.target, current.self, config.attackReach, 4);

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
    attack: intent.attack,
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
  const retreatTarget = lowHealth ? config.attackReach * 2.5 : config.attackReach * 1.5;
  const spacingScore = horizontalDistance <= config.attackReach ? 15 : horizontalDistance > retreatTarget ? 8 : -horizontalDistance;
  const pressureScore = -Math.abs(delta.y) * 2;
  const healthScore = healthDiff * 12;
  const cautionScore = lowHealth && horizontalDistance > config.attackReach ? horizontalDistance * 2 : 0;

  return spacingScore + pressureScore + healthScore + cautionScore;
}

function selectChild(node: MctsNode): MctsNode {
  const exploration = Math.SQRT2;
  return node.children.reduce((best, candidate) => {
    const bestScore = upperConfidenceBound(best, exploration);
    const candidateScore = upperConfidenceBound(candidate, exploration);
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

export function runPhysicsDuel(options: {
  version?: string;
  leftName?: string;
  rightName?: string;
  maxTicks?: number;
  attackDamage?: number;
}) {
  const version = options.version ?? '1.20.4';
  const arena = createFlatWorld(version);
  const physics = Physics(arena.mcData, arena.world);
  const left = createSimulatedFighter(options.leftName ?? 'Alpha', version, new Vec3(-3, 64, 0));
  const right = createSimulatedFighter(options.rightName ?? 'Bravo', version, new Vec3(3, 64, 0));
  const maxTicks = options.maxTicks ?? 120;
  const attackDamage = options.attackDamage ?? 4;
  const plannerConfig = defaultCombatConfig;

  console.log(`Starting prismarine-physics duel on ${version}`);

  for (let tick = 1; tick <= maxTicks; tick++) {
    const leftDecision = stepFighter(left, right, physics, arena.world, plannerConfig);
    if (leftDecision.attack) {
      applyDamage(left, right, plannerConfig.attackReach, attackDamage);
    }

    if (right.health <= 0) {
      console.log(`${left.name} won in ${tick} ticks`);
      return { winner: left.name, ticks: tick };
    }

    const rightDecision = stepFighter(right, left, physics, arena.world, plannerConfig);
    if (rightDecision.attack) {
      applyDamage(right, left, plannerConfig.attackReach, attackDamage);
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
      action: { name: 'dead', controls: createControlState(), attack: false },
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

