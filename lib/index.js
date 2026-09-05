/**
 * dsh-plugin-context-trim — 会话注入门控插件（host 入口）
 *
 * 每个会话可单独选择注入哪些插件贡献的 skill / tool / 系统提示词段落。
 * 核心思想：不改注册表里的任何条目，只在 agent 自己的作用域层叠加同名
 * 「影子条目」压制全局条目（机制细节见 lib/applier.js 头注释）。
 *
 * 模块布局：
 *   lib/attribution.js  归属表（插件 → 工具/技能名清单、关键组、保留名）
 *   lib/util.js         通用工具（dshHome / workspaceKey / 日志 / selections 清洗）
 *   lib/store.js        GateStore：内存缓存 + JSON 持久化 + revision 乐观锁
 *   lib/applier.js      GateApplier：会话级遮蔽执行器（inject fiber 通道）
 *   lib/catalog.js      GateCatalog：树表枚举与归属（被动观测段落）
 *   lib/index.js        本文件：插件入口 + HTTP 路由 + 会话开始判定
 *
 * client 半边（lib/client.js）受 dsh 浏览器模块加载器约束必须保持单文件
 * （每个插件只服务一个 client.js 资源），以分节注释组织。
 *
 * 零运行时依赖：不 import 任何 @deepseek-ai/* 包。
 *
 * @module dsh-plugin-context-trim
 */
import { join } from 'node:path'
import { GateApplier } from './applier.js'
import { GateCatalog } from './catalog.js'
import { GateStore } from './store.js'
import { countFalse, dshHome, log, sanitizeSelections, workspaceKeyOf } from './util.js'

export const name = 'dsh-plugin-context-trim'
/** 需要的宿主端服务：agents（agent/created + 活 agent 查表）、skills、tools、systemPrompt（枚举与 scoped 注册）、sessionQuery（判会话已开始）、webServer（路由）。 */
export const inject = ['agents', 'skills', 'tools', 'systemPrompt', 'sessionQuery', 'webServer']

/** HTTP 路由前缀。 */
export const ROUTE_PREFIX = '/dsh-plugin-context-trim'
/** 持久化文件（$DSH_HOME 下，UTF-8 无 BOM，原子写入）。 */
export const STORE_FILE = 'dsh-plugin-context-trim.json'

