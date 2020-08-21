import { config as x, parse } from 'dotenv'
import { readFileSync } from 'fs'

const tryGet = <T, D>(fn: () => T, def: (err: unknown) => D) => {
  try {
    return fn()
  } catch (err) {
    return def(err)
  }
}

export const config: typeof x = (options) => {
  const NODE_ENV = process.env.NODE_ENV || 'development'
  const paths = [
    `${__dirname}/../.env`,
    `${__dirname}/../.env.local`,
    `${__dirname}/../.env.${NODE_ENV}`,
    `${__dirname}/../.env.${NODE_ENV}.local`,
  ]

  const { debug, encoding } = {
    debug: false,
    encoding: 'utf-8' as any,
    ...options,
  }

  const parsed = {}

  for (const path of paths) {
    try {
      const buffer = tryGet(() => readFileSync(path, { encoding }), () => undefined)

      if (buffer) {
        Object.assign(parsed, parse(buffer, { debug }))
      }
    } catch (error) {
      return { error }
    }
  }

  Object.assign(process.env, parsed)

  return { parsed }
}
