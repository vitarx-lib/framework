import { __updateParentVNode, isVNode, type VElement, type VNode } from '../vnode/index.js'
import {
  getVElementParentEl,
  type HtmlElement,
  patchUpdate,
  removeElement,
  renderElement,
  unmountVNode,
  updateActivateState,
  VElementToHTMLElement
} from './web-runtime-dom/index.js'
import {
  type ClassWidgetConstructor,
  type FnWidgetConstructor,
  isClassWidgetConstructor,
  LifeCycleHooks,
  Widget
} from '../widget/index.js'
import { getCurrentScope, Scope } from '../scope/index.js'
import { watchDepend } from '../observer/index.js'
import { __LifeCycleTrigger__, __WidgetPropsSelfNodeSymbol__ } from '../widget/constant.js'

/**
 * 渲染状态
 *
 * - notMounted：未挂载
 * - mounted：已挂载
 * - uninstalling：卸载中
 * - unloaded：已卸载
 */
export type RenderState = 'notMounted' | 'activated' | 'deactivate' | 'uninstalling' | 'unloaded'

/**
 * 小部件渲染器
 *
 * 用于渲染小部件，和管理小部件的生命周期。
 */
export class WidgetRenderer {
  // 当前组件的Child虚拟节点
  protected _currentChildVNode: VNode
  // 等到更新
  protected _pendingUpdate = false
  // 当前作用域
  protected _currentScope: Scope
  // 上一次挂载的父元素
  protected _lastParent: ParentNode | null = null
  /**
   * 渲染器状态
   *
   * @protected
   */
  protected _state: RenderState = 'notMounted'

  constructor(widget: Widget) {
    this._widget = widget
    this._currentScope = getCurrentScope()!
    const { result: childVNode } = watchDepend(this.build.bind(this), this.update.bind(this), {
      getResult: true
    })
    // @ts-ignore 兼容开发模式的，build时摇树优化会自动去除该if块
    if (import.meta.env?.MODE === 'development') {
      // 热更新
      if (widget.vnode.el) {
        const oldRenderer = widget.vnode.instance!.renderer
        // 恢复子节点
        this._currentChildVNode = oldRenderer.child
        // 恢复渲染器状态
        this._state = oldRenderer.state
        // 恢复最后一次挂载的父元素
        this._lastParent = oldRenderer._lastParent
        // 重置小部件实例
        widget.vnode.instance = widget
        // 更新引用
        widget.vnode.ref && (widget.vnode.ref.value = widget)
        // 更新一次视图
        this.update(childVNode)
        return
      }
    }
    this._currentChildVNode = childVNode
    // 触发onCreated生命周期
    this.triggerLifeCycle(LifeCycleHooks.created)
  }

  /**
   * 当前作用域
   *
   * @note 该方法是受保护的，由`Vitarx`内部调用，请勿外部调用。
   *
   * @protected
   */
  get scope(): Scope | undefined {
    return this._currentScope
  }

  /**
   * 获取当前状态
   */
  get state(): RenderState {
    return this._state
  }

  /**
   * 判断是否已真实挂载到DOM
   *
   * 如果临时移除，也会返回false。
   *
   * @returns {boolean}
   */
  get isMounted(): boolean {
    return !!this._currentChildVNode.el
  }

  /**
   * 当前小部件的child虚拟节点元素
   *
   * @returns {VElement | null}
   */
  get el(): VElement | null {
    return this._currentChildVNode.el || null
  }

  /**
   * 当前小部件的`child`虚拟节点
   *
   * @returns {VNode}
   */
  get child(): VNode {
    return this._currentChildVNode
  }

  /**
   * 获取挂载的父节点
   *
   * @returns {ParentNode | null} DOM元素实例
   */
  get parentEl(): ParentNode | null {
    return getVElementParentEl(this.el)
  }

  // 小部件实例
  protected _widget: Widget

  /**
   * 获取小部件自身的虚拟节点
   *
   * @returns {VNode}
   */
  get vnode(): VNode<FnWidgetConstructor | ClassWidgetConstructor> {
    return (this.widget as any).props[__WidgetPropsSelfNodeSymbol__]
  }

  /**
   * 获取小部件名称
   *
   * @returns {string}
   */
  get name(): string {
    return this.vnode.type.name
  }

  /**
   * 小部件实例
   *
   * @returns {Widget}
   */
  protected get widget(): Widget {
    return this._widget
  }

  /**
   * 挂载节点
   *
   * @note 该方法是受保护的，由`Vitarx`内部调用，请勿外部调用。
   *
   * @protected
   * @param parent
   */
  mount(parent?: Element | DocumentFragment): HtmlElement {
    let el: HtmlElement
    if (this.state !== 'notMounted') {
      if (!this.el) throw new Error('[Vitarx]：渲染器实例已被销毁，不能重新进行挂载。')
      el = VElementToHTMLElement(this.el)
      if (parent && parent !== this.parentEl) {
        console.warn('[Vitarx]：同一个小部件实例不应该被多次挂载，这会从旧的容器，转移到新的容器。')
        parent.appendChild(el)
      }
    } else {
      // 触发onBeforeMount生命周期
      const target = this.triggerLifeCycle(LifeCycleHooks.beforeMount)
      // 挂载到指定元素
      if (target instanceof Element) parent = target
      el = renderElement(this._currentChildVNode, parent)
      Promise.resolve().then(() => {
        this._state = 'activated'
        // 触发onActivated生命周期
        this.triggerLifeCycle(LifeCycleHooks.activated)
        // 触发onMounted生命周期
        this.triggerLifeCycle(LifeCycleHooks.mounted)
      })
    }
    return el
  }

