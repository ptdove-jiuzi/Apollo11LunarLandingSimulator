# -*- coding: utf-8 -*-
import io
def patch(p, pairs):
    s = io.open(p, encoding='utf-8').read()
    for old, new in pairs:
        assert s.count(old) == 1, (p, old[:70], s.count(old))
        s = s.replace(old, new)
    io.open(p, 'w', encoding='utf-8').write(s)
    print('patched', p)

patch('apollo11/webdata/js/09-i18n.js', [
 ("      'rp.modeReplay': '回放模式·固定样本',",
  """      'rp.modeReplay': '回放模式·固定样本',
      'dsky.help': '用法：VERB → 两位数字 → NOUN → 两位数字 → ENTR 提交；CLR 清除键入；空按 ENTR 会亮 OPR ERR。例：V16 N68 E 显示时间。数字可直接键入 R1（± 改符号）。程序写显示通道会接管寄存器。',"""),
 ("      'rp.modeReplay': 'REPLAY - fixed samples',",
  """      'rp.modeReplay': 'REPLAY - fixed samples',
      'dsky.help': 'Usage: VERB → 2 digits → NOUN → 2 digits → ENTR to commit; CLR cancels; bare ENTR lights OPR ERR. Example: V16 N68 E. Digits type straight into R1 (+/- sets sign). Program writes take over the registers.',"""),
])

patch('apollo11/webdata/css/app.css', [
 ("""/* ============================================================ 离线轨迹回放 */""",
  """/* DSKY 用法速查卡 */
.dskyhelp {
  margin: 6px 0 2px; padding: 6px 8px; border-radius: 6px;
  background: rgba(255, 214, 10, .08); border: 1px solid rgba(255, 214, 10, .25);
  color: #f5e6a8; font-size: 11px; line-height: 1.6; white-space: pre-line;
}

/* ============================================================ 离线轨迹回放 */"""),
])
