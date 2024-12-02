import { isFunction } from '../../../utils/index.js'
import { isVDocumentFragment, recoveryFragment, renderElement } from './render.js'
import { removeAttribute, setAttribute } from './attributes.js'
import { renderChildren } from './children.js'
import { Fragment, isTextVNode, isVNode, type VNode, type VNodeChild } from '../../vnode/index.js'
import type { HtmlElement, VElement } from './type.js'

/**
 * 差异更新
 *
 * @param oldVNode - 旧虚拟节点
 * @param newVNode - 新虚拟节点
 */
export function patchUpdate(oldVNode: VNode, newVNode: VNode): VNode {
  // 类型不一致，替换原有节点
  if (oldVNode.type !== newVNode.type || oldVNode.key !== newVNode.key) {
    // 获取父节点
    const parent = getVElementParentNode(oldVNode.el)
    // 替换旧节点为新节点
    replaceVNode(newVNode, oldVNode, parent)
    return newVNode
  } else {
    // 非片段节点，则进行更新属性
    if (oldVNode.type !== Fragment) {
      patchAttrs(oldVNode, newVNode)
    }
    // 非组件节点，更新子节点
    if (!isFunction(oldVNode.type)) {
      patchChildren(oldVNode, newVNode)
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
function patchAttrs(oldVNode: VNode, newVNode: VNode): void {
  const isWidget = isFunction(oldVNode.type),
    el = oldVNode.el as HTMLElement
  const oldAttrs = oldVNode.props as Record<string, any>
  const newAttrs = newVNode.props as Record<string, any>
  // 使用 Set 记录 oldAttrs 中的键，以便在循环中检查需要删除的属性
  const oldKeysSet = new Set(Object.keys(oldAttrs))
  // 遍历 newAttrs，检查是否有新的属性或属性值需要更新
  Object.keys(newAttrs).forEach(key => {
    // 更新或新增属性
    if (oldAttrs[key] !== newAttrs[key]) {
      if (!isWidget) {
        setAttribute(el, key, newAttrs[key], oldAttrs[key])
      }
      oldAttrs[key] = newAttrs[key]
    }
    // 将已经处理过的 key 从 oldKeysSet 中删除
    oldKeysSet.delete(key)
  })
  // 删除 newAttrs 中不存在的旧属性
  oldKeysSet.forEach(key => {
    if (!isWidget) {
      removeAttribute(el, key, oldAttrs[key])
    }
    delete oldAttrs[key]
  })
}

/**
 * 差异化更新子节点列表
 *
 * @param oldVNode - 旧虚拟节点
 * @param newVNode - 新虚拟节点
 */
function patchChildren(oldVNode: VNode, newVNode: VNode): boolean {
  const oldChildren = oldVNode.children!
  const newChildren = newVNode.children!
  if (oldChildren === newChildren) return false
  // 创建新子节点
  if (newChildren && !oldChildren) {
    const parent = oldVNode.type === Fragment ? getVElementParentNode(oldVNode.el) : oldVNode.el
    // 渲染新的子节点
    renderChildren(parent as Element, newChildren, true)
    oldVNode.children = newChildren
    return true
  }
  // 删除旧子节点
  if (!newChildren && oldChildren) {
    for (const oldChild of oldChildren) {
      unmountVNode(oldChild)
    }
    oldVNode.children = newChildren
    return true
  }
  const maxLength = Math.max(oldChildren!.length, newChildren.length)
  const isFragment = isVDocumentFragment(oldVNode.el)

  // 正序遍历，使用偏移量管理索引
  let offset = 0
  for (let i = 0; i < maxLength; i++) {
    const adjustedIndex = i - offset // 调整后的索引，考虑删除带来的偏移
    const oldChild = oldChildren[adjustedIndex]
    const newChild = patchChild(oldVNode, oldChild, newChildren[i])

    if (newChild) {
      oldVNode.children[adjustedIndex] = newChild
      if (isFragment) {
        // @ts-ignore
        oldVNode.el.__backup[adjustedIndex] = newChild.el
      }
    } else {
      // 删除当前节点并调整偏移量
      oldChildren.splice(adjustedIndex, 1)
      offset++ // 偏移量增加，下一次遍历时索引需要校正
      if (isFragment) {
        // @ts-ignore
        oldVNode.el.__backup.splice(adjustedIndex, 1)
      }
    }
  }
  return true
}

/**
 * 差异化更新子节点
 *
 * @param oldVNode - 旧虚拟节点
 * @param oldChild - 旧子节点
 * @param newChild - 新子节点
 * @protected
 */
function patchChild(oldVNode: VNode, oldChild: VNodeChild, newChild: VNodeChild): VNodeChild {
  // 删除节点
  if (oldChild && !newChild) {
    unmountVNode(oldChild)
    return newChild
  }
  // 新增节点
  if (!oldChild && newChild) {
    const parent = oldVNode.type === Fragment ? getVElementParentNode(oldVNode.el)! : oldVNode.el!
    // 渲染新的子节点
    renderChildren(parent as Element, newChild, true)
    return newChild
  }
  // 更新文本节点
  if (isTextVNode(oldChild) && isTextVNode(newChild)) {
    if (oldChild.value !== newChild.value) {
      oldChild.value = newChild.value
      oldChild.el!.nodeValue = newChild.value
    }
    return oldChild
  }
  // 更新节点
  if (isVNode(oldChild) && isVNode(newChild)) {
    return patchUpdate(oldChild, newChild)
  }
  // 替换节点
  else {
    replaceVNode(newChild, oldChild)
    return newChild
  }
}

/**
 * 卸载节点
 *
 * @param {VNodeChild} vnode - 要卸载的虚拟节点
 * @param {boolean} removeEl - 是否要从DOM树中移除元素，内部递归时使用，无需外部指定！
 * @protected
 */
export function unmountVNode(vnode: VNodeChild, removeEl: boolean = true): void {
  if (isVNode(vnode)) {
    if (vnode.instance) {
      vnode.instance!.renderer.unmount(removeEl)
    } else {
      // 递归卸载子级
      vnode.children?.forEach(child => unmountVNode(child, false))
      // 删除元素
      if (removeEl) removeElement(vnode.el)
    }
  } else if (isTextVNode(vnode) && removeEl) {
    vnode.el?.remove()
  }
}

/**
 * 卸载节点
 *
 * @param vnode - 要卸载的虚拟节点
 * @protected
 */
export function mountVNode(vnode: VNodeChild): void {
  if (isVNode(vnode)) {
    if (vnode.instance) {
      // 递归挂载子节点
      mountVNode(vnode.instance.renderer.child)
      // 挂载当前节点
      vnode.instance.renderer.mount()
    } else {
      // 递归挂载子级
      vnode.children?.forEach(child => mountVNode(child))
    }
  }
}

/**
 * 更新激活状态
 *
 * @param vnode - 子节点
 * @param activate - 激活为true，停用为false
 */
export function updateActivateState(vnode: VNodeChild, activate: boolean) {
  if (isVNode(vnode)) {
    if (vnode.instance) {
      if (activate) {
        vnode.instance.renderer.activate(false)
      } else {
        vnode.instance.renderer.deactivate(false)
      }
    } else {
      // 递归激活/停用子节点
      if (vnode.children) {
        for (let i = 0; i < vnode.children.length; i++) {
          updateActivateState(vnode.children[i], activate)
        }
      }
    }
  }
}

/**
 * 删除元素
 *
 * @param el
 */
export function removeElement(el: HtmlElement | null) {
  if (!el) return
  if (isVDocumentFragment(el)) {
    // 删除旧节点
    el.__backup.forEach(item => item.remove())
  } else {
    el?.remove()
  }
}

/**
 * 替换节点
 *
 * @param newVNode
 * @param oldVNode
 * @param parent
 */
function replaceVNode(newVNode: VNodeChild, oldVNode: VNodeChild, parent?: ParentNode | null) {
  if (parent === undefined) {
    parent = getVElementParentNode(oldVNode.el!)
  }
  if (!parent) {
    throw new Error('被替换的旧节点未挂载，无法获取其所在的容器元素实例，无法完成替换操作。')
  }
  const newEl = renderElement(newVNode)
  // 如果新节点是传送节点，则不进行替换，直接卸载旧节点
  if ('instance' in newVNode && newVNode.instance!.renderer.teleport) {
    unmountVNode(oldVNode)
    mountVNode(newVNode)
    return
  }
  // 替换文本节点
  if (isTextVNode(oldVNode)) {
    parent.replaceChild(newEl, oldVNode.el!)
    mountVNode(newVNode)
    return
  }
  if (oldVNode.instance) {
    if (oldVNode.instance.renderer.teleport) {
      // 将新元素替换掉旧节点的传送占位元素
      replaceElement(newEl, oldVNode.instance.renderer.teleport.placeholder, parent)
    } else {
      // 将新元素插入到旧元素之前，兼容卸载动画
      insertElement(newEl, oldVNode.el!, parent)
    }
  } else {
    replaceElement(newEl, oldVNode.el!, parent)
  }
  // 卸载旧节点
  unmountVNode(oldVNode)
  // 挂载新节点
  mountVNode(newVNode)
}

/**
 * 在旧元素之前插入新元素
 *
 * 兼容`VDocumentFragment`
 *
 * @param newEl - 新元素
 * @param oldEl - 旧元素
 * @param parent - 父元素
 */
export function insertElement(newEl: HtmlElement, oldEl: HtmlElement, parent: ParentNode) {
  if (isVDocumentFragment(oldEl)) {
    parent.insertBefore(recoveryFragment(newEl), oldEl.__backup[0])
  } else {
    parent.insertBefore(recoveryFragment(newEl), oldEl)
  }
}

/**
 * 替换节点
 *
 * @param newEl
 * @param oldEl
 * @param parent - 不传入父节点，自动使用旧节点的父节点
 */
export function replaceElement(newEl: HtmlElement, oldEl: HtmlElement, parent: ParentNode): void {
  if (isVDocumentFragment(oldEl)) {
    // 片段节点弹出第一个元素，用于替换
    const oldFirst = oldEl.__backup.shift()!
    // 删除其余元素
    removeElement(oldEl)
    parent.replaceChild(recoveryFragment(newEl), oldFirst)
  } else {
    parent.replaceChild(recoveryFragment(newEl), oldEl)
  }
}

/**
 * 获取父元素
 *
 * 等同于 `document.getElementById(id).parentNode`，只是对片段元素进行特殊处理。
 *
 * @param el
 */
export function getVElementParentNode(el: VElement | HtmlElement | null): ParentNode | null {
  if (!el) return null
  return isVDocumentFragment(el) ? el.__backup[0].parentNode : el.parentNode
}
