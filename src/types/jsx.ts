declare namespace JSX {
  /**
   * @inheritDoc
   */
  interface Element extends Vitarx.VNode {}

  /**
   * @inheritDoc
   */
  type ElementClass = Vitarx.ClassWidget

  /**
   * @inheritDoc
   */
  interface IntrinsicElements extends Vitarx.JSX.IntrinsicElements {}

  /**
   * @inheritDoc
   */
  interface IntrinsicAttributes extends Vitarx.JSX.IntrinsicAttributes {}

  /**
   * 子孙类型检测
   *
   * @see https://bosens-china.github.io/Typescript-manual/download/zh/reference/jsx.html#%E5%AD%90%E5%AD%99%E7%B1%BB%E5%9E%8B%E6%A3%80%E6%9F%A5 子孙类型检测
   */
  interface ElementChildrenAttribute {
    children: {}
  }
}
