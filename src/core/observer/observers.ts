import { Listener } from './listener.js'
import { ExtractProp, PropName } from '../responsive/index.js'
import { isArray, isFunction, microTaskDebouncedCallback } from '../../utils/index.js'

/** 所有改变事件监听标识类型 */
export type AllChangeSymbol = typeof Observers.ALL_CHANGE_SYMBOL

/**
 * 配置选项
 *
 * - limit: 限制回调函数调用次数，默认为0，不限制，当为1时，表示只调用一次，当为2时，表示调用两次，以此类推。
 * - batch: 是否采用批处理，默认为true，谨慎设置为false，假设监听的是一个数组，设置为false时，当执行array.slice等方法会触发多次回调。
 * - scope: 作用域，默认为true，自动添加到作用域中，如果设置为false，则不添加到作用域中。
 */
export interface Options {
  /**
   * 限制回调函数调用次数，默认为0，不限制，当为1时，表示只调用一次，当为2时，表示调用两次，以此类推。
   *
   * @default 0
   */
  limit?: number
  /**
   * 是否采用批处理，默认为true，需谨慎使用false，假设监听的是一个数组，
   * 设置为false时，当执行array.slice等方法会触发多次回调。
   *
   * @default true
   */
  batch?: boolean
  /**
   * 作用域
   *
   * 默认为true，自动添加到作用域中，如果设置为false，则不添加到作用域中。
   *
   * @default true
   */
  scope?: boolean
}

// 监听器集合
type Listeners = Set<Listener | AnyCallback>
/** 监听器映射MAP */
type PropListenerMap = Map<PropName | AllChangeSymbol, Listeners>
// 队列
type Queue = Map<AnyObject, Set<PropName | AllChangeSymbol>>
/** 默认配置 */
const DEFAULT_OPTIONS: Required<Options> = {
  batch: true,
  limit: 0,
  scope: true
}
/**
 * 全局观察者管理器
 */
export class Observers {
  /**
   * 全部变更事件监听标识
   */
  static ALL_CHANGE_SYMBOL = Symbol('ALL_CHANGE_SYMBOL')
  /**
   * 对象使用该标记做为属性返回一个真实源对象做为监听对象。
   */
  static OBSERVERS_TARGET_SYMBOL = Symbol('OBSERVERS_TARGET_SYMBOL')
  // 监听源锁
  static #weakMapLock = new WeakSet<object>()
  // 批量处理的监听器
  static #listeners: WeakMap<object, PropListenerMap> = new WeakMap()
  // 不批量处理的监听器
  static #notBatchHandleListeners: WeakMap<object, PropListenerMap> = new WeakMap()
  // 微任务队列
  static #triggerQueue: Queue = new Map()
  // 是否正在处理队列
  static #isHanding = false

