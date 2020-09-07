import { RTCPeerConnection } from 'wrtc'

export class RTCAnsweringDataChannelPeerConnection extends RTCPeerConnection {
  private _channel?: RTCDataChannel
  private _candidates = [] as RTCIceCandidate[]
  private _onGatheredCandidates!: Promise<void>
  private _onChannelOpen!: Promise<void>

  // step 2
  static async fromOffer(offer: RTCSessionDescriptionInit) {
    const connection = new RTCAnsweringDataChannelPeerConnection()
    const answer = await connection.createAnswerFromOffer(offer)

    return [connection, answer] as const
  }

  async createAnswerFromOffer(offer: RTCSessionDescriptionInit) {
    await this.setRemoteDescription(offer)
    const answer = await super.createAnswer()
    await this.setLocalDescription(answer)

    this.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this._candidates.push(candidate)
      }
    }

    this._onGatheredCandidates = new Promise(resolve => {
      this.onicegatheringstatechange = () => {
        if (this.iceGatheringState === 'complete') {
          resolve()
        }
      }
    })

    this._onChannelOpen = new Promise(resolve => {
      this.ondatachannel = async ({ channel }) => {
        this._channel = channel

        resolve()
      }
    })

    return answer
  }

  // step 4
  async addIceCandidates(...candidates: (RTCIceCandidate | RTCIceCandidateInit)[]) {
    await this._onGatheredCandidates
    await Promise.all(candidates.map(c => this.addIceCandidate(c)))
  }

  get channel() {
    return this._channel
  }

  get candidates() {
    return this._candidates
  }

  // step 6
  get onChannelOpen() {
    return this._onChannelOpen
  }
}

export class RTCDataChannelServer {
  private _connections = new Set<RTCAnsweringDataChannelPeerConnection>()

  async createConnectionFromOffer(offer: RTCSessionDescriptionInit) {
    const [connection, answer] = await RTCAnsweringDataChannelPeerConnection.fromOffer(offer)

    this._connections.add(connection)

    connection.onChannelOpen.then(() => {
      connection.channel?.addEventListener('close', () => {
        this._connections.delete(connection)
      })
    })

    return [connection, answer] as const
  }

  get connections() {
    return this._connections
  }
}
