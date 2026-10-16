# -*- coding: utf-8 -*-
# 主循环支持「外部固定步长驱动」：离线轨迹生成器与回放播放器接管推进时，
# 主循环不再自己驱动制导/Demo，否则 rAF 与外部 setInterval 双重驱动会引入
# 帧率依赖，破坏采样的确定性（对照「错误需要修改/04」二.4）。
import io
p = 'apollo11/webdata/js/07-app.js'
s = io.open(p, encoding='utf-8').read()

old = """    descentGuidance();
    if (App.world) {
      var simDt = 0;
      if (!App.paused) {
        var before = App.world.t;
        App.world.advance(dt);
        simDt = App.world.t - before;
        checkMilestones(before, App.world.t);
      }
      if (APL.Demo && APL.Demo.isActive()) APL.Demo.tick(simDt > 0 ? simDt : dt);"""
new = """    if (!App.driverExternal) descentGuidance();
    if (App.world) {
      var simDt = 0;
      if (!App.paused && !App.driverExternal) {
        var before = App.world.t;
        App.world.advance(dt);
        simDt = App.world.t - before;
        checkMilestones(before, App.world.t);
      }
      if (!App.driverExternal && APL.Demo && APL.Demo.isActive()) {
        APL.Demo.tick(simDt > 0 ? simDt : dt);
      }"""
assert s.count(old) == 1, s.count(old)
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
