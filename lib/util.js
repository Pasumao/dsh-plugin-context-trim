/**
 * dsh-plugin-context-trim — 通用工具（host 半边）
 *
 * @module dsh-plugin-context-trim/util
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 持久化目录（$DSH_HOME，默认 ~/.dsh）。 */
export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/** 归一化 cwd 为 workspaceKey（Windows 大小写/分隔符宽容）。 */
export function workspaceKeyOf(cwd) {
  const raw = typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd()
  return raw.replace(/[\\/]+/g, '/').replace(/[/.]$/, '').toLowerCase()
}

/** 统一日志前缀。 */
export function log(...args) {
  console.log('[dsh-plugin-context-trim]', ...args)
}

/** selections 白名单化：只接受 kind:name → boolean 的稀疏表（false 才有意义）。 */
export function sanitizeSelections(input) {
  if (input === null || typeof input !== 'object') return {}
  const out = {}
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'boolean') continue
    if (!/^(skill|tool|section|context|variable):/.test(key)) continue
    if (value === false) out[key] = false
  }
  return out
}

/** 统计稀疏表中的取消项数量。 */
export function countFalse(selections) {
  let n = 0
  for (const value of Object.values(selections ?? {})) {
    if (value === false) n++
  }
  return n
}
