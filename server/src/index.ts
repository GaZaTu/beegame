import './fakedomapi'

import * as http from 'http'
import * as https from 'https'
import * as http2 from 'http2'
import * as express from 'express'
import * as cors from 'cors'
import * as ws from 'ws'
import { Server } from 'colyseus'
// import { monitor } from '@colyseus/monitor'
// import socialRoutes from '@colyseus/social/express'
import { BeeGameServerRoom } from './server'
import * as killPort from 'kill-port'
import { config } from './dotenv'
import { readFileSync } from 'fs'
import { WebRTCServer } from './colyseus-wrtc'

config()

const PORT = Number(process.env.PORT || 2567)
const HOST = String(process.env.HOST || '127.0.0.1')

const randomInt = (min: number, max: number) => {
  min = Math.ceil(min)
  max = Math.floor(max)

  return Math.floor(Math.random() * (max - min + 1)) + min
}

const throttleWSServer = (server: ws.Server, latencyRange = [25, 75] as readonly [number, number]) => {
  const clientsAdd = server.clients.add

  server.clients.add = function (this: Set<ws>, client) {
    const send = client.send

    client.send = function (this: ws, ...args: any[]) {
      setTimeout(() => send.apply(this, args as any), 50)
    }

    return clientsAdd.apply(this, [client])
  }
}

const createHttpServer = (callback?: (req: http.IncomingMessage, res: http.ServerResponse) => void) => {
  let server!: http.Server | https.Server // | http2.Http2SecureServer

  if (process.env.KEY && process.env.CERT && process.env.CA) {
    const httpsConfig = {
      allowHTTP1: true,
      key: readFileSync(process.env.KEY),
      cert: readFileSync(process.env.CERT),
      ca: [readFileSync(process.env.CA)],
    }

    // server = http2.createSecureServer(httpsConfig, callback)
    server = https.createServer(httpsConfig, callback)
  } else {
    server = http.createServer(callback)
  }

  const listen = () =>
    new Promise<() => Promise<void>>(resolve => (
      server.listen(PORT, HOST, () => (
        resolve(() => (
          new Promise<void>((resolve, reject) => (
            server.close(err => err ? reject(err) : resolve())
          ))
        ))
      ))
    ))

  return [server, listen] as [typeof server, typeof listen]
}

const listen = async (httpServer: http.Server | https.Server) => {
  const gameServer = new WebRTCServer({
    server: httpServer,
  })

  if (process.env.NODE_ENV !== 'production') {
    const wsServer = (gameServer.transport as any).wss as ws.Server

    if (wsServer instanceof ws.Server) {
      throttleWSServer(wsServer)
    }
  }

  // register your room handlers
  gameServer.define('beegame', BeeGameServerRoom)

  /**
   * Register @colyseus/social routes
   *
   * - uncomment if you want to use default authentication (https://docs.colyseus.io/authentication/)
   * - also uncomment the import statement
   */
  // app.use('/', socialRoutes)

  // register colyseus monitor AFTER registering your room handlers
  // app.use('/colyseus', monitor())

  await gameServer.listen(PORT, HOST)

  console.log(`Listening on ${httpServer instanceof http.Server ? 'ws' : 'wss'}://${HOST}:${PORT}`)

  return gameServer
}

(async () => {
  try {
    await killPort(PORT, 'tcp')
  } catch { }

  const app = express()

  app.use(cors())
  app.use(express.json())

  const [httpServer] = createHttpServer(app)
  const gameServer = await listen(httpServer)

  process.once('SIGINT', () => gameServer.gracefullyShutdown())
  process.once('SIGTERM', () => gameServer.gracefullyShutdown())
  process.once('SIGUSR2', () => gameServer.gracefullyShutdown())
  process.once('uncaughtException', err => gameServer.gracefullyShutdown(undefined, err))
})()
