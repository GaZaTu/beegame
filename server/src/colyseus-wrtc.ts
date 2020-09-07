import { createServer } from 'http'
import { EventEmitter } from 'events'
import { Server, matchMaker } from 'colyseus'
import { ServerOptions } from 'colyseus/lib/Server'
import { Transport, Client, ClientState, ISendOptions } from 'colyseus/lib/transport/Transport'
import { Schema } from '@colyseus/schema/lib/Schema'
import { Protocol, getMessageBytes } from 'colyseus/lib/Protocol'
import { SeatReservation } from 'colyseus/lib/MatchMaker'
import * as wrtc from 'wrtc'
import * as arrayBufferToBuffer from 'arraybuffer-to-buffer'
import { RTCAnsweringDataChannelPeerConnection } from './wrtc-server'

Object.assign(globalThis, wrtc)

class WebRTCClient implements Client {
  sessionId: string
  state: ClientState = ClientState.JOINING
  _enqueuedMessages: any[] = []

  public static modifyDataChannel(channel: RTCDataChannel): RTCDataChannel & EventEmitter {
    const addListener = (event: string, listener: (...args: any[]) => void) => {
      switch (event) {
        case 'message':
          return channel.addEventListener('message', ev => {
            listener(arrayBufferToBuffer(ev.data))
          })
        default:
          return channel.addEventListener(event, ev => listener())
      }
    }

    const removeListener = (event: string, listener: (...args: any[]) => void) => {
      channel.removeEventListener(event, listener)
    }

    const once = (event: string, listener: (...args: any[]) => void) => {
      const actualListener = (...args: any[]) => {
        listener(...args)
        removeListener(event, actualListener)
      }

      addListener(event, actualListener)
    }

    const emitter = {
      addListener,
      removeListener,
      on: addListener,
      off: removeListener,
      once,
    } as EventEmitter

    return Object.assign(channel, emitter)
  }

  constructor(
    public id: string,
    public ref: RTCDataChannel & EventEmitter,
  ) {
    this.sessionId = id
  }

  public send(messageOrType: any, messageOrOptions?: any | ISendOptions, options?: ISendOptions) {
    //
    // TODO: implement `options.afterNextPatch`
    //
    this.enqueueRaw(
      (messageOrType instanceof Schema)
        ? getMessageBytes[Protocol.ROOM_DATA_SCHEMA](messageOrType)
        : getMessageBytes[Protocol.ROOM_DATA](messageOrType, messageOrOptions),
      options,
    )
  }

  public enqueueRaw(data: ArrayLike<number>, options?: ISendOptions) {
    if (this.state === ClientState.JOINING) {
      // sending messages during `onJoin`.
      // - the client-side cannot register "onMessage" callbacks at this point.
      // - enqueue the messages to be send after JOIN_ROOM message has been sent
      this._enqueuedMessages.push(data)
      return
    }

    this.raw(data, options)
  }

  public raw(data: ArrayLike<number>, options?: ISendOptions) {
    if (this.ref.readyState !== 'open') {
      console.warn('trying to send data to inactive client', this.sessionId)
      return
    }

    this.ref.send(new Uint8Array(data))
  }

  public error(code: number, message: string = '') {
    this.raw(getMessageBytes[Protocol.ERROR](code, message))
  }

  get readyState() {
    switch (this.ref.readyState) {
      case 'connecting':
        return 0
      case 'open':
        return 1
      case 'closing':
        return 2
      case 'closed':
        return 3
    }
  }

  public leave(code?: number, data?: string) {
    this.ref.close()
  }

  public close(code?: number, data?: string) {
    console.warn('DEPRECATION WARNING: use client.leave() instead of client.close()')
    try {
      throw new Error()
    } catch (e) {
      console.log(e.stack)
    }
    this.leave(code, data)
  }

  public toJSON() {
    return { sessionId: this.sessionId, readyState: this.readyState }
  }
}

class WebRTCTransport extends Transport {
  static PING = 1
  static PONG = 2

  connections = new Map<string, (RTCAnsweringDataChannelPeerConnection & { pingCount?: number })>()

  pingInterval?: NodeJS.Timer
  pingIntervalMS: number
  pingMaxRetries: number

