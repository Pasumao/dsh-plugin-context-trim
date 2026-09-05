/**
 * dsh-plugin-context-trim — GateApplier（host 半边）
 *
 * 会话级遮蔽执行器：对被取消的条目在 agent 作用域层叠加同名影子条目压制
 * 全局原条目（影子 skill modelInvocable:false / tools.restrict deny / 空文本
 * section-context），不改注册表原条目；agent 销毁时 cordis effect 自动 unwind。
 *
 * cordis inject 白名单：agent.ctx 由 agent 工厂创建，服务属性受 inject 白名单
 * 保护（有 systemPrompt、无 skills/tools），直接 `agent.ctx.skills` 会抛
 * "cannot get property without inject"。三个通道统一走
 * `agent.ctx.inject([service], cb)` 子插件 fiber：注册落 agent 作用域层，
 * fiber dispose 即整代卸载；回调在依赖就绪后的微任务级异步执行（实践中先于
 * 首个 pre-step 完成，见 README 边界说明）。
 *
 * @module dsh-plugin-context-trim/applier
 */
import { RESERVED_TOOLS } from './attribution.js'
import { log, workspaceKeyOf } from './util.js'

export class GateApplier {
  constructor(ctx, store) {
    this.ctx = ctx
    this.store = store
    /** @type {Map<string, {generation:number, channels:object[], skills:Set<string>, tools:Set<string>, sections:Set<string>}>} */
    this.agentState = new Map()
    /** 影子 skill 完整定义缓存（name → SkillDefinition，含 content）。 */
    this.skillDefs = new Map()
    /** 正在回填定义的技能名（防重入）。 */
    this.backfilling = new Set()
    this.degraded = false
    this.lastSkippedUnknown = []
  }

  // ---- 技能定义预取（异步；结果供同步编排使用） ----

  /** 预取被门控技能的完整原定义（必须在注册影子**之前**经全局视图取，否则会取到影子自己）。 */
  async ensureSkillDefs(names, cwd) {
    const missing = [...new Set(names)].filter((n) => !this.skillDefs.has(n) && !this.backfilling.has(n))
    if (missing.length === 0) return
    for (const n of missing) this.backfilling.add(n)
    try {
      for (const n of missing) {
        try {
          const def = await this.ctx.skills.get(n, cwd !== undefined ? { cwd } : {})
          if (def !== undefined && def !== null && typeof def.content === 'string') {
            this.skillDefs.set(n, def)
          } else {
            log(`技能 "${n}" 全局视图取不到完整定义（可能已卸载），跳过影子注册`)
          }
        } catch (error) {
          log(`技能 "${n}" 取完整定义失败：`, error?.message ?? error)
        }
      }
    } finally {
      for (const n of missing) this.backfilling.delete(n)
    }
  }

  /** 启动时为持久化的全部被门控技能预取定义（resume 场景）。 */
  prewarm() {
    const names = new Set()
    for (const rec of this.store.sessions.values()) {
      for (const [key, value] of Object.entries(rec.selections)) {
        if (value === false && key.startsWith('skill:')) names.add(key.slice('skill:'.length))
      }
    }
    for (const rec of this.store.workspaceDefaults.values()) {
      for (const [key, value] of Object.entries(rec.selections)) {
        if (value === false && key.startsWith('skill:')) names.add(key.slice('skill:'.length))
      }
    }
    if (names.size > 0) {
      log(`预取 ${names.size} 个被门控技能的完整定义`)
      this.ensureSkillDefs(names).catch(() => {})
    }
  }

  // ---- 生效勾选解析 ----

  uncheckedKeys(selections) {
    const out = { skills: [], tools: [], sections: [], contexts: [], variables: [] }
    if (selections === null || selections === undefined) return out
    for (const [key, value] of Object.entries(selections)) {
      if (value !== false) continue
      const idx = key.indexOf(':')
      if (idx <= 0) continue
      const kind = key.slice(0, idx)
      const rest = key.slice(idx + 1)
      if (kind === 'skill') out.skills.push(rest)
      else if (kind === 'tool') out.tools.push(rest)
      else if (kind === 'section') out.sections.push(rest)
      else if (kind === 'context') out.contexts.push(rest)
      else if (kind === 'variable') out.variables.push(rest)
    }
    return out
  }

  // ---- 通道安装 ----

