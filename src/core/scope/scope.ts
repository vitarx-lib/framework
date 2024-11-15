import { Effect, type EffectInterface, isEffect } from './effect.js'

/**
 * # 自动处置
 *
 * 当类实例化时会自动将实例对象添加到父级 {@link Scope} 作用域中进行管理，当父级作用域销毁时，会自动触发该实例的销毁方法，从而实现自动清理。
 */
export class AutoDisposed extends Effect {
  constructor() {
    super()
    // 添加到父级作用域中进行管理
    addEffect(this)
  }
}

/**
 * # 作用域管理器
 */
export class Scope extends Effect {
  /** 临时记录当前作用域 */
  static #currentScope?: Scope
  /** 副作用 */
  #effects?: Set<EffectInterface> = new Set()

  /**
   * 实例化一个作用域管理器
   *
   * @param main - 主函数
   * @param toParent - 是否添加到父级作用域中，如果有。
   */
  constructor(main: () => void, toParent: boolean = true) {
    super()
    const oldScope = Scope.#currentScope
    // 添加到父级作用域中
    if (toParent) oldScope?.add(this)
    Scope.#currentScope = this
    main()
    Scope.#currentScope = oldScope
  }

  /**
   * 获取监听器数量
   *
   * @readonly
   */
  get count() {
    return this.#effects?.size ?? 0
  }

  /**
   * 获取当前作用域
   *
   * @returns {Scope|undefined} 返回当前作用域实例，如果没有则返回undefined
   */
  static getCurrentScope(): Scope | undefined {
    return Scope.#currentScope
  }

  /**
   * 添加一个可处置的副作用到当前作用域中。
   *
   * 如果习惯类编程则可以继承自{@link Effect} 或 {@link AutoDisposed} 类；
   * 函数式编程则可以传入一个对象，对象必须具有`destroy`和`onDestroyed`属性方法。
   *
   * @param effect - 处置对象
   * @returns {boolean} - 是否添加成功
   */
  add(effect: EffectInterface): boolean {
    if (!this.isDeprecated) {
      isEffect(effect, true)
      this.#effects?.add(effect)
      effect.onDestroyed(() => this.#effects?.delete(effect))
      return true
    } else {
      console.trace('当前作用域已被销毁，不应该再往作用域中增加可处置的副作用对象')
      return false
    }
  }

  /**
   * 销毁作用域下所有监听器
   *
   * @override
   */
  override destroy() {
    if (!this.isDeprecated && this.#effects) {
      this.#effects.forEach(dispose => dispose.destroy())
      this.#effects = undefined
      super.destroy()
    }
  }

  /**
   * 暂停所有可处置的副作用
   *
   * @override
   */
  override pause() {
    if (!this.isPaused) {
      this.#effects?.forEach(dispose => dispose?.pause?.())
      super.pause()
    }
  }

  /**
   * 恢复所有可处置的副作用
   *
   * @override
   */
  override unpause() {
    if (this.isPaused) {
      this.#effects?.forEach(dispose => dispose?.unpause?.())
      super.unpause()
    }
  }
}

/**
 * ## 创建作用域
 *
 * @param main 入口函数
 * @param toParent - 是否添加到父级作用域中，默认为true
 * @returns {Scope} 返回作用域实例，提供了`destroy`方法来销毁作用域
 */
export function createScope(main: () => void, toParent: boolean = true): Scope {
  return new Scope(main, toParent)
}

/**
 * ## 获取当前作用域
 *
 * @returns {Scope|undefined} 返回当前作用域实例，如果没有则返回undefined
 */
export function getCurrentScope(): Scope | undefined {
  return Scope.getCurrentScope()
}

/**
 * ## 往作用域中添加一个可处置对象
 *
 * @returns {boolean} - 是否添加成功
 * @param effect
 */
export function addEffect(effect: EffectInterface): boolean {
  return !!getCurrentScope()?.add(effect)
}
