import {
  Depend,
  type ExtractProp,
  isProxy,
  isValueProxy,
  type PropName,
  type UnProxy
} from '../responsive/index.js'
import { Listener } from './listener.js'
import { Observers, type Options } from './observers.js'
import { deepClone, isArray, isSimpleGetterFunction, popProperty } from '../../utils/index.js'

// 提取监听源
type ExtractOrigin<T> = T extends AnyFunction ? ReturnType<T> : T
// 提取属性名称 联合类型
type ExtractPropName<T, O = ExtractOrigin<T>> = O extends object ? ExtractProp<O> : never
/** 监听变化的回调，不需要在意旧值，只关心变化的属性 */
type WatchChangeCallback<T> = (prop: ExtractPropName<T>[], origin: ExtractOrigin<T>) => void
/** 监听新值和旧值的回调-如果值为对象会深度克隆 */
type WatchValueCallback<T> = (
  newValue: UnProxy<ExtractOrigin<T>>,
  oldValue: UnProxy<ExtractOrigin<T>>
) => void
// 回调函数类型
type WatchCallback<T> = T extends AnyFunction
  ? ReturnType<T> extends AnyPrimitive
    ? WatchValueCallback<T> // 则利用依赖收集监听属性
    : WatchChangeCallback<T> // 如果不是代理对象且不是包含代理对象的数组则不进行监听
  : WatchChangeCallback<T>
/**
 * ## 回调函数类型
 *
 * 如果监听的是对象，则prop为变化的属性名数组，如果监听的是对象属性，则prop为变化的属性名称（单个属性名）
 *
 * @template P - 监听的属性名类型
 * @template T - 监听源类型
 * @param {any} prop - 属性名
 */
type Callback<P extends PropName | PropName[], T extends AnyObject> = (prop: P, origin: T) => void
/**
 * 监听依赖结果
 */
type WatchDependResult<R, GET> = GET extends boolean
  ? {
      listener: Listener<VoidCallback> | undefined
      result: R
    }
  : Listener<VoidCallback> | undefined

/**
 * 检测是否为代理对象
 *
 * @param obj
 */
function verifyProxy(obj: any) {
  if (!isProxy(obj)) {
    throw TypeError(
      'origin参数必须是实现了ProxySymbol接口的对象，由ref或reactive方法创建的对象都实现了ProxySymbol接口'
    )
  }
}

/**
 * 创建值监听器
 *
 * @param origin
 * @param prop
 * @param callback
 * @param options
 * @private
 */
function createValueListener<T extends AnyObject>(
  origin: T,
  prop: ExtractProp<T> | undefined,
  callback: WatchValueCallback<T>,
  options?: Options
): Listener<() => void> {
  let oldValue = deepClone(prop !== undefined ? origin[prop] : origin)
  return Listener.create(() => {
    const newValue = deepClone(prop !== undefined ? origin[prop] : origin)
    callback(newValue as any, oldValue as any)
    oldValue = newValue
  }, options?.limit ?? 0)
}

