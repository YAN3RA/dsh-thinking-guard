/**
 * v3 设计层（D-044）——设置页四个子页面共用的 token、容器脚手架与块级词汇表。
 *
 * WHY A SHARED MODULE: v3 的视觉识别来自一套统一的 token 与块（panel / stats /
 * board / rank / table / gitem / catstat）。四个页面各写一份必然漂移，所以跨页面
 * 复用的部分集中在这里；页面专属样式仍留在各自文件里（调用统计页的样式函数、
 * CapabilitySection.tsx 的 mc-* 样式块）。
 *
 * CONTAINER, NOT VIEWPORT: 设置面板是宿主写死的 800px 弹窗，内容列只有 564px，
 * 与视口宽度无关（D-044 实测）。因此 v3 的断点全部写成 `@container v3`，页面根
 * 节点加上 `v3-root` 即成为容器。用 `@media` 会在 1200px 窗口里误判成「宽」，
 * 画出实际放不下的双栏。
 *
 * THEME: v3 原始 CSS 写死深色；这里全部映射到宿主 `--dsw-alias-*`，深浅色跟随
 * 应用。卡片底色用「label-primary 的 4% 叠在 bg-layer-2 上」而不是半透明白，
 * 否则浅色主题下会发脏。
 *
 * 本模块只输出样式与一个 style 元素，不假设任何 DOM 结构。
 */
import { createElement, type ReactElement } from 'react'