  /**
   * ## 触发监听器的回调函数
   *
   * @param {AnyObject} origin - 要触发的源对象，一般是 `ref` | `reactive` 创建的对象
   * @param {PropName|PropName[]} prop - 变更的属性名
   */
  static trigger<T extends AnyObject, P extends ExtractProp<T>>(origin: T, prop: P | P[]): void {
    // 如果不在微任务中，则开始处理队列
    if (!this.#isHanding) {
      this.#triggerQueue = new Map()
      this.#isHanding = true
      // 处理队列
      Promise.resolve().then(this.#handleTriggerQueue.bind(this))
    }
    origin = this.getObserveTarget(origin)
    const props = isArray(prop) ? prop : [prop]
    const notBatchListeners = this.#notBatchHandleListeners.get(origin)
    const batchListeners = this.#listeners.get(origin)
    if (batchListeners || notBatchListeners) {
      for (const prop of props) {
        // 触发非批量处理的监听器
        this.#triggerListeners(notBatchListeners?.get(prop), origin, [prop])
        // 推送到队列
        if (this.#triggerQueue.has(origin)) {
          this.#triggerQueue.get(origin)!.add(prop)
        } else {
          this.#triggerQueue.set(origin, new Set([prop]))
        }
      }
      // 触发默认监听器
      this.#triggerListeners(notBatchListeners?.get(this.ALL_CHANGE_SYMBOL), origin, props)
    }
  }

  /**
   * ## 注册监听器
   *
   * 一般你无需使用此方法，通常使用助手函数`watch`。
   *
   * @param {AnyObject} origin - 监听源，一般是`ref`|`reactive`创建的对象
   * @param {Function|Listener} callback - 回调函数或监听器实例
   * @param {PropName} prop - 属性名，默认为{@linkcode Observers.ALL_CHANGE_SYMBOL}标记，监听全部变化
   * @param {Options} options - 监听器选项
   * @returns {Listener} - 监听器实例
   */
  static register<T extends AnyObject, C extends AnyCallback>(
    origin: T,
    callback: C | Listener<C>,
    prop: PropName = this.ALL_CHANGE_SYMBOL,
    options?: Options
  ): Listener<C> {
    const { listener, list } = this.#createListener(callback, options)
    this.#addListener(list, origin, prop, listener)
    return listener
  }

  /**
   * ## 注册一个监听器，同时监听多个属性
   *
   * @param {AnyObject} origin - 监听源，一般是`ref`|`reactive`创建的对象
   * @param {PropName[]} props - 属性名数组
   * @param {Function|Listener} callback - 回调函数或监听器实例
   * @param {Options} options - 监听器选项
   * @returns {Listener} - 监听器实例
   */
  static registerProps<C extends AnyCallback>(
    origin: AnyObject,
    props: PropName[] | Set<PropName>,
    callback: C | Listener<C>,
    options?: Options
  ): Listener<C> {
    if (!origin || typeof origin !== 'object') {
      throw new TypeError('origin must be a object')
    }
    if (Array.isArray(props)) props = new Set(props)
    if (props.size === 0) throw new TypeError('props must be a non-empty array or set')
    // 创建监听器
    const { listener, list } = this.#createListener(callback, options)
    if (options?.batch === false || props.size === 1) {
      for (const prop of props) {
        this.#addListener(list, origin, prop, listener)
      }
    } else {
      // 监听的属性名集合
      const onProps = Array.isArray(props) ? new Set(props) : props
      // 添加一个回调函数
      const remove = this.addNotBatchCallback(
        origin,
        microTaskDebouncedCallback(
          (keys: PropName[]) => {
            const changes: PropName[] = []
            // 过滤掉不在监听的属性名
            for (const key of new Set(keys)) {
              if (onProps.has(key)) changes.push(key)
            }
            // 如果有变化，则触发监听器
            if (changes.length) listener.trigger([changes, origin] as Parameters<C>)
          },
          (last, prev) => {
            if (!prev) return last
            prev[0].push(...last[0])
            return prev
          }
        )
      )
      // 监听器销毁时删除监听器
      listener.onDestroyed(remove)
    }
    return listener
  }

  /**
   * 注册不批量处理的回调函数
   *
   * 注册一个不进行批处理的回调函数用于处理数据变化。
   *
   * @param {AnyObject} origin - 监听源，一般是`ref`|`reactive`创建的对象
   * @param {AnyFunction} callback - 回调函数
   * @param prop - 属性名，默认为{@linkcode Observers.ALL_CHANGE_SYMBOL}标记，监听全部变化
   * @returns {Function} - 调用此函数可以删除回调函数
   */
  static addNotBatchCallback<C extends AnyCallback>(
    origin: AnyObject,
    callback: C,
    prop: PropName = this.ALL_CHANGE_SYMBOL
  ): () => void {
    this.#addListener(this.#notBatchHandleListeners, origin, prop, callback)
    return () => this.#removeListener(this.#notBatchHandleListeners, origin, prop, callback)
  }
  /**
   * ## 同时注册给多个对象注册同一个监听器
   *
   * @param {AnyObject[]|Set<AnyObject>} origins - 监听源列表
   * @param {Function|Listener} callback - 回调函数或监听器实例
   * @param {Options} options - 监听器选项
   * @returns {Listener} - 监听器实例
   */
  static registers<T extends AnyObject, C extends AnyCallback>(
    origins: Set<T> | T[],
    callback: C | Listener<C>,
    options?: Options
  ): Listener<C> {
    if (Array.isArray(origins)) {
      origins = new Set(origins)
    }
    if (!(origins instanceof Set) || origins.size === 0) {
      throw new TypeError('origins must be a non-empty array or set')
    }
    const { listener, list } = this.#createListener(callback, options)
    // 监听器列表
    for (const origin of origins) {
      this.#addListener(list, origin, this.ALL_CHANGE_SYMBOL, listener)
    }
    // 如果监听器销毁了，则删除监听器
    listener.onDestroyed(() => {
      for (const origin of origins) {
        this.#removeListener(list, origin, this.ALL_CHANGE_SYMBOL, listener)
      }
    })
    return listener
  }

  /** 创建监听器，并返回监听器列表 */
  static #createListener<C extends AnyCallback>(callback: C | Listener<C>, options?: Options) {
    // 合并默认选项
    options = Object.assign({}, DEFAULT_OPTIONS, options)
    // 创建监听器
    const listener = isFunction(callback) ? new Listener(callback, options) : callback
    // 监听器列表
    const list = options.batch ? this.#listeners : this.#notBatchHandleListeners
    return { listener, list }
  }

