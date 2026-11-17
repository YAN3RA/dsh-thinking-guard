/**
 * 能力菜单 v3 的样式入口。
 *
 * WHY A RE-EXPORT: v3 的 token 与块级词汇（panel / catstat / group / tag）
 * 由 `../v3-ui.ts` 统一定义，执行保护页用的是同一份。这里只做再导出，让本
 * 页面所有 import 都落在 `capability-v3/` 内（迁移边界一眼可见），同时保证
 * 两页不会各写一份同名 token 而漂移。页面专属样式仍留在 `section.tsx` 的
 * `mc-*` / `.v3-root .v3-*` 块里，与 0.1.27 一致。
 */
export { V3Styles, V3_ROOT_CLASS } from '../v3-ui.ts'
