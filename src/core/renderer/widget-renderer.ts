import { isVNode, updateParentVNodeMapping, type VNode, type WidgetType } from '../vnode/index.js'
import {
  type ContainerElement,
  insertBeforeExactly,
  mountVNode,
  patchUpdate,
  removeElement,
  renderElement,
  replaceElement,
  unmountVNode,
  updateActivateState
} from './web-runtime-dom/index.js'
import { type HookParameter, type HookReturnType, LifeCycleHooks, Widget } from '../widget/index.js'
import { watchDepend } from '../observer/index.js'
import { getCurrentScope, type Scope } from '../scope/index.js'
import Logger from '../logger.js'

/**
 * 渲染状态
 *
 * - notRendered：未渲染
 * - notMounted：未挂载
 * - activated：活跃
 * - deactivate：不活跃
 * - uninstalling：卸载中
 * - unloaded：已卸载
 */
export type RenderState =
  | 'notRendered'
  | 'notMounted'
  | 'activated'
  | 'deactivate'
  | 'uninstalling'
  | 'unloaded'

/**
 * 小部件渲染器
 *
 * 用于渲染小部件，和管理小部件的生命周期。
 */
export class WidgetRenderer<T extends Widget> {
  // 渲染器状态
  protected _state: RenderState = 'notRendered'
  // 等到更新
  protected _pendingUpdate = false
  // 影子占位元素
  protected _shadowElement: Comment | null = null
  // 当前组件的Child虚拟节点
  protected _child: VNode

  constructor(widget: T) {
    this._widget = widget
    const { result: childVNode, listener } = watchDepend(
      this.build.bind(this),
      this.update.bind(this),
      {
        getResult: true
      }
    )
    // 兼容异步
    if (listener && !getCurrentScope()) widget['scope'].add(listener)
    this._child = childVNode
  }

  /**
   * 获取影子元素
   *
   * 仅传送节点和被挂起的顶层节点使用影子节点记录其所在位置。
   */
  get shadowElement(): Comment {
    if (!this._shadowElement) {
      this._shadowElement = document.createComment('shadow')
    }
    return this._shadowElement
  }

  // 小部件实例
  protected _widget: T

  /**
   * 当前小部件的`child`虚拟节点
   *
   * @returns {VNode}
   */
  get child(): VNode {
    return this._child
  }

  // 传送功能相关数据
  protected _teleport: Element | null = null

  /**
   * 当前小部件的状态
   */
  get state(): RenderState {
    return this._state
  }

  /**
   * 当前作用域
   *
   * @note 该方法是受保护的，由`Vitarx`内部调用，请勿外部调用。
   *
   * @protected
   */
  get scope(): Scope {
    return this.widget['scope']
  }

  /**
   * 当前小部件的child虚拟节点元素
   *
   * @returns {ContainerElement | null}
   */
  get el(): ContainerElement | undefined {
    return this._child?.el
  }

