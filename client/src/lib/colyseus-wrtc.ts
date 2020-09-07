import { Client, Room, JoinOptions } from 'colyseus.js'
import { Connection } from 'colyseus.js/lib/Connection'
import { SchemaConstructor } from 'colyseus.js/lib/serializer/SchemaSerializer'
import { post } from '@colyseus/http'
import { MatchMakeError } from 'colyseus.js/lib/Client'
import { RTCOfferingDataChannelPeerConnection } from './wrtc-client'

class WebRTCConnection {
  static PING = 1
  static PONG = 2

  constructor(
    public connection: RTCOfferingDataChannelPeerConnection,
  ) {
    this.connection.channel!.onmessage = ev => {
      if (this.onmessage) {
        this.onmessage!.apply(undefined as any, [ev])
      }

      if (new Uint8Array(ev.data)[0] === WebRTCConnection.PING) {
        this.connection.channel!.send(new Uint8Array([WebRTCConnection.PONG]))
      }
    }

    this.connection.channel!.onclose = ev => {
      if (this.onclose) {
        this.onclose!.apply(undefined as any, [Object.assign(ev, { code: 0, reason: '' }) as any])
      }
    }

    this.connection.channel!.onerror = ev => {
      if (this.onerror) {
        this.onerror!.apply(undefined as any, [ev])
      }
    }
  }

  onmessage: Connection['onmessage'] = null
  onclose: Connection['onclose'] = null
  onerror: Connection['onerror'] = null

  open() {}

  send(data: Array<number> | ArrayBufferLike) {
    if (Array.isArray(data)) {
      data = new Uint8Array(data)
    }

    this.connection.channel!.send(data)
  }

  close() {
    this.connection.channel!.close()
  }
}

class WebRTCRoom<T> extends Room<T> {
  constructor(name: string, rootSchema: SchemaConstructor<T> | undefined, connection: RTCOfferingDataChannelPeerConnection) {
    super(name, rootSchema)

    this.connection = new WebRTCConnection(connection) as any
  }

  public connect(endpoint: string) {
    this.connection.reconnectEnabled = false
    this.connection.onmessage = this.onMessageCallback.bind(this)
    this.connection.onclose = (e: CloseEvent) => {
      if (!this.hasJoined) {
        return this.onError.invoke(e.code, e.reason)
      }

      this.onLeave.invoke(e.code)
    }
    this.connection.onerror = () => {
      this.onError.invoke(0, '')
    }
    this.connection.open()
  }
}

export class WebRTCClient extends Client {
  connection?: RTCOfferingDataChannelPeerConnection

  protected createRoom<T>(roomName: string, rootSchema?: SchemaConstructor<T>) {
    return new WebRTCRoom<T>(roomName, rootSchema, this.connection!)
  }

  public async consumeSeatReservation<T>(response: any, rootSchema?: SchemaConstructor<T>) {
    const { room, sessionId, rtcAnswer } = response

    await this.shareICECandidates({
      sessionId,
      roomName: room.name,
      candidates: await this.connection!.connect(rtcAnswer),
    })

    return super.consumeSeatReservation(response, rootSchema)
  }

  protected async createMatchMakeRequest<T>(
    method: string,
    roomName: string,
    options: JoinOptions = {},
    rootSchema?: SchemaConstructor<T>,
  ) {
    const [connection, rtcOffer] = await RTCOfferingDataChannelPeerConnection.create()
    this.connection = connection

    return super.createMatchMakeRequest(
      method,
      roomName,
      {
        ...options,
        rtcOffer,
      },
      rootSchema,
    )
  }

  private async shareICECandidates(options: { sessionId: string, roomName: string, candidates: RTCIceCandidate[], token?: any }) {
    const url = `${this.endpoint.replace('ws', 'http')}/matchmake/shareICECandidates/${options.roomName}`

    // automatically forward auth token, if present
    if (this.auth.hasToken) {
      options.token = this.auth.token
    }

    const response = (
      await post(url, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(options),
      })
    ).data

    if (response.error) {
      throw new MatchMakeError(response.error, response.code)
    }

    this.connection!.addIceCandidates(...response.candidates)
  }
}
