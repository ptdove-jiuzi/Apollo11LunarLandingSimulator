// Real-browser offline generation and unchanged replay-gate validation.
const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');
const {pathToFileURL} = require('url');
const {chromium} = require('C:/Users/user/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core');
const root = path.resolve(process.argv[2] || '.');
const ids = (process.argv[3] || 'M3').split(',');
const out = path.join(root, 'outputs', 'route08');
async function main() {
  const browser = await chromium.launch({headless:true, executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args:['--allow-file-access-from-files']});
  const results = [];
  try {
    for (const id of ids) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(pathToFileURL(path.join(root, 'apollo11', 'webdata', 'index.html')).href);
      await page.waitForFunction(() => window.APLApp && typeof APLApp.startMission === 'function' && window.APL && APL.Demo);
      const data = await page.evaluate(async id => {
        const allLogs = [];
        const log0 = APLApp.logLine;
        APLApp.logLine = function(kind,text,...args) { allLogs.push({t:APLApp.world?APLApp.world.t:0,kind,text}); return log0.call(this,kind,text,...args); };
        APLApp.driverExternal = true;
        APLApp.paused = true;
        APL.setLang('zh');
        APLApp.startMission(id);
        APLApp.driverExternal = true;
        APL.Demo.state.noAssist = true;
        APL.Demo.start(id);
        APLApp.paused = true;
        APLApp.driverExternal = true;
        const samples = [], events = [], wlog = [];
        let frames = 0, lastIndex = -1, lastSample = -Infinity;
        function sample(force) {
          const w = APLApp.world;
          const firing = w.crafts.some(c => c.throttle > 0.001);
          if (!force && w.t - lastSample < (firing ? 1 : 60)) return;
          lastSample = w.t;
          const r = (x,n) => Math.round(x*n)/n;
          samples.push({t:r(w.t,100), c:w.crafts.map(c => ({id:c.id,r:c.r.map(x=>r(x,1000)),v:c.v.map(x=>r(x,1e6)),m:r(c.mass(),10),th:r(c.throttle||0,1000),st:c.stageIndex,pr:c.primary,at:c.attitude.vec?c.attitude.vec.map(x=>r(x,1e4)):null,mo:c.modules.map(m=>[m.id,Math.round(m.prop)]),lm:c.flags.isLM?1:0,ld:c.landed?1:0,cr:c.crashed?1:0}))});
        }
        sample(true);
        while (APL.Demo.isActive() && frames < 240000) {
          const w = APLApp.world;
          const t0 = w.t;
          w.advance(1/60);
          APL.Demo.tick(Math.max(0,w.t-t0));
          frames++;
          if (APL.Demo.state.index !== lastIndex) {
            lastIndex = APL.Demo.state.index;
            const step = APL.Demo.state.script[lastIndex];
            events.push({t:w.t,i:lastIndex,zh:step?step.text.zh:'(end)'});
          }
          if (w.events.length) {wlog.push(...w.events.map(e=>({t:e.t,tag:e.tag,text:e.text})));w.events.length=0;}
          sample(false);
          if (frames % 1000 === 0) await new Promise(resolve => setTimeout(resolve,0));
        }
        sample(true);
        const w = APLApp.world, c = APLApp.craft;
        const orbit = c.orbitRelative(c.primary,w);
        return {traj:{mission:id,step:1/60,samples,events,wlog},logs:allLogs,frames,index:APL.Demo.state.index,active:APL.Demo.isActive(),failure:APL.Demo.state.failure,failMsg:APL.Demo.state.failMsg,t:w.t,crashed:c.crashed,landed:c.landed,orbit:{peri:orbit.periapsis,apo:orbit.apoapsis},rndz:APL.Demo.state.rndzResult,prop:c.modules.map(m=>[m.id,m.prop])};
      }, id);
      data.errors = errors;
      fs.writeFileSync(path.join(out,id+'-run.json'), JSON.stringify(data,null,2));
      const html = '<pre id="trajout">'+JSON.stringify(data.traj)+'</pre><pre id="metainfo">\n[GEN-DONE] frames='+data.frames+' index='+data.index+' active='+data.active+'\n'+data.logs.map(l=>'[LOG] T+'+Math.round(l.t)+' '+l.kind+' '+l.text).join('\n')+errors.map(e=>'\n[FATAL] '+e).join('')+'</pre>';
      const dump = path.join(out,id+'-dump.html');
      fs.writeFileSync(dump,html);
      const gateRoot = path.join(out,'gate');
      const gateJs = path.join(gateRoot,'apollo11','webdata','js');
      fs.mkdirSync(gateJs,{recursive:true});
      for (const f of ['00-constants.js','01-math.js','02-astro.js','03-physics.js']) fs.copyFileSync(path.join(root,'apollo11','webdata','js',f),path.join(gateJs,f));
      const gate = spawnSync(process.execPath,[path.join(root,'tools','save_replay.js'),dump,id,gateRoot],{encoding:'utf8'});
      fs.writeFileSync(path.join(out,id+'-gate.txt'),gate.stdout+gate.stderr);
      const result = {mission:id,frames:data.frames,index:data.index,t:data.t,active:data.active,failMsg:data.failMsg,errors,gateExit:gate.status,prop:data.prop,orbit:data.orbit};
      console.log(JSON.stringify(result));
      console.log(gate.stdout);
      results.push(result);
      await page.close();
    }
  } finally {await browser.close();}
  fs.writeFileSync(path.join(out,'missions-summary.json'),JSON.stringify(results,null,2));
  process.exitCode = results.some(r=>r.active || r.gateExit !== 0 || r.errors.length)?1:0;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
