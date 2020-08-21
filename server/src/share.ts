import { Schema, type, MapSchema } from '@colyseus/schema'
import * as ex from 'excalibur'

export class VectorState extends Schema {
  @type('number')
  x!: number
  @type('number')
  y!: number

  constructor(data?: Partial<VectorState>) {
    super()

    Object.assign(this, data)
  }

  static fromVector(v?: ex.Vector) {
    return v ? new VectorState({ x: v.x, y: v.y }) : new VectorState({ x: 0, y: 0 })
  }

  static toVector(v?: VectorState) {
    return v ? new ex.Vector(v.x, v.y) : new ex.Vector(0, 0)
  }
}

export class PlayerState extends Schema {
  @type('string')
  name!: string
  @type('string')
  colorHex!: string
  @type(VectorState)
  pos!: VectorState
  @type(VectorState)
  vel!: VectorState

  constructor(data?: Partial<PlayerState>) {
    super()

    Object.assign(this, data)
  }
}

export class BeeGameRoomState extends Schema {
  @type({ map: PlayerState })
  players = new MapSchema<PlayerState>()

  constructor(data?: Partial<BeeGameRoomState>) {
    super()

    Object.assign(this, data)
  }
}

export class ProjectileState extends Schema {
  @type(VectorState)
  pos!: VectorState
  @type(VectorState)
  vel!: VectorState
  @type(PlayerState)
  source!: PlayerState
}

export class Projectile extends ex.ParticleEmitter {
  protected _state = new ProjectileState()

  private _onPostCollision = (ev: ex.PostCollisionEvent) => {
    if (ev.other instanceof Player) {
      ev.other.kill()
    }

    ev.actor.kill()
  }

  constructor(config: ex.ParticleEmitterArgs, { source }: { source: Player }) {
    super({
      ...config,
      color: source.color,
      // emitterType: ex.EmitterType.Circle,
      // radius: 0,
      // minVel: 37,
      // maxVel: 80,
      // minAngle: 2,
      // maxAngle: 4.8,
      // isEmitting: true,
      // emitRate: 6,
      // opacity: 0.5,
      // fadeFlag: true,
      // particleLife: 1000,
      // maxSize: 3,
      // minSize: 1,
      // startSize: 0,
      // endSize: 0,
      // acceleration: new ex.Vector(0, 800),
      // beginColor: ex.Color.Transparent,
      // endColor: ex.Color.Transparent,
      // body: new ex.Body({
      //   collider: new ex.Collider({
      //     type: ex.CollisionType.Active,
      //     shape: ex.Shape.Circle(1),
      //   }),
      // }),
    })
  }

  onInitialize(engine: ex.Engine) {
    this.on('postcollision', this._onPostCollision)
  }

  get state() {
    return this._state
  }
}

class Nameplate extends ex.Label {
  constructor(config: Partial<ex.Label> & { x?: number, y?: number }, { name }: { name: string }) {
    super({
      ...config,
      fontFamily: 'Arial',
      fontSize: 12,
      textAlign: ex.TextAlign.Center,
      text: name,
    })
  }
}

interface CollisionInfo {
  readonly actor: ex.Actor
  readonly other: ex.Actor
  readonly side: ex.Side
  // readonly mtv: ex.Vector
}

const negateSide = (side: ex.Side) => {
  switch (side) {
    case ex.Side.Bottom: return ex.Side.Top
    case ex.Side.Left: return ex.Side.Right
    case ex.Side.Right: return ex.Side.Left
    case ex.Side.Top: return ex.Side.Bottom
    default: return ex.Side.None
  }
}

const mtvToSide = ({ x, y }: ex.Vector) => {
  if (x > 0) {
    return ex.Side.Left
  } else if (x < 0) {
    return ex.Side.Right
  } else if (y > 0) {
    return ex.Side.Top
  } else if (y < 0) {
    return ex.Side.Bottom
  } else {
    return ex.Side.None
  }
}

class CollisionsTracker {
  private _actor: ex.Actor
  private _onCollisionStartCallback: (ev: ex.CollisionStartEvent, collision: CollisionInfo) => void
  private _onCollisionEndCallback: (ev: ex.CollisionEndEvent, collision: CollisionInfo) => void
  private _collisions = [] as CollisionInfo[]

  private _onCollisionStart = (ev: ex.CollisionStartEvent) => {
    const negate = ev.pair.colliderA === this._actor.body.collider
    const collision = {
      actor: ev.actor,
      other: ev.other,
      side: mtvToSide(negate ? ev.pair.collision.mtv.negate() : ev.pair.collision.mtv),
    }

    this._collisions.push(collision)
    this.onCollisionStart(ev, collision)
    this._onCollisionStartCallback(ev, collision)
  }

  private _onCollisionEnd = (ev: ex.CollisionEndEvent) => {
    const collisionIndex = this._collisions.findIndex(c => ev.actor === c.actor && ev.other === c.other)
    const collision = this._collisions[collisionIndex]

    this._collisions.splice(collisionIndex, 1)
    this.onCollisionEnd(ev, collision)
    this._onCollisionEndCallback(ev, collision)
  }

