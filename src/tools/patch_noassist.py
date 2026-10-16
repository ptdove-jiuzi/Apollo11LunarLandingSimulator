# -*- coding: utf-8 -*-
# 给 11-demo.js 的所有"演示兜底/状态同步"加 noAssist 开关：
# 离线轨迹生成时把 DEMO.noAssist 置 1，生成器就必须靠真实制导满足验收闸门，
# 不许用状态同步掩盖（对照「错误需要修改/04」第二节）。
import io
p = 'apollo11/webdata/js/11-demo.js'
s = io.open(p, encoding='utf-8').read()
n = 0

def wrap(old, new, cnt=1):
    global s, n
    assert s.count(old) == cnt, (old[:60], s.count(old))
    s = s.replace(old, new)
    n += 1

# 1) 交会前的状态归一化
wrap("""              if (demoRndzNormalize(c0, tgt0)) {""",
     """              if (!DEMO.noAssist && demoRndzNormalize(c0, tgt0)) {""")
# 2) 交会收拢兜底
wrap("""          if (DEMO.stepT > 350000) { demoRndzCloseOut(c, lm); return true; }""",
     """          if (DEMO.stepT > 350000) {
            if (DEMO.noAssist) {
              app().logLine && app().logLine('bad',
                '生成模式：交会 350 000 s 未收拢，且禁止演示兜底 → 本步判失败');
              return true;
            }
            demoRndzCloseOut(c, lm); return true;
          }""")
# 3) TEI 闭环校验失败后的返回兜底（两处）
wrap("""              demoReturnAssist(c);""",
     """              if (!DEMO.noAssist) demoReturnAssist(c);""")
wrap("""          if (DEMO.timer > 26000) { demoReturnAssist(c); return true; }""",
     """          if (DEMO.timer > 26000) {
            if (DEMO.noAssist) {
              app().logLine && app().logLine('bad',
                '生成模式：TEI 未在 26 000 s 内进入返回走廊，且禁止演示兜底 → 判失败');
              return true;
            }
            demoReturnAssist(c); return true;
          }""")
# 4) 返回滑行走满 4 天的直接摆位
wrap("""          if (DEMO.timer > 4 * 86400) {
            var rHat = V.unit(c.r);""",
     """          if (DEMO.timer > 4 * 86400) {
            if (DEMO.noAssist) {
              app().logLine && app().logLine('bad',
                '生成模式：返回滑行走满 4 天未到地球附近，且禁止演示兜底 → 判失败');
              return true;
            }
            var rHat = V.unit(c.r);""")
# 5) 再入段伞降摆位
wrap("""          if (DEMO.timer > 5000 && !DEMO.entrySynced) {
            DEMO.entrySynced = true;""",
     """          if (DEMO.timer > 5000 && !DEMO.entrySynced) {
            if (DEMO.noAssist) {
              app().logLine && app().logLine('bad',
                '生成模式：再入段 5 000 s 未落地，且禁止演示兜底 → 判失败');
              return true;
            }
            DEMO.entrySynced = true;""")
# 6) start() 里复位 noAssist（默认关闭：运行时演示仍可用兜底）
wrap("""      DEMO.entrySynced = false;      // 再入伞降兜底只允许摆一次""",
     """      DEMO.entrySynced = false;      // 再入伞降兜底只允许摆一次
      DEMO.noAssist = !!DEMO.noAssist;   // 生成模式开关（由离线生成器置位）""")

io.open(p, 'w', encoding='utf-8').write(s)
print('wrapped', n, 'assist sites')
