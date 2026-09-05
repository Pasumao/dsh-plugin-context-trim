/**
 * dsh-plugin-context-trim — GateStore（host 半边）
 *
 * 内存缓存（同步读写，agent/created 路径零 await）+ JSON 持久化（原子写，
 * 串行队列）+ revision 乐观锁。
 *
 * selections 以 kind:name 扁平键存储，只存 false（被取消）条目（稀疏表）：
 * 缺失 = 勾选。目录随版本漂移时不会留下误伤性的残留 true/false。
 *
 * @module dsh-plugin-context-trim/store
 */
import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { log } from './util.js'

export class GateStore {
  constructor(filePath) {
    this.filePath = filePath
    /** @type {Map<string, {workspaceKey:string, revision:number, updatedAt:string, selections:Record<string,boolean>, startedAt:string|null, forcedAt:string|null, applied:object}>} */
    this.sessions = new Map()
    /** @type {Map<string, {revision:number, updatedAt:string, selections:Record<string,boolean>}>} */
    this.workspaceDefaults = new Map()
    /** 已确认「会话已开始」的 sticky 缓存（持久事实，进程内不回退）。 */
    this.startedSet = new Set()
    this.saving = false
    this.dirty = false
    /** 写盘串行队列：直接 persist() 与调度写盘共用，杜绝 tmp 文件竞态。 */
    this.writeQueue = Promise.resolve()
    this.loadSync()
  }

  loadSync() {
    try {
      const raw = readFileSync(this.filePath, 'utf8')
      const data = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw)
      if (data !== null && typeof data === 'object') {
        for (const [id, rec] of Object.entries(data.sessions ?? {})) {
          if (rec && typeof rec === 'object' && typeof rec.selections === 'object' && rec.selections !== null) {
            this.sessions.set(id, {
              workspaceKey: typeof rec.workspaceKey === 'string' ? rec.workspaceKey : '',
              revision: Number(rec.revision) || 0,
              updatedAt: typeof rec.updatedAt === 'string' ? rec.updatedAt : '',
              selections: { ...rec.selections },
              startedAt: typeof rec.startedAt === 'string' ? rec.startedAt : null,
              forcedAt: typeof rec.forcedAt === 'string' ? rec.forcedAt : null,
              applied: rec.applied && typeof rec.applied === 'object' ? rec.applied : null
            })
          }
        }
        for (const [key, rec] of Object.entries(data.workspaceDefaults ?? {})) {
          if (rec && typeof rec === 'object' && typeof rec.selections === 'object' && rec.selections !== null) {
            this.workspaceDefaults.set(key, {
              revision: Number(rec.revision) || 0,
              updatedAt: typeof rec.updatedAt === 'string' ? rec.updatedAt : '',
              selections: { ...rec.selections }
            })
          }
        }
      }
      log(`已加载 ${this.sessions.size} 个会话选择、${this.workspaceDefaults.size} 个工作区默认`)
    } catch {
      log('无历史数据（首次启动或文件损坏，使用空库）')
    }
  }

  serialize() {
    return JSON.stringify({
      version: 1,
      workspaceDefaults: Object.fromEntries(this.workspaceDefaults),
      sessions: Object.fromEntries(this.sessions)
    }, null, 2)
  }

  /** 异步原子持久化（串行队列：所有写盘排队执行，杜绝 tmp 竞态）。 */
  scheduleSave() {
    if (this.saving) {
      this.dirty = true
      return
    }
    this.saving = true
    this.persist().catch((error) => log('持久化失败：', error?.message ?? error)).then(() => {
      this.saving = false
      if (this.dirty) {
        this.dirty = false
        this.scheduleSave()
      }
    })
  }

  /** 原子写入（经串行队列；tmp + rename）。 */
  persist() {
    const run = this.writeQueue.then(() => this.persistNow())
    this.writeQueue = run.catch(() => {})
    return run
  }

  async persistNow() {
    const payload = this.serialize()
    const tmp = `${this.filePath}.tmp`
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(tmp, payload, 'utf8')
    await rename(tmp, this.filePath)
  }

  /** 会话选择；无则 undefined。 */
  getSelection(sessionId) {
    return this.sessions.get(sessionId)
  }

  /** 生效勾选：per-session 优先，落 workspace 默认；都没有 → null（= 全量注入）。 */
  effective(sessionId, workspaceKey) {
    const rec = this.sessions.get(sessionId)
    if (rec !== undefined) return { source: 'session', selections: rec.selections, revision: rec.revision }
    const def = workspaceKey !== '' ? this.workspaceDefaults.get(workspaceKey) : undefined
    if (def !== undefined) return { source: 'workspace-default', selections: def.selections, revision: def.revision }
    return null
  }

  /**
   * 保存会话选择（乐观锁）。成功返回记录；revision 冲突返回 null。
   * selections 传 null 表示清空全部取消项（恢复全量）。
   */
  putSelection(sessionId, workspaceKey, clientRevision, selections, { forced = false, started = false } = {}) {
    const existing = this.sessions.get(sessionId)
    const revision = (existing?.revision ?? 0) + 1
    if (existing !== undefined && Number(clientRevision) !== existing.revision) return null
    const now = new Date().toISOString()
    const rec = {
      workspaceKey,
      revision,
      updatedAt: now,
      selections: selections === null ? {} : { ...selections },
      startedAt: existing?.startedAt ?? (started ? now : null),
      forcedAt: existing?.forcedAt ?? (forced ? now : null),
      applied: existing?.applied ?? null
    }
    this.sessions.set(sessionId, rec)
    this.scheduleSave()
    return rec
  }

  /** 工作区默认模板（乐观锁）。 */
  putDefaults(workspaceKey, clientRevision, selections) {
    const existing = this.workspaceDefaults.get(workspaceKey)
    if (existing !== undefined && Number(clientRevision) !== existing.revision) return null
    const rec = {
      revision: (existing?.revision ?? 0) + 1,
      updatedAt: new Date().toISOString(),
      selections: selections === null ? {} : { ...selections }
    }
    this.workspaceDefaults.set(workspaceKey, rec)
    this.scheduleSave()
    return rec
  }

  /** 标记会话已开始（sticky）。 */
  markStarted(sessionId) {
    this.startedSet.add(sessionId)
    const rec = this.sessions.get(sessionId)
    if (rec !== undefined && rec.startedAt === null) {
      rec.startedAt = new Date().toISOString()
      this.scheduleSave()
    }
  }

  markForced(sessionId) {
    const rec = this.sessions.get(sessionId)
    if (rec !== undefined && rec.forcedAt === null) {
      rec.forcedAt = new Date().toISOString()
      this.scheduleSave()
    }
  }

  /** 记录描述性 applied（状态点/诊断用；活 disposer 只存内存，严禁从 JSON 恢复）。 */
  setApplied(sessionId, applied) {
    const rec = this.sessions.get(sessionId)
    if (rec === undefined) return
    rec.applied = applied
    this.scheduleSave()
  }

  /** 孤儿键淘汰：按现存 session 集修剪。 */
  pruneSessions(existingIds) {
    const alive = new Set(existingIds)
    let removed = 0
    for (const id of [...this.sessions.keys()]) {
      if (!alive.has(id)) {
        this.sessions.delete(id)
        removed++
      }
    }
    if (removed > 0) {
      log(`淘汰 ${removed} 个孤儿会话选择`)
      this.scheduleSave()
    }
  }
}