  /**
   * 更新视图
   *
   * @param {VNode} newChildVNode - 可选的新`child`虚拟节点，如果不提供，则使用`build`方法构建。
   */
  update(newChildVNode?: VNode): void {
    if (this._state === 'unloaded') {
      console.warn('[Vitarx]：渲染器已销毁，无法再更新视图！')
      return
    }
    if (this._pendingUpdate) return
    this._pendingUpdate = true
    try {
      // 触发更新前生命周期
      this.triggerLifeCycle(LifeCycleHooks.beforeUpdate)
      // 延迟更新
      setTimeout(() => {
        this._pendingUpdate = false
      })
      const oldVNode = this._currentChildVNode
      const newVNode = newChildVNode || this.build()
      this._currentChildVNode = patchUpdate(oldVNode, newVNode)
      // 触发更新后生命周期
      this.triggerLifeCycle(LifeCycleHooks.updated)
    } catch (e) {
      this._pendingUpdate = false
      console.trace(`[Vitarx]：更新视图时捕获到了异常，${e}`)
    }
  }

  /**
   * 卸载小部件
   *
   * @note 该方法是受保护的，由`Vitarx`内部调用，请勿外部调用。
   *
   * @protected
   */
  unmount(): void {
    if (this._state === 'activated' || this._state === 'deactivate') {
      this._state = 'uninstalling'
      // 触发onDeactivated生命周期
      const result = this.triggerLifeCycle(LifeCycleHooks.beforeUnmount)
      // 递归删除子节点
      unmountVNode(this.child)
      // 如果没有返回true，则等待子节点删除完成然后移除当前节点
      if (result !== true) removeElement(this.el)
      // 销毁当前作用域
      this.scope?.destroy()
      // 修改状态为已卸载
      this._state = 'unloaded'
      // 触发onUnmounted生命周期
      this.triggerLifeCycle(LifeCycleHooks.unmounted)
      // @ts-ignore 释放资源
      this._currentChildVNode = null
      // @ts-ignore 释放资源
      this._currentScope = null
      // @ts-ignore 释放资源
      this._widget = null
      this._lastParent = null
    }
  }

  /**
   * 让小部件恢复激活状态，重新挂载到父元素上。
   *
   * @note 该方法是受保护的，由`Vitarx`内部调用，请勿外部调用。
   *
   * @protected
   * @param root - 该参数用于递归时内部判断是否需要重新挂载，请勿外部传入。
   */
  activate(root: boolean = true): void {
    if (this._state === 'deactivate') {
      this._state = 'activated'
      if (root) {
        // 恢复父元素
        this._lastParent?.appendChild(VElementToHTMLElement(this.el!))
        this._lastParent = null
      }
      // 恢复作用域
      this._currentScope?.unpause()
      // 触发onActivated生命周期
      this.triggerLifeCycle(LifeCycleHooks.activated)
      // 恢复子节点
      updateActivateState(this.child, true)
    }
  }

  /**
   * 停用小部件
   *
   * @note 该方法是受保护的，由`Vitarx`内部调用，请勿外部调用。
   *
   * @protected
   * @param root - 该参数用于递归时内部判断是否需要移除当前元素，请勿外部传入。
   */
  deactivate(root: boolean = true): void {
    if (this._state === 'activated') {
      this._state = 'deactivate'
      this._currentScope?.pause()
      // 触发onDeactivated生命周期
      this.triggerLifeCycle(LifeCycleHooks.deactivate)
      // 删除当前元素
      if (root) {
        this._lastParent = this.parentEl
        removeElement(this.el)
      }
      // 停用子节点
      updateActivateState(this.child, false)
    }
  }

  /**
   * 构建`child`虚拟节点
   *
   * @note 该方法是受保护的，由`Vitarx`内部调用，请勿外部调用。
   *
   * @protected
   * @returns {VNode}
   */
  protected build(): VNode {
    let vnode: VNode
    try {
      vnode = (this.widget as any).build()
    } catch (e) {
      const errVNode = this.triggerLifeCycle(LifeCycleHooks.error)
      if (!isVNode(errVNode)) throw e
      vnode = errVNode
    }
    if (isVNode(vnode)) {
      __updateParentVNode(vnode, this.vnode)
      return vnode
    }
    if (isClassWidgetConstructor(this.vnode.type)) {
      throw new Error(`[Vitarx]：${this.name}类Widget.build返回值非有效的VNode对象`)
    } else {
      throw new Error(`[Vitarx]：${this.name}函数Widget，返回值非有效的VNode对象|VNode构造器`)
    }
  }

  /**
   * 触发生命周期钩子
   *
   * @param hook - 生命周期钩子名称
   * @param args - 参数列表
   *
   * @protected
   */
  protected triggerLifeCycle(hook: LifeCycleHooks, ...args: any[]): any {
    return (this.widget as any)[__LifeCycleTrigger__](hook, ...args)
  }
}

