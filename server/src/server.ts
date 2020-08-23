import * as ex from 'excalibur'
import { LocalPlayer, Level, BeeGame, BeeGameRoomState, VectorState, PlayerState, NetEvents } from './share'
import { Room, Client } from 'colyseus'

class NetworkKeyboard {
  private static KeyToSessionMap = class extends Map<ex.Input.Keys, Set<unknown>> {
    constructor() {
      super(Object.values(ex.Input.Keys).map(k => [k as ex.Input.Keys, new Set<unknown>()]))
    }
  }

  private _keys = new NetworkKeyboard.KeyToSessionMap()
  private _keysDown = new NetworkKeyboard.KeyToSessionMap()
  private _keysUp = new NetworkKeyboard.KeyToSessionMap()

  constructor(
    private _room: Room,
  ) {
    this._room.onMessage(NetEvents.KEYDOWN, (client, { keys }) => {
      for (const key of keys) {
        const clientsThatHoldKey = this._keys.get(key)!
        const clientsThatPressedKey = this._keysDown.get(key)!

        if (!clientsThatHoldKey.has(client.sessionId)) {
          clientsThatHoldKey.add(client.sessionId)
          clientsThatPressedKey.add(client.sessionId)
        }
      }
    })

    this._room.onMessage(NetEvents.KEYUP, (client, { keys }) => {
      for (const key of keys) {
        const clientsThatHoldKey = this._keys.get(key)!
        const clientsThatReleasedKey = this._keysUp.get(key)!

        clientsThatHoldKey.delete(client.sessionId)
        clientsThatReleasedKey.add(client.sessionId)
      }
    })
  }

  update() {
    this._keysDown.forEach(v => v.clear())
    this._keysUp.forEach(v => v.clear())
  }

  getKeys(sessionId: unknown) {
    return [...this._keys]
      .filter(([, s]) => s.has(sessionId))
      .map(([k]) => k)
  }

  wasPressed(key: ex.Input.Keys, sessionId: unknown) {
    return this._keysDown.get(key)!.has(sessionId)
  }

  wasReleased(key: ex.Input.Keys, sessionId: unknown) {
    return this._keysUp.get(key)!.has(sessionId)
  }

  isHeld(key: ex.Input.Keys, sessionId: unknown) {
    return this._keys.get(key)!.has(sessionId)
  }
}

class ServerLocalPlayerKeyboard extends ex.Input.Keyboard {
  constructor(
    private _keyboard: NetworkKeyboard,
    private _sessionId: unknown,
  ) {
    super()
  }

  init() {}

  update() {}

  getKeys() {
    return this._keyboard.getKeys(this._sessionId)
  }

  wasPressed(key: ex.Input.Keys) {
    return this._keyboard.wasPressed(key, this._sessionId)
  }

  wasReleased(key: ex.Input.Keys) {
    return this._keyboard.wasReleased(key, this._sessionId)
  }

  isHeld(key: ex.Input.Keys) {
    return this._keyboard.isHeld(key, this._sessionId)
  }
}

class ServerLocalPlayerInput implements ex.Input.EngineInput {
  keyboard: ex.Input.Keyboard = new ServerLocalPlayerKeyboard(this._netKeyboard, this._sessionId)
  pointers: ex.Input.Pointers = undefined as any
  gamepads: ex.Input.Gamepads = undefined as any

  constructor(
    private _sessionId: unknown,
    private _netKeyboard: NetworkKeyboard,
    // private _netPointers: NetworkPointers,
    // private _netGamepads: NetworkGamepads,
  ) {}
}

export class ServerLocalPlayer extends LocalPlayer {
  private _input: ex.Input.EngineInput

  constructor(
    config: ex.ActorArgs,
    state: PlayerState,
    { input }: { input: ex.Input.EngineInput },
  ) {
    super(config, state)

    this._input = input
  }

  protected getInput() {
    return this._input
  }

  onPreUpdate(engine: ex.Engine, delta: number) {
    super.onPreUpdate(engine, delta)
  }