  /**
   * 获取观察的目标
   *
   * @param obj
   */
  static getObserveTarget<T extends AnyObject>(obj: T): T {
    return (Reflect.get(obj, this.OBSERVERS_TARGET_SYMBOL) as T) ?? obj
  }

  /**
   * ## 添加监听器
   *
   * @param list - 监听器列表
   * @param proxy - 代理对象
   * @param prop - 属性名
   * @param listener - 监听器实例或回调函数，如果是监听器则会在销毁时自动删除
   */
  static #addListener<T extends AnyObject, C extends AnyCallback>(
    list: WeakMap<T, PropListenerMap>,
    proxy: T,
    prop: PropName,
    listener: Listener<C> | C
  ): void {
    proxy = this.getObserveTarget(proxy)
    const unLock = this.#lockWeakMap(proxy)
    if (!list.has(proxy)) {
      list.set(proxy, new Map())
    }
    const propMap = list.get(proxy)!
    if (!propMap.has(prop)) {
      propMap.set(prop, new Set())
    }
    propMap.get(prop)!.add(listener)
    if (listener instanceof Listener) {
      listener.onDestroyed(() => this.#removeListener(list, proxy, prop, listener))
    }
    unLock()
  }

  /**
   * ## 处理触发队列
   *
   * @private
   */
  static #handleTriggerQueue() {
    // 恢复状态
    this.#isHanding = false
    const queue: Queue = this.#triggerQueue
    for (const [origin, props] of queue) {
      this.#triggerProps(origin, props)
    }
  }

  /**
   * 触发多个属性的监听器
   *
   * @param origin
   * @param props
   * @private
   */
  static #triggerProps(origin: AnyObject, props: Set<PropName>) {
    for (const prop of props) {
      this.#triggerListeners(this.#listeners.get(origin)?.get(prop), origin, [prop])
    }
    // 兼容prop传入ALL_CHANGE_SYMBOL
    if (!props.has(this.ALL_CHANGE_SYMBOL)) {
      // 如果不存在ALL_CHANGE_SYMBOL的监听器，则触发它
      this.#triggerListeners(
        this.#listeners.get(origin)?.get(this.ALL_CHANGE_SYMBOL),
        origin,
        Array.from(props)
      )
    }
  }

  /**
   * ## 触发监听器
   *
   * @private
   * @param listeners
   * @param origin
   * @param p
   */
  static #triggerListeners<T extends AnyObject>(
    listeners: Listeners | undefined,
    origin: T,
    p: ExtractProp<T>[]
  ): void {
    if (listeners?.size) {
      for (const listener of listeners) {
        if (typeof listener === 'function') {
          listener(p, origin)
        } else {
          listener.trigger([p, origin])
        }
      }
    }
  }

  /**
   * ## 将指定监听源映射锁定
   *
   * @param origin
   * @private
   */
  static #lockWeakMap(origin: AnyObject) {
    while (this.#weakMapLock.has(origin)) {}
    this.#weakMapLock.add(origin)
    return () => {
      this.#weakMapLock.delete(origin)
    }
  }

  /**
   * ## 删除监听器
   *
   * @param list - 监听器列表
   * @param proxy - 代理对象
   * @param prop - 属性名
   * @param listener - 监听器实例
   */
  static #removeListener<T extends AnyObject, C extends AnyCallback>(
    list: WeakMap<T, PropListenerMap>,
    proxy: T,
    prop: PropName,
    listener: Listener<C> | C
  ): void {
    proxy = this.getObserveTarget(proxy)
    const unLock = this.#lockWeakMap(proxy)
    const set = list.get(proxy)?.get(prop)
    if (set) {
      set.delete(listener)
      if (set.size === 0) list.get(proxy)?.delete(prop)
      if (list.get(proxy)?.size === 0) list.delete(proxy)
    }
    unLock()
  }
}