/**
 * ## 监听对象的所有属性变化
 *
 * 简单示例：
 *
 * ```ts
 * import { watch,reactive,ref } from 'vitarx'
 * const reactiveObj = reactive({a:1,b:2,c:{a:1}})
 * const refObj = ref({a:1})
 *
 * // ## 监听对象所有属性变化，下面的写法等效于 watch(()=>reactiveObj,...)
 * watch(reactiveObj,(props:Array<keyof obj>,origin:Reactive<typeof obj>)=>{
 *  // origin 参数为obj本身
 *  // props 为变化的属性名数组，当options.batch为false时，props一次只会存在一个属性，为true时会存在多个属性名
 *  console.log(`捕获到obj属性变化：${props.join(',')}`)
 * })
 *
 * // ## 监听嵌套对象的变化
 * watch(reactiveObj.c,...) // 等效于 watch(()=>reactiveObj.c,...)
 *
 * // ## 监听普通值属性，下面的写法等效于 watchPropValue(reactiveObj,'a',...)
 * watch(()=>reactiveObj.a,(newValue,oldValue)=>{
 *    // 第一个参数为新值，第二个参数为旧值
 * })
 *
 * // ## 同时监听多个对象 等效于 watch(()=>[reactiveObj,refObj])
 * watch([reactiveObj,refObj],function(index:`${number}`[],origin){
 *    // 注意： index参数值是变化的对象所在下标，例如：['0','1'] 则代表reactiveObj和refObj都发生了改变
 *    // origin 是[reactiveObj,refObj]
 * })
 * ```
 * **origin**合法类型如下：
 * - `object` ：任意实现了ProxySymbol的对象，一般是ref或reactive创建的响应式代理对象。也可以是一个实现了{@link ProxySymbol}接口中的标记属性的任意对象。
 * - `array` : 非Proxy数组，可以在数组中包含多个响应式代理对象达到同时监听多个对象变化的效果，但不能包含非响应式代理对象。
 * - `function`：如果返回的是一个基本类型值，例如：number|string|boolean|null...非对象类型的值，那函数的写法必须是`()=>obj.key`，会通过依赖收集监听对象的某个属性值变化，回调函数接收的参数也变为了新值和旧值，除了返回基本类型值，其他合法返回值同上述的`array`,`object`
 *
 * @template T - 监听源类型
 * @param {T} origin - 监听源，一般是`ref`|`reactive`创建的对象
 * @param {WatchCallback<T>} callback - 回调函数
 * @param {Options} options - 监听器配置选项
 */
export function watch<T extends AnyObject, C extends WatchCallback<T>>(
  origin: T,
  callback: C,
  options?: Options
): Listener<C> {
  if (isProxy(origin)) {
    return Observers.register(origin, callback, Observers.ALL_CHANGE_SYMBOL, options)
  }
  if (isSimpleGetterFunction(origin)) {
    const result = origin()
    // 处理监听普通类型
    if (result === null || typeof result !== 'object') {
      const { deps } = Depend.collect(origin)
      // 如果只有一个依赖，则进行监听
      if (deps.size === 1 && deps.values().next().value!.size === 1) {
        const obj = deps.keys().next().value!
        const prop = deps.values().next().value!.values().next().value!
        return watchPropValue(obj, prop, callback as AnyCallback, options) as unknown as Listener<C>
      }
      throw new TypeError(
        '当origin参数为()=>any类型时，返回的非对象类型值，必须是某个响应式(实现了ProxySymbol接口)对象的属性值才能进行监听。'
      )
    } else {
      origin = result
    }
  }
  if (isArray(origin)) {
    if (origin.length === 0) {
      throw new TypeError(
        'watch.origin参数不能是空数组(包括使用getter函数返回空数组)。正确示例(obj为实现了ProxySymbol接口的对象)：[obj,...]'
      )
    }
    const deps = origin.filter(isProxy)
    if (deps.length === origin.length) {
      let mainListener: Listener
      let subCallback: AnyCallback
      if (options?.batch === undefined || options?.batch) {
        // 如果需要批处理 则使用deps数组做为源注册一个监听器
        mainListener = Observers.register(deps, callback, Observers.ALL_CHANGE_SYMBOL, options)
        subCallback = (_p, o) => Observers.trigger(deps, [`${origin.indexOf(o)}`])
      } else {
        // 不进行批处理直接实例一个监听器，减少开销
        mainListener = Listener.create(callback, options?.limit ?? 0)
        subCallback = (_p, o) => mainListener.trigger([[`${origin.indexOf(o)}`], deps])
      }
      // 辅助监听器
      const subListener = new Listener(subCallback, options?.limit)
      // 监听多个源的变化，把变化反应到listener
      Observers.registers(deps, subListener, options)
      // 主监听器被销毁时，同时销毁辅助监听器
      mainListener.onDestroyed(function () {
        subListener.destroy()
      })
      return mainListener as unknown as Listener<C>
    }
  }
  throw new TypeError(
    'watch.origin参数无效，正确值示例(obj为实现了ProxySymbol接口的对象)：()=>obj.key | ()=>obj | ()=>[obj,...] | obj | [obj,...]'
  )
}

