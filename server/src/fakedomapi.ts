import { EventEmitter } from 'events'
import * as gl from 'gl'

const createLoggingProxy = <T>(o: T) =>
  new Proxy(o as any, {
    // get: (target, p, receiver) => {
    //   console.log('get', `${target.constructor.name}.${String(p)}`)

    //   const v = target[p]

    //   if (typeof v === 'function') {
    //     const func = (...args: unknown[]) => {
    //       console.log('call', `${target.constructor.name}.${String(p)}(${args.join(', ')})`)

    //       return v.apply(target, args)
    //     }

    //     func.toString = () => v.toString()

    //     return func
    //   }

    //   return v
    // },
    // set: (target, p, v, receiver) => {
    //   console.log('set', `${target.constructor.name}.${String(p)}`)

    //   target[p] = v

    //   return true
    // },
    has: (target, p) => {
      return true
    },
  })

class FakeWindow {
  readonly URL: (typeof globalThis)['URL'] = FakeURL as any

  readonly eventEmitter = new EventEmitter()

  constructor() {
    return createLoggingProxy(this)
  }

  addEventListener: Window['addEventListener'] = (type: string, listener: (...args: any[]) => void) => {
    this.eventEmitter.addListener(type, listener)
  }

  removeEventListener: Window['removeEventListener'] = (type: string, listener: (...args: any[]) => void) => {
    this.eventEmitter.removeListener(type, listener)
  }

  requestAnimationFrame: Window['requestAnimationFrame'] = (callback) => {
    return setTimeout(callback, 1e3 / 60)
  }

  cancelAnimationFrame: Window['cancelAnimationFrame'] = (handle) => {
    clearTimeout(handle)
  }

  get top() {
    return this as any as Window['top']
  }
}

class FakeDocument {
  readonly body: Document['body'] = new FakeHTMLElement() as any

  readonly eventEmitter = new EventEmitter()

  constructor() {
    return createLoggingProxy(this)
  }

  createElement: Document['createElement'] = (tagName: string) => {
    switch (tagName) {
      case 'canvas':
        return new FakeHTMLCanvasElement()
      case 'a':
        return new FakeHTMLAnchorElement()
      case 'div':
        return new FakeHTMLDivElement()
    }

    return undefined as any
  }

  addEventListener: Document['addEventListener'] = (type: string, listener: (...args: any[]) => void) => {
    this.eventEmitter.addListener(type, listener)
  }
}

class FakeHTMLElement {
  readonly style: HTMLElement['style'] = new FakeCSSStyleDeclaration() as any

  readonly eventEmitter = new EventEmitter()

  constructor() {
    return createLoggingProxy(this)
  }

  addEventListener: HTMLElement['addEventListener'] = (type: string, listener: (...args: any[]) => void) => {
    this.eventEmitter.addListener(type, listener)
  }

  appendChild: HTMLElement['appendChild'] = (child) => {
    return child
  }
}

class FakeHTMLCanvasElement extends FakeHTMLElement {
  constructor() {
    super()

    return createLoggingProxy(this)
  }

  getContext: HTMLCanvasElement['getContext'] = (contextId: string, options?: any) => {
    switch (contextId) {
      case '2d':
        return new FakeCanvasRenderingContext2D(this as any)
      case 'webgl':
        return gl(0, 0, options)
    }

    return undefined as any
  }

  toDataURL: HTMLCanvasElement['toDataURL'] = (type) => {
    switch (type) {
      case 'image/png':
        return `data:image/png:undefined`
    }

    return undefined as any
  }
}

class FakeXMLHttpRequest {
  responseType: XMLHttpRequest['responseType'] = 'arraybuffer'

  constructor() {
    return createLoggingProxy(this)
  }

  open: XMLHttpRequest['open'] = (method: string, url: string) => {

  }
}

class FakeHTMLAnchorElement extends FakeHTMLElement {
  constructor() {
    super()

    return createLoggingProxy(this)
  }
}

class FakeCSSStyleDeclaration {
  constructor() {
    return createLoggingProxy(this)
  }

  get cssText() {
    return undefined! as string
  }

  set cssText(value) {
    value.trim().split(';')
      .map(rule => rule.trim().split(':'))
      .map(([key, value]) => [key.trim(), value.trim()] as const)
      .map(([key, value]) => [key.replace(/-([a-z])/g, g => g[1].toUpperCase()), value] as const)
      .forEach(([key, value]) => {
        (this as any)[key] = value
      })
  }
}

class FakeNavigator {
  constructor() {
    return createLoggingProxy(this)
  }
}

class FakeCanvasRenderingContext2D {
  constructor(
    public readonly canvas: CanvasRenderingContext2D['canvas'],
  ) {
    return createLoggingProxy(this)
  }

  clearRect: CanvasRenderingContext2D['clearRect'] = () => {}

  fillRect: CanvasRenderingContext2D['fillRect'] = () => {}

  save: CanvasRenderingContext2D['save'] = () => {}

  scale: CanvasRenderingContext2D['scale'] = () => {}

  translate: CanvasRenderingContext2D['translate'] = () => {}

  restore: CanvasRenderingContext2D['restore'] = () => {}
}

class FakeURL extends URL {
  static createObjectURL(object: any) {
    return ''
  }

  static revokeObjectURL(url: string) {

  }
}

class FakeHTMLDivElement extends FakeHTMLElement {
  constructor() {
    super()

    return createLoggingProxy(this)
  }
}

globalThis.window = Object.assign(new FakeWindow() as any, globalThis)
globalThis.document = new FakeDocument() as any
globalThis.XMLHttpRequest = FakeXMLHttpRequest as any
globalThis.navigator = new FakeNavigator() as any
globalThis.URL = FakeURL as any
