/**
 * dsh-plugin-context-trim 自检：不加载 dsh 宿主，直接验证核心模块。
 * 运行：node scripts/selfcheck.mjs
 *
 * 检查项：
 *  1. 包一致性：package.json / cordis.patch.yml / client 导出 / 关键文件齐全
 *  2. GateStore：读写回环、revision 乐观锁（冲突拒绝）、workspace 默认回退
 *  3. GateApplier：影子 skill（含 content、modelInvocable:false）、tools
 *     restrict 白名单化（未知名跳过 / run_code 不 restrict）、空文本 section
 *     影子、重复应用先 dispose 上一代（generation 幂等）
 *  4. GateCatalog：工具归属（关键组/插件/MCP/内置）、技能归属、段落归属
 */

import { readFile, writeFile, rm, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

import {
  name as PLUGIN_NAME,
  ROUTE_PREFIX,
  STORE_FILE,
  GateStore,
  GateApplier,
  GateCatalog,
  sanitizeSelections,
  workspaceKeyOf
} from '../lib/index.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const results = []
const pass = (msg) => { results.push(`  ✅ ${msg}`); console.log(`  ✅ ${msg}`) }
const fail = (msg) => { results.push(`  ❌ ${msg}`); console.error(`  ❌ ${msg}`) }

async function test1() {
  console.log('[1/4] 包一致性')
  try {
    const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
    assert.equal(pkg.name, PLUGIN_NAME, 'package.json name 与 lib 导出名一致')
    assert.equal(pkg.exports['./client'], './lib/client.js', '声明 ./client 导出')
    assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml', '声明 bundle patch')
    assert.equal(pkg.dsh?.client?.platform, 'web', '声明 web client 平台')
    const patch = await readFile(join(ROOT, 'cordis.patch.yml'), 'utf8')
    assert.ok(patch.includes(`id: ${PLUGIN_NAME}`) && patch.includes(`name: ${PLUGIN_NAME}`), 'cordis.patch.yml id/name = 包名')
    const clientSrc = await readFile(join(ROOT, 'lib/client.js'), 'utf8')
    assert.ok(clientSrc.includes(`id: '${PLUGIN_NAME}'`), 'client bundle id = 包名')
    assert.ok(clientSrc.includes("ctx.slots.inject('conversation.input.left'"), 'client 注入 conversation.input.left 插槽')
    assert.ok(/exports\.inject\s*=\s*\['slots'\]/.test(clientSrc), 'client 声明 inject slots')
    assert.ok(!clientSrc.includes('require("fs")') && !clientSrc.includes("require('fs')"), 'client 不 require node 内置模块')
    const raw = await readFile(join(ROOT, 'package.json'))
    assert.ok(!(raw.byteLength > 2 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf), 'package.json 无 BOM')
    pass('包结构 / 命名 / client 声明 / 无 BOM 全部一致')
  } catch (error) {
    fail(`包一致性：${error.message}`)
  }
}

async function test2() {
  console.log('[2/4] GateStore')
  const dir = join(tmpdir(), `dsh-trim-selfcheck-${Date.now()}`)
  await mkdir(dir, { recursive: true })
  const file = join(dir, STORE_FILE)
  try {
    const store = new GateStore(file)
    assert.equal(store.getSelection('s1'), undefined, '空库无会话')
    assert.equal(store.effective('s1', 'ws-a'), null, '无记录时 effective=null（全量注入）')

    const rec = store.putSelection('s1', 'ws-a', 0, { 'skill:nonebot-plugin-dev-kb': false, 'tool:pwsh': false }, {})
    assert.ok(rec && rec.revision === 1, '首次保存 revision=1')
    assert.equal(store.putSelection('s1', 'ws-a', 0, { 'skill:x': false }, {}), null, 'revision 冲突返回 null')
    assert.equal(store.putSelection('s1', 'ws-a', 99, null, {}), null, '未知 revision 冲突返回 null')

    const rec2 = store.putSelection('s1', 'ws-a', 1, { 'skill:nonebot-plugin-dev-kb': false }, {})
    assert.ok(rec2 && rec2.revision === 2, '携带正确 revision 可再存（revision=2）')
    assert.equal(store.effective('s1', 'ws-a').selections['tool:pwsh'], undefined, '恢复勾选后键消失（稀疏表）')

    const drec = store.putDefaults('ws-b', 0, { 'skill:dsh-plugin-dev-kb': false })
    assert.ok(drec && drec.revision === 1, '工作区默认可保存')
    assert.equal(store.effective('s2', 'ws-b').source, 'workspace-default', '无 per-session 记录时回退工作区默认')
    assert.equal(store.effective('s2', 'ws-b').selections['skill:dsh-plugin-dev-kb'], false, '默认模板键生效')

    // 持久化回环
    await store.persist()
    const store2 = new GateStore(file)
    assert.equal(store2.getSelection('s1').revision, 2, '重启后 revision 保持')
    assert.deepEqual(store2.getSelection('s1').selections, { 'skill:nonebot-plugin-dev-kb': false }, '重启后 selections 保持')

    store2.pruneSessions(['s1'])
    assert.equal(store2.getSelection('ghost') ?? undefined, undefined, '孤儿淘汰不误伤')
    await store2.persist()
    const store3 = new GateStore(file)
    store3.pruneSessions(['other']) // s1 被淘汰
    await store3.persist()
    assert.ok(true, 'pruneSessions 执行无异常')
    pass('读写回环 / 乐观锁 / 默认回退 / 持久化')
  } catch (error) {
    fail(`GateStore：${error.message}`)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** 构造假 ctx / agent（模拟 agent.ctx 的 skills/tools/systemPrompt scoped 注册面）。 */
function makeFakeWorld({ skillDefs = {}, knownTools = ['read', 'write', 'pwsh', 'skill', 'run_code', 'plugin_metrics'] } = {}) {
  const log2 = []
  const fibersDisposed = []
  const calls = { skillRegister: [], toolRestrict: [], section: [], context: [] }
  const skillsDisposers = []
  const toolsDisposers = []
  const promptDisposers = []
  const agentCtx = {
    // cordis 真实 agent.ctx 的服务属性受 inject 白名单保护；插件统一走
    // agent.ctx.inject([svc], cb) 子 fiber。fake 里同步回调 + 可 dispose fiber。
    inject(services, cb) {
      cb(agentCtx)
      return { dispose() { fibersDisposed.push(services.join('+')) } }
    },
    skills: {
      register(skill) {
        calls.skillRegister.push(skill)
        const disposer = () => skillsDisposers.push(skill.name)
        skillsDisposers.length = 0 // 每次注册重置「上一代已 dispose」观测
        return disposer
      }
    },
    tools: {
      restrict(filter) {
        calls.toolRestrict.push(filter)
        return () => toolsDisposers.push(filter.deny?.[0])
      }
    },
    systemPrompt: {
      section(section) {
        calls.section.push(section)
        return () => promptDisposers.push(`section:${section.name}`)
      },
      context(context) {
        calls.context.push(context)
        return () => promptDisposers.push(`context:${context.name}`)
      }
    }
  }
  const ctx = {
    skills: {
      get: async (n) => skillDefs[n],
      snapshot: async () => ({ skills: [], complete: true })
    },
    tools: {
      schemas: () => knownTools.map((n) => ({ name: n, description: '' }))
    },
    systemPrompt: {},
    agents: { list: () => [], get: () => undefined },
    on: () => () => {},
    effect: () => () => {},
    logger: { warn: () => {} }
  }
  const agent = {
    id: 'sess-1',
    ctx: agentCtx,
    session: { id: 'sess-1', header: { cwd: 'D:\\ws\\demo' } }
  }
  return { ctx, agent, calls, skillsDisposers, toolsDisposers, promptDisposers, log2, fibersDisposed }
}

async function test3() {
  console.log('[3/4] GateApplier')
  const dir = join(tmpdir(), `dsh-trim-selfcheck-applier-${Date.now()}-${process.pid}`)
  try {
    await mkdir(dir, { recursive: true })
    const store = new GateStore(join(dir, STORE_FILE))
    const world = makeFakeWorld({
      skillDefs: {
        'nonebot-plugin-dev-kb': {
          name: 'nonebot-plugin-dev-kb',
          description: 'NoneBot KB',
          content: '# KB body',
          invocation: { modelInvocable: true, userInvocable: false },
          provider: 'runtime',
          source: 'runtime'
        }
      }
    })
    const applier = new GateApplier(world.ctx, store)
    await applier.ensureSkillDefs(['nonebot-plugin-dev-kb'])

    store.putSelection('sess-1', workspaceKeyOf('D:\\ws\\demo'), 0, {
      'skill:nonebot-plugin-dev-kb': false,
      'tool:pwsh': false,
      'tool:ghost_tool': false,       // 未知名 → 白名单化跳过
      'tool:run_code': false,          // 保留名 → 不 restrict
      'section:dsh-plugin-workbench:file-mention': false,
      'context:some-context': false,
      'variable:persona': false        // variables 不处理
    })

    const result = applier.applyToAgent(world.agent, 'selfcheck')
    assert.ok(result.gated, '报告 gated')

    assert.equal(world.calls.skillRegister.length, 1, '影子 skill 注册一次')
    const shadow = world.calls.skillRegister[0]
    assert.equal(shadow.invocation.modelInvocable, false, '影子 modelInvocable=false')
    assert.equal(shadow.invocation.userInvocable, false, '保留原 userInvocable 语义')
    assert.equal(shadow.content, '# KB body', '影子携带完整 content')

    assert.equal(world.calls.toolRestrict.length, 1, '只 restrict 已知工具')
    assert.deepEqual(world.calls.toolRestrict[0].deny, ['pwsh'], 'deny 列表正确（ghost/run_code 未进 restrict）')

    assert.equal(world.calls.section.length, 1, '空文本 section 影子注册')
    assert.equal(world.calls.section[0].text, '', 'section text 为空')
    assert.equal(world.calls.context.length, 1, '空文本 context 影子注册')

    // 重复应用：先 dispose 上一代通道 fiber，再重建（generation 幂等）
    const firstSkills = applier.agentState.get('sess-1').skills.size
    applier.applyToAgent(world.agent, 'selfcheck-2')
    const state = applier.agentState.get('sess-1')
    assert.equal(state.generation, 2, 'generation 递增')
    assert.equal(state.skills.size, firstSkills, '重建后影子数量一致（无 no-op disposer 残留）')
    assert.deepEqual(world.fibersDisposed.slice(0, 3), ['skills', 'tools', 'systemPrompt'], '重建前 dispose 上一代三个通道 fiber')

    // 无记录 → 全量注入（selections=null 表示清空全部取消项；当前 revision 为 1）
    store.putSelection('sess-1', workspaceKeyOf('D:\\ws\\demo'), 1, null, {})
    const r2 = applier.applyToAgent(world.agent, 'selfcheck-3')
    assert.equal(r2.gated, false, 'selections=null 时全量')

    // effective=null（清空记录）路径
    const r3 = applier.applyToAgent({ id: 'sess-9', ctx: world.agent.ctx, session: { id: 'sess-9', header: { cwd: 'D:\\ws\\demo' } } }, 'selfcheck-4')
    assert.equal(r3.gated, false, '无任何记录的会话不应用')

    await rm(dir, { recursive: true, force: true }).catch(() => {})
    pass('影子注册 / 白名单化 / generation 幂等 / 全量回退')
  } catch (error) {
    fail(`GateApplier：${error.message}`)
  }
}

async function test4() {
  console.log('[4/4] GateCatalog 归属 + sanitize')
  try {
    const { ctx } = makeFakeWorld()
    const store = new GateStore(join(tmpdir(), `dsh-trim-selfcheck-${Date.now()}`, STORE_FILE))
    const catalog = new GateCatalog(ctx, store)

    assert.deepEqual(catalog.toolClassOf('read'), { kind: 'critical', groupId: 'critical:file', label: '文件读写' }, 'read → 关键文件组')
    assert.deepEqual(catalog.toolClassOf('pwsh'), { kind: 'critical', groupId: 'critical:console', label: '控制台' }, 'pwsh → 关键控制台组')
    assert.deepEqual(catalog.toolClassOf('skill'), { kind: 'critical', groupId: 'critical:skill', label: '技能总闸' }, 'skill → 技能总闸')
    assert.deepEqual(catalog.toolClassOf('run_code'), { kind: 'reserved', groupId: 'reserved', label: '保留' }, 'run_code → 保留')
    assert.equal(catalog.toolClassOf('ask_user_choice').groupId, 'dsh-plugin-image-tools', '插件工具归属')
    assert.equal(catalog.toolClassOf('mcp__comfyui__txt2img').groupId, 'mcp:comfyui', 'MCP 前缀归属')
    assert.equal(catalog.toolClassOf('web_search').groupId, 'builtin-tools', '未知工具 → 内置')

    assert.equal(catalog.skillGroupOf({ name: 'dsh-plugin-dev-kb', provider: 'runtime', source: 'runtime' }), 'dsh-plugin-dev-kb', 'KB 技能名归属')
    assert.equal(catalog.skillGroupOf({ name: 'foo', provider: 'dsh-plugin-x', source: 'runtime' }), 'dsh-plugin-x', 'provider 标签归属')
    assert.equal(catalog.skillGroupOf({ name: 'foo', provider: 'runtime', source: 'project-dsh' }), 'project-skills', '项目技能组')

    assert.equal(catalog.sectionGroupOf('dsh-plugin-workbench:file-mention').gatable, true, '插件段落可门控')
    assert.equal(catalog.sectionGroupOf('dsh-plugin-workbench:file-mention').groupId, 'dsh-plugin-workbench', '插件段落归属插件')
    assert.equal(catalog.sectionGroupOf('persona').gatable, false, '核心段落锁定')

    assert.deepEqual(sanitizeSelections({ 'skill:a': false, 'tool:b': true, 'bad': false, 'section:c': 'no' }), { 'skill:a': false }, 'sanitize 只留 false 的合法键')

    assert.equal(workspaceKeyOf('D:\\WS\\Demo\\\\'), workspaceKeyOf('d:/ws/demo'), 'workspaceKey 大小写/分隔符归一')
    pass('归属表 / sanitize / workspaceKey')
  } catch (error) {
    fail(`GateCatalog：${error.message}`)
  }
}

console.log(`dsh-plugin-context-trim selfcheck @ ${new Date().toISOString()}`)
await test1()
await test2()
await test3()
await test4()

const failed = results.filter((r) => r.startsWith('  ❌'))
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length > 0 ? 1 : 0)
