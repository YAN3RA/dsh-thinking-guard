/**
 * C-4：forced-colors（高对比度）保底。node 无渲染环境，这里对 V3Styles 的样式文本做结构回归：
 * 必须存在 forced-colors 媒体块、使用系统色关键字、覆盖卡片/状态格/比例条/机制卡，
 * 且不滥用 forced-color-adjust:none。真实 computed 验证由主代理在 forced-colors 环境做。
 */
import { describe, expect, it } from 'vitest'
import { V3Styles } from '../src/client/v3-ui.ts'

function cssText(): string {
  const element = V3Styles() as unknown as { props: { children?: unknown } }
  return String(element.props.children ?? '')
}

describe('C-4 forced-colors fallback', () => {
  const css = cssText()

  it('ships a forced-colors media block with system-color borders', () => {
    expect(css).toContain('@media (forced-colors: active)')
    expect(css).toContain('CanvasText')
    expect(css).toContain('Highlight')
    // 关键结构都要有保底：卡片、状态格、比例条、机制卡、表格滚动区。
    for (const selector of ['.v3-root .gd-card', '.v3-root .ov-scell', '.v3-root .ov-bar', '.v3-root .mc-frontmatter-region']) {
      expect(css).toContain(selector)
    }
    expect(css).toContain('.v3-root :focus-visible')
  })

  it('does not abuse forced-color-adjust:none', () => {
    expect(css.includes('forced-color-adjust:none')).toBe(false)
  })
})
