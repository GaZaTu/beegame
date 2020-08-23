import React, { useRef, useEffect, useMemo } from 'react'
import * as ex from 'excalibur'
import { Client, Room } from 'colyseus.js'
import { BeeGameRoomState, Player, LocalPlayer, Level, BeeGame, PlayerState, VectorState, NetEvents } from 'server'
import retry from '../lib/retry'

interface PrivateKeyboardFields {
  readonly _keys: ex.Input.Keys[]
  readonly _keysUp: ex.Input.Keys[]
  readonly _keysDown: ex.Input.Keys[]
}

class KeyboardSnapshot extends ex.Input.Keyboard {
  constructor(
    private _snapshot: PrivateKeyboardFields,
  ) {
    super()
  }

  static from(keyboard: ex.Input.Keyboard) {
    const { _keys, _keysUp, _keysDown } = keyboard as unknown as PrivateKeyboardFields
    const snapshot = { _keys, _keysUp, _keysDown }

    return new KeyboardSnapshot(JSON.parse(JSON.stringify(snapshot)))
  }

  init() { }

  update() { }

  getKeys() {
    return this._snapshot._keys
  }

  wasPressed(key: ex.Input.Keys) {
    return this._snapshot._keysDown.includes(key)
  }

  wasReleased(key: ex.Input.Keys) {
    return this._snapshot._keysUp.includes(key)
  }

  isHeld(key: ex.Input.Keys) {
    return this._snapshot._keys.includes(key)
  }
}

export class ClientLocalPlayer extends LocalPlayer {
  private _room: Room
  private _latencyTracker: LatencyTracker
  private _unsubFromState = this.listenToPlayerState()
  private _posHistory = [] as { time: number, pos: ex.Vector }[]
  private _inputHistory = [] as { time: number, keyboard: ex.Input.Keyboard }[]

  constructor(
    config: ex.ActorArgs,
    state: PlayerState,
    { room, latencyTracker }: { room: Room, latencyTracker: LatencyTracker },
  ) {
    super(config, state)

    this._room = room
    this._latencyTracker = latencyTracker
  }

  protected getInput(engine: ex.Engine) {
    return engine.input
  }

  onPreUpdate(engine: ex.Engine, delta: number) {
    super.onPreUpdate(engine, delta)

    this.sendPressedKeysToServer(this.getKeyboard(engine))
    this.sendReleasedKeysToServer(this.getKeyboard(engine))
  }

  onPostUpdate(engine: ex.Engine, delta: number) {
    super.onPostUpdate(engine, delta)

    this._posHistory.unshift({ time: Date.now(), pos: this.pos.clone() })
    this._posHistory.length = this._posHistory.length < 50 ? this._posHistory.length : 50
  }

  onPostKill(scene: ex.Scene) {
    super.onPostKill(scene)

    this._unsubFromState()
  }

  useKeyboardToMove(keyboard: ex.Input.Keyboard, delta: number) {
    this._inputHistory.unshift({ time: Date.now(), keyboard: KeyboardSnapshot.from(keyboard) })
    this._inputHistory.length = this._inputHistory.length < 50 ? this._inputHistory.length : 50

    const now = Date.now() - 100

    for (const { time, keyboard } of this._inputHistory) {
      if ((time - now) < (1e3 / 60)) {
        super.useKeyboardToMove(keyboard, delta)

        break
      }
    }
  }

  async sendPressedKeysToServer(keyboard: ex.Input.Keyboard) {
    const keys = LocalPlayer.KEYS_TO_WATCH
      .filter(key => keyboard.wasPressed(key))

    if (keys.length > 0) {
      this._room.send(NetEvents.KEYDOWN, { keys })
    }
  }

  async sendReleasedKeysToServer(keyboard: ex.Input.Keyboard) {
    const keys = LocalPlayer.KEYS_TO_WATCH
      .filter(key => keyboard.wasReleased(key))

    if (keys.length > 0) {
      this._room.send(NetEvents.KEYUP, { keys })
    }
  }

  private listenToPlayerState() {
    const unsub1 = this.state.listen('pos', serverPos => {
      const now = Date.now() - this._latencyTracker.getLatency()

      for (const { time, pos } of this._posHistory) {
        if ((time - now) < (1e3 / 60)) {
          const serverPosVector = VectorState.toVector(serverPos)

          if (pos.distance(serverPosVector) > 10) {
            console.warn(`input prediction error, distance: ${Math.floor(pos.distance(serverPosVector))}`)

            this.pos = serverPosVector
          }

          break
        }
      }
    })

    const unsub2 = this.state.listen('vel', vel => {
      this.vel = VectorState.toVector(vel)
    })

    return () => {
      unsub1()
      unsub2()
    }
  }
}

export class NetworkPlayer extends Player {
  private _latencyTracker: LatencyTracker
  private _unsubFromState = this.listenToPlayerState()

  constructor(
    config: ex.ActorArgs,
    state: PlayerState,
    { latencyTracker }: { latencyTracker: LatencyTracker },
  ) {
    super({
      ...config,
    }, state)

    this._latencyTracker = latencyTracker
  }

  onPostKill(scene: ex.Scene) {
    super.onPostKill(scene)

    this._unsubFromState()
  }

