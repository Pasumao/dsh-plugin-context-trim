<p align="center">
  <img src="docs/banner.svg" alt="dsh-plugin-context-trim banner" width="100%">
</p>

# dsh-plugin-context-trim

![npm version](https://img.shields.io/npm/v/dsh-plugin-context-trim)
![npm downloads](https://img.shields.io/npm/dm/dsh-plugin-context-trim)
![License](https://img.shields.io/github/license/Pasumao/dsh-plugin-context-trim)
![Stars](https://img.shields.io/github/stars/Pasumao/dsh-plugin-context-trim?style=social)
![AI Assisted](https://img.shields.io/badge/AI-Assisted-8A2BE2)

[**中文**](./README.md) | [English](./README.en.md)

**DeepSeek Harness 生态里第一个「按会话裁剪上下文注入」的插件**：写 NoneBot 时用不上 dsh 插件开发知识库，纯聊天时用不上生图工具——本插件让你**按会话**决定向模型注入哪些 skill、tool、系统提示词段落，其余的在本会话内对模型完全不可见。

`3 条影子通道（skill / tool / 段落）· 5 条本地路由 · 0 依赖 · 0 配置 · 不改核心包`

装完你会看到：

- 会话输入栏左下角多一个**漏斗按钮「注入」**，绿点=全量、橙点=有裁剪、灰锁=已锁定
- 点击弹出按插件聚合的树表，勾掉不想要的插件（如全部知识库技能），模型从此看不到它们
- 每步请求实测减少数千字符的无关 schema 与技能描述（弹窗底部实时粗估）
- 其他会话完全不受影响，agent 销毁自动还原，随时一键恢复全量

## 安装

```powershell
dsh plugin --profile web add dsh-plugin-context-trim
```

或从 GitHub 安装：

```powershell
dsh plugin --profile web add github:Pasumao/dsh-plugin-context-trim
```

源码安装（本地开发 / 调试）：

```bash
git clone https://github.com/Pasumao/dsh-plugin-context-trim.git
cd dsh-plugin-context-trim
npm install
# 以 link: 方式挂载进 profile（与 dsh.profile.bundles 同机制）
```

装完重启 dsh（launcher）并刷新浏览器。包自带 `cordis.patch.yml` 挂载行，经 `dsh.profile.bundles`
自动应用，无需手动改任何配置。host 侧代码改动需重启 dsh；client 侧改动浏览器强刷即可。

## 快速上手

1. 新建一个会话，点击输入栏左下角的**漏斗按钮**——弹窗列出所有能影响模型上下文的插件；
2. 展开不想注入的插件组，点组行勾选框**批量取消**（如 `dsh-plugin-nonebot-kb` 整组），
   底部实时显示「已裁剪 N 项，预计每步请求减少约 X 字符」；
3. 点**「应用」**——本会话立即生效，模型上下文里不再出现这些内容；点**「存为默认」**
   可把当前勾选保存为该工作区新会话的默认模板。

## 功能

| 功能 | 说明 |
|---|---|
| 按会话裁剪 skill | 同名影子技能以 `modelInvocable:false` 压制原技能：`<available_skills>` 目录消失，`skill` 工具按名加载也被拒 |
| 按会话裁剪 tool / MCP 工具 | `tools.restrict({ deny })` 逐工具隐藏（MCP 工具天然覆盖），未知名自动跳过防竞态 |
| 按会话裁剪提示词段落 | 同名空文本 section/context 影子，渲染层自动丢弃；无法归属插件的段落默认锁定防误伤 |
| 树表弹窗 | 按插件聚合、三态勾选、组行批量设置且跳过锁定行、类型标识配色随主题自适应、可拖动/缩放 |
| 关键能力保护 | 文件读写 / 控制台 / 技能总闸带 ⚠ 标识，取消需确认，恢复免确认 |
| 会话锁定与强制更改 | 会话已开始（落盘 ≥1 步）后只读锁定；「强制更改」确认后解锁并热生效（下一 step） |
| 新会话默认模板 | 「存为默认 / 恢复默认」管理工作区级模板，每个新会话自动套用 |
| 状态点 | 绿=全量注入 / 橙=有裁剪 / 灰锁=已锁定；未锁定时按钮以品牌强调色点亮 |

## 配置

**本插件零配置（zero-config）**：安装即用——没有密钥、没有账号、没有任何必填字段。
选择数据自动持久化在 `$DSH_HOME/dsh-plugin-context-trim.json`（UTF-8 无 BOM，原子写入），
一般无需手工编辑；HTTP 路由仅监听本机回环地址，仅服务本机 GUI。

## 工作原理

<details>
<summary>影子条目机制（点开了解为什么它不会污染其他会话）</summary>

对被取消的条目，插件只在 **agent 自己的作用域层**叠加同名「影子条目」压制全局原条目，
注册表里的原条目一个字节都不动：

| 通道 | 手段 | 效果 |
|---|---|---|
| skill | `agent.ctx.skills.register(同名影子, modelInvocable:false)` | 目录消失 + 按名加载被拒 |
| tool / MCP | `agent.ctx.tools.restrict({ deny:[name] })` 逐工具 | 模型请求看不到该工具 |
| 提示词段落 | `agent.ctx.systemPrompt.section(同名, text:'')` | 空文本段落被渲染层丢弃 |

注册经 `agent.ctx.inject([service], …)` 子插件 fiber 落在 agent 作用域层（cordis 的
agent.ctx 服务属性受 inject 白名单保护）；agent 销毁时 cordis effect 自动 unwind——
零残留、零跨会话影响。重复应用按 generation token 先 dispose 上一代再重建（幂等）；
影子 skill 注册前先经全局视图取**完整原定义**（含正文），只覆写 `modelInvocable`。

</details>

## 兼容性

- 目标版本 dsh `0.1.2-rc.1`（API 均为官方文档化扩展点：`ctx.skills` / `ctx.tools.restrict` /
  `ctx.systemPrompt` / `ctx.webServer` / 插槽系统）
- 纯插件实现（host + client bundle），不改 dsh 核心包；Node ≥ 18，零运行时依赖

## 安全与限制

- 会话中途裁剪后，历史里旧的目录消息仍在（官方语义是向前替换目录，不回收历史），模型以最新目录为准
- MCP server 重连后新增的工具不在已有 deny 列表中，会以未门控状态出现（低危竞态）
- 动态 cordis 插件（cordis_run）的 scoped 工具不受 restrict 约束
- 其他插件未标注 `provider` 时，其技能归入「运行时技能」组（归属表随版本维护）
- 影子注册体在依赖就绪后的微任务级落地，实践中先于首个模型 pre-step 完成
- HTTP 路由仅服务本机 GUI（回环地址校验），不暴露公网

## 常见问题

**Q：取消某个插件后，之前会话里它生成的内容会消失吗？**
不会。门控只影响「之后发给模型的上下文组装」，历史消息原样保留。

**Q：新会话为什么是绿点？已开始的会话为什么锁住？**
绿点 = 与默认行为一致的全量注入。会话一旦落盘过模型步骤（已开始），注入即锁定，
防止运行中的会话被静默改变；确需修改点「强制更改」，下一 step 热生效。

**Q：想让所有新会话默认去掉知识库技能？**
在任意会话里勾好，点「存为默认」——该工作区之后的新会话自动套用这套裁剪。

## 相关插件

本插件属于 **Pasumao 的 dsh 插件生态**，同系列已发布插件可搭配使用：

| 插件（npm） | GitHub | 说明 |
|---|---|---|
| [dsh-notify](https://www.npmjs.com/package/dsh-notify) | [GitHub 仓库](https://github.com/Pasumao/dsh-plugin-notify) | Windows 原生通知 + 系统托盘 |
| [dsh-plugin-choice-refresh](https://www.npmjs.com/package/dsh-plugin-choice-refresh) | [GitHub 仓库](https://github.com/Pasumao/dsh-plugin-choice-refresh) | 选择增强：重新生成选项 / 更多选项 |
| [dsh-plugin-dev-kb](https://www.npmjs.com/package/dsh-plugin-dev-kb) | [GitHub 仓库](https://github.com/Pasumao/dsh-plugin-dev-kb) | 插件开发知识库（官方文档完整镜像 + 技能） |
| [dsh-plugin-image-tools](https://www.npmjs.com/package/dsh-plugin-image-tools) | [GitHub 仓库](https://github.com/Pasumao/dsh-plugin-image-tools) | 图片选择卡 / 回复内嵌图 / 盲模型收图 |
| [dsh-plugin-table-zoom](https://www.npmjs.com/package/dsh-plugin-table-zoom) | [GitHub 仓库](https://github.com/Pasumao/dsh-plugin-table-zoom) | 聊天长表格浮窗查看 + 一键复制 Markdown |
| [dsh-plugin-windows-guard](https://www.npmjs.com/package/dsh-plugin-windows-guard) | [GitHub 仓库](https://github.com/Pasumao/dsh-plugin-windows-guard) | Windows 环境防坑：守则技能 + 编码诊断修复 |
| [dsh-plugin-workbench](https://www.npmjs.com/package/dsh-plugin-workbench) | [GitHub 仓库](https://github.com/Pasumao/dsh-plugin-workbench) | VS Code 风格文件浏览器 + 可编辑预览 |

> 本系列其余插件见 [Pasumao · dsh 插件](https://github.com/Pasumao)；觉得好用欢迎到 GitHub 点 ⭐。

## AI 生成声明

代码与文档由 AI 辅助生成（DeepSeek Harness），均经人工审查与自检验证
（`npm run selfcheck`：包一致性 / 乐观锁与持久化 / 影子应用幂等 / 归属表断言）。

## License

[MIT](./LICENSE)