  constructor({
    actor,
    onCollisionStartCallback,
    onCollisionEndCallback,
  }: {
    actor: ex.Actor,
    onCollisionStartCallback?: CollisionsTracker['_onCollisionStartCallback'],
    onCollisionEndCallback?: CollisionsTracker['_onCollisionEndCallback'],
  }) {
    this._actor = actor
    this._onCollisionStartCallback = onCollisionStartCallback || (() => {})
    this._onCollisionEndCallback = onCollisionEndCallback || (() => {})

    this._actor.on('collisionstart', this._onCollisionStart)
    this._actor.on('collisionend', this._onCollisionEnd)
  }

  stop() {
    this._actor.off('collisionstart', this._onCollisionStart)
    this._actor.off('collisionend', this._onCollisionEnd)
  }

  findCollisionWith(others: (ex.CollisionType | ex.Actor | (new (...args: any[]) => ex.Actor))[], side = ex.Side.None) {
    return this._collisions
      .filter(c => {
        return others.find(o => {
          if (typeof o === 'string') {
            return c.other.body.collider.type === o
          } else if (typeof o === 'function') {
            return c.other instanceof o
          } else {
            return c.other === o
          }
        }) !== undefined
      })
      .filter(c => side === ex.Side.None || c.side === side)
      .find(() => true)
  }

  isCollidingWith(others: (ex.CollisionType | ex.Actor | (new (...args: any[]) => ex.Actor))[], side = ex.Side.None) {
    return this.findCollisionWith(others, side) !== undefined
  }

  protected onCollisionStart(ev: ex.CollisionStartEvent, collision: CollisionInfo) {}

  protected onCollisionEnd(ev: ex.CollisionEndEvent, collision: CollisionInfo) {}
}

class NetworkActor<S extends Schema> extends ex.Actor {
  constructor(
    config: ex.ActorArgs,
    private _state: S,
  ) {
    super(config)
  }

  get state() {
    return this._state
  }
}

export class Player extends NetworkActor<PlayerState> {
  protected _onGround = false
  protected _collisions = new CollisionsTracker({ actor: this })

  constructor(
    config: ex.ActorArgs,
    state: PlayerState,
  ) {
    super({
      ...config,
      width: 20,
      height: 75,
      body: new ex.Body({
        collider: new ex.Collider({
          type: ex.CollisionType.Active,
          shape: ex.Shape.Box(20, 75),
        }),
      }),
      color: ex.Color.fromHex(state.colorHex),
      pos: VectorState.toVector(state.pos),
      vel: VectorState.toVector(state.vel),
    }, state)

    this.add(new Nameplate({ y: 0 - (this.height / 2) }, state))
    // this.add(new Projectile({}, { source: this }))
  }

  onPreUpdate(engine: ex.Engine, delta: number) {
    this._onGround = this._collisions.isCollidingWith([Floor, Player], ex.Side.Bottom)
  }

  onPostUpdate(engine: ex.Engine, delta: number) {
    if (this._onGround) {
      this.vel.y = 0
      this.acc.y = 0
    }
  }

  get onGround() {
    return this._onGround
  }

  get collisions() {
    return this._collisions
  }
}

export abstract class LocalPlayer extends Player {
  protected abstract getInput(engine: ex.Engine): ex.Input.EngineInput

  onPreUpdate(engine: ex.Engine, delta: number) {
    super.onPreUpdate(engine, delta)

    this.vel.x = 0

    if (this.getInput(engine).keyboard.isHeld(ex.Input.Keys.Left)) {
      this.vel.x = (10 * delta) * -1
    } else if (this.getInput(engine).keyboard.isHeld(ex.Input.Keys.Right)) {
      this.vel.x = 10 * delta
    }

    if (this.getInput(engine).keyboard.wasPressed(ex.Input.Keys.Up) && this._onGround) {
      this._onGround = false
      this.vel.y = (25 * delta) * -1
    }

    if (this.getInput(engine).keyboard.wasPressed(ex.Input.Keys.Space)) {}
  }
}

export class Floor extends ex.Actor {
  constructor(config?: ex.ActorArgs) {
    super({
      ...config,
      scale: new ex.Vector(2, 2),
      anchor: ex.Vector.Zero,
      width: 1000,
      height: 10,
      color: ex.Color.Gray,
      body: new ex.Body({
        collider: new ex.Collider({
          type: ex.CollisionType.Fixed,
          shape: ex.Shape.Box(1000, 10),
          group: ex.CollisionGroupManager.groupByName('floor'),
        }),
      }),
    })
  }
}

export class Level extends ex.Scene {
  constructor(
    engine: ex.Engine,
  ) {
    super(engine)
  }

  onInitialize(engine: ex.Engine) {
    ex.CollisionGroupManager.reset()
    ex.CollisionGroupManager.create('player')
    ex.CollisionGroupManager.create('enemy')
    ex.CollisionGroupManager.create('floor')

    const floor = new Floor({ x: 0, y: 1000 })

    engine.add(floor)

    this.camera.clearAllStrategies()
    this.camera.strategy.lockToActor(floor)
  }
}

export class BeeGame extends ex.Engine {
  static createMainLoopOld = ex.Engine.createMainLoop
  static createMainLoop(engine: ex.Engine, requestAnimationFrame: (func: Function) => number, now: () => number) {
    return BeeGame.createMainLoopOld(engine, func => {
      console.log('requestAnimationFrame')

      return requestAnimationFrame(func)
    }, now)
  }

  onInitialize() {
    // Turn off anti-aliasing for pixel art graphics
    this.setAntialiasing(false)

    // Set global gravity, 800 pixels/sec^2
    ex.Physics.acc = new ex.Vector(0, 800)
  }
}
