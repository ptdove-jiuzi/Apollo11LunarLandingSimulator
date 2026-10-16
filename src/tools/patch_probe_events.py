# -*- coding: utf-8 -*-
import io
p = 'tools/make_replay_probe.js'
s = io.open(p, encoding='utf-8').read()
old = """      if (APL.Demo.isActive()) APL.Demo.tick(simDt > 0 ? simDt : STEP);
      record(false);"""
new = """      if (APL.Demo.isActive()) APL.Demo.tick(simDt > 0 ? simDt : STEP);
      // 采集世界事件（主循环的 checkMilestones 被 driverExternal 关掉了，
      // 这里代它消费；事件同时是回放要显示的任务里程碑）
      if (w.events && w.events.length) {
        for (var ei = 0; ei < w.events.length; ei++) {
          var ev = w.events[ei];
          evlog.push({ t: Math.round(w.t * 100) / 100, tag: ev.tag, text: ev.text });
        }
        w.events.length = 0;
      }
      record(false);"""
assert s.count(old) == 1
s = s.replace(old, new)
old2 = "  var samples = [], events = [], frames = 0, started = false, lastIdx = -1;"
new2 = "  var samples = [], events = [], evlog = [], frames = 0, started = false, lastIdx = -1;"
assert s.count(old2) == 1
s = s.replace(old2, new2)
old3 = """      out.textContent = JSON.stringify({
        mission: id, step: STEP, samples: samples, events: events
      });"""
new3 = """      out.textContent = JSON.stringify({
        mission: id, step: STEP, samples: samples, events: events, wlog: evlog
      });"""
assert s.count(old3) == 1
s = s.replace(old3, new3)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
