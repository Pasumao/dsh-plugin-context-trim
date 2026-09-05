# Changelog

## 0.1.0 (2026-09-06)

首个版本。

- 会话注入门控核心：按会话取消/恢复插件贡献的 skill、tool（含 MCP 工具）、
  系统提示词段落——以「会话级影子条目」压制（同名影子 skill `modelInvocable:false`、
  `tools.restrict({deny})` 逐工具、同名空文本 section/context），不改注册表原条目，
  agent 销毁自动还原，零跨会话影响。
- Web GUI：输入栏左下角「注入」按钮（状态点：绿=全量 / 橙=有裁剪 / 灰锁=已锁定，
  未锁定时以品牌强调色点亮）+ 树表弹窗：按插件聚合、三态勾选、锁定行跳过、
  关键能力取消确认、「全选 / 全不选」三态总控、token 粗估、弹窗可拖动/缩放、
  默认全部收缩（有裁剪项的组自动展开）、类型标识配色随主题自适应。
- 会话生命周期：已开始会话（persisted ≥1 step 事件）只读锁定，「强制更改」确认后
  解锁并热生效（下一 step 生效）；新会话（hero）不误判锁定。
- 工作区级「新会话默认模板」（存为默认 / 恢复默认加载模板），新会话自动套用。
- 稳定性：影子 skill 定义预取（含 content，避免 validateDefinition 拒绝）、
  应用幂等（generation token，重复应用先 dispose 上一代 fiber）、restrict 白名单化
  （未知名跳过 + 日志）、revision 乐观锁（409 冲突提示）、写盘全量串行队列、
  孤儿会话键淘汰、回环鉴权（localhost-only）。
