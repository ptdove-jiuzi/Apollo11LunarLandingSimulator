# -*- coding: utf-8 -*-
import io
p = 'tools/make_replayaudit_probe.js'
s = io.open(p, encoding='utf-8').read()
old = """    var stackLogged = 0;
    P.World.prototype.advance = function (dt) {
      advCalls++; advSim += dt;"""
new = """    var stackLogged = 0;
    // 只统计**回放世界**的积分调用：页面启动自检会在它自己的私有世界 w2 上
    // 跑 700 步烟测，如果按原型统计会把那些也算进来（第一版就误报了）。
    P.World.prototype.advance = function (dt) {
      if (this !== window.__rw) return origAdvance.call(this, dt);
      advCalls++; advSim += dt;"""
assert s.count(old) == 1
s = s.replace(old, new)
old2 = """      started = true;
      rep('LOAD', '轨迹加载=' + ok"""
new2 = """      started = true;
      window.__rw = APLApp.world;
      rep('LOAD', '轨迹加载=' + ok"""
assert s.count(old2) == 1
s = s.replace(old2, new2)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
