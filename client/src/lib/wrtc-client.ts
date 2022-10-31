export class RTCOfferingDataChannelPeerConnection extends RTCPeerConnection {
  private _channel?: RTCDataChannel
  private _candidates = [] as RTCIceCandidate[]
  private _onGatheredCandidates!: Promise<void>
  private _onChannelOpen!: Promise<void>

  // step 1
  static async create() {
    const connection = new RTCOfferingDataChannelPeerConnection()
    const offer = await connection.createOffer()

    return [connection, offer] as const
  }

  async createSessionOffer() {
    this._channel = this.createDataChannel('')
    this._channel.binaryType = 'arraybuffer'

    await new Promise(resolve => {
      this.onnegotiationneeded = resolve
    })

    const offer = await super.createOffer()
    this.setLocalDescription(offer)

    return offer
  }

  // step 3
  async connect(answer: RTCSessionDescriptionInit) {
    await this.setRemoteDescription(answer)

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
      this.channel!.onopen = () => resolve()
    })

    await this._onGatheredCandidates

    return this._candidates
  }

  // step 5
  async addIceCandidates(...candidates: (RTCIceCandidate | RTCIceCandidateInit)[]) {
    await Promise.all(candidates.map(c => this.addIceCandidate(c)))
  }

  get channel() {
    return this._channel
  }

  get candidates() {
    return this._candidates
  }

  // step 7
  get onChannelOpen() {
    return this._onChannelOpen
  }
}
