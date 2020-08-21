import './fakedomapi'

import * as http from 'http'
import * as express from 'express'
import * as cors from 'cors'
import * as ws from 'ws'
import { Server } from 'colyseus'
// import { monitor } from '@colyseus/monitor'
// import socialRoutes from '@colyseus/social/express'
import { BeeGameServerRoom } from './server'
import * as killPort from 'kill-port'
import { config } from './dotenv'

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

const listen = async () => {
  const app = express()

  app.use(cors())
  app.use(express.json())

  const httpServer = http.createServer(app)
  const gameServer = new Server({
    server: httpServer,
  })

  const wsServer = (gameServer.transport as any).wss as ws.Server

  throttleWSServer(wsServer)

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

  console.log(`Listening on ws://${HOST}:${PORT}`)

  return gameServer
}

(async () => {
  try {
    await killPort(PORT, 'tcp')
  } catch {}

  const server = await listen()

  process.once('SIGINT', () => server.gracefullyShutdown())
  process.once('SIGTERM', () => server.gracefullyShutdown())
  process.once('SIGUSR2', () => server.gracefullyShutdown())
  process.once('uncaughtException', err => server.gracefullyShutdown(undefined, err))
})()
