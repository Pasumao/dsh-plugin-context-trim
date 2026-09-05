/**
 * dsh-plugin-context-trim — GateCatalog（host 半边）
 *
 * 树表数据枚举与归属：
 *   - skills：ctx.skills.snapshot()（全局视图；summary 不含 content，仅供目录展示）
 *   - tools：ctx.tools.schemas()（全局视图；核心 preset 工具不在此面，天然不可门控）
 *   - sections/contexts/variables：全局 system-prompt/assemble waterfall 被动观测
 *     缓存（裸 assemble() 不能做常规枚举：会求值全部 provider、可能抛错、complete
 *     段失真；仅作冷启动回退且 try/catch）
 *
 * @module dsh-plugin-context-trim/catalog
 */
import { ATTRIBUTABLE_SECTION_PREFIX, CRITICAL_GROUPS, PLUGIN_SKILLS, PLUGIN_TOOLS, RESERVED_TOOLS } from './attribution.js'
import { log } from './util.js'

export class GateCatalog {
  constructor(ctx, store) {
    this.ctx = ctx
    this.store = store
    /** 被动观测缓存：真实组装出现的 sections / contexts / variables 名称（内存即可，重启重建）。 */
    this.observed = { sections: new Map(), contexts: new Map(), variables: new Set() }
    this.observedOnce = false
  }

  /** 全局 system-prompt/assemble waterfall 被动观测（零干扰：观测后原样放行）。 */
  startObserving() {
    this.ctx.on('system-prompt/assemble', (assembly, _context, next) => {
      try {
        if (assembly !== null && typeof assembly === 'object') {
          for (const s of Array.isArray(assembly.sections) ? assembly.sections : []) {
            if (s && typeof s.name === 'string') this.observed.sections.set(s.name, true)
          }
          for (const c of Array.isArray(assembly.contexts) ? assembly.contexts : []) {
            if (c && typeof c.name === 'string') this.observed.contexts.set(c.name, true)
          }
          for (const v of Object.keys(assembly.variables ?? {})) this.observed.variables.add(v)
          this.observedOnce = true
        }
      } catch { /* 观测失败不影响组装 */ }
      return next()
    })
  }

  /**
   * 冷启动回退：裸 assemble()（try/catch，可能抛错/失真，仅首次取目录且观测
   * 缓存为空时用一次，UI 标注「枚举可能不完整」）。
   */
  async coldFallback() {
    if (this.observedOnce) return false
    try {
      const assembly = await this.ctx.systemPrompt.assemble()
      for (const s of Array.isArray(assembly?.sections) ? assembly.sections : []) {
        if (s && typeof s.name === 'string') this.observed.sections.set(s.name, true)
      }
      for (const c of Array.isArray(assembly?.contexts) ? assembly.contexts : []) {
        if (c && typeof c.name === 'string') this.observed.contexts.set(c.name, true)
      }
      for (const v of Object.keys(assembly?.variables ?? {})) this.observed.variables.add(v)
      return true
    } catch (error) {
      log('冷启动裸 assemble 失败（段落枚举可能不完整）：', error?.message ?? error)
      return false
    }
  }

  /** 技能归属：优先 provider 字段（KB provider 补丁后精确），回退已知技能名表。 */
  skillGroupOf(summary) {
    const provider = typeof summary.provider === 'string' ? summary.provider : ''
    if (provider.startsWith('dsh-plugin-')) return provider
    for (const [pluginId, names] of Object.entries(PLUGIN_SKILLS)) {
      if (names.includes(summary.name)) return pluginId
    }
    if (provider !== '' && provider !== 'runtime') return provider
    const source = typeof summary.source === 'string' ? summary.source : 'runtime'
    if (source.startsWith('project-')) return 'project-skills'
    if (source.startsWith('user-')) return 'user-skills'
    if (source === 'bundled') return 'bundled-skills'
    return 'runtime-skills'
  }

  /** 工具归属：关键组 → 已知插件 → MCP 前缀 → 内置/其他。 */
  toolClassOf(toolName) {
    for (const group of CRITICAL_GROUPS) {
      if (group.test(toolName)) return { kind: 'critical', groupId: group.id, label: group.label }
    }
    if (RESERVED_TOOLS.has(toolName)) return { kind: 'reserved', groupId: 'reserved', label: '保留' }
    for (const [pluginId, names] of Object.entries(PLUGIN_TOOLS)) {
      if (names.includes(toolName)) return { kind: 'plugin', groupId: pluginId, label: pluginId }
    }
    // MCP 工具经 dsh-mcp-client 注册为 mcp__<serverName>__<rawName>（publicToolName）。
    const mcpMatch = /^mcp__(.+?)__/.exec(toolName)
    if (mcpMatch !== null) return { kind: 'mcp', groupId: `mcp:${mcpMatch[1]}`, label: `MCP: ${mcpMatch[1]}` }
    return { kind: 'builtin', groupId: 'builtin-tools', label: '内置工具' }
  }

  sectionAttributable(sectionName) {
    return typeof sectionName === 'string' && sectionName.startsWith(ATTRIBUTABLE_SECTION_PREFIX)
  }

  /** 段落归属：无法归属到插件的段落一律锁定（防误伤核心提示词）。 */
  sectionGroupOf(sectionName) {
    if (!this.sectionAttributable(sectionName)) return { groupId: 'core-sections', label: '核心段落（锁定）', gatable: false }
    const pluginId = ATTRIBUTABLE_SECTION_PREFIX + sectionName.slice(ATTRIBUTABLE_SECTION_PREFIX.length).split(/[:_]/, 1)[0]
    return { groupId: pluginId, label: pluginId, gatable: true }
  }

  async skillsSnapshot(cwd) {
    try {
      const snapshot = await this.ctx.skills.snapshot(cwd !== undefined ? { cwd } : {})
      return { skills: snapshot?.skills ?? [], complete: snapshot?.complete !== false }
    } catch (error) {
      log('技能快照失败：', error?.message ?? error)
      return { skills: [], complete: false }
    }
  }
}