/**
 * ## 监听对象改变
 *
 * 非必要不要使用，因为它会深度克隆对象，来维持新旧值的差异。
 *
 * @note 不同于{@link watch}方法，该方法会回调对象改变之后和改变之前的值做为参数，且深度克隆。
 *
 * @template T - 监听源类型
 * @param {T} origin - 监听源，一般是`ref`|`reactive`创建的对象
 * @param {WatchValueCallback<T>} callback - 回调函数，第一个参数为`newValue`，第二个参数为`oldValue`
 * @param {Options} options - 监听器配置选项
 * @see watch
 */
export function watchValue<T extends AnyObject>(
  origin: T,
  callback: WatchValueCallback<T>,
  options?: Options
): Listener<() => void> {
  if (isSimpleGetterFunction(origin)) {
    const result = origin()
    // 处理监听普通类型
    if (result === null || typeof result !== 'object') {
      const { deps } = Depend.collect(origin)
      // 如果只有一个依赖，则进行监听
      if (deps.size === 1 && deps.values().next().value!.size === 1) {
        const obj = deps.keys().next().value!
        const prop = deps.values().next().value!.values().next().value!
        return watchPropValue(obj, prop, callback as AnyCallback, options)
      }
      throw new TypeError(
        '当watch.origin参数为()=>any类型时，返回的非对象类型值，必须是某个响应式(实现了ProxySymbol接口)对象的属性值才能进行监听。'
      )
    } else {
      origin = result
    }
  }
  if (isProxy(origin)) {
    // 处理值类型代理，让其返回value
    const prop = isValueProxy(origin) ? 'value' : undefined
    return Observers.register(
      origin,
      createValueListener(origin, prop as any, callback, options),
      Observers.ALL_CHANGE_SYMBOL,
      options
    )
  }
  throw new TypeError(
    'watch.origin参数无效，可选值示例(obj为实现了ProxySymbol接口的对象)：()=>obj.key | ()=>obj | obj'
  )
}

/**
 * ## 监听多个属性变化
 *
 * 该方法和watchProp不同的是，可以监听多个属性的变化，当监听多个属性时，回调函数的参数为变化的属性名数组。
 *
 * @template T - 监听源类型
 * @template P - 属性名类型
 * @param {T} origin - 监听源，一般是`ref`|`reactive`创建的对象
 * @param {ExtractProp<T>[]} props - 要监听的属性名数组
 * @param {Callback<P, T>} callback - 回调函数
 * @param {Options} options - 监听器配置选项
 */
export function watchProps<
  T extends AnyObject,
  P extends ExtractProp<T>[],
  C extends AnyCallback = Callback<P, T>
>(origin: T, props: P, callback: C, options?: Options): Listener<C> {
  // 检测源是否为Proxy
  verifyProxy(origin)
  if (props.length === 0) throw TypeError('props参数不能为空数组')
  // 判断是否需要批处理
  let mainListener: Listener
  let subCallback: AnyCallback
  if (options?.batch === undefined || options?.batch) {
    // 批处理
    mainListener = Observers.register(
      props,
      prop => callback(prop, origin),
      Observers.ALL_CHANGE_SYMBOL,
      options
    )
    subCallback = p => Observers.trigger(props, p)
  } else {
    // 非批处理
    mainListener = Listener.create(callback, options?.limit ?? 0)
    subCallback = p => mainListener.trigger([p, origin])
  }
  // 辅助监听器，同时监听多个属性变化，并将变化反应到主监听器上
  const subListener = new Listener(subCallback)
  // 监听多个属性变化
  Observers.registerProps(origin, props, subListener, options)
  // 主监听器被销毁时，同时销毁辅助监听器
  mainListener.onDestroyed(() => subListener.destroy())
  return mainListener as unknown as Listener<C>
}

/**
 * ## 监听单个属性变化
 *
 * @template T - 监听源类型
 * @template P - 属性名类型
 * @param {T} origin - 监听源，一般是`ref`|`reactive`创建的对象
 * @param {ExtractProp<T>} prop - 要监听的属性名
 * @param {Callback<P, T>} callback - 回调函数
 * @param {Options} options - 监听器配置选项
 */
