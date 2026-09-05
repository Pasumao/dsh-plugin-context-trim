/**
 * dsh-plugin-context-trim — 会话注入门控插件（client 半边）
 *
 * 免构建浏览器 bundle（dsh 浏览器模块加载器格式，只 require react/jsx-runtime）。
 *
 * UI：
 *   - 会话输入栏左下角（conversation.input.left 插槽，list/session）新增「注入」
 *     按钮，按钮叠加状态点：绿=全量注入 / 橙=有裁剪 / 灰锁=已锁定；
 *   - 点击弹出树表弹窗：按插件聚合展示 skill / tool / 提示词段落，行级勾选，
 *     整插件行三态批量设置子项（跳过锁定行）；
 *   - 关键能力（文件读写/控制台/技能总闸）取消需确认弹窗；恢复免确认；
 *   - 会话已开始（persisted ≥1 step）后树表只读锁定，「强制更改」确认后解锁
 *     编辑并热生效；
 *   - 「应用」才提交 host（PUT /selection，携带 revision 乐观锁，409 提示
 *     重新加载）；支持把当前勾选存为工作区级新会话默认模板。
 *
 * 数据面：同源 fetch /dsh-plugin-context-trim/*（插件 HTTP 路由不在 0.1.2
 * token 墙内，仅服务本机 GUI）。
 *
 * @module dsh-plugin-context-trim/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-context-trim',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    var react_jsx_runtime = require('react/jsx-runtime');
    var react = require('react');
    var jsx = react_jsx_runtime.jsx;
    var jsxs = react_jsx_runtime.jsxs;
    var Fragment = react_jsx_runtime.Fragment;

    // ------------------------------------------------------------------
    // 样式：一次注入 <style>，类名 dshtrim-*，全部走主题 CSS 变量。
    // ------------------------------------------------------------------
    var CSS = [
      '.dshtrim-btn{position:relative;width:26px;height:26px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:8px;place-items:center;padding:0;display:grid}',
      '.dshtrim-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dshtrim-btn:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}',
      '.dshtrim-btnOn{color:var(--dsw-alias-brand-primary,#4c8dff)}',
      '.dshtrim-btnOn:hover:not(:disabled){color:var(--dsw-alias-brand-primary,#4c8dff)}',
      '.dshtrim-btnWarn{color:var(--dsw-alias-state-warn-primary,#e8a33d)}',
      '.dshtrim-btnWarn:hover:not(:disabled){color:var(--dsw-alias-state-warn-primary,#e8a33d)}',
      '.dshtrim-btnLocked{color:var(--dsw-alias-label-dimmed,#8a8f98)}',
      '.dshtrim-dot{position:absolute;top:2px;right:2px;width:7px;height:7px;border-radius:999px;pointer-events:none;border:1.5px solid var(--dsw-specific-input-major)}',
      '.dshtrim-dotGreen{background:#3fb26f}',
      '.dshtrim-dotOrange{background:#e8a33d}',
      '.dshtrim-dotGray{background:#8a8f98}',
      '.dshtrim-overlay{position:fixed;inset:0;z-index:9999;background:rgba(8,10,18,.55);display:flex;align-items:center;justify-content:center;padding:24px}',
      '.dshtrim-modal{position:relative;width:min(680px,94vw);max-height:min(76vh,720px);display:flex;flex-direction:column;overflow:hidden;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);border:1px solid var(--dsw-alias-border-l2-darkmode-thin);border-radius:18px;box-shadow:var(--dsw-shadow-lv2)}',
      '.dshtrim-modal,.dshtrim-modal *{box-sizing:border-box}',
      '.dshtrim-head{flex-shrink:0;justify-content:space-between;align-items:center;gap:12px;padding:14px 18px 10px;display:flex;cursor:move;user-select:none}',
      '.dshtrim-title{margin:0;font-size:15px;font-weight:600;line-height:22px}',
      '.dshtrim-subtitle{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;margin-top:2px}',
      '.dshtrim-close{width:26px;height:26px;flex-shrink:0;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:999px;place-items:center;padding:0;display:grid;font-size:14px}',
      '.dshtrim-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dshtrim-lockbar{flex-shrink:0;align-items:center;gap:10px;margin:0 18px 8px;padding:8px 12px;border-radius:10px;background:var(--dsw-alias-state-warn-tertiary,#f7e3bd);color:var(--dsw-alias-state-warn-primary,#8a5b00);font-size:12px;line-height:18px;display:flex}',
      '.dshtrim-errorBar{flex-shrink:0;align-items:center;gap:10px;margin:0 18px 8px;padding:8px 12px;border-radius:10px;background:var(--dsw-alias-state-error-tertiary,#f6c9c9);color:var(--dsw-alias-state-error-primary,#a02020);font-size:12px;line-height:18px;display:flex}',
      '.dshtrim-body{overscroll-behavior:contain;flex-direction:column;flex:auto;min-height:0;margin:0 10px;padding:0 8px;border-top:1px solid var(--dsw-alias-border-l2-darkmode-thin);display:flex;overflow-y:auto}',
      '.dshtrim-group{border-bottom:1px solid var(--dsw-alias-border-l2-darkmode-thin)}',
      '.dshtrim-group:last-child{border-bottom:none}',
      '.dshtrim-groupRow{width:100%;color:inherit;align-items:center;gap:4px;padding:4px 4px;display:flex}',
      '.dshtrim-caretBtn{width:20px;height:24px;flex-shrink:0;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:6px;place-items:center;padding:0;display:grid}',
      '.dshtrim-caretBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dshtrim-checkBtn{flex-shrink:0;background:0 0;border:none;border-radius:6px;padding:2px;cursor:pointer;display:grid;place-items:center}',
      '.dshtrim-checkBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dshtrim-groupNameBtn{flex:auto;min-width:0;color:inherit;text-align:left;cursor:pointer;background:0 0;border:none;border-radius:8px;align-items:center;gap:8px;padding:5px 6px;display:flex}',
      '.dshtrim-groupNameBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dshtrim-caret{flex-shrink:0;width:14px;color:var(--dsw-alias-label-tertiary);font-size:10px;text-align:center;transition:transform .12s ease;display:inline-block}',
      '.dshtrim-caretOpen{transform:rotate(90deg)}',
      '.dshtrim-groupName{flex:auto;min-width:0;font-size:13px;font-weight:600;line-height:20px;overflow-wrap:anywhere}',
      '.dshtrim-count{flex-shrink:0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
      '.dshtrim-rows{flex-direction:column;display:flex}',
      '.dshtrim-row{width:100%;color:inherit;cursor:pointer;text-align:left;background:0 0;border:none;border-radius:8px;align-items:center;gap:8px;padding:5px 6px;display:flex}',
      '.dshtrim-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dshtrim-name{font-size:13px;line-height:19px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow-wrap:anywhere}',
      '.dshtrim-desc{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px;margin-top:1px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
      '.dshtrim-badge{flex-shrink:0;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
      // 类型配色跟随主题（primary=文字 / tertiary=底色，浅色深色主题各自解析）。
      '.dshtrim-badgeSkill{background:var(--dsw-alias-state-success-tertiary,rgba(63,178,111,.14));color:var(--dsw-alias-state-success-primary,#3fb26f)}',
      '.dshtrim-badgeTool{background:var(--dsw-alias-state-business-tertiary,rgba(76,141,255,.13));color:var(--dsw-alias-state-business-primary,#6f9dff)}',
      '.dshtrim-badgeSection{background:var(--dsw-alias-state-warn-tertiary,rgba(232,163,61,.14));color:var(--dsw-alias-state-warn-primary,#e8a33d)}',
      '.dshtrim-badgeContext{background:0 0;color:var(--dsw-alias-state-error-primary,#f25a5a);border:1px solid var(--dsw-alias-state-error-primary,#f25a5a)}',
      '.dshtrim-badgeVariable{background:0 0;color:var(--dsw-alias-label-tertiary);border:1px dashed var(--dsw-alias-border-l2)}',
      '.dshtrim-badgeCritical{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-primary)}',
      '.dshtrim-badgeLocked{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-dimmed)}',
      '.dshtrim-check{width:17px;height:17px;flex-shrink:0;border:1.5px solid var(--dsw-alias-border-l2);border-radius:5px;place-items:center;display:grid;font-size:11px;line-height:1;color:transparent}',
      '.dshtrim-checkChecked{background:var(--dsw-alias-interactive-bg-active);border-color:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary-inverted)}',
      '.dshtrim-checkPartial{border-color:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-interactive-bg-active);font-weight:700}',
      '.dshtrim-rowDisabled{opacity:.45;cursor:default}',
      '.dshtrim-rowDisabled:hover{background:0 0}',
      '.dshtrim-foot{flex-shrink:0;justify-content:space-between;align-items:center;gap:10px;padding:10px 18px 14px;display:flex}',
      '.dshtrim-footInfo{flex:auto;min-width:0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
      '.dshtrim-actions{flex-shrink:0;align-items:center;gap:8px;display:flex}',
      '.dshtrim-btnOutline{appearance:none;cursor:pointer;border-radius:999px;border:1px solid var(--dsw-alias-border-l2-darkmode-thin);background:0 0;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;padding:5px 12px;font-family:inherit}',
      '.dshtrim-btnOutline:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.dshtrim-btnOutline:disabled{cursor:default;opacity:.55}',
      '.dshtrim-allBtn{display:inline-flex;align-items:center;gap:6px}',
      '.dshtrim-btnPrimary{appearance:none;cursor:pointer;border-radius:999px;border:1px solid transparent;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary,#4c8dff));color:var(--dsw-alias-label-primary-inverted,#fff);font-size:12px;line-height:18px;padding:5px 14px;font-family:inherit}',
      '.dshtrim-btnPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary,#4c8dff))}',
      '.dshtrim-btnPrimary:disabled{cursor:default;opacity:1;background:var(--dsw-alias-button-primary-dimmed,var(--dsw-alias-label-dimmed,#8a8f98));color:var(--dsw-alias-label-primary,#fff)}',
      '.dshtrim-confirm{position:fixed;inset:0;z-index:10000;background:rgba(8,10,18,.55);display:flex;align-items:center;justify-content:center;padding:24px}',
      '.dshtrim-confirmCard{width:min(420px,90vw);color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);border:1px solid var(--dsw-alias-border-l2-darkmode-thin);border-radius:14px;box-shadow:var(--dsw-shadow-lv2);padding:16px 18px}',
      '.dshtrim-confirmTitle{margin:0 0 8px;font-size:14px;font-weight:600;line-height:20px}',
      '.dshtrim-confirmText{color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:19px;white-space:pre-wrap;word-break:break-word}',
      '.dshtrim-confirmActions{justify-content:flex-end;gap:8px;margin-top:14px;display:flex}',
      '.dshtrim-loading{padding:24px 0;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px}',
      '.dshtrim-resize{position:absolute;right:3px;bottom:3px;width:20px;height:20px;cursor:nwse-resize;color:var(--dsw-alias-label-tertiary);display:grid;place-items:end center;padding:3px}',
      '.dshtrim-resize:hover{color:var(--dsw-alias-label-primary)}',
      '.dshtrim-resizeGrip{width:10px;height:10px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;opacity:.45;border-radius:1px}',
      '@media (width<=720px){.dshtrim-modal{border-radius:14px}}'
    ].join('');
    var tagId = 'dsh-plugin-context-trim/gate.module.css';
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {
      var tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-plugin-context-trim';
      tag.dataset.pluginCss = tagId;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    // ------------------------------------------------------------------
    // 常量与纯函数（导出供 selfcheck 冒烟）
    // ------------------------------------------------------------------
    var API = '/dsh-plugin-context-trim';

    /** 组 id → 展示名（catalog 未给 groupLabel 的回退）。 */
    var GROUP_LABELS = {
      'builtin-tools': '内置工具',
      'runtime-skills': '运行时技能',
      'project-skills': '项目技能',
      'user-skills': '用户技能',
      'bundled-skills': '随包技能',
      'core-sections': '核心段落（锁定）',
      'core-variables': '核心变量（由段落间接控制）',
      'reserved': '保留（不可门控）'
    };

    function groupDisplayName(groupId, fallback) {
      if (typeof fallback === 'string' && fallback !== '') return fallback;
      return GROUP_LABELS[groupId] ?? groupId;
    }

    /** 组排序权重：插件组 → MCP → 关键组 → 内置 → 保留 → 运行时技能 → 核心。 */
    function groupOrder(groupId) {
      if (groupId.startsWith('dsh-plugin-')) return 0;
      if (groupId.startsWith('mcp:')) return 1;
      if (groupId.startsWith('critical:')) return 2;
      if (groupId === 'builtin-tools') return 3;
      if (groupId === 'reserved') return 4;
      if (groupId === 'runtime-skills' || groupId === 'project-skills' || groupId === 'user-skills' || groupId === 'bundled-skills') return 5;
      return 6;
    }

    var KIND_LABELS = { skill: '📖 skill', tool: '🔧 tool', section: '📝 段落', context: '🧩 上下文', variable: '𝑥 变量' };
    var KIND_ICONS = { skill: '📖', tool: '🔧', section: '📝', context: '🧩', variable: '𝑥' };
    var BADGE_CLASSES = {
      skill: ' dshtrim-badgeSkill',
      tool: ' dshtrim-badgeTool',
      section: ' dshtrim-badgeSection',
      context: ' dshtrim-badgeContext',
      variable: ' dshtrim-badgeVariable'
    };

    /** 组的主导类型图标（折叠时提示组内条目类型）。 */
    function groupIcon(group) {
      var counts = {};
      var best = null;
      var bestN = 0;
      for (var i = 0; i < group.rows.length; i++) {
        var k = group.rows[i].kind;
        counts[k] = (counts[k] ?? 0) + 1;
        if (counts[k] > bestN) { bestN = counts[k]; best = k; }
      }
      return best !== null ? (KIND_ICONS[best] ?? '') : '';
    }

    /** 由行数组构建组视图：[{ id, label, rows, gatableCount }]，组间按 groupOrder、组内按 kind+name 排序。 */
    function buildGroups(rows) {
      var byId = new Map();
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var list = byId.get(row.group);
        if (list === undefined) {
          list = [];
          byId.set(row.group, list);
        }
        list.push(row);
      }
      var groups = [];
      byId.forEach(function (list, id) {
        list.sort(function (a, b) {
          var ka = (a.kind ?? '') + ':' + a.name;
          var kb = (b.kind ?? '') + ':' + b.name;
          return ka < kb ? -1 : ka > kb ? 1 : 0;
        });
        groups.push({
          id: id,
          label: groupDisplayName(id, list[0] && list[0].groupLabel),
          rows: list,
          gatableCount: list.filter(function (r) { return r.gatable !== false; }).length
        });
      });
      groups.sort(function (a, b) {
        var oa = groupOrder(a.id);
        var ob = groupOrder(b.id);
        return oa !== ob ? oa - ob : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      });
      return groups;
    }

    /** token 粗估：被裁剪行的描述/名字字符数折算（仅供参考）。 */
    function estimateSavedChars(rows, unchecked) {
      var n = 0;
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (unchecked[row.key] === false) n += (row.description ?? '').length + (row.whenToUse ?? '').length + row.name.length;
      }
      return n;
    }

    function fetchJson(url, options) {
      return fetch(url, options).then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, status: res.status, body: body };
        }, function () {
          return { ok: res.ok, status: res.status, body: null };
        });
      });
    }

    // ------------------------------------------------------------------
    // 三态勾选框
    // ------------------------------------------------------------------
    function TriCheck(props) {
      var state = props.state; // 'checked' | 'partial' | 'unchecked'
      var cls = state === 'checked' ? ' dshtrim-checkChecked' : state === 'partial' ? ' dshtrim-checkPartial' : '';
      return jsx('span', {
        className: 'dshtrim-check' + cls,
        role: 'checkbox',
        'aria-checked': state === 'checked' ? 'true' : state === 'partial' ? 'mixed' : 'false',
        children: state === 'checked' ? '\u2713' : state === 'partial' ? '\u2013' : null
      });
    }

    // ------------------------------------------------------------------
    // 确认弹窗（关键能力取消 / 强制更改）
    // ------------------------------------------------------------------
    function ConfirmDialog(props) {
      return jsx('div', {
        className: 'dshtrim-confirm',
        onClick: props.onCancel,
        children: jsxs('div', {
          className: 'dshtrim-confirmCard',
          onClick: function (e) { e.stopPropagation(); },
          children: [
            jsx('p', { className: 'dshtrim-confirmTitle', children: props.title }),
            jsx('p', { className: 'dshtrim-confirmText', children: props.text }),
            jsxs('div', {
              className: 'dshtrim-confirmActions',
              children: [
                jsx('button', { type: 'button', className: 'dshtrim-btnOutline', onClick: props.onCancel, children: '取消' }),
                jsx('button', { type: 'button', className: 'dshtrim-btnPrimary', onClick: props.onConfirm, children: props.confirmLabel ?? '确定' })
              ]
            })
          ]
        })
      });
    }

    // ------------------------------------------------------------------
    // 单行 / 组行
    // ------------------------------------------------------------------
    function GateRow(props) {
      var row = props.row;
      var checked = props.checked;
      var disabled = props.disabled || row.gatable === false;
      var title = row.description !== '' ? row.name + '\n' + row.description : row.name;
      return jsxs('button', {
        type: 'button',
        className: 'dshtrim-row' + (disabled ? ' dshtrim-rowDisabled' : ''),
        onClick: disabled ? undefined : function () { props.onToggle(row); },
        children: [
          jsx(TriCheck, { state: row.gatable === false ? 'checked' : (checked ? 'checked' : 'unchecked') }),
          jsxs('span', { style: { flex: 'auto', minWidth: 0 }, children: [
            jsx('div', { className: 'dshtrim-name', title: title, children: row.name }),
            row.description !== '' && row.description !== undefined ? jsx('div', { className: 'dshtrim-desc', children: row.description }) : null
          ] }),
          jsx('span', { className: 'dshtrim-badge' + (BADGE_CLASSES[row.kind] ?? ''), children: KIND_LABELS[row.kind] ?? row.kind }),
          row.critical === true ? jsx('span', { className: 'dshtrim-badge dshtrim-badgeCritical', children: '\u26a0 关键' }) : null,
          row.gatable === false ? jsx('span', { className: 'dshtrim-badge dshtrim-badgeLocked', children: '\u{1F512} 锁定' }) : null
        ]
      });
    }

    function GateGroup(props) {
      var group = props.group;
      var open = props.open;
      var lockedNote = group.gatableCount < group.rows.length ? '（' + (group.rows.length - group.gatableCount) + ' 项锁定）' : '';
      return jsxs('div', {
        className: 'dshtrim-group',
        children: [
          jsxs('div', {
            className: 'dshtrim-groupRow',
            children: [
              jsx('button', {
                type: 'button',
                className: 'dshtrim-caretBtn',
                title: open ? '折叠' : '展开',
                onClick: function () { props.onToggleOpen(group.id); },
                children: jsx('span', { className: 'dshtrim-caret' + (open ? ' dshtrim-caretOpen' : ''), children: '\u25B6' })
              }),
              jsx('button', {
                type: 'button',
                className: 'dshtrim-checkBtn',
                title: '批量勾选 / 取消本组（跳过锁定项）',
                onClick: function () { props.onToggleGroup(group); },
                children: jsx(TriCheck, { state: props.state })
              }),
              jsx('button', {
                type: 'button',
                className: 'dshtrim-groupNameBtn',
                onClick: function () { props.onToggleOpen(group.id); },
                children: [
                  jsx('span', { className: 'dshtrim-groupName', children: groupIcon(group) + ' ' + group.label }),
                  jsx('span', { className: 'dshtrim-count', children: group.rows.length + ' 项' + lockedNote })
                ]
              })
            ]
          }),
          open ? jsx('div', {
            className: 'dshtrim-rows',
            children: group.rows.map(function (row) {
              return jsx(GateRow, {
                row: row,
                checked: props.rowChecked(row.key),
                disabled: props.disabled,
                onToggle: props.onToggleRow
              }, row.key);
            })
          }) : null
        ]
      }, group.id);
    }

    // ------------------------------------------------------------------
    // 弹窗主体
    // ------------------------------------------------------------------
    function GateModal(props) {
      var sessionId = props.sessionId;
      var onClose = props.onClose;
      var onApplied = props.onApplied;

      var phaseState = react.useState('loading');
      var phase = phaseState[0];
      var setPhase = phaseState[1];
      var catalogState = react.useState(null);
      var catalog = catalogState[0];
      var setCatalog = catalogState[1];
      var uncheckedState = react.useState({});
      var unchecked = uncheckedState[0];
      var setUnchecked = uncheckedState[1];
      var openGroupsState = react.useState(function () { return new Set(); });
      var openGroups = openGroupsState[0];
      var setOpenGroups = openGroupsState[1];
      var startedState = react.useState(false);
      var started = startedState[0];
      var setStarted = startedState[1];
      var forcedUnlockedState = react.useState(false);
      var forcedUnlocked = forcedUnlockedState[0];
      var setForcedUnlocked = forcedUnlockedState[1];
      var revisionState = react.useState(0);
      var revision = revisionState[0];
      var setRevision = revisionState[1];
      var defaultRevState = react.useState(0);
      var defaultRevision = defaultRevState[0];
      var setDefaultRevision = defaultRevState[1];
      var confirmState = react.useState(null);
      var confirm = confirmState[0];
      var setConfirm = confirmState[1];
      var busyState = react.useState(false);
      var busy = busyState[0];
      var setBusy = busyState[1];
      var errorState = react.useState(null);
      var errorText = errorState[0];
      var setErrorText = errorState[1];
      var noteState = react.useState(null);
      var savedNote = noteState[0];
      var setSavedNote = noteState[1];

      // ---- 拖动 / 缩放（稳定监听一次，手势数据走 ref，避免重渲染泄漏监听） ----
      var modalRef = react.useRef(null);
      var modeRef = react.useRef(null); // null | {type:'drag',sx,sy,ox,oy} | {type:'resize',sx,sy,w0,h0}
      var offsetRef = react.useRef({ x: 0, y: 0 });
      var sizeRef = react.useRef({ w: 0, h: 0 }); // 0 = 默认 CSS 尺寸
      var movedRef = react.useRef(false); // 本次手势是否移动过（抑制误触遮罩关闭）
      var offsetState = react.useState({ x: 0, y: 0 });
      var offset = offsetState[0];
      var setOffset = offsetState[1];
      var sizeState = react.useState({ w: 0, h: 0 });
      var size = sizeState[0];
      var setSize = sizeState[1];

      react.useEffect(function () {
        function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
        function onMove(e) {
          var m = modeRef.current;
          if (!m) return;
          if (m.type === 'drag') {
            var nx = clamp(m.ox + (e.clientX - m.sx), -window.innerWidth + 200, window.innerWidth - 200);
            var ny = clamp(m.oy + (e.clientY - m.sy), -window.innerHeight + 120, window.innerHeight - 120);
            offsetRef.current = { x: nx, y: ny };
            movedRef.current = true;
            setOffset({ x: nx, y: ny });
          } else {
            var w = clamp(m.w0 + (e.clientX - m.sx), 420, window.innerWidth * 0.94);
            var h = clamp(m.h0 + (e.clientY - m.sy), 320, window.innerHeight * 0.9);
            sizeRef.current = { w: w, h: h };
            movedRef.current = true;
            setSize({ w: w, h: h });
          }
        }
        function onUp() { modeRef.current = null; }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        return function () {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };
      }, []);

      function beginDrag(e) {
        if (e.button !== 0) return;
        if (e.target && typeof e.target.closest === 'function' && e.target.closest('button')) return;
        modeRef.current = { type: 'drag', sx: e.clientX, sy: e.clientY, ox: offsetRef.current.x, oy: offsetRef.current.y };
        movedRef.current = false;
      }
      function beginResize(e) {
        if (e.button !== 0) return;
        e.stopPropagation();
        var rect = modalRef.current ? modalRef.current.getBoundingClientRect() : { width: 680, height: 520 };
        modeRef.current = { type: 'resize', sx: e.clientX, sy: e.clientY, w0: rect.width, h0: rect.height };
        movedRef.current = false;
      }

      // 初次打开：并行拉 catalog + selection，初始化勾选与展开组。
      react.useEffect(function () {
        var alive = true;
        setPhase('loading');
        Promise.all([
          fetchJson(API + '/catalog?sessionId=' + encodeURIComponent(sessionId) + '&cwd=' + encodeURIComponent(props.cwd ?? '')),
          fetchJson(API + '/selection?sessionId=' + encodeURIComponent(sessionId))
        ]).then(function (results) {
          if (!alive) return;
          var cat = results[0];
          var sel = results[1];
          if (!cat.ok || !sel.ok || cat.body === null || sel.body === null) {
            setPhase('error');
            setErrorText('读取目录失败（HTTP ' + cat.status + ' / ' + sel.status + '）');
            return;
          }
          setCatalog(cat.body);
          var selMap = Object.assign({}, cat.body.effective?.selections ?? {}, sel.body.selections ?? {});
          setUnchecked(selMap);
          setRevision(sel.body.revision ?? 0);
          setStarted(sel.body.started === true);
          setForcedUnlocked(false);
          var rows = []
            .concat(cat.body.skills ?? [])
            .concat(cat.body.tools ?? [])
            .concat(cat.body.sections ?? [])
            .concat(cat.body.contexts ?? [])
            .concat(cat.body.variables ?? []);
          var groups = buildGroups(rows);
          // 默认全部收缩，只展开有裁剪项的组（让当前生效的门控一眼可见）。
          var initial = new Set();
          for (var i = 0; i < groups.length; i++) {
            var g = groups[i];
            if (g.rows.some(function (r) { return selMap[r.key] === false; })) initial.add(g.id);
          }
          setOpenGroups(initial);
          setPhase('ready');
        }).catch(function (error) {
          if (!alive) return;
          setPhase('error');
          setErrorText('读取目录失败：' + (error?.message ?? error));
        });
        return function () { alive = false; };
      }, [sessionId]);

      var rowsAll = react.useMemo(function () {
        if (catalog === null) return [];
        return []
          .concat(catalog.skills ?? [])
          .concat(catalog.tools ?? [])
          .concat(catalog.sections ?? [])
          .concat(catalog.contexts ?? [])
          .concat(catalog.variables ?? []);
      }, [catalog]);
      var groups = react.useMemo(function () { return buildGroups(rowsAll); }, [rowsAll]);

      // 默认模板 revision：弹窗打开后拉一次（保存时乐观锁用）。
      var workspaceKey = props.cwd ?? catalog?.workspaceKey ?? '';
      react.useEffect(function () {
        if (workspaceKey === '') return undefined;
        var alive = true;
        fetchJson(API + '/defaults?cwd=' + encodeURIComponent(workspaceKey)).then(function (res) {
          if (alive && res.ok && res.body !== null) setDefaultRevision(res.body.revision ?? 0);
        }).catch(function () {});
        return function () { alive = false; };
      }, [workspaceKey]);

      function rowChecked(key) {
        return unchecked[key] !== false;
      }

      function groupState(group) {
        var total = 0;
        var checkedCount = 0;
        for (var i = 0; i < group.rows.length; i++) {
          var row = group.rows[i];
          if (row.gatable === false) continue;
          total++;
          if (rowChecked(row.key)) checkedCount++;
        }
        if (total === 0) return 'checked';
        if (checkedCount === 0) return 'unchecked';
        return checkedCount === total ? 'checked' : 'partial';
      }

      function isCriticalRow(row) {
        return row.critical === true || (row.group ?? '').startsWith('critical:');
      }

      function setUncheckedNext(update) {
        setUnchecked(function (prev) { return update(Object.assign({}, prev)); });
        setSavedNote(null);
      }

      function toggleRow(row) {
        if (busy) return;
        var willCheck = unchecked[row.key] === false; // 当前被取消 → 恢复勾选（免确认）
        if (!willCheck && isCriticalRow(row)) {
          var extra = row.name === 'skill' ? '\n特别地，取消 skill（技能总闸）后技能目录将停止更新。' : '';
          setConfirm({
            title: '取消关键能力「' + row.name + '」？',
            text: '取消后，本会话将失去该关键能力，agent 大部分任务可能无法完成。' + extra + '\n确定取消？（误触只需再勾回来，恢复免确认）',
            confirmLabel: '取消注入',
            onConfirm: function () {
              setConfirm(null);
              setUncheckedNext(function (next) { delete next[row.key]; next[row.key] = false; return next; });
            }
          });
          return;
        }
        setUncheckedNext(function (next) {
          if (willCheck) delete next[row.key];
          else next[row.key] = false;
          return next;
        });
      }

      function toggleGroup(group) {
        if (busy) return;
        var state = groupState(group);
        var target = state === 'checked' ? false : true; // 全选→全不选；部分/全不选→全选
        var gatableKeys = [];
        var criticalRows = [];
        for (var i = 0; i < group.rows.length; i++) {
          var row = group.rows[i];
          if (row.gatable === false) continue;
          gatableKeys.push(row.key);
          if (isCriticalRow(row)) criticalRows.push(row);
        }
        if (!target && criticalRows.length > 0) {
          var names = criticalRows.map(function (r) { return r.name; });
          setConfirm({
            title: '取消关键能力？',
            text: '该操作将同时取消关键能力：' + names.join('、') + '。\n取消后本会话可能无法读写文件或执行命令。确定取消？（恢复免确认）',
            confirmLabel: '取消注入',
            onConfirm: function () {
              setConfirm(null);
              setUncheckedNext(function (next) {
                for (var j = 0; j < gatableKeys.length; j++) next[gatableKeys[j]] = false;
                return next;
              });
            }
          });
          return;
        }
        setUncheckedNext(function (next) {
          for (var j = 0; j < gatableKeys.length; j++) {
            if (target) delete next[gatableKeys[j]];
            else next[gatableKeys[j]] = false;
          }
          return next;
        });
      }

      function toggleOpen(id) {
        setOpenGroups(function (prev) {
          var next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      }

      /** 全局三态：所有可门控行的勾选状态。 */
      function allState() {
        var total = 0;
        var checkedCount = 0;
        for (var i = 0; i < rowsAll.length; i++) {
          var row = rowsAll[i];
          if (row.gatable === false) continue;
          total++;
          if (rowChecked(row.key)) checkedCount++;
        }
        if (total === 0) return 'checked';
        if (checkedCount === 0) return 'unchecked';
        return checkedCount === total ? 'checked' : 'partial';
      }

      /** 全选/全不选总控：跳过锁定行；取消时含关键能力则先确认。 */
      function toggleAll() {
        if (busy) return;
        var state = allState();
        var target = state === 'checked' ? false : true; // 全选→全不选；部分/全不选→全选
        var gatableKeys = [];
        var criticalCount = 0;
        for (var i = 0; i < rowsAll.length; i++) {
          var row = rowsAll[i];
          if (row.gatable === false) continue;
          gatableKeys.push(row.key);
          if (isCriticalRow(row)) criticalCount++;
        }
        if (!target && criticalCount > 0) {
          setConfirm({
            title: '取消全部注入（含关键能力）？',
            text: '该操作将取消全部 ' + gatableKeys.length + ' 项，其中含 ' + criticalCount + ' 项关键能力（文件读写/控制台/技能总闸等）。\n取消后本会话可能完全无法执行任务。确定取消？（恢复免确认）',
            confirmLabel: '全部取消',
            onConfirm: function () {
              setConfirm(null);
              setUncheckedNext(function (next) {
                for (var j = 0; j < gatableKeys.length; j++) next[gatableKeys[j]] = false;
                return next;
              });
            }
          });
          return;
        }
        setUncheckedNext(function (next) {
          for (var j = 0; j < gatableKeys.length; j++) {
            if (target) delete next[gatableKeys[j]];
            else next[gatableKeys[j]] = false;
          }
          return next;
        });
      }

      /** 恢复默认：加载该工作区的新会话默认模板（无模板则恢复全量注入）。 */
      function doLoadDefault() {
        if (busy || phase !== 'ready' || workspaceKey === '') return;
        setErrorText(null);
        fetchJson(API + '/defaults?cwd=' + encodeURIComponent(workspaceKey)).then(function (res) {
          if (!res.ok || res.body === null) {
            setErrorText('默认模板读取失败（HTTP ' + res.status + '）');
            return;
          }
          var sel = Object.assign({}, res.body.selections ?? {});
          setUncheckedNext(function () { return sel; });
          setDefaultRevision(res.body.revision ?? 0);
          setSavedNote(res.body.exists === true ? '已加载该工作区的默认模板。' : '该工作区暂无默认模板，已恢复全量注入。');
        }).catch(function (error) {
          setErrorText('默认模板读取失败：' + (error?.message ?? error));
        });
      }

      function doApply() {
        if (busy || phase !== 'ready') return;
        setBusy(true);
        setErrorText(null);
        fetchJson(API + '/selection?sessionId=' + encodeURIComponent(sessionId), {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ revision: revision, selections: unchecked, forced: started && forcedUnlocked })
        }).then(function (res) {
          setBusy(false);
          if (res.status === 409) {
            setErrorText('保存冲突：该会话的选择刚被其他窗口修改过，请点击「重新加载」。');
            return;
          }
          if (!res.ok || res.body === null || res.body.ok !== true) {
            setErrorText('保存失败（HTTP ' + res.status + '）');
            return;
          }
          setRevision(res.body.revision ?? revision + 1);
          setSavedNote('已应用' + (res.body.hotApplied ? '，本会话已热生效' : '') + '。');
          onApplied();
        }).catch(function (error) {
          setBusy(false);
          setErrorText('保存失败：' + (error?.message ?? error));
        });
      }

      function doReload() {
        onClose();
        onApplied();
      }

      function doForceChange() {
        setConfirm({
          title: '强制更改会话注入？',
          text: '会话已开始，注入处于锁定态。强制更改会立即修改本会话的上下文注入（skills 目录 / 工具 / 提示词段落逐 step 重算，下一步生效），并保持解锁直至会话结束。',
          confirmLabel: '解锁并编辑',
          onConfirm: function () {
            setConfirm(null);
            setForcedUnlocked(true);
          }
        });
      }

      function doSaveDefault() {
        if (busy || phase !== 'ready' || workspaceKey === '') return;
        setBusy(true);
        setErrorText(null);
        fetchJson(API + '/defaults?cwd=' + encodeURIComponent(workspaceKey), {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ revision: defaultRevision, selections: unchecked })
        }).then(function (res) {
          setBusy(false);
          if (res.status === 409) {
            setErrorText('默认模板保存冲突：刚被其他窗口修改过，请重开弹窗再试。');
            return;
          }
          if (!res.ok || res.body === null || res.body.ok !== true) {
            setErrorText('默认模板保存失败（HTTP ' + res.status + '）');
            return;
          }
          setDefaultRevision(res.body.revision ?? defaultRevision + 1);
          setSavedNote('已存为该工作区的新会话默认模板。');
        }).catch(function (error) {
          setBusy(false);
          setErrorText('默认模板保存失败：' + (error?.message ?? error));
        });
      }

      var locked = started && !forcedUnlocked;
      var savedChars = estimateSavedChars(rowsAll, unchecked);
      var trimmedCount = rowsAll.filter(function (r) { return unchecked[r.key] === false; }).length;

      return jsxs(Fragment, {
        children: [
          jsx('div', {
            className: 'dshtrim-overlay',
            onClick: function () {
              if (movedRef.current) { movedRef.current = false; return; } // 拖动/缩放手势结束不误触关闭
              onClose();
            },
            children: jsxs('div', {
              ref: modalRef,
              className: 'dshtrim-modal',
              style: {
                transform: 'translate(' + offset.x + 'px, ' + offset.y + 'px)',
                ...(size.w > 0 ? { width: size.w + 'px' } : {}),
                ...(size.h > 0 ? { height: size.h + 'px' } : {})
              },
              onClick: function (e) { e.stopPropagation(); },
              children: [
                jsxs('div', { className: 'dshtrim-head', onPointerDown: beginDrag, children: [
                  jsxs('div', { children: [
                    jsx('div', { className: 'dshtrim-title', children: '会话注入管理' }),
                    jsx('div', { className: 'dshtrim-subtitle', children: '控制本会话向模型注入哪些 skill / tool / 提示词段落' })
                  ] }),
                  jsx('button', { type: 'button', className: 'dshtrim-close', onClick: onClose, 'aria-label': '关闭', children: '\u2715' })
                ] }),
                locked ? jsxs('div', { className: 'dshtrim-lockbar', children: [
                  jsx('span', { style: { flex: 'auto' }, children: '会话已开始，注入已锁定。' }),
                  jsx('button', { type: 'button', className: 'dshtrim-btnOutline', onClick: doForceChange, children: '强制更改' })
                ] }) : null,
                errorText !== null ? jsxs('div', { className: 'dshtrim-errorBar', children: [
                  jsx('span', { style: { flex: 'auto' }, children: errorText }),
                  jsx('button', { type: 'button', className: 'dshtrim-btnOutline', onClick: doReload, children: '重新加载' })
                ] }) : null,
                jsx('div', {
                  className: 'dshtrim-body',
                  children: phase === 'loading'
                    ? jsx('div', { className: 'dshtrim-loading', children: '加载目录中…' })
                    : phase === 'error'
                      ? jsx('div', { className: 'dshtrim-loading', children: '目录加载失败' })
                      : groups.map(function (group) {
                        return jsx(GateGroup, {
                          group: group,
                          open: openGroups.has(group.id),
                          state: groupState(group),
                          disabled: locked || busy,
                          rowChecked: rowChecked,
                          onToggleOpen: toggleOpen,
                          onToggleRow: toggleRow,
                          onToggleGroup: toggleGroup
                        }, group.id);
                      })
                }),
                jsxs('div', { className: 'dshtrim-foot', children: [
                  jsx('div', { className: 'dshtrim-footInfo', children:
                    (savedNote ?? (trimmedCount > 0
                      ? '已裁剪 ' + trimmedCount + ' 项，预计每步请求减少约 ' + savedChars + ' 字符（粗估）'
                      : '全量注入（与默认行为一致）')) +
                    (catalog !== null && catalog.sectionsViaColdFallback === true ? '；段落枚举可能不完整' : '')
                  }),
                  jsxs('div', { className: 'dshtrim-actions', children: [
                    jsxs('button', { type: 'button', className: 'dshtrim-btnOutline dshtrim-allBtn', disabled: locked || busy || phase !== 'ready', onClick: toggleAll, title: '全选 / 全不选（跳过锁定项；取消关键能力会先确认）', children: [
                      jsx(TriCheck, { state: allState() }),
                      '全选'
                    ] }),
                    jsx('button', { type: 'button', className: 'dshtrim-btnOutline', disabled: locked || busy || phase !== 'ready', onClick: doLoadDefault, title: '加载该工作区的新会话默认模板（无模板则恢复全量注入）', children: '恢复默认' }),
                    jsx('button', { type: 'button', className: 'dshtrim-btnOutline', disabled: locked || busy || phase !== 'ready', onClick: doSaveDefault, title: '把当前勾选保存为该工作区新会话的默认模板', children: '存为默认' }),
                    jsx('button', { type: 'button', className: 'dshtrim-btnOutline', disabled: busy, onClick: onClose, children: '关闭' }),
                    jsx('button', { type: 'button', className: 'dshtrim-btnPrimary', disabled: locked || busy || phase !== 'ready', onClick: doApply, children: busy ? '应用中…' : '应用' })
                  ] })
                ] }),
                jsx('div', { className: 'dshtrim-resize', title: '拖动调整大小', onPointerDown: beginResize, children:
                  jsx('span', { className: 'dshtrim-resizeGrip', 'aria-hidden': 'true' })
                })
              ]
            })
          }),
          confirm !== null ? jsx(ConfirmDialog, {
            title: confirm.title,
            text: confirm.text,
            confirmLabel: confirm.confirmLabel,
            onConfirm: confirm.onConfirm,
            onCancel: function () { setConfirm(null); }
          }) : null
        ]
      });
    }

    // ------------------------------------------------------------------
    // 插槽组件：按钮 + 状态点 + 弹窗开关
    // ------------------------------------------------------------------
    function GateButton(props) {
      var sessionId = props.sessionId;
      var openState = react.useState(false);
      var open = openState[0];
      var setOpen = openState[1];
      var dotState = react.useState('green');
      var dot = dotState[0];
      var setDot = dotState[1];

      react.useEffect(function () {
        if (sessionId === undefined || sessionId === null || sessionId === '') return undefined;
        var alive = true;
        function poll() {
          fetchJson(API + '/status?sessionId=' + encodeURIComponent(sessionId)).then(function (res) {
            if (alive && res.ok && res.body !== null && typeof res.body.dot === 'string') {
              setDot(res.body.dot);
            }
          }).catch(function () {});
        }
        poll();
        var timer = setInterval(poll, 8000);
        return function () {
          alive = false;
          clearInterval(timer);
        };
      }, [sessionId]);

      if (sessionId === undefined || sessionId === null || sessionId === '') return null;

      var dotClass = dot === 'orange' ? ' dshtrim-dotOrange' : dot === 'gray' ? ' dshtrim-dotGray' : ' dshtrim-dotGreen';
      // 未锁定时按钮点亮：绿=激活色、橙=警示色；仅锁定态灰显。
      var btnClass = 'dshtrim-btn' + (dot === 'orange' ? ' dshtrim-btnWarn' : dot === 'gray' ? ' dshtrim-btnLocked' : ' dshtrim-btnOn');
      var label = dot === 'orange' ? '注入（本会话有裁剪）' : dot === 'gray' ? '注入（已锁定）' : '注入（全量）';

      return jsxs(Fragment, {
        children: [
          jsxs('button', {
            type: 'button',
            className: btnClass,
            title: label,
            'aria-label': label,
            onMouseDown: function (e) { e.preventDefault(); },
            onClick: function () { setOpen(true); },
            children: [
              jsx('svg', { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true', children:
                jsx('path', { d: 'M2 3h12L9.5 8.5V13l-3 1.5V8.5L2 3z', stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round' })
              }),
              jsx('span', { className: 'dshtrim-dot' + dotClass, 'data-dot': dot })
            ]
          }),
          open ? jsx(GateModal, {
            sessionId: sessionId,
            cwd: typeof props.cwd === 'string' ? props.cwd : undefined,
            onClose: function () { setOpen(false); },
            onApplied: function () { /* 状态点由 8s 轮询刷新 */ }
          }) : null
        ]
      });
    }

    function apply(ctx) {
      ctx.slots.inject('conversation.input.left', function () {
        return ctx.slots.register({
          name: 'conversation.input.left',
          id: 'session-gate',
          order: 40
        }, GateButton);
      });
    }

    exports.apply = apply;
    exports.inject = ['slots'];
    exports.GateButton = GateButton;
    exports.GateModal = GateModal;
    exports.buildGroups = buildGroups;
    exports.groupOrder = groupOrder;
    exports.estimateSavedChars = estimateSavedChars;
    return module.exports;
  }
});