  /**
   * 在 agent 作用域层安装一个注册通道（子插件 fiber，dispose 即整代卸载）。
   * @param {object} agentCtx - agent.ctx。
   * @param {string[]} services - 通道服务名（['skills'] / ['tools'] / ['systemPrompt']）。
   * @param {object[]} channels - 当前代的 fiber 收集数组（dispose 用）。
   * @param {(sctx: object) => void} install - 注册体（在 fiber 上下文内执行）。
   */
  installChannel(agentCtx, services, channels, install) {
    if (agentCtx !== null && typeof agentCtx.inject === 'function') {
      try {
        const fiber = agentCtx.inject(services, (sctx) => install(sctx))
        channels.push(fiber)
        return
      } catch (error) {
        this.degraded = true
        log(`通道 ${services.join('+')} 安装失败：`, error?.message ?? error)
        return
      }
    }
    // 回退（fake ctx / 异常路径）：直接访问。
    install(agentCtx)
  }

  // ---- 核心应用 ----

  /**
   * 对一个 agent 应用会话门控。同步编排（缓存读取 / dispose 上一代 / 安装
   * 通道），注册体经 inject fiber 微任务落地。
   * @param {object} agent - 智能体实例（agent.ctx 为其作用域上下文）。
   * @param {string} cause - 触发原因（日志用）。
   * @returns {{ gated:boolean, applied:object, skippedUnknown:string[] }}
   */
  applyToAgent(agent, cause) {
    if (agent === null || agent === undefined || agent.ctx === undefined || agent.ctx === null || agent.session === undefined) {
      return { gated: false, applied: null, skippedUnknown: [] }
    }
    const sessionId = agent.session.id
    const workspaceKey = workspaceKeyOf(agent.session?.header?.cwd)
    const effective = this.store.effective(sessionId, workspaceKey)
    const state = this.stateOf(agent.id)

    if (effective === null) {
      this.disposeGeneration(state)
      return { gated: false, applied: null, skippedUnknown: [] }
    }

    // 幂等：先 dispose 上一代全部通道 fiber，再重建（skills.register 同层同名
    // first-wins，重复注册只拿到 no-op disposer，会让「恢复勾选」永久失效）。
    this.disposeGeneration(state)
    state.generation++
    const generation = state.generation
    const self = this

    const unchecked = this.uncheckedKeys(effective.selections)
    const applied = { skillsShadowed: [...unchecked.skills], toolsRestricted: [...unchecked.tools], sectionsShadowed: [...unchecked.sections], contextsShadowed: [...unchecked.contexts], source: effective.source, generation }
    const skippedUnknown = []

    // --- skills：同名影子注册（modelInvocable:false，保留 userInvocable）。
    // 缓存未命中的技能不装影子（缺 content 会被 validateDefinition 拒绝），
    // 异步回填后重放；resume 竞态窗口内首条目录可能泄漏该技能（降级，记日志）。
    const skillInstalls = []
    for (const skillName of unchecked.skills) {
      const def = this.skillDefs.get(skillName)
      if (def === undefined) {
        skippedUnknown.push(`skill:${skillName}`)
        applied.skillsShadowed = applied.skillsShadowed.filter((n) => n !== skillName)
        this.scheduleBackfill(skillName, agent.session?.header?.cwd)
        continue
      }
      skillInstalls.push(def)
    }
    if (skillInstalls.length > 0) {
      this.installChannel(agent.ctx, ['skills'], state.channels, (sctx) => {
        if (state.generation !== generation) return // 已被更新的代际取代
        for (const def of skillInstalls) {
          try {
            sctx.skills.register({
              name: def.name,
              description: def.description,
              ...(def.whenToUse !== undefined ? { whenToUse: def.whenToUse } : {}),
              ...(def.source !== undefined ? { source: def.source } : {}),
              ...(def.resourceBase !== undefined ? { resourceBase: def.resourceBase } : {}),
              ...(def.path !== undefined ? { path: def.path } : {}),
              ...(def.metadata !== undefined ? { metadata: def.metadata } : {}),
              ...(def.provider !== undefined ? { provider: def.provider } : {}),
              content: def.content,
              invocation: {
                modelInvocable: false,
                userInvocable: def.invocation?.userInvocable !== false
              }
            })
            state.skills.add(def.name)
          } catch (error) {
            self.degraded = true
            log(`影子注册技能 "${def.name}" 失败：`, error?.message ?? error)
          }
        }
      })
    }

    // --- tools：应用前名称白名单化，未知名跳过（MCP 异步注册/残留键/改名防护）。
    const knownTools = new Set()
    try {
      for (const schema of this.ctx.tools.schemas()) knownTools.add(schema.name)
    } catch (error) {
      log('枚举全局工具名失败：', error?.message ?? error)
    }
    const toolInstalls = []
    for (const toolName of unchecked.tools) {
      if (RESERVED_TOOLS.has(toolName)) {
        applied.toolsRestricted = applied.toolsRestricted.filter((n) => n !== toolName)
        continue
      }
      if (!knownTools.has(toolName)) {
        skippedUnknown.push(`tool:${toolName}`)
        applied.toolsRestricted = applied.toolsRestricted.filter((n) => n !== toolName)
        continue
      }
      toolInstalls.push(toolName)
    }
    if (toolInstalls.length > 0) {
      this.installChannel(agent.ctx, ['tools'], state.channels, (sctx) => {
        if (state.generation !== generation) return
        for (const toolName of toolInstalls) {
          try {
            sctx.tools.restrict({ deny: [toolName] })
            state.tools.add(toolName)
          } catch (error) {
            self.degraded = true
            log(`restrict 工具 "${toolName}" 失败：`, error?.message ?? error)
          }
        }
      })
    }

    // --- sections / contexts：同名空文本影子（空 section 渲染层丢弃）。
    // variables 特例：置 undefined 会让引用它的 section 渲染失败 → 默认锁定不处理。
    const promptInstalls = []
    for (const sectionName of unchecked.sections) promptInstalls.push({ kind: 'section', name: sectionName })
    for (const contextName of unchecked.contexts) promptInstalls.push({ kind: 'context', name: contextName })
    if (promptInstalls.length > 0) {
      this.installChannel(agent.ctx, ['systemPrompt'], state.channels, (sctx) => {
        if (state.generation !== generation) return
        for (const item of promptInstalls) {
          try {
            if (item.kind === 'section') sctx.systemPrompt.section({ name: item.name, order: 0, text: '' })
            else sctx.systemPrompt.context({ name: item.name, order: 0, text: '' })
            state.sections.add(`${item.kind}:${item.name}`)
          } catch (error) {
            self.degraded = true
            log(`影子 ${item.kind} "${item.name}" 失败：`, error?.message ?? error)
          }
        }
      })
    }

    this.lastSkippedUnknown = skippedUnknown
    const gated = applied.skillsShadowed.length + applied.toolsRestricted.length + applied.sectionsShadowed.length + applied.contextsShadowed.length > 0
    this.store.setApplied(sessionId, gated || skippedUnknown.length > 0 ? { ...applied, skippedUnknown, at: new Date().toISOString(), cause } : null)
    if (gated || skippedUnknown.length > 0) {
      log(`已应用会话门控（${cause}）：skills=${applied.skillsShadowed.length} tools=${applied.toolsRestricted.length} sections=${applied.sectionsShadowed.length} contexts=${applied.contextsShadowed.length}${skippedUnknown.length > 0 ? ` 跳过=${skippedUnknown.length}` : ''}`)
    }
    return { gated, applied, skippedUnknown }
  }

