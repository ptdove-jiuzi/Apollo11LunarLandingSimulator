# -*- coding: utf-8 -*-
# 教程 UX：让"下一步"按钮别满屏跑（用户：点一下下一步、指针还停在按钮上，快速跳过）。
#   1) 卡片改固定槽位：目标中心在上 45% → 卡片固定在上半屏（top=74）；否则固定在
#      下半屏（bottom，距底 96px，避开底部控制条）。整趟教程按钮位置基本不动。
#   2) 每步渲染后把焦点放到【下一步】：鼠标不用找按钮，直接按回车/空格连跳。
import io
p = 'apollo11/webdata/js/10-tutorial.js'
s = io.open(p, encoding='utf-8').read()
old = """    if (!t) { cx = (W - cw) / 2; cy = Math.max(20, H * 0.12); }
    else {
      cx = Math.min(Math.max(16, t.r.left + t.r.width / 2 - cw / 2), W - cw - 16);
      var below = t.r.bottom + 14;
      var estH = card.offsetHeight || 300;
      if (below + estH > H - 16) cy = Math.max(16, t.r.top - estH - 14);
      else cy = below;
    }"""
new = """    if (!t) { cx = (W - cw) / 2; cy = Math.max(20, H * 0.12); }
    else {
      // ★ 固定槽位（不再跟着目标跑，否则"下一步"按钮每步都换位置）：
      //   目标中心在上 45% → 卡片固定在上半屏（top=74，避开顶栏）；
      //   否则固定在下半屏（距底 96px，避开底部控制条）。水平始终居中。
      cx = Math.max(16, Math.min((W - cw) / 2, W - cw - 16));
      var estH = card.offsetHeight || 300;
      var slotTop = (t.r.top + t.r.height / 2) < H * 0.45;
      cy = slotTop ? 74 : Math.max(16, H - estH - 96);
    }"""
assert s.count(old) == 1
s = s.replace(old, new)
old2 = """    layout(targetRect(st.target), false);
    if (st.wait) Tut.card.classList.add('waiting'); else Tut.card.classList.remove('waiting');"""
new2 = """    layout(targetRect(st.target), false);
    if (st.wait) Tut.card.classList.add('waiting'); else Tut.card.classList.remove('waiting');
    // 每步渲染后聚焦【下一步】：鼠标不用回按钮，直接回车/空格连跳
    try {
      var nb = $('tutNext');
      if (nb && !nb.disabled) nb.focus({ preventScroll: true });
    } catch (eF) { /* 旧浏览器忽略 */ }"""
assert s.count(old2) == 1
s = s.replace(old2, new2)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
