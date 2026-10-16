# -*- coding: utf-8 -*-
# M5 全流程演示：交会摆位辅助（用户授权"哪怕只是动画也行"）。
#   · 只在 noAssist=false 时启用（闸门口径的生成仍禁用）；
#   · 交会步开始 4000 s 后仍未收拢 → 把上升级摆到「指令舱后方 25 km、
#     低 3 km」的标准 CW 起手位（路线 08 §3 的收敛测试位形），
#     之后完全交给真实 CW 闭环收拢（150 m / 1 m/s 稳定 300 s 再对接）；
#   · TLI / LOI / 着陆 / 月面上升等物理段一律不碰。
import io
def patch(p, pairs):
    s = io.open(p, encoding='utf-8').read()
    for old, new in pairs:
        assert s.count(old) == 1, (p, old[:70], s.count(old))
        s = s.replace(old, new)
    io.open(p, 'w', encoding='utf-8').write(s)
    print('patched', p)

patch('apollo11/webdata/js/11-demo.js', [
 # 1) 辅助函数（插在 solveTLI 之前）
 ("  function solveTLI() {",
  """  // ---- M5 全流程演示：交会摆位辅助（noAssist=false 时启用）----
  // 背景：从真实上升轨道直接做 CW 交会，相位修正的代价远超上升级预算
  // （实测 3000 kg 烧到 0 仍未收敛、900 000 s 超时）。本辅助只做一件事：
  // 把上升级摆到「指令舱后方 25 km、低 3 km」的标准 CW 起手位（路线 08 §3
  // 的收敛测试位形），之后完全交给真实 CW 闭环收拢。物理段一律不碰。
  function demoRndzSetup(w) {
    var lm = null, csm = null;
    w.crafts.forEach(function (k) {
      var hasA = k.modules.some(function (m) { return m.id === 'LM_A'; });
      var hasSM = k.modules.some(function (m) { return m.id === 'SM'; });
      if (hasA && !lm) lm = k;
      else if (hasSM && !csm) csm = k;
    });
    if (!lm || !csm) return false;
    var ms = A.moonState(w.t);
    var rT = V.sub(csm.r, ms.r), vT = V.sub(csm.v, ms.v);
    var el = M.elements(B.MOON.mu, rT, vT);
    if (!el || !isFinite(el.a) || el.a < 1000) return false;
    var hz = V.unit(V.cross(rT, vT));
    var dth = 25 / el.a;                       // 后方 25 km 的角距
    function rot(v, th) {                      // Rodrigues：绕轨道面法向旋转
      var c = Math.cos(th), s = Math.sin(th);
      var cr = V.cross(hz, v), d = V.dot(hz, v);
      return V.add(V.add(V.mul(v, c), V.mul(cr, s)), V.mul(hz, d * (1 - c)));
    }
    var rL = rot(rT, -dth), vL = rot(vT, -dth);
    rL = V.sub(rL, V.mul(V.unit(rL), 3));      // 低 3 km → 向前的相对漂移
    lm.r = V.add(ms.r, rL);
    lm.v = V.add(ms.v, vL);
    lm.landed = false; lm.crashed = false;
    if (lm.burn) lm.burn.active = false;
    lm.throttleCmd = 0; lm.throttle = 0;
    return true;
  }

  function solveTLI() {"""),
 # 2) 接进 M5 交会步：enter 复位标志
 ("""        warp: 600, warpCap: 600, timeout: 900000,
        enter: function () { DEMO.rendezvous = true; DEMO.rndzResult = null; },
        done: function () {
          var o = DEMO.rndzResult;
          if (o && o.done) { DEMO.rendezvous = false; return true; }
          if (o && o.failed) { generationFail('交会失败：' + o.reason); return true; }
          return false;
        } },""",
  """        warp: 600, warpCap: 600, timeout: 900000,
        enter: function () { DEMO.rendezvous = true; DEMO.rndzResult = null; DEMO.rndzAssisted = false; },
        done: function () {
          var o = DEMO.rndzResult;
          if (o && o.done) { DEMO.rendezvous = false; return true; }
          if (o && o.failed) { generationFail('交会失败：' + o.reason); return true; }
          // 全流程演示辅助（noAssist=false，用户授权"哪怕只是动画也行"）：
          // 4000 s 后仍未收拢 → 摆一次标准 CW 起手位，交给真实闭环完成。
          if (!DEMO.noAssist && !DEMO.rndzAssisted && (DEMO.stepT || 0) > 4000) {
            DEMO.rndzAssisted = true;
            if (demoRndzSetup(world())) {
              logMsg('sys',
                '演示辅助：把上升级摆到指令舱后方 25 km 的标准 CW 起手位'
                + '（仅交会段；TLI/LOI/着陆/月面上升均为真实物理）',
                'Demo assist: LM placed 25 km behind the CSM for CW closure');
            }
          }
          return false;
        } },"""),
])
