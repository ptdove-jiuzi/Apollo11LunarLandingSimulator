# -*- coding: utf-8 -*-
import io
def patch(p, pairs):
    s = io.open(p, encoding='utf-8').read()
    for old, new in pairs:
        assert s.count(old) == 1, (p, old[:60], s.count(old))
        s = s.replace(old, new)
    io.open(p, 'w', encoding='utf-8').write(s)
    print('patched', p)

patch('AGENT_HANDOFF/07-未完成项定位与交接.md', [
 ("""    —— TOF 候选表在函数体第 25 行左右：
    `var tofs = [64*3600, 68*3600, 72*3600, 76*3600, 80*3600];`""",
  """    —— TOF 候选表在 **`11-demo.js:60`**：
    `var tofs = [64 * 3600, 68 * 3600, 72 * 3600, 76 * 3600, 80 * 3600];`"""),
 ("""  - `apollo11/webdata/js/03-physics.js` —— `function lunarAimPoint` / B 面瞄准
    （搜 `lunarAimPoint`；这是第 11 轮引入的"用月心系 v∞ 当偏置轴 + 2 参数 Newton"）""",
  """  - **`apollo11/webdata/js/03-physics.js:2555`** `World.prototype.lunarAimPoint = function (c, tof, periAltKm, opts)`
    —— B 面瞄准（第 11 轮引入的"用月心系 v∞ 当偏置轴 + 2 参数 Newton"；
    `opts.aimPoint` 的消费点在 `03-physics.js:2777` 附近）"""),
 ("""  - 演示的油量裕度（**完成后必须删掉**）：搜 `11-demo.js` 里的
    "补到 3 200 kg / 补到 12 000 kg"（`05` §6.9.2 的三个确定性改造之一）""",
  """  - 演示的油量裕度（**完成后必须删掉**，`05` §6.9.2 的三个确定性改造之一）：
    · **`11-demo.js:1108`** `if (am && am.prop < 3200) am.prop = 3200;`（交会前给上升级补油）
    · **`11-demo.js:1231-1235`** `if (smM && smM.prop < 12000) {...}`（TEI 前给服务舱补油）"""),
])

patch('AGENT_HANDOFF/README.md', [
 ("""| `04-重构提示词.md` | **给重构 Agent 的完整提示词**（真实轨道学 / 动力学 / 教程与制导面板文档化）。要开始重构时，把这份提示词连同本文件夹一起交给它 |
| `README.md` | 本文件（索引） |""",
  """| `05-真实轨道学与动力学改造记录.md` | 动力学深挖（有限推力 / 月球自转 / B 面瞄准 / TEI / M5 打通全过程的正面与反面教材） |
| `06-当前状态总览.md` | **第 16 轮后的现状**：验证快照、五个机制、已知限制 |
| `07-未完成项定位与交接.md` | **还没做完的事，逐条给出文件:行号:函数名 + 改法 + 验证命令**（要交给下一个 Agent 就先看这份） |
| `04-重构提示词.md` | **给重构 Agent 的完整提示词**（真实轨道学 / 动力学 / 教程与制导面板文档化） |
| `README.md` | 本文件（索引） |"""),
])
