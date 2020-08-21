declare module 'kill-port' {
  namespace killPort {}
  function killPort(port: number, protocol: 'tcp' | 'udp'): Promise<void>

  export = killPort
}