export function apply(ctx) {
  const store = new GateStore(join(dshHome(), STORE_FILE))
  const applier = new GateApplier(ctx, store)
  const catalog = new GateCatalog(ctx, store)

  // 被动观测提示词段落（全局 waterfall；零干扰：观测后原样放行）。
  ctx.effect(() => catalog.startObserving(), 'dsh-plugin-context-trim: assemble observer')

  // agent/created 接线：编排纯同步、零 await（计划书 §4.2——派发循环不 await
  // 监听器，慢应用会让首条 <available_skills> 目录带着应被门控的技能发出且
  // 不可回收）。注册体经 inject fiber 微任务落地，见 applier.js 说明。
  ctx.on('agent/created', (payload) => {
    try {
      applier.applyToAgent(payload?.agent, 'agent-created')
    } catch (error) {
      log('agent/created 应用失败：', error?.message ?? error)
    }
  })

  // 会话已开始判定：**只认持久化事实**——该 session 已落盘 ≥1 个 step 事件。
  // 不用「存在活 agent」作信号：dsh 会为新会话预创建 agent（hero 空会话也有
  // agent），用活 agent 判定会把所有新会话误判成已开始（对计划书 §4.1
  // 「或 agent 正在运行」的现实修正）。listEvents 异步，只进 HTTP 状态查询，
  // 不进 agent/created 同步路径；肯定结果 sticky，否定结果短节流防高频重读。
  const stepStartCache = new Map()
  const STEP_NEGATIVE_TTL_MS = 4000
  async function isSessionStarted(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return false
    if (store.startedSet.has(sessionId)) return true
    const lastNegative = stepStartCache.get(sessionId)
    if (lastNegative !== undefined && Date.now() - lastNegative < STEP_NEGATIVE_TTL_MS) return false
    try {
      const events = await ctx.sessionQuery.listEvents(sessionId)
      const started = Array.isArray(events) && events.some((e) => e?.type === 'step/start' || e?.type === 'step/end')
      if (started) store.markStarted(sessionId)
      else stepStartCache.set(sessionId, Date.now())
      return started
    } catch {
      return false
    }
  }

  // ---------- HTTP 路由 ----------
  const json = (res, status, body) => {
    const text = JSON.stringify(body)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(text)
  }
  const readBody = async (req) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    if (chunks.length === 0) return {}
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      return null
    }
  }
  const loopbackOnly = (req) => {
    const addr = req.socket?.remoteAddress ?? ''
    return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1' || addr === ''
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (req, res) => {
      try {
        if (!loopbackOnly(req)) {
          json(res, 403, { error: 'loopback-only' })
          return
        }
        const method = (req.method ?? 'GET').toUpperCase()
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const path = url.pathname.slice(ROUTE_PREFIX.length).replace(/^\/+/, '')
        const sessionId = url.searchParams.get('sessionId') ?? ''
        const cwdParam = url.searchParams.get('cwd') ?? undefined
        const workspaceKey = cwdParam !== undefined ? workspaceKeyOf(cwdParam) : ''

        // ---- GET /catalog?sessionId=&cwd= ----
        if (path === 'catalog' && method === 'GET') {
          const cold = await catalog.coldFallback()
          const { skills, complete } = await catalog.skillsSnapshot(cwdParam)
          const workspaceKeyEff = workspaceKey !== '' ? workspaceKey : (sessionId !== '' ? workspaceKeyOf(cwdParam) : '')
          const effective = sessionId !== ''
            ? store.effective(sessionId, workspaceKeyEff)
            : (workspaceKeyEff !== '' ? store.effective('', workspaceKeyEff) : null)

          const toolSchemas = ctx.tools.schemas()
          const toolRows = toolSchemas.map((schema) => {
            const cls = catalog.toolClassOf(schema.name)
            return {
              key: `tool:${schema.name}`,
              kind: 'tool',
              name: schema.name,
              description: typeof schema.description === 'string' ? schema.description : '',
              group: cls.groupId,
              groupLabel: cls.label,
              groupKind: cls.kind,
              critical: cls.kind === 'critical',
              gatable: cls.kind !== 'reserved'
            }
          })

          const skillRows = skills.map((summary) => ({
            key: `skill:${summary.name}`,
            kind: 'skill',
            name: summary.name,
            description: typeof summary.description === 'string' ? summary.description : '',
            whenToUse: typeof summary.whenToUse === 'string' ? summary.whenToUse : undefined,
            group: catalog.skillGroupOf(summary),
            modelInvocable: summary.invocation?.modelInvocable !== false,
            userInvocable: summary.invocation?.userInvocable !== false,
            source: summary.source,
            provider: summary.provider,
            gatable: true
          }))

          const sectionRows = [...catalog.observed.sections.keys()].sort().map((sectionName) => {
            const group = catalog.sectionGroupOf(sectionName)
            return {
              key: `section:${sectionName}`,
              kind: 'section',
              name: sectionName,
              group: group.groupId,
              groupLabel: group.label,
              gatable: group.gatable
            }
          })
          const contextRows = [...catalog.observed.contexts.keys()].sort().map((contextName) => {
            const group = catalog.sectionGroupOf(contextName)
            return {
              key: `context:${contextName}`,
              kind: 'context',
              name: contextName,
              group: group.groupId,
              groupLabel: group.label,
              gatable: group.gatable
            }
          })
          const variableRows = [...catalog.observed.variables].sort().map((variableName) => ({
            key: `variable:${variableName}`,
            kind: 'variable',
            name: variableName,
            group: 'core-variables',
            groupLabel: '核心变量（由段落间接控制）',
            gatable: false
          }))

          json(res, 200, {
            workspaceKey: workspaceKeyEff,
            skillsComplete: complete,
            sectionsObservedOnce: catalog.observedOnce,
            sectionsViaColdFallback: cold && !catalog.observedOnce,
            skills: skillRows,
            tools: toolRows,
            sections: sectionRows,
            contexts: contextRows,
            variables: variableRows,
            effective
          })
          return
        }

        // ---- GET/PUT /selection?sessionId= ----
        if (path === 'selection') {
          if (method === 'GET') {
            if (sessionId === '') {
              json(res, 400, { error: 'sessionId-required' })
              return
            }
            const rec = store.getSelection(sessionId)
            const started = await isSessionStarted(sessionId)
            json(res, 200, {
              sessionId,
              revision: rec?.revision ?? 0,
              selections: rec?.selections ?? {},
              started,
              forcedAt: rec?.forcedAt ?? null,
              exists: rec !== undefined
            })
            return
          }
          if (method === 'PUT') {
            const body = await readBody(req)
            if (body === null || typeof body !== 'object') {
              json(res, 400, { error: 'invalid-json' })
              return
            }
            if (sessionId === '') {
              json(res, 400, { error: 'sessionId-required' })
              return
            }
            const selections = body.selections === null
              ? null
              : sanitizeSelections(body.selections)
            const rec = store.putSelection(sessionId, workspaceKey !== '' ? workspaceKey : workspaceKeyOf(cwdParam), body.revision, selections, {
              forced: body.forced === true,
              started: await isSessionStarted(sessionId)
            })
            if (rec === null) {
              json(res, 409, { error: 'revision-conflict', currentRevision: store.getSelection(sessionId)?.revision ?? 0 })
              return
            }
            // 预取新被门控技能的完整定义（影子注册的前置条件）。
            const unchecked = applier.uncheckedKeys(rec.selections)
            if (unchecked.skills.length > 0) {
              await applier.ensureSkillDefs(unchecked.skills, cwdParam)
            }
            // 热生效：会话有活 agent 则立即重应用（同步编排）。
            let hotApplied = false
            const live = ctx.agents?.get?.(sessionId)
            if (live !== undefined) {
              const result = applier.applyToAgent(live, 'selection-put')
              hotApplied = result.gated || result.skippedUnknown.length > 0
            }
            if (body.forced === true) store.markForced(sessionId)
            json(res, 200, { ok: true, revision: rec.revision, hotApplied })
            return
          }
          json(res, 405, { error: 'method-not-allowed' })
          return
        }

        // ---- GET /status?sessionId= ----
        if (path === 'status' && method === 'GET') {
          if (sessionId === '') {
            json(res, 400, { error: 'sessionId-required' })
            return
          }
          const rec = store.getSelection(sessionId)
          const started = await isSessionStarted(sessionId)
          const effective = store.effective(sessionId, rec?.workspaceKey ?? workspaceKey)
          const gatedCount = effective === null ? 0 : countFalse(effective.selections)
          const live = ctx.agents?.get?.(sessionId) !== undefined
          const skippedUnknown = Array.isArray(applier.lastSkippedUnknown) ? applier.lastSkippedUnknown : []
          json(res, 200, {
            sessionId,
            started,
            locked: started,
            agentRunning: live,
            forcedAt: rec?.forcedAt ?? null,
            gatedCount,
            degraded: applier.degraded || skippedUnknown.length > 0,
            skippedUnknown,
            applied: rec?.applied ?? null,
            dot: !started && gatedCount === 0 ? 'green' : (gatedCount > 0 ? 'orange' : 'gray')
          })
          return
        }

        // ---- POST /apply {sessionId} ----
        if (path === 'apply' && method === 'POST') {
          const body = await readBody(req)
          const targetId = typeof body?.sessionId === 'string' ? body.sessionId : sessionId
          if (targetId === '') {
            json(res, 400, { error: 'sessionId-required' })
            return
          }
          const live = ctx.agents?.get?.(targetId)
          if (live === undefined) {
            json(res, 200, { applied: false, reason: 'no-live-agent' })
            return
          }
          const result = applier.applyToAgent(live, 'manual-apply')
          // 调试（发布后可移除）：以 agent 作用域读回实际可见工具面，与全局面对比。
          const globalNames = ctx.tools.schemas().map((s) => s.name)
          let scopedNames = null
          try { scopedNames = ctx.tools.schemas(live).map((s) => s.name) } catch (error) { scopedNames = ['ERROR: ' + (error?.message ?? error)] }
          const state = applier.stateOf(live.id)
          json(res, 200, {
            applied: result.gated,
            skippedUnknown: result.skippedUnknown,
            degraded: applier.degraded,
            detail: result.applied,
            debug: {
              callbacksSucceeded: { skills: state.skills.size, tools: state.tools.size, sections: state.sections.size },
              globalToolCount: globalNames.length,
              scopedToolCount: Array.isArray(scopedNames) ? scopedNames.length : scopedNames,
              scopedToolNames: Array.isArray(scopedNames) ? scopedNames : undefined,
              generation: state.generation,
              lastAssembly: catalog.lastAssembly
            }
          })
          return
        }

        // ---- GET/PUT /defaults?cwd= ----
        if (path === 'defaults') {
          if (workspaceKey === '') {
            json(res, 400, { error: 'cwd-required' })
            return
          }
          if (method === 'GET') {
            const rec = store.workspaceDefaults.get(workspaceKey)
            json(res, 200, { workspaceKey, revision: rec?.revision ?? 0, selections: rec?.selections ?? {}, exists: rec !== undefined })
            return
          }
          if (method === 'PUT') {
            const body = await readBody(req)
            if (body === null || typeof body !== 'object') {
              json(res, 400, { error: 'invalid-json' })
              return
            }
            const selections = body.selections === null ? null : sanitizeSelections(body.selections)
            const rec = store.putDefaults(workspaceKey, body.revision, selections)
            if (rec === null) {
              json(res, 409, { error: 'revision-conflict', currentRevision: store.workspaceDefaults.get(workspaceKey)?.revision ?? 0 })
              return
            }
            json(res, 200, { ok: true, revision: rec.revision })
            return
          }
          json(res, 405, { error: 'method-not-allowed' })
          return
        }

        json(res, 404, { error: 'not-found', path })
      } catch (error) {
        log('路由处理失败：', error?.message ?? error)
        try {
          json(res, 500, { error: 'internal-error', message: error?.message ?? String(error) })
        } catch { /* 响应头已发出 */ }
      }
    }
  }), 'dsh-plugin-context-trim: routes')

  // 启动收尾（异步）：孤儿键淘汰 + 技能定义预热。
  queueMicrotask(() => {
    Promise.resolve(ctx.sessionQuery.listSessions().catch(() => null)).then((records) => {
      if (Array.isArray(records)) {
        store.pruneSessions(records.map((r) => r?.header?.id ?? r?.id).filter((id) => typeof id === 'string'))
      }
      applier.prewarm()
    }).catch(() => {})
  })

  // 卸载清理。
  ctx.effect(() => () => {
    applier.disposeAll()
  }, 'dsh-plugin-context-trim: dispose')
}

// 内部构件命名导出（供 selfcheck 冒烟测试；运行时只用上面的 apply）。
export { GateStore } from './store.js'
export { GateApplier } from './applier.js'
export { GateCatalog } from './catalog.js'
export { sanitizeSelections, workspaceKeyOf } from './util.js'
