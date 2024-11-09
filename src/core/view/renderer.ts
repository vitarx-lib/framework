import {
  Fragment,
  type FragmentTag,
  type HtmlTagName,
  isRefEl,
  isVNode,
  type VDocumentFragment,
  type VElement,
  type VNode,
  type VNodeChild,
  type VNodeChildren
} from './VNode.js'
import { isArray, isFunction, isRecordObject, isString } from '../../utils/index.js'
import {
  type ClassWidget,
  createScope,
  type HTMLClassProperties,
  type HtmlElementTags,
  type HTMLStyleProperties,
  isClassWidget,
  reactive,
  watchDepend
} from '../../index.js'
import { createFnWidget, type FnWidget } from './fn-widget.js'
import type { Widget } from './widget.js'

/**
 * 真实DOM元素
 */
export type ElementNode = Element | DocumentFragment

/**
 * 小部件元素管理器
 */
export class WidgetRenderer {
  currentVNode: VNode

  constructor(protected widget: Widget) {
    const { result, listener } = watchDepend(this.build.bind(this), this.update.bind(this), {
      getResult: true
    })
    if (!isVNode(result)) {
      listener?.destroy()
      throw new Error('[Vitarx]：Widget.build方法必须返回VNode虚拟节点')
    }
    this.currentVNode = result
  }

  /**
   * 是否已挂载
   */
  get mounted(): boolean {
    return this.currentVNode.el !== null
  }

  /**
   * 获取节点对象
   *
   * @returns {VElement | null}
   */
  get el(): VElement | null {
    return this.currentVNode.el
  }

  /**
   * 获取父真实节点
   */
  get parentNode(): ParentNode | null {
    return getParentNode(this.el)
  }

  /**
   * 创建节点元素
   *
   * @returns {ElementNode}
   */
  createElement(): ElementNode {
    return createElement(this.currentVNode)
  }

  /**
   * 挂载节点
   *
   * @param parent
   */
  mount(parent: ElementNode): ElementNode {
    let el: ElementNode
    if (this.el) {
      el = VElementToHTMLElement(this.el)
    } else {
      el = this.createElement()
      this.widget.onMounted?.()
    }
    parent.append(el)
    return el
  }

  build(): VNode {
    try {
      return this.widget.build()
    } catch (e) {
      if (this.widget?.onError && isFunction(this.widget.onError)) {
        const vnode = this.widget.onError(e)
        if (isVNode(vnode)) return vnode
      }
      // 继续向上抛出异常
      throw e
    }
  }

  update(force: boolean = false) {
    const oldVNode = this.currentVNode
    const newVNode = this.build()
    this.currentVNode = this.patchUpdate(oldVNode, newVNode)
  }

  /**
   * 差异更新
   *
   * @param oldVNode
   * @param newVNode
   */
  protected patchUpdate(oldVNode: VNode, newVNode: VNode) {
    // 类型不一致，替换原有节点
    if (oldVNode.type !== newVNode.type || oldVNode.key !== newVNode.key) {
      oldVNode.scope?.destroy()
      const newEl = createElement(newVNode)
      replaceChild(getParentNode(oldVNode.el)!, newEl as VElement, oldVNode.el!)
      return newVNode
    } else {
      // 片段类型不具有任何属性
      if (oldVNode.type !== Fragment) {
        this.patchAttrs(oldVNode, newVNode)
      }
      // 更新子节点
      if (!isFunction(oldVNode.type)) {
        this.patchChildren(oldVNode, newVNode)
      }
      return oldVNode
    }
  }

  /**
   * 差异化更新属性
   *
   * @param oldVNode
   * @param newVNode
   */
  protected patchAttrs(oldVNode: VNode, newVNode: VNode) {
    const isWidget = isFunction(oldVNode.type), el = oldVNode.el as HTMLElement
    const oldAttrs = oldVNode.props as Record<string, any>
    const newAttrs = newVNode.props as Record<string, any>
    // 使用 Set 记录 newAttrs 中的键
    const newKeysSet = new Set(Object.keys(newAttrs))
    // 遍历 oldAttrs，删除不在 newAttrs 中的键
    Object.keys(oldAttrs).forEach(key => {
      if (!newKeysSet.has(key)) {
        if (isWidget) {
          // @ts-ignore
          delete oldAttrs[key]
        } else {
          if (key === 'className') {
            el.className = ''
          } else {
            el.removeAttribute(key)
          }
        }
      } else if (oldAttrs[key] !== newAttrs[key]) {
        // 更新 oldAttrs 中值有变化的键
        if (isWidget) {
          oldAttrs[key] = newAttrs[key]
        } else {
          setAttr(el, key, newAttrs[key])
        }
      }
    })
    // 遍历 newAttrs，添加不在 oldAttrs 中的键
    Object.keys(newAttrs).forEach(key => {
      if (isWidget) {
        if (!(key in oldAttrs)) {
          if (isWidget) {
            oldAttrs[key] = newAttrs[key]
          } else {
            setAttr(el, key, newAttrs[key])
          }
        }
      }
    })
  }

