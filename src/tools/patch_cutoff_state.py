# -*- coding: utf-8 -*-
# 地球入轨关机判据改成"目标轨道状态误差"：高度误差 + 径向速度误差 + 切向速度误差
# 三项合成等效速度误差（位置误差按 30 s 折成速度）。
# 旧的"速度目标残余"判据允许在还差 2.2 km 高度、还以 30 m/s 爬升时关机 →
# 生成的轨道必然椭圆（实测 154×205）。
import io
p = 'apollo11/webdata/js/03-physics.js'
s = io.open(p, encoding='utf-8').read()
old = """    // 与 vgoGuidance 同一套目标（切向圆速度 + 径向爬升项）
    if (c.primary !== 'MOON') {
      var tgR = vgoEarthTarget(world, c, f);
      if (tgR) {
        var res = V.mag(V.sub(tgR.vDes, f.vrel)) * 1000;
        // 高度闸门：还没爬到目标高度附近就不许判"残差归零"（否则关机半径
        // 直接变成近地点，近地点永远差着几公里）。单位是 km（0.1_km 级别的
        // 量纲错误会让闸门形同虚设 —— 第一版就写成了 3000）。
        if (Math.abs(tgR.r - tgR.rt) > 3) {
          return Math.max(res, 25);
        }
        return res;
      }
    }"""
new = """    // 地球入轨：关机判据 = "目标轨道状态误差"，不是"速度目标残余"。
    //   高度误差 Δr、径向速度 vr、切向速度误差 Δvt 都要小；位置误差按 30 s
    //   折算成等效速度误差，量纲与调用方（< 1.5 m/s）一致。
    //   旧判据只看速度目标，允许在"还差 2.2 km 高度、还以 30 m/s 爬升"时关机
    //   → 生成的轨道必然椭圆（实测 154×205 km）。
    if (c.primary !== 'MOON') {
      var tgR = vgoEarthTarget(world, c, f);
      if (tgR) {
        var vrR = V.dot(f.vrel, up);
        var vtR = V.mag(V.sub(f.vrel, V.mul(up, vrR)));
        var vtDesR = Math.sqrt(B.EARTH.mu / tgR.rt);
        var eqV = Math.sqrt(Math.pow((tgR.r - tgR.rt) / 30, 2) +
                            Math.pow(vrR, 2) + Math.pow(vtR - vtDesR, 2));
        return eqV * 1000;
      }
    }"""
assert s.count(old) == 1, s.count(old)
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
