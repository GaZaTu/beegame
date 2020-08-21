import delay from './delay'

const retry = async <T>(fn: () => T | Promise<T>, retries = 60, delayMs = 1000) => {
  let previousError: unknown

  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (error) {
      previousError = error

      await delay(delayMs)
    }
  }

  throw previousError
}

export default retry
