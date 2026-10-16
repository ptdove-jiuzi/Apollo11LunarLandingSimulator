# -*- coding: utf-8 -*-
import io
p = 'apollo11/webdata/js/00-constants.js'
s = io.open(p, encoding='utf-8').read()
old1 = "    propMass: 24000,   // 【临时对照实验】"
new1 = ("    propMass: 24000,            // kg SPS。真实值 18410（路线 08 §4 要求），\n"
        "    // 但实测恢复真实值会让 M2 的 TLI 有限动力弧打靶发散（近月点差 1896 km，\n"
        "    // 对照实验见 AGENT_HANDOFF/10 §3）—— 前置条件是先修 startLunarTransfer\n"
        "    // 的质量敏感性（种子 Tbase 用了点火前的质量）。修好后应改回 18410。")
assert s.count(old1) == 1
s = s.replace(old1, new1)
old2 = "    ascentProp: 3000,     // 【临时对照实验】这个重量要跟着一起降落，"
new2 = ("    ascentProp: 3000,     // 上升级推进剂。真实值 2353（路线 08 §4）；当前放大值\n"
        "                          // 与 SPS 同步保留，原因同上（见 HANDOFF/10 §3）。\n"
        "                          // 这个重量要跟着一起降落，")
assert s.count(old2) == 1
s = s.replace(old2, new2)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