  /**
   * 差异化更新子节点
   *
   * @param oldVNode
   * @param newVNode
   */
  protected patchChildren(oldVNode: VNode, newVNode: VNode) {
    const oldChildren = oldVNode.children
    const newChildren = newVNode.children
    if (oldChildren === newChildren) return
    const isFragment = oldVNode.type === Fragment
    // 如果没有旧的子节点
    if (!oldChildren && newChildren) {
      createChildren(VElementToHTMLElement(oldVNode.el!), newChildren)
      oldVNode.children = newChildren
      return
    }
    // 如果新子节点为空 则删除旧子节点
    if (!newChildren && oldChildren) {
      oldVNode.children = newChildren
      return
    }
    // 处理字符串差异
    // if (typeof oldChildren === 'string' && typeof newChildren === 'string') {
    //   if (oldChildren !== newChildren) {
    //     if (!isFragment) {
    //       if (isArray(oldVNode.el)) {
    //         oldVNode.el[0].nodeValue = newChildren
    //       } else {
    //         oldVNode.el!.firstChild!.nodeValue = newChildren
    //       }
    //       ;(oldVNode.props as any).children = newChildren
    //     }
    //   }
    //   return
    // }
  }
}

/**
 * 从Vnode el中获取父节点
 *
 * @param el
 */
function getParentNode(el: VElement | null): ParentNode | null {
  if (!el) return null
  return isArray(el) ? el[0].parentNode : el.parentNode
}

/**
 * 替换节点
 *
 * @param parent
 * @param newEl
 * @param oldEl
 */
function replaceChild(parent: ParentNode, newEl: VElement | ElementNode, oldEl: VElement) {
  if (isArray(oldEl)) {
    const old = oldEl.shift()!
    removeElement(oldEl)
    parent.replaceChild(VElementToHTMLElement(newEl), old)
  } else {
    parent.replaceChild(VElementToHTMLElement(newEl), oldEl)
  }
}

/**
 * 删除元素
 *
 * @param el
 */
function removeElement(el: VElement) {
  if (isArray(el)) {
    // 删除旧节点
    el.forEach(item => item.remove())
  } else {
    el.remove()
  }
}
/**
 * 创建一个真实DOM元素
 *
 * @param vnode
 */
function createElement(vnode: VNode): ElementNode {
  let el: ElementNode
  switch (typeof vnode.type) {
    case 'string':
      // HTML 元素节点
      el = createHtmlElement(vnode as VNode<HtmlTagName>)
      break
    case 'symbol':
      // Fragment 节点
      el = createFragmentElement(vnode as VNode<FragmentTag>)
      break
    case 'function':
      el = createWidgetElement(vnode as VNode<ClassWidget | FnWidget>)
      break
    default:
      throw new Error(`Unsupported vnode type: ${vnode.type}`)
  }
  if (el instanceof DocumentFragment) {
    vnode.el = fragmentToNodes(el)
  } else {
    vnode.el = el
  }
  return el
}

// 创建小部件元素
function createWidgetElement(vnode: VNode<FnWidget | ClassWidget>) {
  let component: Widget
  const scope = createScope(() => {
    vnode.props = reactive(vnode.props, false)
    // 函数组件或类组件
    component = isClassWidget(vnode.type) ? new vnode.type(vnode.props) : createFnWidget(vnode.type as FnWidget, vnode.props)
  })
  if (isRefEl(vnode.ref)) vnode.ref.value = component!
  vnode.scope = scope
  return component!.renderer.mount()
}

// 创建html元素
function createHtmlElement(vnode: VNode<HtmlElementTags>) {
  const el = document.createElement(vnode.type)
  setAttributes(el, vnode.props)
  createChildren(el, vnode.children)
  if (isRefEl(vnode.ref)) vnode.ref.value = el
  return el
}

