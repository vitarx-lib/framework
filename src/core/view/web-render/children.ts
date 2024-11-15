import { type VNodeChild, type VNodeChildren } from '../VNode.js'
import { type ParentElement, renderElement } from './element.js'
import { isArray } from '../../../utils/index.js'

/**
 * 挂载子节点列表
 *
 * @param parent
 * @param children
 */
export function renderChildren(parent: ParentElement, children: VNodeChildren | null): void {
  if (!children) return
  for (let i = 0; i < children.length; i++) {
    renderChild(parent, children[i])
  }
}

/**
 * 创建并挂载子节点
 *
 * @param parent
 * @param child
 */
export function renderChild(parent: ParentElement, child: VNodeChild): void {
  if (isArray(child)) {
    renderChildren(parent, child)
  } else {
    renderElement(child, parent)
  }
}
