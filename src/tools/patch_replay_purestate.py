# -*- coding: utf-8 -*-
# 让回放状态成为"样本的纯函数"：每次 apply 按样本重建模块表（已抛弃的级会被
# 真正移除），否则被抛掉的级会以"上次设置过的推进剂"残留 —— 状态依赖拖动历史
# （实测 M1 同一 t 三次取状态不一致）。
import io
p = 'apollo11/webdata/js/12-replay.js'
s = io.open(p, encoding='utf-8').read()

old1 = """  // 把样本状态写进世界（**唯一**改变飞行器状态的入口；全部来自固定样本）
  RP.apply = function () {"""
new1 = """  // 模块定义表（按 id 取一份干净副本；回放要按样本重建模块表）
  var MODREG = null;
  function freshModules(ids) {
    if (!MODREG) {
      MODREG = {};
      var all = P.buildSaturnVStack();
      for (var i = 0; i < all.length; i++) MODREG[all[i].id] = all[i];
    }
    var out = [];
    for (var k = 0; k < ids.length; k++) {
      var m = MODREG[ids[k]];
      if (m) out.push(JSON.parse(JSON.stringify(m)));
    }
    return out;
  }

  // 把样本状态写进世界（**唯一**改变飞行器状态的入口；全部来自固定样本）
  RP.apply = function () {"""
assert s.count(old1) == 1
s = s.replace(old1, new1)

old2 = """      // 模块推进剂（HUD 的推进级面板读它）
      for (var k2 = 0; k2 < cs.mo.length; k2++) {
        for (var m2 = 0; m2 < c.modules.length; m2++) {
          if (c.modules[m2].id === cs.mo[k2][0]) {
            c.modules[m2].prop = lerp(cs.mo[k2][1], (cb.mo[k2] || cs.mo[k2])[1], f);
          }
        }
      }"""
new2 = """      // 模块表按样本重建（已抛弃的级必须真正消失），推进剂按样本插值
      c.modules = freshModules(cs.mo.map(function (x) { return x[0]; }));
      for (var k2 = 0; k2 < cs.mo.length; k2++) {
        var id2 = cs.mo[k2][0];
        var cbv = cb.mo.filter(function (x) { return x[0] === id2; })[0] || cs.mo[k2];
        for (var m2 = 0; m2 < c.modules.length; m2++) {
          if (c.modules[m2].id === id2) c.modules[m2].prop = lerp(cs.mo[k2][1], cbv[1], f);
        }
      }"""
assert s.count(old2) == 1
s = s.replace(old2, new2)

old3 = """      c.throttle = cs.th; c.throttleCmd = cs.th;
      c.stageIndex = cs.st;"""
new3 = """      c.throttle = cs.th; c.throttleCmd = cs.th;
      c.stageIndex = cs.st;
      c.flags.isLM = !!cs.lm;"""
assert s.count(old3) == 1
s = s.replace(old3, new3)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