export function watchProp<
  T extends AnyObject,
  P extends ExtractProp<T>,
  C extends AnyCallback = Callback<P, T>
>(origin: T, prop: P, callback: C | Listener<C>, options?: Options): Listener<C> {
  verifyProxy(origin)
  return Observers.register(origin, callback, prop, options)
}

/**
 * ## 监听单个属性变化
 *
 * 不同于`watchProp`方法，`watchPropValue`方法的回调参数为新值和旧值，而`watchProp`回调参数为属性名称，和源对象。
 *
 * @template T - 监听源类型
 * @template P - 属性名类型
 * @param {T} origin - 监听源，一般是`ref`|`reactive`创建的对象
 * @param {ExtractProp<T>} prop - 要监听的属性名
 * @param {WatchValueCallback<T[P]>} callback - 回调函数，第一个参数为`newValue`，第二个参数为`oldValue`
 * @param {Options} options - 监听器配置选项
 */
export function watchPropValue<T extends AnyObject, P extends ExtractProp<T>>(
  origin: T,
  prop: P,
  callback: WatchValueCallback<T[P]>,
  options?: Options
): Listener<() => void> {
  verifyProxy(origin)
  return Observers.register(
    origin,
    createValueListener(origin, prop, callback, options),
    prop,
    options
  )
}
/**
 * ## 监听函数的依赖变化
 *
 *
 * @note 该方法会监听函数的依赖，当依赖发生变化时，会触发回调函数，没有传入回调函数则触发传入的fn函数本身。
 *
 * @alias watchEffect
 * @template R - 返回值类型
 * @template GET - 是否收集依赖的返回值
 * @param {() => R} fn - 要监听的函数
 * @param {() => void} callback - 回调函数
 * @param {Options} options - 监听器配置选项
 * @returns {WatchDependResult<R, GET>} - 如果收集到依赖则返回监听器，否则返回undefined
 */
export function watchDepend<GET, R>(
  fn: () => R,
  callback?: () => void,
  options?: Options & { getResult?: GET }
): WatchDependResult<R, GET> {
  const getResult = options ? popProperty(options, 'getResult') : false
  const { deps, result } = Depend.collect(fn)
  let mainListener: Listener<VoidCallback> | undefined = undefined
  if (deps.size > 0) {
    let subCallback: AnyCallback
    if (options?.batch === undefined || options?.batch) {
      mainListener = Observers.register(
        deps,
        callback ? () => callback() : () => fn(),
        Observers.ALL_CHANGE_SYMBOL,
        options
      )
      const change = Symbol('depend change')
      subCallback = () => Observers.trigger(deps, change as any)
    } else {
      mainListener = Listener.create(callback || fn, options?.limit ?? 0)
      subCallback = () => mainListener!.trigger([])
    }
    // 辅助监听器，同时监听多个属性变化，并将变化反应到主监听器上
    const subListener = new Listener(subCallback, options?.limit)
    // 主监听器被销毁时，同时销毁辅助监听器
    mainListener.onDestroyed(() => subListener.destroy())
    deps.forEach((props, proxy) => {
      Observers.registerProps(proxy, props, subListener)
    })
  }
  return (getResult ? { listener: mainListener, result } : mainListener) as WatchDependResult<
    R,
    GET
  >
}

export { watchDepend as watchEffect }

/**
 * 在下一次微任务开始之前执行回调函数
 *
 * @param {function} cb - 回调函数
 * @returns {void}
 */
export function nextTick(cb: () => void): void
/**
 * 等待微任务队列执行完毕
 *
 * @returns {Promise<void>} - 返回Promise对象，可以使用await来等待任务完成
 */
export function nextTick(): Promise<void>
/**
 * 在微任务队列中执行回调，或返回一个Promise
 *
 * @param {function} [cb] - 可选回调函数
 * @returns {Promise<void>|void} - 如果传入回调，返回void；否则返回Promise对象
 */
export function nextTick(cb?: () => void): Promise<void> | void {
  if (cb) {
    Promise.resolve().then(cb)
  } else {
    return Promise.resolve()
  }
}
