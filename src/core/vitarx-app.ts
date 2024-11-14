import {
  type ClassWidget,
  createFnWidget,
  type FnWidget,
  isClassWidget,
  Widget
} from './view/index.js'
import { createScope } from './scope/index.js'

/**
 * # Vitarx App
 */
export class VitarxApp {
  static ssr: boolean = false
  /** 元素容器 */
  protected readonly container: Element
  /** 配置选项 */
  protected readonly options: Required<Vitarx.AppOptions> = {
    ssr: false
  }
  /**
   * 小部件实例
   */
  widget: Widget | null = null
  /**
   * 构建应用实例
   *
   * @param container
   * @param options
   */
  constructor(container: Element, options?: Vitarx.AppOptions) {
    if (!(container instanceof Element)) {
      throw new Error('[Vitarx]：根容器必须是Element实例。')
    }
    this.container = container
    this.options = Object.assign(this.options, options)
    VitarxApp.ssr = this.options.ssr
  }

  /**
   * 获取版本号
   *
   * @returns {string} - 版本号
   */
  static get version(): string {
    return '__VERSION__'
  }

  /**
   * 渲染小部件
   *
   * @param widget - 入口小部件
   * @param props - 小部件的props参数
   */
  render<P extends Record<string, any>>(widget: ClassWidget<P> | FnWidget<P>, props?: P): void {
    createScope(() => {
      if (isClassWidget(widget)) {
        this.widget = new widget(props || {})
      } else {
        this.widget = createFnWidget(widget as FnWidget<P>, props as any)
      }
      this.widget.renderer.mount(this.container)
    })
  }

  /**
   * 更新App
   */
  update(): void {
    if (!this.widget) {
      console.warn('[VitarxApp.update]：还未渲染小部件，或小部件已经卸载，不能执行更新操作。')
    } else {
      this.widget.renderer.update()
    }
  }

  /**
   * 卸载小部件
   */
  unmount(): void {
    if (!this.widget) {
      console.warn('[VitarxApp.unmount]：还未渲染小部件，或小部件已经卸载，不能执行卸载操作。')
    } else {
      this.widget.renderer.unmount()
      this.widget = null
    }
  }
}

/**
 * ## 创建一个应用实例
 *
 * @param container - 根容器元素，也可以是选择器`selector`，内部自动使用 `document.querySelector` 查找元素。
 * @param options - 应用配置
 * @returns {Vitarx} - 应用实例
 */
export function createApp(container: Element | string, options?: Vitarx.AppOptions): VitarxApp {
  if (typeof container === 'string') {
    container = document.querySelector(container)!
  }
  return new VitarxApp(container, options)
}