  stateOf(agentId) {
    let state = this.agentState.get(agentId)
    if (state === undefined) {
      state = { generation: 0, channels: [], skills: new Set(), tools: new Set(), sections: new Set() }
      this.agentState.set(agentId, state)
    }
    return state
  }

  disposeGeneration(state) {
    for (const fiber of state.channels) {
      try {
        if (fiber !== null && typeof fiber?.dispose === 'function') fiber.dispose()
      } catch { /* unwind 失败不阻塞其余清理 */ }
    }
    state.channels = []
    state.skills.clear()
    state.tools.clear()
    state.sections.clear()
  }

  /** 缓存未命中的技能：回填定义后重放应用（resume 竞态降级路径）。 */
  scheduleBackfill(skillName, cwd) {
    if (this.backfilling.has(skillName)) return
    this.ensureSkillDefs([skillName], cwd)
      .then(() => {
        if (!this.skillDefs.has(skillName)) return
        // 重放：对仍存活的所有 agent 重放应用（只影响该技能所在会话）。
        try {
          const agents = this.ctx.agents?.list?.() ?? []
          for (const agent of agents) this.applyToAgent(agent, 'backfill-replay')
        } catch (error) {
          log('回填重放失败：', error?.message ?? error)
        }
      })
      .catch(() => {})
  }

  /** 插件卸载：清掉所有代际簿记（agent 自身 scope 的 effect 由 cordis unwind）。 */
  disposeAll() {
    for (const state of this.agentState.values()) this.disposeGeneration(state)
    this.agentState.clear()
    this.skillDefs.clear()
  }
}
