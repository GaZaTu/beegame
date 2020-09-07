declare module 'kill-port' {
  namespace killPort { }
  function killPort(port: number, protocol: 'tcp' | 'udp'): Promise<void>

  export = killPort
}

declare module 'wrtc' {
  export const MediaStream: (typeof globalThis)['MediaStream']
  export const MediaStreamTrack: (typeof globalThis)['MediaStreamTrack']
  export const RTCDataChannel: (typeof globalThis)['RTCDataChannel']
  export const RTCDataChannelEvent: (typeof globalThis)['RTCDataChannelEvent']
  export const RTCDtlsTransport: (typeof globalThis)['RTCDtlsTransport']
  export const RTCIceCandidate: (typeof globalThis)['RTCIceCandidate']
  export const RTCIceTransport: (typeof globalThis)['RTCIceTransport']
  export const RTCPeerConnection: (typeof globalThis)['RTCPeerConnection']
  export const RTCPeerConnectionIceEvent: (typeof globalThis)['RTCPeerConnectionIceEvent']
  export const RTCRtpReceiver: (typeof globalThis)['RTCRtpReceiver']
  export const RTCRtpSender: (typeof globalThis)['RTCRtpSender']
  export const RTCRtpTransceiver: (typeof globalThis)['RTCRtpTransceiver']
  export const RTCSctpTransport: (typeof globalThis)['RTCSctpTransport']
  export const RTCSessionDescription: (typeof globalThis)['RTCSessionDescription']
  export const getUserMedia: (typeof navigator)['getUserMedia']
  export const mediaDevices: (typeof navigator)['mediaDevices']
  export const nonstandard: {
    i420ToRgba: (...args: any[]) => any,
    RTCAudioSink: any,
    RTCAudioSource: any,
    RTCVideoSink: any,
    RTCVideoSource: any,
    rgbaToI420: (...args: any[]) => any,
  }
}

declare module 'gl' {
  namespace gl { }
  function gl(width: number, height: number, contextAttributes?: WebGLContextAttributes): WebGLRenderingContext

  export = gl
}