/** Every rule the v3 pages share. Class names are global like the existing mc-*. */
const CSS = [
  /* ---------- container + tokens ---------- */
  '.v3-root{container:v3 / inline-size;'
    + '--v3-bg:var(--dsw-alias-bg-layer-2,Canvas);'
    + '--v3-panel:color-mix(in srgb,var(--dsw-alias-label-primary,CanvasText) 4%,var(--dsw-alias-bg-layer-2,Canvas));'
    + '--v3-panel-2:color-mix(in srgb,var(--dsw-alias-label-primary,CanvasText) 8%,var(--dsw-alias-bg-layer-2,Canvas));'
    + '--v3-line:color-mix(in srgb,var(--dsw-alias-label-primary,CanvasText) 10%,transparent);'
    + '--v3-line-2:color-mix(in srgb,var(--dsw-alias-label-primary,CanvasText) 17%,transparent);'
    + '--v3-t1:var(--dsw-alias-label-primary,CanvasText);'
    + '--v3-t2:var(--dsw-alias-label-secondary,var(--dsw-alias-label-primary,CanvasText));'
    + '--v3-t3:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary,CanvasText));'
    + '--v3-t4:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary,CanvasText));'
    + '--v3-ok:var(--dsw-alias-state-success-primary,#18894a);'
    + '--v3-bad:var(--dsw-alias-state-error-primary,#c92b2b);'
    + '--v3-warn:var(--dsw-alias-state-warn-primary,#a2730a);'
    + '--v3-info:var(--dsw-alias-link,var(--dsw-alias-brand-primary,#2066c4));'
    + '--v3-ok-dim:color-mix(in srgb,var(--v3-ok) 16%,transparent);'
    + '--v3-bad-dim:color-mix(in srgb,var(--v3-bad) 14%,transparent);'
    + '--v3-warn-dim:color-mix(in srgb,var(--v3-warn) 14%,transparent);'
    + '--v3-info-dim:color-mix(in srgb,var(--v3-info) 14%,transparent);'
    + '--v3-r-sm:var(--dsw-radius-sm,6px);--v3-r-md:var(--dsw-radius-md,9px);--v3-r-lg:var(--dsw-radius-lg,12px);'
    + '--v3-font-code:var(--dsw-font-markdown-code-font-family,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);'
    + 'color:var(--v3-t1);font-size:13px;line-height:20px}',

  /* ---------- status line + dots ---------- */
  '.v3-statusline{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--v3-t3);'
    + 'padding:5px 10px;border-radius:999px;background:var(--v3-panel);border:1px solid var(--v3-line);min-width:0}',
  '.v3-statusline b{color:var(--v3-t1);font-weight:600}',
  '.v3-statusline[data-tone=\'bad\']{background:var(--v3-bad-dim);border-color:color-mix(in srgb,var(--v3-bad) 30%,transparent)}',
  '.v3-dot{display:inline-block;width:7px;height:7px;border-radius:50%;flex:none;background:var(--v3-t4)}',
  '.v3-dot[data-tone=\'ok\']{background:var(--v3-ok);box-shadow:0 0 0 3px var(--v3-ok-dim)}',
  '.v3-dot[data-tone=\'bad\']{background:var(--v3-bad);box-shadow:0 0 0 3px var(--v3-bad-dim)}',
  '.v3-dot[data-tone=\'warn\']{background:var(--v3-warn);box-shadow:0 0 0 3px var(--v3-warn-dim)}',
  '.v3-dot[data-tone=\'run\']{width:8px;height:8px;background:transparent;border:1.5px solid var(--v3-t3);border-top-color:transparent;animation:v3-spin .9s linear infinite;box-shadow:none}',
  '@keyframes v3-spin{to{transform:rotate(360deg)}}',

  /* ---------- panel ---------- */
  '.v3-panel{background:var(--v3-panel);border:1px solid var(--v3-line);border-radius:var(--v3-r-lg);padding:13px 15px;min-width:0}',
  '.v3-pn{margin-left:auto;font-size:11px;color:var(--v3-t4);white-space:nowrap;text-transform:none;letter-spacing:0}',

  /* ---------- stat strip ---------- */
  '.v3-stat{background:var(--v3-panel);padding:13px 15px;min-width:0}',
  '.v3-stat-l{font-size:11px;color:var(--v3-t3);letter-spacing:.02em}',
  '.v3-stat-v{font-size:26px;line-height:34px;font-weight:650;letter-spacing:-.025em;margin-top:3px;font-variant-numeric:tabular-nums}',
  '.v3-stat-v small{font-size:12px;font-weight:400;color:var(--v3-t3);margin-left:4px;letter-spacing:0}',
  '.v3-stat-d{font-size:11px;color:var(--v3-t4);margin-top:2px;display:flex;align-items:center;gap:5px}',

  /* ---------- board + chart ---------- */
  '.v3-chart .v3-line{fill:none;stroke:var(--v3-info);stroke-width:1.8;stroke-linejoin:round;stroke-linecap:round}',

  /* ---------- donut + source list ---------- */
  '.v3-src .v3-nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',

  /* ---------- rank bars ---------- */
  '.v3-rank-row .v3-nm{font-family:var(--v3-font-code);font-size:11.5px;color:var(--v3-t2);width:158px;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',

  /* ---------- table ---------- */
  '.v3-table thead th.v3-r{text-align:right}',
  '.v3-table td.v3-r{text-align:right;font-variant-numeric:tabular-nums;color:var(--v3-t2)}',
  '.v3-c-tool .v3-nm{font-family:var(--v3-font-code);font-size:11.5px;overflow:hidden;text-overflow:ellipsis}',

  /* ---------- empty / banner ---------- */
  '.v3-banner{display:flex;align-items:flex-start;gap:10px;padding:11px 13px;border-radius:var(--v3-r-md);background:var(--v3-bad-dim);border:1px solid color-mix(in srgb,var(--v3-bad) 32%,transparent);font-size:12px;line-height:19px;color:var(--v3-t2)}',
  '.v3-banner b{display:block;font-size:12.5px;margin-bottom:2px;color:var(--v3-t1)}',
  '.v3-banner code{font-family:var(--v3-font-code);font-size:10.5px;padding:1px 5px;border-radius:3px;background:var(--v3-panel-2);color:var(--v3-t3);margin-left:5px}',

  /* ---------- guard grid ---------- */
  '.v3-gitem .v3-gnm{font-size:13px;font-weight:600}',
  '.v3-notebox{margin:0;padding:11px 13px;border-radius:var(--v3-r-md);background:var(--v3-panel);border:1px solid var(--v3-line);color:var(--v3-t3);font-size:11.5px;line-height:18px}',
  '.v3-notebox b{color:var(--v3-t2);font-weight:600}',

  /* ---------- switch (guard + catalog) ---------- */
  '.v3-sw{position:relative;width:34px;height:19px;border:0;border-radius:999px;padding:0;cursor:pointer;flex:none;background:color-mix(in srgb,var(--dsw-alias-label-primary,CanvasText) 16%,transparent);transition:background .16s}',
  '.v3-sw::after{content:\'\';position:absolute;top:2px;left:2px;width:15px;height:15px;border-radius:50%;background:var(--dsw-alias-switch-thumb,var(--v3-bg));transition:transform .16s}',
  '.v3-sw[aria-checked=\'true\']{background:var(--v3-ok)}',
  '.v3-sw[aria-checked=\'true\']::after{transform:translateX(15px)}',
  '.v3-sw:disabled{opacity:.55;cursor:default}',
  '.v3-sw:focus-visible{outline:2px solid var(--v3-info);outline-offset:2px}',

  /* ---------- catalog ---------- */
  '.v3-catgrid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}',
  '.v3-catstat{display:flex;background:var(--v3-panel);border:1px solid var(--v3-line);border-radius:var(--v3-r-lg);overflow:hidden;margin-bottom:12px}',
  '.v3-catstat>div{flex:1 1 0;padding:11px 14px;min-width:0}',
  '.v3-catstat>div+div{border-left:1px solid var(--v3-line)}',
  '.v3-catstat .v3-l{font-size:10.5px;color:var(--v3-t4);letter-spacing:.05em;text-transform:uppercase}',
  '.v3-catstat .v3-v{font-size:19px;font-weight:650;margin-top:2px;letter-spacing:-.02em;font-variant-numeric:tabular-nums}',
  '.v3-catstat .v3-v small{font-size:11px;font-weight:400;color:var(--v3-t3);margin-left:4px;letter-spacing:0}',
  '.v3-group{background:var(--v3-panel);border:1px solid var(--v3-line);border-radius:var(--v3-r-md);overflow:hidden;margin-bottom:10px;min-width:0}',
  '.v3-group:last-child{margin-bottom:0}',
  '.v3-group>summary{display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;list-style:none;min-height:36px;flex-wrap:wrap}',
  '.v3-group>summary::-webkit-details-marker{display:none}',
  '.v3-group>summary:hover{background:var(--v3-panel-2)}',
  '.v3-group[open]>summary{border-bottom:1px solid var(--v3-line)}',
  '.v3-group>summary .v3-chev{width:10px;height:10px;color:var(--v3-t4);flex:none;transition:transform .14s}',
  '.v3-group[open]>summary .v3-chev{transform:rotate(90deg)}',
  '.v3-group>summary .v3-gnm{font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
  '.v3-group>summary .v3-cnt{font-size:10.5px;color:var(--v3-t4);flex:none}',
  '.v3-group>summary .v3-right{margin-left:auto;display:flex;gap:4px;align-items:center;flex:none}',
  '.v3-trow{display:flex;align-items:center;gap:8px;padding:0 12px 0 29px;min-height:30px;border-top:1px solid var(--v3-line);font-size:12px;min-width:0}',
  '.v3-trow:first-of-type{border-top:0}',
  '.v3-trow:hover{background:var(--v3-panel-2)}',
  '.v3-trow .v3-nm{font-family:var(--v3-font-code);font-size:11.5px;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.v3-trow .v3-uses{flex:none;font-size:11px;color:var(--v3-t4);font-variant-numeric:tabular-nums;white-space:nowrap}',
  '.v3-tag{display:inline-flex;align-items:center;gap:4px;height:17px;padding:0 6px;border-radius:4px;font-size:10px;line-height:17px;white-space:nowrap;color:var(--v3-t3);background:var(--v3-panel-2)}',
  '.v3-tag[data-tone=\'info\']{color:var(--v3-info);background:var(--v3-info-dim)}',
  '.v3-tag[data-tone=\'warn\']{color:var(--v3-warn);background:var(--v3-warn-dim)}',
  '.v3-tag[data-tone=\'bad\']{color:var(--v3-bad);background:var(--v3-bad-dim)}',
  '.v3-hint{margin:0;font-size:11px;line-height:17px;color:var(--v3-t4)}',

  /* ---------- scope hint + scan progress ---------- */
  '@keyframes v3-indet{0%{left:-34%}100%{left:100%}}',

  /* ---------- container breakpoints (v3 own numbers, container-keyed) ---------- */
  '@container v3 (max-width:980px){.v3-board{grid-template-columns:minmax(0,1fr)}}',
  '@container v3 (max-width:900px){.v3-gpanel,.v3-catgrid{grid-template-columns:minmax(0,1fr)}}',
  '@container v3 (max-width:720px){.v3-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.v3-catstat{flex-wrap:wrap}.v3-catstat>div{flex:1 1 45%}.v3-catstat>div+div{border-left:0}}',
  '@container v3 (max-width:620px){.v3-rank-row .v3-nm{width:104px}}',
  '@media (prefers-reduced-motion:reduce){.v3-dot[data-tone=\'run\'],.v3-scan[data-running=\'true\'] .v3-fill{animation:none}}',
  /* 裸 `[hidden]` 会全局覆盖宿主的 display，收窄到 `.v3-root` 后代（A-4）。 */
  '.v3-root [hidden]{display:none !important}',
].join('')

/**
 * The one v3 stylesheet element; rendered by the shell, never by the pages.
 *
 * 0.3.6（A-3）把实例收敛到外壳 `thinking-throttle.tsx` 里唯一一处，三个子页只
 * 带 `v3-root` 容器类、不再各自渲染副本，所以全文档恰好一个
 * `style[data-v3-style]`。仍保持「React 元素」形态而不是模块级 head 注入（那是
 * 能力菜单 `mc-*` 的做法，两套生命周期不混用），这样无 hook 的视图保持纯函数，
 * 测试套件可以继续遍历返回的树。
 */
export function V3Styles(): ReactElement {
  return createElement('style', { 'data-v3-style': 'true' }, CSS)
}

/** Whether an element must be treated as the v3 container (add to the page root). */
export const V3_ROOT_CLASS = 'v3-root'

