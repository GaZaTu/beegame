import { Client, Room, JoinOptions } from 'colyseus.js'
import { Connection } from 'colyseus.js/lib/Connection'
import { SchemaConstructor } from 'colyseus.js/lib/serializer/SchemaSerializer'
import { post } from '@colyseus/http'
import { MatchMakeError } from 'colyseus.js/lib/Client'

class WebRTCConnection {
  static PING = 1
  static PONG = 2

  constructor(
    public connection: RTCPeerConnection,
    public channel: RTCDataChannel,
  ) {
    this.channel.onmessage = ev => {
      if (this.onmessage) {
        this.onmessage!.apply(undefined as any, [ev])
      }

      if (new Uint8Array(ev.data)[0] === WebRTCConnection.PING) {
        this.channel.send(new Uint8Array([WebRTCConnection.PONG]))
      }
    }

    this.channel.onclose = ev => {
      if (this.onclose) {
        this.onclose!.apply(undefined as any, [Object.assign(ev, { code: 0, reason: '' }) as any])
      }
    }

    this.channel.onerror = ev => {
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

    this.channel.send(data)
  }

  close() {
    this.channel.close()
  }
}

class WebRTCRoom<T> extends Room<T> {
  constructor(name: string, rootSchema: SchemaConstructor<T> | undefined, connection: RTCPeerConnection, channel: RTCDataChannel) {
    super(name, rootSchema)

    this.connection = new WebRTCConnection(connection, channel) as any
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
  connection = new RTCPeerConnection()
  channel?: RTCDataChannel
  iceCandidates = [] as RTCIceCandidate[]

  protected createRoom<T>(roomName: string, rootSchema?: SchemaConstructor<T>) {
    return new WebRTCRoom<T>(roomName, rootSchema, this.connection, this.channel!)
  }

  public async consumeSeatReservation<T>(response: any, rootSchema?: SchemaConstructor<T>) {
    const { room, sessionId, rtcAnswer } = response
    this.connection.setRemoteDescription(rtcAnswer)

    this.connection.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.iceCandidates.push(candidate)
      }
    }

    this.connection.onicegatheringstatechange = async () => {
      const options = {
        sessionId,
        candidates: this.iceCandidates,
      } as any

      if (this.connection.iceGatheringState === 'complete') {
        const url = `${this.endpoint.replace('ws', 'http')}/matchmake/shareICECandidates/${room.name}`

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

        for (const candidate of response.candidates) {
          this.connection.addIceCandidate(candidate)
        }
      }
    }

    return super.consumeSeatReservation(response, rootSchema)
  }

  protected async createMatchMakeRequest<T>(
    method: string,
    roomName: string,
    options: JoinOptions = {},
    rootSchema?: SchemaConstructor<T>,
  ) {
    this.channel = this.connection.createDataChannel('')
    this.channel.binaryType = 'arraybuffer'

    await new Promise(resolve => {
      this.connection.onnegotiationneeded = resolve
    })

    const rtcOffer = await this.connection.createOffer()
    this.connection.setLocalDescription(rtcOffer)

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
}
