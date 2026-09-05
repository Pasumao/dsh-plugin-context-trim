/**
 * dsh-plugin-context-trim — 归属表（host 半边）
 *
 * 插件 → 工具/技能名清单。与实时名集求交时未知名跳过 + 日志（GateApplier）。
 * 随各插件发布维护；provider 字段补丁（M3）生效前技能归属靠 PLUGIN_SKILLS 回退。
 *
 * @module dsh-plugin-context-trim/attribution
 */

/** 已知插件注册的工具名（本工作区各插件）。 */
export const PLUGIN_TOOLS = {
  'dsh-plugin-image-tools': ['ask_user_choice', 'show_images', 'save_received_images'],
  'dsh-plugin-metrics': ['plugin_metrics'],
  'dsh-plugin-qwen-web': ['qwen_generate_image', 'qwen_text'],
  'dsh-plugin-windows-guard': ['windows_encode_detect', 'windows_encode_fix']
}

/** 已知插件注册的技能名（provider 字段补丁生效前的归属回退）。 */
export const PLUGIN_SKILLS = {
  'dsh-plugin-dev-kb': ['dsh-plugin-dev-kb'],
  'dsh-plugin-neoforge-kb': ['neoforge-docs-kb'],
  'dsh-plugin-nonebot-kb': ['nonebot-plugin-dev-kb'],
  'dsh-plugin-windows-guard': ['windows-enc', 'windows-sys']
}

/** 关键能力组（按运行时名称模式归类，不硬编码单一名字；计划书 §5.3）。 */
export const CRITICAL_GROUPS = [
  { id: 'critical:file', label: '文件读写', test: (n) => /^(read|write|edit|glob|grep)/.test(n) },
  { id: 'critical:console', label: '控制台', test: (n) => /^(pwsh|bash|console|shell)/.test(n) },
  { id: 'critical:skill', label: '技能总闸', test: (n) => n === 'skill' }
]

/** 保留名：不可 restrict（dsh-tools 硬约束）。 */
export const RESERVED_TOOLS = new Set(['run_code'])

/** 插件段落归属前缀：无法归属到插件的段落一律视为 harness 核心（锁定）。 */
export const ATTRIBUTABLE_SECTION_PREFIX = 'dsh-plugin'
