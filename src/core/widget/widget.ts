import { __WidgetPropsSelfNodeSymbol__ } from './constant.js'
import { LifeCycle } from './life-cycle.js'
import { WidgetRenderer } from '../renderer/index.js'
import type { FnWidgetConstructor } from './fn-widget.js'
import type { ContainerElement } from '../renderer/web-runtime-dom/index.js'
import type { VNode } from '../vnode/index.js'

/**
 * `Element`等同于`VNode`，兼容TSX类型检测。
 */
export type Element = Vitarx.Element
/**
 * 类组件构造器类型
 */
export type ClassWidgetConstructor<P extends Record<string, any> = any> = new (
  props: P
) => Widget<P>

// 获取组件子节点类型
export type WidgetChildren<P> = P extends { children: infer U }
  ? U
  : P extends { children?: infer U }
    ? U | undefined
    : undefined

/**
 * 组件基类
 */
export abstract class Widget<P extends Record<string, any> = {}> extends LifeCycle {
  /**
   * 内部私有属性，用于存放接收的`prop`
   *
   * @private
   */
  private readonly _props: P

  /**
   * ## 实例化
   *
   * @param props
   */
  constructor(props: P) {
    super()
    this._props = props
  }

  /**
   * 内部私有属性，用于存放渲染器实例。
   *
   * 如需自定义渲染器，可重写`renderer`属性获取器。
   *
   * @private
   */
  protected _renderer?: WidgetRenderer<this>

  /**
   * 该方法由`Vitarx`内部调用，用于渲染
   *
   * 请勿在外部调用，以及使用`WidgetRenderer`实例方法，避免内存泄露。
   *
   * @protected
   */
  get renderer(): WidgetRenderer<this> {
    if (!this._renderer) {
      this._renderer = new WidgetRenderer(this)
    }
    return this._renderer
  }

  /**
   * 获取小部件自身的虚拟节点
   *
   * 该获取器被内部依赖，请勿重写！
   *
   * @returns {VNode<ClassWidgetConstructor | FnWidgetConstructor>}
   * @protected
   */
  get vnode(): VNode<ClassWidgetConstructor | FnWidgetConstructor> {
    return this._props[__WidgetPropsSelfNodeSymbol__ as any]
  }

  /**
   * 外部传入的属性
   *
   * 建议保持单向数据流，不要尝试修改`props`中数据。
   */
  protected get props(): Readonly<P> {
    return this._props as Readonly<P>
  }

  /**
   * 获取外部传入的子节点
   *
   * `children` 不会自动渲染，你可以将它视为一个参数，你可以在`build`方法中使用该参数，来实现插槽的效果。
   */
  protected get children(): WidgetChildren<P> {
    return this.props.children as WidgetChildren<P>
  }

  /**
   * 获取小部件渲染的节点元素
   *
   * 如果小部件已经渲染，则返回小部件的`DOM`元素，否则返回`null`。
   *
   * > 注意：如果是片段元素，`DocumentFragment` 则需要使用this.el.__backup数组访问元素。
   *
   * @returns {ContainerElement | null}
   */
  get el(): ContainerElement | null {
    return this.renderer.el
  }

  /**
   * 强制更新视图
   *
   * 如果你修改了非响应式数据，则可以调用此方法，强制更新视图。
   *
   * @param {VNode} newChildVNode - 可选的新`child`虚拟节点，如果不提供，则使用`build`方法构建。
   * @protected
   */
  protected update(newChildVNode?: VNode) {
    this.renderer.update(newChildVNode)
  }

  /**
   * 构建`UI`元素。
   *
   * 该方法会被多次调用，所以在方法内不应该存在任何副作用。
   *
   * > **注意**：在类组件的build方法中不要返回 `() => Element`，而是应返回`Element`。
   *
   * 示例：
   * ```ts
   * // JSX语法
   * build() {
   *   return <div>Hello World</div>
   * }
   * // 使用`createVNode`或`createElement` API函数创建元素
   * build() {
   *  return createVNode('div',{},'Hello World')
   * }
   * ```
   * @note 该方法应由子类实现，且该方法是受保护的，仅供内部渲染逻辑使用。
   * @protected
   * @returns {Element} - 返回的是虚拟的VNode节点
   */
  protected abstract build(): Element
}

/**
 * 判断是否为类构造器
 *
 * @param val
 */
export function isClassWidgetConstructor(val: any): val is ClassWidgetConstructor {
  if (typeof val !== 'function') return false
  return val.prototype instanceof Widget
}
