type Child = Node | string | null | undefined | false;

/** 작은 DOM 생성 도우미. 문자열 자식은 textContent 로 들어가므로 편지 내용이 HTML로 해석되지 않는다. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) if (child) node.append(child);
  return node;
}