  constructor(options: ServerOptions) {
    super()

    // disable per-message deflate
    options.perMessageDeflate = false

    if (options.pingTimeout !== undefined) {
      console.warn('"pingTimeout" is deprecated. Use "pingInterval" instead.')
      options.pingInterval = options.pingTimeout
    }

    if (options.pingCountMax !== undefined) {
      console.warn('"pingCountMax" is deprecated. Use "pingMaxRetries" instead.')
      options.pingMaxRetries = options.pingCountMax
    }

    this.pingIntervalMS = (options.pingInterval !== undefined)
      ? options.pingInterval
      : 1500
    this.pingMaxRetries = (options.pingMaxRetries !== undefined)
      ? options.pingMaxRetries
      : 2

    this.server = options.server!

    if (this.pingIntervalMS > 0 && this.pingMaxRetries > 0) {
      this.autoTerminateUnresponsiveClients(this.pingIntervalMS, this.pingMaxRetries)
    }
  }

  public listen(port?: number, hostname?: string, backlog?: number, listeningListener?: () => void) {
    this.server.listen(port, hostname, backlog, listeningListener)

    return this
  }

  public shutdown() {
    for (const connection of this.connections.values()) {
      connection.close()
    }
  }

  autoTerminateUnresponsiveClients(pingInterval: number, pingMaxRetries: number) {
    // interval to detect broken connections
    this.pingInterval = setInterval(() => {
      for (const connection of this.connections.values()) {
        if (!connection.channel || connection.channel.readyState !== 'open') {
          continue
        }

        // if client hasn't responded after the interval, terminate its connection.
        if ((connection.pingCount ?? 0) >= pingMaxRetries) {
          connection.close()
          continue
        }

        connection.pingCount = (connection.pingCount ?? 0) + 1
        connection.channel.send(new Uint8Array([WebRTCTransport.PING]))
      }
    }, pingInterval)
  }

  async addConnection(connection: RTCAnsweringDataChannelPeerConnection & { pingCount?: number }, seatReservation: SeatReservation) {
    this.connections.set(seatReservation.sessionId, connection)

    const sessionId = seatReservation.sessionId
    const roomId = seatReservation.room.roomId

    const room = matchMaker.getRoomById(roomId)

    await connection.onChannelOpen

    connection.channel!.send(new Uint8Array([WebRTCTransport.PING]))
    connection.channel!.addEventListener('message', ev => {
      if (new Uint8Array(ev.data)[0] === WebRTCTransport.PONG) {
        connection.pingCount = 0
      }
    })

    const client = new WebRTCClient(sessionId, WebRTCClient.modifyDataChannel(connection.channel!))

    try {
      if (!room || !room.hasReservedSeat(sessionId)) {
        throw new Error('seat reservation expired.')
      }

      await room._onJoin(client, undefined)
    } catch (e) {
      client.error(e.code, e.message)
      connection.close()
    }
  }
}

export class WebRTCServer extends Server {
  transport!: WebRTCTransport

  constructor(options?: ServerOptions) {
    super(options)

    interceptMatchMaker(async (roomName, { rtcOffer }, seatReservation) => {
      const [connection, rtcAnswer] = await RTCAnsweringDataChannelPeerConnection.fromOffer(rtcOffer)

      Object.assign(seatReservation, { rtcAnswer })

      this.transport.addConnection(connection, seatReservation)
    })

      ; (matchMaker as any).shareICECandidates = async (roomName: string, { sessionId, candidates }: any | undefined) => {
        for (const [id, connection] of this.transport.connections) {
          if (id === sessionId) {
            await connection.addIceCandidates(...candidates)

            return {
              candidates: connection.candidates,
            }
          }
        }

        return undefined
      }
      ; (this as any).exposedMethods.push('shareICECandidates')
  }

  public attach(options: ServerOptions) {
    if (!options.server) { options.server = createServer() }
    options.server.once('listening', () => this.registerProcessForDiscovery())

    this.attachMatchMakingRoutes(options.server)

    delete options.engine

    this.transport = new WebRTCTransport(options)
  }
}

const interceptMatchMaker = (onGetSeatReservation: (roomName: string, options: any | undefined, seatReservation: SeatReservation) => unknown) => {
  const exposedMethods = ['joinOrCreate', 'create', 'join', 'joinById'] as const

  for (const exposedMethod of exposedMethods) {
    const func = matchMaker[exposedMethod]

    matchMaker[exposedMethod] = async (roomName: string, options?: any) => {
      const seatReservation = await func.apply(undefined, [roomName, options])

      await onGetSeatReservation(roomName, options, seatReservation)

      return seatReservation
    }
  }
}
