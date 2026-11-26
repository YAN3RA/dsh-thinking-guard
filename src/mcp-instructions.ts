import type { PromptPresentation } from '@deepseek-ai/dsh-system-prompt'
import { serverNameOf } from './registry.ts'

const RESOURCE_TOOLS = new Set([
  'list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource',
])

/**
 * DSH's MCP client publishes literal instructions as `mcp:<server>` sections,
 * independently of tool schemas. Alpha.2 also publishes an independent
 * `mcp:<server>:tools` catalog for its native `load_tools` entry.
 * Use the caller's registered tool view BEFORE Resident-only admission: an
 * On-demand tool still needs its server's instructions. Empty/unknown servers
 * are not evidence of an explicit Disabled decision.
 */
export function projectMcpInstructions<T extends PromptPresentation>(
  assembly: T,
  tools: readonly { readonly name: string }[],
  isDisabled: (name: string) => boolean,
): T {
  if (!assembly.sections.some(section => section.name.startsWith('mcp:'))) return assembly

  // DSH exposes resources through shared tools, not mcp__server__tool names.
  // Its public resource API does not identify which server needs instructions.
  // Preserve them conservatively while resource access is still enabled in
  // this scope; never parse or rewrite server-provided prose to infer ownership.
  const preserveInstructions = assembly.sections.some(section => section.name === 'mcp-resource-servers' && section.text.length > 0)
    && tools.some(tool => RESOURCE_TOOLS.has(tool.name) && !isDisabled(tool.name))

  const disabledServers = new Map<string, boolean>()
  const disabledMcpTools = new Set<string>()
  for (const tool of tools) {
    if (!tool.name.startsWith('mcp__')) continue
    const server = serverNameOf(tool.name)
    const disabled = isDisabled(tool.name)
    disabledServers.set(server, (disabledServers.get(server) ?? true) && disabled)
    if (disabled) disabledMcpTools.add(tool.name)
  }
  // Incremental hosts leave an omitted source active; a same-name empty
  // contribution withdraws it. Older hosts omit empty text when rendering.
  const sections = assembly.sections.map(section => {
    if (!section.name.startsWith('mcp:') || section.text === '') return section
    // Match Alpha.2's exact loader name from the section, without splitting
    // the server name on '__'. The resource exception applies to instructions
    // only, and a disabled member alone does not make the loader unusable.
    const source = section.name.slice('mcp:'.length)
    const suffix = ':tools'
    const withdraw = source.endsWith(suffix)
      ? disabledMcpTools.has(`mcp__${source.slice(0, -suffix.length)}__load_tools`)
      : !preserveInstructions && disabledServers.get(source) === true
    return withdraw ? { ...section, text: '', interpolate: false } : section
  })
  return sections.every((section, index) => section === assembly.sections[index])
    ? assembly : { ...assembly, sections }
}