  onPostUpdate(engine: ex.Engine, delta: number) {
    super.onPostUpdate(engine, delta)

    if (this.pos.distance(VectorState.toVector(this.state.pos)) > 1) {
      this.state.pos = VectorState.fromVector(this.pos)
    }

    if (this.vel.distance(VectorState.toVector(this.state.vel)) > 1) {
      this.state.vel = VectorState.fromVector(this.vel)
    }
  }
}

export class ServerLevel extends Level {}

export class BeeGameServerEngine extends BeeGame {
  players = new Proxy({} as { [key: string]: ServerLocalPlayer }, {
    set: (target, p: string, v: ServerLocalPlayer) => {
      target[p] = v
      this.currentScene.add(v)

      return true
    },
    deleteProperty: (target, p: string) => {
      this.currentScene.remove(target[p])
      delete target[p]

      return true
    },
  })

  constructor(options?: ex.EngineOptions) {
    super({
      ...options,
      suppressConsoleBootMessage: true,
      suppressMinimumBrowserFeatureDetection: true,
    })
  }

  onInitialize() {
    super.onInitialize()

    this.add('level', new ServerLevel(this))
    this.goToScene('level')
  }
}

class LatencyTracker {
  private _sessionLatencies = new Map<unknown, number>()
  private _previousPing = Date.now()
  private _intervalId = setInterval(() => {
    this._previousPing = Date.now()
    this._room.broadcast(NetEvents.PING)
  }, 5000)

  constructor(
    private _room: Room,
  ) {
    this._room.onMessage(NetEvents.PONG, client => {
      this._sessionLatencies.set(client.sessionId, Date.now() - this._previousPing)
    })

    this._room.onMessage(NetEvents.PING, client => {
      client.send(NetEvents.PONG)
    })
  }

  getLatency(sessionId: unknown) {
    return this._sessionLatencies.get(sessionId) || 0
  }

  deleteSession(sessionId: unknown) {
    this._sessionLatencies.delete(sessionId)
  }

  stop() {
    clearInterval(this._intervalId)
  }
}

class ServerLocalPlayerLatencyTracker {
  constructor(
    private _latencyTracker: LatencyTracker,
    private _sessionId: unknown,
  ) {}

  getLatency() {
    return this._latencyTracker.getLatency(this._sessionId)
  }
}

export class BeeGameServerRoom extends Room<BeeGameRoomState> {
  private _engine!: BeeGameServerEngine
  private _keyboard = new NetworkKeyboard(this)
  private _latencyTracker = new LatencyTracker(this)

  private log(message?: any, ...optionalParams: any[]) {
    console.group(`room: { roomId: ${this.roomId}, roomName: ${this.roomName} }`)
    console.log(message, ...optionalParams)
    console.groupEnd()
  }

  onCreate({}: {}) {
    this.log(`.onCreate({})`)

    this.setState(new BeeGameRoomState())
    // this.patchRate = 10

    this._engine = new BeeGameServerEngine()
    this._engine.start()
    this._engine.on('postframe', () => this._keyboard.update())
  }

  onJoin(client: Client, { name, colorHex }: { name: string, colorHex: string }) {
    this.log(`.onJoin({ sessionId: ${client.sessionId} }, { name: ${name} })`)

    const player = new ServerLocalPlayer({
      color: ex.Color.fromHex(colorHex),
    }, new PlayerState({
      name,
      colorHex,
      pos: new VectorState({ x: 0 + ((Object.keys(this.state.players).length + 1) * 100), y: 900 }),
      vel: new VectorState({ x: 0, y: 0 }),
    }), {
      input: new ServerLocalPlayerInput(client.sessionId, this._keyboard),
    })

    this._engine.players[client.sessionId] = player
    this.state.players[client.sessionId] = player.state
  }

  onLeave(client: Client, consented: boolean) {
    this.log(`.onLeave({ sessionId: ${client.sessionId} })`)

    delete this._engine.players[client.sessionId]
    delete this.state.players[client.sessionId]

    this._latencyTracker.deleteSession(client.sessionId)
  }

  onDispose() {
    this.log(`.onDispose()`)

    this._engine.stop()
    this._latencyTracker.stop()
  }
}
