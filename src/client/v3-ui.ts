/**
 * v3 设计层（D-044）——设置页四个子页面共用的 token、容器脚手架与块级词汇表。
 *
 * WHY A SHARED MODULE: v3 的视觉识别来自一套统一的 token 与块（panel / stats /
 * board / rank / table / gitem / catstat）。四个页面各写一份必然漂移，所以跨页面
 * 复用的部分集中在这里；页面专属样式仍留在各自文件里（call-index.tsx 的
 * `CallIndexStyles()`、CapabilitySection.tsx 的 mc-* 样式块）。
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
  '.v3-num{font-variant-numeric:tabular-nums}',
  '.v3-mono{font-family:var(--v3-font-code)}',

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
  '.v3-ph{display:flex;align-items:center;gap:8px;margin-bottom:11px;min-height:18px;flex-wrap:wrap}',
  '.v3-pt{margin:0;font-size:11px;font-weight:600;color:var(--v3-t3);letter-spacing:.07em;text-transform:uppercase}',
  '.v3-pn{margin-left:auto;font-size:11px;color:var(--v3-t4);white-space:nowrap;text-transform:none;letter-spacing:0}',

  /* ---------- stat strip ---------- */
  '.v3-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:var(--v3-line);border:1px solid var(--v3-line);border-radius:var(--v3-r-lg);overflow:hidden}',
  '.v3-stat{background:var(--v3-panel);padding:13px 15px;min-width:0}',
  '.v3-stat-l{font-size:11px;color:var(--v3-t3);letter-spacing:.02em}',
  '.v3-stat-v{font-size:26px;line-height:34px;font-weight:650;letter-spacing:-.025em;margin-top:3px;font-variant-numeric:tabular-nums}',
  '.v3-stat-v small{font-size:12px;font-weight:400;color:var(--v3-t3);margin-left:4px;letter-spacing:0}',
  '.v3-stat-d{font-size:11px;color:var(--v3-t4);margin-top:2px;display:flex;align-items:center;gap:5px}',
  '.v3-spark{margin-top:8px;display:block;width:100%;height:22px;overflow:visible}',
  '.v3-spark .v3-spark-ln{fill:none;stroke-width:1.4;stroke-linejoin:round;stroke-linecap:round}',
  '.v3-spark .v3-spark-fl{opacity:.14}',

  /* ---------- board + chart ---------- */
  '.v3-board{display:grid;grid-template-columns:minmax(0,2.15fr) minmax(0,1fr);gap:12px;align-items:stretch}',
  '.v3-chartbox{position:relative;min-width:0}',
  '.v3-chart{display:block;width:100%;height:212px;overflow:visible}',
  '.v3-chart .v3-grid{stroke:var(--v3-line);stroke-width:1}',
  '.v3-chart .v3-axis{fill:var(--v3-t4);font-size:9.5px}',
  '.v3-chart .v3-area{fill:var(--v3-info);opacity:.13}',
  '.v3-chart .v3-line{fill:none;stroke:var(--v3-info);stroke-width:1.8;stroke-linejoin:round;stroke-linecap:round}',
  '.v3-chart .v3-pt{fill:var(--v3-panel);stroke:var(--v3-info);stroke-width:1.6}',
  '.v3-chart .v3-bar-er{fill:var(--v3-bad);opacity:.85}',
  '.v3-chart .v3-hlbox{fill:var(--v3-info-dim);stroke:var(--v3-info);stroke-width:1;stroke-dasharray:3 3}',
  '.v3-chart .v3-lbl{fill:var(--v3-t2);font-size:10px}',
  '.v3-chart .v3-lbl-b{fill:var(--v3-t1);font-size:10.5px;font-weight:600}',
  '.v3-legend{display:flex;gap:16px;margin-top:8px;font-size:11px;color:var(--v3-t4);flex-wrap:wrap}',
  '.v3-legend span{display:inline-flex;align-items:center;gap:6px}',
  '.v3-legend i{width:14px;height:2px;border-radius:1px;flex:none;background:var(--v3-info)}',
  '.v3-legend i[data-mark=\'square\']{width:8px;height:8px;border-radius:2px;background:var(--v3-bad)}',

  /* ---------- donut + source list ---------- */
  '.v3-donut-wrap{display:flex;align-items:center;gap:14px;flex-wrap:wrap}',
  '.v3-donut{flex:none;width:104px;height:104px;position:relative}',
  '.v3-donut svg{width:104px;height:104px;transform:rotate(-90deg)}',
  '.v3-donut .v3-trk{fill:none;stroke:var(--v3-panel-2);stroke-width:9}',
  '.v3-donut .v3-seg{fill:none;stroke:var(--v3-t4);stroke-width:9}',
  '.v3-donut .v3-mid{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;pointer-events:none}',
  '.v3-donut .v3-mid b{font-size:17px;font-weight:650;letter-spacing:-.02em;line-height:20px}',
  '.v3-donut .v3-mid span{font-size:9.5px;color:var(--v3-t4);line-height:12px;letter-spacing:.04em}',
  '.v3-src-list{flex:1 1 180px;min-width:0;display:flex;flex-direction:column;gap:5px}',
  '.v3-src{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--v3-t2);min-width:0}',
  '.v3-src i{width:7px;height:7px;border-radius:2px;flex:none;background:var(--v3-t4);opacity:.5}',
  '.v3-src .v3-nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.v3-src b{margin-left:auto;color:var(--v3-t1);font-weight:600;font-variant-numeric:tabular-nums}',
  '.v3-src em{font-style:normal;color:var(--v3-t4);min-width:44px;text-align:right;font-variant-numeric:tabular-nums;font-size:11px}',
  '.v3-src-note{margin:9px 0 0;padding-top:9px;border-top:1px solid var(--v3-line);font-size:11px;line-height:17px;color:var(--v3-t4)}',

  /* ---------- rank bars ---------- */
  '.v3-rank{display:flex;flex-direction:column;gap:1px;margin-top:-2px}',
  '.v3-rank-row{display:flex;align-items:center;gap:9px;min-height:27px;font-size:12px;padding:0 2px;border-radius:4px}',
  '.v3-rank-row:hover{background:var(--v3-panel-2)}',
  '.v3-rank-row .v3-nm{font-family:var(--v3-font-code);font-size:11.5px;color:var(--v3-t2);width:158px;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.v3-rank-row .v3-bar{flex:1 1 auto;min-width:30px;height:6px;background:var(--v3-panel-2);border-radius:3px;position:relative;overflow:hidden}',
  '.v3-rank-row .v3-bar span{position:absolute;left:0;top:0;bottom:0;min-width:3px;background:var(--v3-info);opacity:.65;border-radius:3px}',
  '.v3-rank-row .v3-bar span[data-bad=\'true\']{background:var(--v3-bad);opacity:.85}',
  '.v3-rank-row .v3-n{width:52px;flex:none;text-align:right;font-variant-numeric:tabular-nums;color:var(--v3-t2);white-space:nowrap}',
  '.v3-rank-row .v3-e{flex:none;text-align:right;font-variant-numeric:tabular-nums;font-size:11px;color:var(--v3-t4);white-space:nowrap}',
  '.v3-rank-row .v3-e[data-bad=\'true\']{color:var(--v3-bad);font-weight:600}',

  /* ---------- table ---------- */
  '.v3-ts{max-height:min(60vh,560px);overflow:auto;overscroll-behavior:contain;border-top:1px solid var(--v3-line)}',
  '.v3-table{width:100%;border-collapse:separate;border-spacing:0;font-size:12.5px}',
  '.v3-table thead th{position:sticky;top:0;z-index:2;background:var(--v3-panel);color:var(--v3-t4);font-weight:500;font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;text-align:left;padding:0 11px;height:29px;white-space:nowrap;border-bottom:1px solid var(--v3-line)}',
  '.v3-table thead th.v3-r{text-align:right}',
  '.v3-table tbody td{padding:0 11px;height:32px;border-bottom:1px solid var(--v3-line);vertical-align:middle;white-space:nowrap}',
  '.v3-table tbody tr:last-child td{border-bottom:0}',
  '.v3-table tbody tr:hover td{background:var(--v3-panel-2)}',
  '.v3-table td.v3-r{text-align:right;font-variant-numeric:tabular-nums;color:var(--v3-t2)}',
  '.v3-c-tool{display:flex;align-items:center;gap:7px;min-width:0}',
  '.v3-c-tool .v3-nm{font-family:var(--v3-font-code);font-size:11.5px;overflow:hidden;text-overflow:ellipsis}',
  '.v3-c-tool .v3-srv{font-size:10.5px;color:var(--v3-t4)}',
  '.v3-srcnote{flex:none;font-size:9px;line-height:13px;height:13px;padding:0 4px;border-radius:3px;color:var(--v3-t4);background:var(--v3-panel-2)}',
  '.v3-rt{display:inline-flex;align-items:center;gap:7px;justify-content:flex-end}',
  '.v3-rt .v3-tk{width:34px;height:3px;border-radius:2px;background:var(--v3-panel-2);overflow:hidden;flex:none}',
  '.v3-rt .v3-fl{display:block;height:100%;background:var(--v3-ok);border-radius:2px}',
  '.v3-rt .v3-fl[data-bad=\'true\']{background:var(--v3-bad)}',
  '.v3-rt b{font-weight:500;min-width:40px;text-align:right;font-variant-numeric:tabular-nums}',
  '.v3-tfoot{display:flex;align-items:center;gap:9px;padding:9px 15px;border-top:1px solid var(--v3-line);color:var(--v3-t4);font-size:11px;flex-wrap:wrap}',

  /* ---------- empty / banner ---------- */
  '.v3-empty{background:var(--v3-panel);border:1px solid var(--v3-line);border-radius:var(--v3-r-lg);padding:34px 24px;text-align:center}',
  '.v3-empty h3{margin:0 0 5px;font-size:14px;font-weight:600;color:var(--v3-t1)}',
  '.v3-empty p{margin:0 auto;max-width:56ch;font-size:12.5px;line-height:20px;color:var(--v3-t3)}',
  '.v3-banner{display:flex;align-items:flex-start;gap:10px;padding:11px 13px;border-radius:var(--v3-r-md);background:var(--v3-bad-dim);border:1px solid color-mix(in srgb,var(--v3-bad) 32%,transparent);font-size:12px;line-height:19px;color:var(--v3-t2)}',
  '.v3-banner b{display:block;font-size:12.5px;margin-bottom:2px;color:var(--v3-t1)}',
  '.v3-banner code{font-family:var(--v3-font-code);font-size:10.5px;padding:1px 5px;border-radius:3px;background:var(--v3-panel-2);color:var(--v3-t3);margin-left:5px}',
  '.v3-faultcard{background:var(--v3-panel);border:1px solid var(--v3-line);border-left:3px solid var(--v3-bad);border-radius:var(--v3-r-md);overflow:hidden}',
  '.v3-faultcard .v3-fh{display:flex;align-items:center;gap:8px;padding:9px 13px}',
  '.v3-faultcard .v3-fh b{font-size:12.5px;font-weight:600}',
  '.v3-faultcard .v3-fh code{font-family:var(--v3-font-code);font-size:10.5px;padding:1px 5px;border-radius:3px;background:var(--v3-panel-2);color:var(--v3-t3)}',
  '.v3-faultcard p{margin:0;padding:0 13px 9px;font-size:11.5px;line-height:18px;color:var(--v3-t3)}',

  /* ---------- guard grid ---------- */
  '.v3-gpanel{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}',
  '.v3-gitem{background:var(--v3-panel);border:1px solid var(--v3-line);border-radius:var(--v3-r-lg);padding:13px 15px;min-width:0}',
  '.v3-gitem .v3-gh{display:flex;align-items:center;gap:8px;margin-bottom:7px;flex-wrap:wrap}',
  '.v3-gitem .v3-gnm{font-size:13px;font-weight:600}',
  '.v3-gitem .v3-gid{font-family:var(--v3-font-code);font-size:10.5px;color:var(--v3-t4)}',
  '.v3-gitem p{margin:0;font-size:11.5px;line-height:18px;color:var(--v3-t3)}',
  '.v3-gitem .v3-gfoot{display:flex;align-items:center;gap:6px;margin-top:9px;font-size:10.5px;color:var(--v3-t4);padding-top:9px;border-top:1px solid var(--v3-line);flex-wrap:wrap}',
  '.v3-kbd{font-family:var(--v3-font-code);font-size:10.5px;padding:1px 5px;border-radius:3px;background:var(--v3-panel-2);color:var(--v3-t2);border:1px solid var(--v3-line)}',
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
  '.v3-scopehint{display:flex;align-items:center;gap:7px;margin-top:9px;padding:6px 10px;border-radius:var(--v3-r-sm);background:var(--v3-panel-2);font-size:11.5px;line-height:17px;color:var(--v3-t3);flex-wrap:wrap}',
  '.v3-scopehint .v3-id{font-family:var(--v3-font-code);font-size:11px;color:var(--v3-t2);padding:1px 5px;border-radius:3px;background:var(--v3-panel);border:1px solid var(--v3-line)}',
  '.v3-scopehint[data-tone=\'warn\']{background:var(--v3-warn-dim);color:var(--v3-t2)}',
  '.v3-scan{display:flex;align-items:center;gap:10px;margin-top:9px;font-size:11.5px;color:var(--v3-t3)}',
  '.v3-scan .v3-track{position:relative;flex:1 1 auto;height:5px;border-radius:3px;background:var(--v3-panel-2);overflow:hidden;min-width:70px}',
  '.v3-scan .v3-fill{position:absolute;inset:0 auto 0 0;background:var(--v3-info);border-radius:3px;transition:width .3s ease}',
  '.v3-scan[data-running=\'true\'] .v3-fill{width:34% !important;animation:v3-indet 1.25s ease-in-out infinite}',
  '@keyframes v3-indet{0%{left:-34%}100%{left:100%}}',
  '.v3-scan .v3-pct{font-variant-numeric:tabular-nums;color:var(--v3-t2);font-weight:600;min-width:38px;text-align:right}',

  /* ---------- container breakpoints (v3 own numbers, container-keyed) ---------- */
  '@container v3 (max-width:980px){.v3-board{grid-template-columns:minmax(0,1fr)}}',
  '@container v3 (max-width:900px){.v3-gpanel,.v3-catgrid{grid-template-columns:minmax(0,1fr)}}',
  '@container v3 (max-width:720px){.v3-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.v3-catstat{flex-wrap:wrap}.v3-catstat>div{flex:1 1 45%}.v3-catstat>div+div{border-left:0}}',
  '@container v3 (max-width:620px){.v3-rank-row .v3-nm{width:104px}}',
  '@media (prefers-reduced-motion:reduce){.v3-dot[data-tone=\'run\'],.v3-scan[data-running=\'true\'] .v3-fill{animation:none}}',
  '[hidden]{display:none !important}',
].join('')

/**
 * Mount the shared v3 stylesheet once per document.
 *
 * React does not dedupe <style> elements across the four pages, and all four
 * render their own root, so the element carries a marker attribute and an
 * identical copy in the DOM is harmless. Kept as an element (not a singleton
 * side effect at import time) so the hook-free views stay pure and the test
 * suite can still walk the tree.
 */
export function V3Styles(): ReactElement {
  return createElement('style', { 'data-v3-style': 'true' }, CSS)
}

/** Whether an element must be treated as the v3 container (add to the page root). */
export const V3_ROOT_CLASS = 'v3-root'