  /**
   * 获取小部件自身的虚拟节点
   *
   * @returns {VNode}
   */
  get vnode(): VNode<WidgetType> {
    return this.widget['vnode']
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
  protected get widget(): T {
    return this._widget
  }

  /**
   * 判断节点是否需要传送
   *
   * 该属性需在渲染之后调用获取的结果才准确！！
   */
  get teleport(): null | Element {
    return this._teleport
  }

  /**
   * 渲染小部件，并返回渲染的真实元素
   *
   * 该方法仅触发 `beforeMount`生命周期，但不会触发`mounted`生命周期，需额外调用`mount`方法触发`mounted`生命周期。
   *
   * @note 该方法是受保护的，由`Vitarx`内部调用，请勿外部调用。
   * @param {ContainerElement} container - 容器元素，如果`beforeMount`钩子返回了指定的容器元素，则此参数无效。
   * @returns {ContainerElement} - 渲染的元素实例
   * @protected
   */
  render(container?: ContainerElement): ContainerElement {
    if (this.state !== 'notRendered') {
      throw new Error('[Vitarx.WidgetRenderer.render]：组件已渲染，请勿重复渲染！')
    }

    let el: ContainerElement | null = null
    try {
      // 触发onBeforeMount生命周期
      const target = this.triggerLifeCycle(LifeCycleHooks.beforeMount)
      if (target instanceof Element) {
        // 如果指定了父元素，则不继续往下传递父元素，避免提前展示视图
        this._teleport = target
        // 将占位符节点插入到正常的父容器中
        container?.appendChild(this.shadowElement)
        el = renderElement(this.child) as ContainerElement
      } else {
        el = renderElement(this.child, container) as ContainerElement
      }
    } catch (e) {
      // 触发onError生命周期
      const errVNode = this.triggerLifeCycle(LifeCycleHooks.error, e, 'render')
      // 如果返回的内容不是一个VNode虚拟节点，则继续抛出错误
      if (!isVNode(errVNode)) throw e
      this._child = errVNode
      el = renderElement(this.child) as ContainerElement
    }
    this._state = 'notMounted'
    return el
  }

  /**
   * 更新视图
   *
   * @param {VNode} newChildVNode - 新子节点，没有则使用`build`方法构建。
   */
  update(newChildVNode?: VNode): void {
    if (this.state === 'unloaded') {
      return Logger.warn('渲染器已销毁，不能再更新视图！')
    }
    // 如果状态不是活跃，则直接返回
    if (this.state === 'deactivate') return
    // 如果是挂起的更新，则直接返回
    if (this._pendingUpdate) return
    this._pendingUpdate = true
    try {
      // 触发更新前生命周期
      this.triggerLifeCycle(LifeCycleHooks.beforeUpdate)
      const oldVNode = this._child
      const newVNode = newChildVNode || this.build()
      this._child = this.patchUpdate(oldVNode, newVNode)
      // 延迟取消待更新状态，避免重复更新
      setTimeout(() => {
        this._pendingUpdate = false
      }, 0)
      // 触发更新后生命周期
      this.triggerLifeCycle(LifeCycleHooks.updated)
    } catch (e) {
      this._pendingUpdate = false
      // 继续向上抛出错误
      throw e
    }
  }

  /**
   * 差异更新
   *
   * @param {VNode} oldVNode - 旧子节点
   * @param {VNode} newVNode - 新子节点
   * @protected
   */
  protected patchUpdate(oldVNode: VNode, newVNode: VNode): VNode {
    return patchUpdate(oldVNode, newVNode)
  }

  /**
   * 该方法用于在元素真实挂载到文档中时调用。
   *
   * @note 该方法是受保护的，由`Vitarx`内部调用，请勿外部调用。
   * @protected
   */
  mount(): void {
    if (this.state !== 'notMounted') {
      return Logger.warn('非待挂载状态，不能进行挂载！')
    }
    // 递归挂载子节点
    mountVNode(this.child)
    // 挂载到传送节点上
    if (this.teleport) {
      this.teleport.appendChild(this.el!)
    }
    this._state = 'activated'
    // 触发onMounted生命周期
    this.triggerLifeCycle(LifeCycleHooks.mounted)
    // 触发onActivated生命周期
    this.triggerLifeCycle(LifeCycleHooks.activated)
  }

  /**
   * 卸载小部件
   *
   * @note 该方法是受保护的，由`Vitarx`内部调用，请勿外部调用。
   * @param {boolean} root - 用于递归时判断是否需要移除当前元素，内部逻辑使用，请勿外部传入。
   * @protected
   */
  unmount(root: boolean = true): void {
    if (this.state !== 'uninstalling' && this.state !== 'unloaded') {
      this._state = 'uninstalling'
      // 是否需要移除元素，默认root为true时需要移除元素
      let isRemoveEl = root
      if (root) {
        // 如果是根节点，则需要判断是否需要异步卸载，异步卸载则返回Promise对象，否则直接移除元素
        const result = this.triggerLifeCycle(LifeCycleHooks.beforeRemove, this.el!, 'unmount')
        if (result instanceof Promise) {
          isRemoveEl = false
          result.finally(() => removeElement(this.el!))
        }
      }
      // 触发onDeactivated生命周期
      this.triggerLifeCycle(LifeCycleHooks.beforeUnmount)
      // 递归卸载子节点
      unmountVNode(this.child, isRemoveEl)
      // 销毁当前作用域
      this.scope?.destroy()
      // 移除占位元素
      this._shadowElement?.remove()
      // 修改状态为已卸载
      this._state = 'unloaded'
      // 触发onDeactivated生命周期
      this.triggerLifeCycle(LifeCycleHooks.deactivate)
      // 触发onUnmounted生命周期
      this.triggerLifeCycle(LifeCycleHooks.unmounted)
    }
  }

  /**
   * 让小部件恢复激活状态，重新挂载到父元素上。
   *
   * @note 该方法是受保护的，由`Vitarx`内部调用，请勿外部调用。
   * @param {boolean} root - 该参数用于递归时内部判断是否需要重新挂载，请勿外部传入。
   * @protected
   */
  activate(root: boolean = true): void {
    if (this._state === 'deactivate') {
      this._state = 'activated'
      // 激活子节点
      updateActivateState(this.child, true)
      if (this.teleport) {
        // 复原传送节点元素
        this.teleport.appendChild(this.el!)
      } else if (root) {
        // 使用真实元素替换占位元素
        replaceElement(this.el!, this.shadowElement)
      }
      // 恢复作用域
      this.scope?.unpause()
      // 更新视图
      this.update()
      // 触发onActivated生命周期
      this.triggerLifeCycle(LifeCycleHooks.activated)
    }
  }

  /**
   * 停用小部件
   *
   * @note 该方法是受保护的，由`Vitarx`内部调用，请勿外部调用。
   * @param root - 该参数用于递归时内部判断是否需要移除当前元素，请勿外部传入。
   * @protected
   */
  deactivate(root: boolean = true): void {
    if (this._state !== 'activated') return

    this._state = 'deactivate'

    // 递归停用子节点
    updateActivateState(this.child, false)

    // 触发beforeRemove生命周期钩子，获取返回值
    const result = this.triggerLifeCycle(LifeCycleHooks.beforeRemove, this.el!, 'deactivate')

    // 异步删除元素
    const removeElementAsync = (element: ContainerElement): void | Promise<void> => {
      if (result instanceof Promise) {
        return result.finally(() => removeElement(element))
      } else {
        removeElement(element)
      }
    }

    if (this.teleport) {
      removeElementAsync(this.el!)
    } else if (root) {
      insertBeforeExactly(this.shadowElement, this.el!)
      removeElementAsync(this.el!)
    }
    // 使用宏任务执行暂停作用域，和触发生命周期
    setTimeout(() => {
      this.scope?.pause()
      // 触发onDeactivated生命周期
      this.triggerLifeCycle(LifeCycleHooks.deactivate)
    }, 0)
  }

  /**
   * 构建`child`虚拟节点
   *
   * @note 该方法是受保护的，由`Vitarx`内部调用，请勿外部调用。
   * @protected
   * @returns {VNode}
   */
  protected build(): VNode {
    let vnode: VNode
    try {
      vnode = this.widget['build']()
    } catch (e) {
      const errVNode = this.triggerLifeCycle(LifeCycleHooks.error, e, 'build')
      if (!isVNode(errVNode)) throw e
      vnode = errVNode
    }
    if (isVNode(vnode)) {
      updateParentVNodeMapping(vnode, this.vnode)
      return vnode
    }
    throw new Error(`[Vitarx.WidgetRenderer]：${this.name}.build返回值必须是VNode对象`)
  }

  /**
   * 触发生命周期钩子
   *
   * @param hook - 生命周期钩子名称
   * @param args - 参数列表
   * @protected
   */
  protected triggerLifeCycle<K extends LifeCycleHooks>(
    hook: K,
    ...args: HookParameter<K>
  ): HookReturnType<K> {
    return this.widget['callLifeCycleHook'](hook, ...args)
  }
}