  private listenToPlayerState() {
    const unsub1 = this.state.listen('pos', pos => {
      setTimeout(() => this.actions.easeTo(pos.x, pos.y, 1e3 / 60), 100 - this._latencyTracker.getLatency())
    })

    const unsub2 = this.state.listen('vel', vel => {
      setTimeout(() => this.vel = VectorState.toVector(vel), 100 - this._latencyTracker.getLatency())
    })

    return () => {
      unsub1()
      unsub2()
    }
  }
}

export class LocalLevel extends Level {}

export class BeeGameClientEngine extends BeeGame {
  player!: ClientLocalPlayer
  players = new Proxy({} as { [key: string]: Player }, {
    set: (target, p: string, v: Player) => {
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

  onInitialize() {
    super.onInitialize()

    this.add('level', new LocalLevel(this))
    this.goToScene('level')
  }
}

const randomInt = (min: number, max: number) => {
  min = Math.ceil(min)
  max = Math.floor(max)

  return Math.floor(Math.random() * (max - min + 1)) + min
}

const throttleWebSocket = (client: WebSocket, latencyRange = [25, 75] as readonly [number, number]) => {
  const send = client.send

  client.send = function (this: WebSocket, ...args: any[]) {
    setTimeout(() => send.apply(this, args as any), 50)
  }
}

class LatencyTracker {
  private _latency = 0
  private _previousPing = Date.now()
  private _intervalId = setInterval(() => {
    this._previousPing = Date.now()
    this._room.send(NetEvents.PING)
  }, 5000)

  constructor(
    private _room: Room,
  ) {
    this._room.onMessage(NetEvents.PONG, () => {
      this._latency = Date.now() - this._previousPing
    })

    this._room.onMessage(NetEvents.PING, () => {
      this._room.send(NetEvents.PONG)
    })
  }

  getLatency() {
    return this._latency
  }

  stop() {
    clearInterval(this._intervalId)
  }
}

class LatencyUIElement extends ex.Label {
  constructor(
    private _latencyTracker: LatencyTracker,
  ) {
    super({
      x: 10,
      y: 10,
      text: '',
      color: ex.Color.Chartreuse,
    })
  }

  onPreUpdate() {
    this.text = `ping: ${this._latencyTracker.getLatency() / 2} ms`
  }
}

const joinBeeGame = async (canvasElement: HTMLCanvasElement, name: string, colorHex: string) => {
  const client = new Client(process.env.REACT_APP_API_WS_URL)
  const room = await client.joinOrCreate<BeeGameRoomState>('beegame', { name, colorHex })

  if (process.env.NODE_ENV !== 'production') {
    throttleWebSocket(room.connection.ws)
  }

  const engine = new BeeGameClientEngine({
    canvasElement,
    displayMode: ex.DisplayMode.Container,
  })
  engine.start()

  room.connection.ws.addEventListener('close', ({ reason, wasClean }) => {
    engine.stop()

    if (wasClean) {
      return
    }

    tryJoinBeeGame(canvasElement, name, colorHex)
  })

  const latencyTracker = new LatencyTracker(room)

  const roomState = await new Promise<BeeGameRoomState>(resolve => room.onStateChange.once(resolve))

  for (const [sessionId, playerState] of Object.entries<PlayerState>(roomState.players)) {
    const player = (() => {
      if (sessionId === room.sessionId) {
        return new ClientLocalPlayer({}, playerState, { room, latencyTracker })
      } else {
        return new NetworkPlayer({}, playerState, { latencyTracker })
      }
    })()

    engine.players[sessionId] = player

    if (player instanceof ClientLocalPlayer) {
      engine.player = player
    }
  }

  roomState.players.onAdd = (playerState, sessionId) => {
    engine.players[sessionId] = new NetworkPlayer({}, playerState, { latencyTracker })
  }

  roomState.players.onRemove = (playerState, sessionId) => {
    delete engine.players[sessionId]
  }

  engine.currentScene.camera.clearAllStrategies()
  engine.currentScene.camera.strategy.lockToActor(engine.player)

  engine.currentScene.addScreenElement(new LatencyUIElement(latencyTracker))
}

const tryJoinBeeGame = async (canvasElement: HTMLCanvasElement, name: string, colorHex: string) =>
  retry(() => joinBeeGame(canvasElement, name, colorHex))

const useBeeGame = (name: string, colorHex: string) => {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    (async () => {
      if (!canvas.current) {
        return
      }

      tryJoinBeeGame(canvas.current, name, colorHex)
    })()
  }, [name, colorHex])

  return {
    canvas,
  }
}

const getRandomString = () =>
  Math.random().toString(36).substr(2, 5)

const getRandomColorHex = () => {
  const letters = '0123456789ABCDEF'
  let color = '#'

  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)]
  }

  return color
}

const BeeGameView: React.FC = () => {
  const { name, colorHex } = useMemo(() => ({
    name: getRandomString(), // prompt('Enter your name'),
    colorHex: getRandomColorHex(), // prompt('Enter your colorHex'),
  }), [])

  if (!name || !colorHex) {
    throw new Error('provide flippin name and colorHex!!')
  }

  const beegame = useBeeGame(name, colorHex)

  return (
    <div style={{ width: '800px', height: '450px' }}>
      <canvas ref={beegame.canvas} />
    </div>
  )
}

export default React.memo(BeeGameView)
