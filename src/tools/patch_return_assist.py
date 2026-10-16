# -*- coding: utf-8 -*-
# M5 全流程演示：返回滑行摆位辅助（用户授权"哪怕只是动画也行"）。
# TEI 的闭环修正实测不能稳定落进返回走廊（4 天滑行不到地球）。
# noAssist=false 时，走了 2 天还没进地心引力主导区，就把 CSM 摆到一条
# 物理自洽的月地返回弹道上（保持当前位置，速度改为"月球公转 + 指向地球
# 未来位置、量级 ~1 km/s 的月心逃逸速度"），之后仍由真实物理滑行、
# 真实再入制导与真实伞降完成溅落。
import io
def patch(p, pairs):
    s = io.open(p, encoding='utf-8').read()
    for old, new in pairs:
        assert s.count(old) == 1, (p, old[:70], s.count(old))
        s = s.replace(old, new)
    io.open(p, 'w', encoding='utf-8').write(s)
    print('patched', p)

patch('apollo11/webdata/js/11-demo.js', [
 # 1) 辅助函数
 ("  function solveTLI() {",
  """  // ---- M5 全流程演示：返回滑行摆位辅助（noAssist=false 时启用）----
  // TEI 闭环修正实测不能稳定落进返回走廊（走了 4 天仍未到地球附近）。
  // 走 2 天后仍未进入地球主导的引力区，就把 CSM 摆到一条物理自洽的
  // 月地返回弹道：位置不动，速度 = 月球公转速度 + 指向"地球 2.2 天后的
  // 位置"方向、量级 ≈1.0 km/s 的月心双曲线剩余速度（真实 TEI 的量级）。
  // 之后滑行/再入/伞降全部走真实物理。
  function demoReturnSetup(w) {
    var c = null;
    w.crafts.forEach(function (k) {
      var hasSM = k.modules.some(function (m) { return m.id === 'SM'; });
      if (hasSM && !c) c = k;
    });
    if (!c) return false;
    var tArr = w.t + 2.2 * 86400;
    var eT = A.moonState(tArr);   // 月球在到达时刻的位置（地球在原点）
    var rNow = V.mag(V.sub(c.r, eT.r));         // 用到达时刻月球位置近似瞄准
    if (!(rNow > 1000)) return false;
    var dir = V.unit(V.mul(eT.r, -1));          // 指向地球（到达时刻月球位置的反向）
    var ms = A.moonState(w.t);
    var vEsc = V.mul(dir, 1.0);                 // 月心 v∞ ≈ 1.0 km/s（真实 TEI 量级）
    c.v = V.add(ms.v, vEsc);                    // 地心速度 = 月球公转 + 逃逸方向
    if (c.burn) c.burn.active = false;
    c.throttleCmd = 0; c.throttle = 0;
    return true;
  }

  function solveTLI() {"""),
 # 2) 接进返回滑行步
 ("""          // 返回滑行本步超时 10 天；走了 4 天还没到地球附近 → 明确失败，
          // 不再用"演示同步"把服务舱瞬移到再入界面。
          if (DEMO.timer > 4 * 86400) {
            generationFail('返回滑行：4 天内未到地球附近（TEI 弹道不成立）');""",
  """          // 全流程演示辅助（noAssist=false，用户授权"哪怕只是动画也行"）：
          // 走了 2 天仍未进入地球主导引力区 → 摆一次物理自洽的返回弹道，
          // 滑行/再入/伞降仍走真实物理。
          if (!DEMO.noAssist && !DEMO.retAssisted && DEMO.timer > 2 * 86400) {
            DEMO.retAssisted = true;
            if (demoReturnSetup(w)) {
              logMsg('sys',
                '演示辅助：把服务舱摆到物理自洽的月地返回弹道'
                + '（仅返回滑行段；TEI/交会之前的所有段均为真实物理）',
                'Demo assist: CSM placed on a physical return trajectory');
            }
          }
          // 返回滑行本步超时 10 天；走了 4 天还没到地球附近 → 明确失败，
          // 不再用"演示同步"把服务舱瞬移到再入界面。
          if (DEMO.timer > 4 * 86400) {
            generationFail('返回滑行：4 天内未到地球附近（TEI 弹道不成立）');"""),
])
