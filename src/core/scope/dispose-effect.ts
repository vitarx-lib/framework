/**
 * 处置功能接口
 *
 * 实现 `DisposeInterface` 接口
 */
export interface DisposeInterface {
  /** 销毁 */
  destroy(): void

  /** 监听销毁 */
  onDestroyed(callback: AnyCallback): void

  /** 暂停：可选 */
  pause?(): void

  /** 取消暂停：可选 */
  unpause?(): void
}

/**
 * # 可处置的对象
 *
 * 用于销毁/弃用对象，并释放内存。
 */
export class DisposeEffect implements DisposeInterface {
  // 销毁回调
  #onDestroyedCallback?: VoidCallback[]
  #onPause?: VoidCallback[]
  #onUnPause?: VoidCallback[]
  // 弃用状态
  #isDeprecated = false
  // 暂停状态
  #pause = false

  /**
   * 是否已弃用/销毁
   *
   * @readonly
   */
  get isDeprecated() {
    return this.#isDeprecated
  }

  /**
   * 判断是否为暂停状态
   */
  get isPaused(): boolean {
    return this.#pause
  }

  /**
   * 销毁/弃用
   *
   * 调用此方法会将标记为弃用状态，并触发销毁回调，清理所有回调函数释放内存。
   */
  destroy(): void {
    if (!this.#isDeprecated) {
      this.#isDeprecated = true
      if (this.#onDestroyedCallback) {
        this.#onDestroyedCallback.forEach(callback => callback())
        this.#onDestroyedCallback = undefined
      }
      this.#onPause = undefined
      this.#onUnPause = undefined
    }
  }

  /**
   * 暂停
   */
  pause() {
    this.#pause = true
    this.#onPause?.forEach(callback => callback())
  }

  /**
   * 取消暂停
   */
  unpause() {
    this.#pause = false
    this.#onUnPause?.forEach(callback => callback())
  }

  /**
   * 监听销毁
   *
   * @param callback
   */
  onDestroyed(callback: VoidCallback): void {
    if (this.#isDeprecated) {
      callback()
    } else {
      if (this.#onDestroyedCallback) {
        this.#onDestroyedCallback.push(callback)
      } else {
        this.#onDestroyedCallback = [callback]
      }
    }
  }

  /**
   * 监听暂停
   *
   * @param callback
   */
  onPause(callback: VoidCallback): void {
    if (this.#isDeprecated) {
      if (this.#onPause) {
        this.#onPause.push(callback)
      } else {
        this.#onPause = [callback]
      }
    }
  }

  /**
   * 监听取消暂停
   *
   * @param callback
   */
  onUnPause(callback: VoidCallback): void {
    if (!this.#isDeprecated) {
      if (this.#onUnPause) {
        this.#onUnPause.push(callback)
      } else {
        this.#onUnPause = [callback]
      }
    }
  }
}