// 创建 Fragment 元素
function createFragmentElement(vnode: VNode<FragmentTag>) {
  const el = document.createDocumentFragment()
  if (!vnode.children) {
    // 创建一个空文本节点，用于占位 document.createComment('注释节点占位')
    el.appendChild(document.createTextNode(''))
    if (isRefEl(vnode.ref)) vnode.ref.value = []
  } else {
    createChildren(el, vnode.children)
    if (isRefEl(vnode.ref)) vnode.ref.value = fragmentToNodes(el)
  }
  return el
}
/**
 * 更新DOM元素的子节点
 *
 * @param parent
 * @param children
 */
function createChildren(parent: ElementNode, children: VNodeChildren | undefined) {
  if (!children) return
  children.forEach(child => createChild(parent, child))
}

/**
 * 创建子节点
 *
 * @param parent
 * @param child
 */
function createChild(parent: ElementNode, child: VNodeChild) {
  if (isVNode(child)) {
    parent.appendChild(createElement(child))
  } else if (child?.toString && isFunction(child?.toString)) {
    parent.appendChild(document.createTextNode(child.toString()))
  }
}

/**
 * 设置属性
 *
 * @param el - 目标元素
 * @param props - 属性对象
 */
function setAttributes(el: HTMLElement, props: Record<string, any>) {
  Object.keys(props).forEach(key => {
    if (key === 'children') return
    setAttr(el, key, props[key])
  })
}

// 设置Html元素属性
function setAttr(el: HTMLElement, key: string, value: any, oldValue?: any) {
  switch (key) {
    case 'style':
      setStyle(el, value)
      break
    case 'class':
      setClass(el, value)
      break
    default:
      if (isHTMLNodeEvent(el, key)) {
        if (!isFunction(value)) {
          throw new TypeError(`无效的事件处理程序，${key}: ${typeof value}`)
        }
        const event = key.slice(2).toLowerCase()
        // 删除旧的事件
        if (oldValue && isFunction(oldValue)) {
          el.removeEventListener(event, oldValue)
        }
        el.addEventListener(event, value)
      } else if (key.startsWith('data-')) {
        el.dataset[key.slice(5)] = value
      } else {
        try {
          // 处理其他属性
          if (key in el) {
            // @ts-ignore
            el[key] = value
          } else {
            el.setAttribute(key, value) // 设置未知属性
          }
        } catch (error) {
          console.error(`设置属性 ${key} 时发生错误:`, error)
        }
      }
      break
  }
}

/**
 * 判断是否为事件属性
 *
 * @param el
 * @param prop
 */
function isHTMLNodeEvent(el: HTMLElement, prop: string) {
  return prop.startsWith('on') && prop.toLowerCase() in el
}

/**
 * 设置内联样式
 *
 * @param el
 * @param style
 */
function setStyle(el: HTMLElement, style: HTMLStyleProperties) {
  if (style && el.style) {
    if (isString(style)) {
      el.style.cssText = style
    } else if (isRecordObject(style)) {
      for (const key in style) {
        // @ts-ignore
        el.style[key] = style[key]
      }
    }
  }
}

/**
 * 设置样式类
 *
 * @param el
 * @param classData
 */
function setClass(el: HTMLElement, classData: HTMLClassProperties) {
  if (classData) {
    if (isString(classData)) {
      el.className = classData
    } else if (isArray(classData)) {
      el.classList.add(...classData)
    } else if (isRecordObject(Object)) {
      for (const key in classData) {
        if (classData[key]) {
          el.classList.add(key)
        } else {
          el.classList.remove(key)
        }
      }
    }
  }
}

/**
 * node数组转换为片段
 *
 * @param nodes
 */
function nodesToFragment(nodes: VDocumentFragment): DocumentFragment {
  const el = document.createDocumentFragment()
  for (let i = 0; i < nodes.length; i++) {
    el.appendChild(nodes[i])
  }
  return el
}

/**
 * 片段转node数组
 *
 * @param el
 */
function fragmentToNodes(el: DocumentFragment): VDocumentFragment {
  const els: Node[] = []
  for (let i = 0; i < el.childNodes.length; i++) {
    els.push(el.childNodes[i])
  }
  return els as VDocumentFragment
}

/**
 * VElement 转 HTMLElement
 *
 * @param el
 * @constructor
 */
function VElementToHTMLElement(el: VElement | ElementNode): ElementNode {
  return isArray(el) ? nodesToFragment(el) : el
}
