from flask import Flask, request, jsonify, render_template_string
import trimesh, numpy as np, json, os, tempfile, re
from groq import Groq

app = Flask(__name__)

HTML = r"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>3DP Agent</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Mono:wght@300;400&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{background:#f5f2ed;font-family:'DM Mono',monospace;overflow:hidden;height:100vh;cursor:none}
#bg{position:fixed;inset:0;z-index:0}
#cur{position:fixed;width:8px;height:8px;border-radius:50%;background:#1a1a1a;pointer-events:none;z-index:9999;transform:translate(-50%,-50%);transition:width .2s,height .2s}
#cur-ring{position:fixed;width:38px;height:38px;border-radius:50%;border:1px solid rgba(26,26,26,0.25);pointer-events:none;z-index:9998;transform:translate(-50%,-50%);transition:left .08s,top .08s}
#nav{position:fixed;top:0;left:0;right:0;display:flex;justify-content:space-between;align-items:center;padding:22px 40px;z-index:100;border-bottom:1px solid rgba(26,26,26,0.06)}
#logo{font-family:'DM Serif Display',serif;font-size:21px;color:#1a1a1a;font-style:italic}
.nl{font-size:10px;letter-spacing:2.5px;color:#aaa;cursor:pointer;transition:color .2s;text-transform:uppercase}
.nl:hover{color:#1a1a1a}
#hero{position:fixed;left:40px;bottom:90px;z-index:100}
#hero-eye{font-size:9px;letter-spacing:3px;color:#aaa;margin-bottom:12px;text-transform:uppercase}
#hero-h1{font-family:'DM Serif Display',serif;font-size:50px;line-height:1.06;letter-spacing:-1.5px;color:#1a1a1a}
#hero-h1 em{font-style:italic;color:#555}
#hero-sub{font-size:9px;letter-spacing:2px;color:#bbb;margin-top:16px;text-transform:uppercase}
#card{position:fixed;right:40px;bottom:90px;width:230px;z-index:100}
#drop{border:1px solid rgba(26,26,26,0.12);padding:26px 22px;background:rgba(245,242,237,0.85);backdrop-filter:blur(16px);cursor:pointer;transition:border-color .25s}
#drop:hover,#drop.drag{border-color:rgba(26,26,26,0.35)}
#drop-icon{width:30px;height:30px;border:1px solid #1a1a1a;display:flex;align-items:center;justify-content:center;font-size:16px;color:#1a1a1a;margin-bottom:14px}
#drop-t{font-size:10px;letter-spacing:2px;color:#1a1a1a;text-transform:uppercase;margin-bottom:3px}
#drop-s{font-size:9px;letter-spacing:1px;color:#aaa}
#fileinput{display:none}
#qtxt{width:100%;margin-top:1px;padding:10px 12px;background:rgba(245,242,237,0.9);border:1px solid rgba(26,26,26,0.1);color:#1a1a1a;font-family:'DM Mono',monospace;font-size:9px;letter-spacing:1px;outline:none;resize:none;transition:border-color .2s}
#qtxt::placeholder{color:#ccc}
#qtxt:focus{border-color:rgba(26,26,26,0.25)}
#abtn{width:100%;margin-top:1px;padding:13px;background:rgba(26,26,26,0.04);border:1px solid rgba(26,26,26,0.1);color:#bbb;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:2px;text-transform:uppercase;cursor:not-allowed;transition:all .25s}
#abtn.ready{color:#1a1a1a;border-color:rgba(26,26,26,0.3);cursor:pointer}
#abtn.ready:hover{background:rgba(26,26,26,0.08);border-color:#1a1a1a}
#abtn.busy{color:#888;cursor:wait}
#rp{position:fixed;inset:0;z-index:200;background:rgba(245,242,237,0.96);backdrop-filter:blur(24px);display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .5s}
#rp.show{opacity:1;pointer-events:all}
#ri{width:640px;max-height:90vh;overflow-y:auto;padding:48px}
#ri::-webkit-scrollbar{width:2px}
#ri::-webkit-scrollbar-thumb{background:rgba(26,26,26,0.15)}
#score-row{display:flex;align-items:baseline;gap:16px;margin-bottom:36px;padding-bottom:28px;border-bottom:1px solid rgba(26,26,26,0.08)}
#sc{font-family:'DM Serif Display',serif;font-size:80px;letter-spacing:-3px;line-height:1}
#sc-lbl{font-size:9px;letter-spacing:2.5px;color:#aaa;text-transform:uppercase;line-height:2}
#mgrid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:rgba(26,26,26,0.06);margin-bottom:28px}
.mc{padding:16px 20px;background:#f5f2ed}
.ml{font-size:9px;letter-spacing:2px;color:#aaa;margin-bottom:5px;text-transform:uppercase}
.mv{font-size:17px;color:#1a1a1a;letter-spacing:.5px}
.iss{display:flex;gap:10px;padding:9px 0;border-bottom:1px solid rgba(26,26,26,0.05);font-size:10px;line-height:1.7;letter-spacing:.3px}
.iss-d{color:#888;flex-shrink:0}
.iss-t{color:#555}
.ok{font-size:10px;letter-spacing:1px;color:#aaa;padding:9px 0}
#rep{font-size:10px;line-height:2;color:#888;letter-spacing:.3px;white-space:pre-wrap;margin-top:20px;padding-top:20px;border-top:1px solid rgba(26,26,26,0.06)}
#cbtn{margin-top:28px;float:right;padding:11px 22px;background:transparent;border:1px solid rgba(26,26,26,0.15);color:#aaa;font-family:'DM Mono',monospace;font-size:9px;letter-spacing:2px;text-transform:uppercase;cursor:pointer;transition:all .2s}
#cbtn:hover{border-color:#1a1a1a;color:#1a1a1a}
#sb{position:fixed;bottom:0;left:0;right:0;display:flex;justify-content:space-between;padding:13px 40px;border-top:1px solid rgba(26,26,26,0.06);z-index:100;font-size:9px;letter-spacing:2px;color:#ccc;text-transform:uppercase}
.dot{display:inline-block;width:5px;height:5px;border-radius:50%;background:#1a1a1a;margin-right:8px;animation:blink 2.5s ease infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.15}}
</style></head><body>
<canvas id="bg"></canvas>
<div id="cur"></div><div id="cur-ring"></div>
<div id="nav">
  <div id="logo">3DP Agent</div>
  <div style="display:flex;gap:28px">
    <div class="nl">Analysis</div>
    <div class="nl">Geometry</div>
    <div class="nl">Report</div>
  </div>
</div>
<div id="hero">
  <div id="hero-eye">Industrial STL Analysis · 2026</div>
  <div id="hero-h1">Geometry<br><em>intelligence</em><br>for makers</div>
  <div id="hero-sub">Drop your STL · Get the truth</div>
</div>
<div id="card">
  <div id="drop" onclick="document.getElementById('fileinput').click()">
    <div id="drop-icon">+</div>
    <div id="drop-t">Load STL file</div>
    <div id="drop-s">Click or drag to upload</div>
  </div>
  <input type="file" id="fileinput" accept=".stl">
  <textarea id="qtxt" rows="2" placeholder="// Optional query..."></textarea>
  <button id="abtn" disabled onclick="runAnalysis()">Analyze →</button>
</div>
<div id="rp">
  <div id="ri">
    <div id="score-row">
      <div id="sc">--</div>
      <div id="sc-lbl">Printability<br>score / 100</div>
    </div>
    <div id="mgrid">
      <div class="mc"><div class="ml">Dimensions</div><div class="mv" id="r-dim">--</div></div>
      <div class="mc"><div class="ml">Volume</div><div class="mv" id="r-vol">--</div></div>
      <div class="mc"><div class="ml">Faces</div><div class="mv" id="r-faces">--</div></div>
      <div class="mc"><div class="ml">Vertices</div><div class="mv" id="r-verts">--</div></div>
    </div>
    <div id="iss-list"></div>
    <div id="rep"></div>
    <button id="cbtn" onclick="closeResult()">← New analysis</button>
  </div>
</div>
<div id="sb">
  <div><span class="dot"></span><span id="stxt">System ready</span></div>
  <div id="sfile">No file loaded</div>
  <div>3DP_AGENT v2.0</div>
</div>

<script>
// ── Canvas world ──────────────────────────────────────────────
const canvas = document.getElementById('bg');
const ctx = canvas.getContext('2d');
let W, H, mouse = {x:window.innerWidth/2, y:window.innerHeight/2};

function resize(){
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

// Particles: mix of digits, shapes, little product silhouettes
const SYMBOLS = ['0','1','2','3','4','5','6','7','8','9',
  '△','□','◇','○','⬡',
  '⌗','⊕','⊞','⊠','∿'];

class Particle {
  constructor(){this.reset(true)}
  reset(init){
    this.x = Math.random()*W;
    this.y = init ? Math.random()*H : H+40;
    this.vy = -(0.18+Math.random()*0.35);
    this.vx = (Math.random()-.5)*0.15;
    this.size = 9+Math.random()*13;
    this.alpha = 0.06+Math.random()*0.12;
    this.sym = SYMBOLS[Math.floor(Math.random()*SYMBOLS.length)];
    this.rot = Math.random()*Math.PI*2;
    this.rotV = (Math.random()-.5)*0.008;
    this.ox = this.x; this.oy = this.y;
    this.fleeing = false;
    this.fleeVx = 0; this.fleeVy = 0;
  }
  update(){
    const dx = this.x - mouse.x;
    const dy = this.y - mouse.y;
    const dist = Math.sqrt(dx*dx+dy*dy);
    if(dist < 90){
      const force = (90-dist)/90;
      this.fleeVx += dx/dist * force * 2.2;
      this.fleeVy += dy/dist * force * 2.2;
      this.fleeing = true;
    }
    this.fleeVx *= 0.88;
    this.fleeVy *= 0.88;
    this.x += this.vx + this.fleeVx;
    this.y += this.vy + this.fleeVy;
    this.rot += this.rotV;
    if(this.y < -40) this.reset(false);
  }
  draw(){
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot);
    ctx.globalAlpha = this.alpha;
    ctx.font = `300 ${this.size}px 'DM Mono',monospace`;
    ctx.fillStyle = '#1a1a1a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.sym, 0, 0);
    ctx.restore();
  }
}

// Draw 3D-print-like small shapes (wireframe cubes, etc.)
class ShapeParticle {
  constructor(){this.reset(true)}
  reset(init){
    this.x = Math.random()*W;
    this.y = init ? Math.random()*H : H+60;
    this.vy = -(0.12+Math.random()*0.25);
    this.vx = (Math.random()-.5)*0.1;
    this.size = 14+Math.random()*20;
    this.alpha = 0.04+Math.random()*0.07;
    this.rot = Math.random()*Math.PI*2;
    this.rotV = (Math.random()-.5)*0.006;
    this.type = Math.floor(Math.random()*3);
    this.fleeVx=0;this.fleeVy=0;
  }
  update(){
    const dx=this.x-mouse.x,dy=this.y-mouse.y;
    const dist=Math.sqrt(dx*dx+dy*dy);
    if(dist<100){
      const f=(100-dist)/100;
      this.fleeVx+=dx/dist*f*2.8;
      this.fleeVy+=dy/dist*f*2.8;
    }
    this.fleeVx*=.86;this.fleeVy*=.86;
    this.x+=this.vx+this.fleeVx;
    this.y+=this.vy+this.fleeVy;
    this.rot+=this.rotV;
    if(this.y<-60)this.reset(false);
  }
  draw(){
    ctx.save();
    ctx.translate(this.x,this.y);
    ctx.rotate(this.rot);
    ctx.globalAlpha=this.alpha;
    ctx.strokeStyle='#1a1a1a';
    ctx.lineWidth=0.8;
    const s=this.size;
    if(this.type===0){
      // wireframe cube projection
      ctx.beginPath();ctx.rect(-s/2,-s/2,s,s);ctx.stroke();
      ctx.beginPath();ctx.rect(-s/2+4,-s/2-4,s,s);ctx.stroke();
      ctx.beginPath();ctx.moveTo(-s/2,-s/2);ctx.lineTo(-s/2+4,-s/2-4);ctx.stroke();
      ctx.beginPath();ctx.moveTo(s/2,-s/2);ctx.lineTo(s/2+4,-s/2-4);ctx.stroke();
      ctx.beginPath();ctx.moveTo(s/2,s/2);ctx.lineTo(s/2+4,s/2-4);ctx.stroke();
      ctx.beginPath();ctx.moveTo(-s/2,s/2);ctx.lineTo(-s/2+4,s/2-4);ctx.stroke();
    } else if(this.type===1){
      // triangle/pyramid
      ctx.beginPath();
      ctx.moveTo(0,-s/1.5);ctx.lineTo(s/2,s/2);ctx.lineTo(-s/2,s/2);ctx.closePath();
      ctx.stroke();
      ctx.beginPath();ctx.moveTo(0,-s/1.5);ctx.lineTo(0,s/2);ctx.stroke();
    } else {
      // cylinder-ish
      ctx.beginPath();ctx.ellipse(0,-s/3,s/2.5,s/6,0,0,Math.PI*2);ctx.stroke();
      ctx.beginPath();ctx.ellipse(0,s/3,s/2.5,s/6,0,0,Math.PI*2);ctx.stroke();
      ctx.beginPath();ctx.moveTo(-s/2.5,-s/3);ctx.lineTo(-s/2.5,s/3);ctx.stroke();
      ctx.beginPath();ctx.moveTo(s/2.5,-s/3);ctx.lineTo(s/2.5,s/3);ctx.stroke();
    }
    ctx.restore();
  }
}

// Organic blobs (warm background)
class Blob {
  constructor(){
    this.x=Math.random()*W;this.y=Math.random()*H;
    this.vx=(Math.random()-.5)*.3;this.vy=(Math.random()-.5)*.3;
    this.r=100+Math.random()*160;
    this.phase=Math.random()*Math.PI*2;
    this.colors=['rgba(210,200,185,0.28)','rgba(190,183,170,0.2)','rgba(200,192,178,0.22)','rgba(180,173,162,0.18)'];
    this.color=this.colors[Math.floor(Math.random()*this.colors.length)];
  }
  update(){
    this.phase+=.005;
    const dx=mouse.x-this.x,dy=mouse.y-this.y,dist=Math.sqrt(dx*dx+dy*dy);
    const pull=Math.max(0,1-dist/350)*.3;
    this.x+=this.vx+dx*pull*.01+Math.sin(this.phase)*.2;
    this.y+=this.vy+dy*pull*.01+Math.cos(this.phase*.7)*.2;
    if(this.x<-this.r)this.x=W+this.r;if(this.x>W+this.r)this.x=-this.r;
    if(this.y<-this.r)this.y=H+this.r;if(this.y>H+this.r)this.y=-this.r;
  }
  draw(){
    const wobble=this.r+Math.sin(this.phase)*12;
    const g=ctx.createRadialGradient(this.x,this.y,0,this.x,this.y,wobble);
    g.addColorStop(0,this.color);g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.beginPath();ctx.arc(this.x,this.y,wobble,0,Math.PI*2);
    ctx.fillStyle=g;ctx.fill();
  }
}

const blobs=Array.from({length:7},()=>new Blob());
const particles=Array.from({length:55},()=>new Particle());
const shapes=Array.from({length:22},()=>new ShapeParticle());

function animate(){
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#f5f2ed';ctx.fillRect(0,0,W,H);
  blobs.forEach(b=>{b.update();b.draw()});
  particles.forEach(p=>{p.update();p.draw()});
  shapes.forEach(s=>{s.update();s.draw()});
  requestAnimationFrame(animate);
}
animate();

// ── Cursor ────────────────────────────────────────────────────
const cur=document.getElementById('cur');
const ring=document.getElementById('cur-ring');
document.addEventListener('mousemove',e=>{
  mouse.x=e.clientX;mouse.y=e.clientY;
  cur.style.left=e.clientX+'px';cur.style.top=e.clientY+'px';
  setTimeout(()=>{ring.style.left=e.clientX+'px';ring.style.top=e.clientY+'px'},85);
});

// ── Drag & drop ───────────────────────────────────────────────
const drop=document.getElementById('drop');
drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('drag')});
drop.addEventListener('dragleave',()=>drop.classList.remove('drag'));
drop.addEventListener('drop',e=>{
  e.preventDefault();drop.classList.remove('drag');
  const f=e.dataTransfer.files[0];
  if(f&&f.name.toLowerCase().endsWith('.stl'))setFile(f);
});

let selectedFile=null;
document.getElementById('fileinput').addEventListener('change',e=>{
  if(e.target.files[0])setFile(e.target.files[0]);
});

function setFile(f){
  selectedFile=f;
  document.getElementById('drop-t').textContent=f.name;
  document.getElementById('drop-s').textContent=Math.round(f.size/1024)+' KB · Ready';
  document.getElementById('sfile').textContent=f.name;
  const btn=document.getElementById('abtn');
  btn.disabled=false;btn.classList.add('ready');btn.textContent='Analyze →';
}

// ── Analysis ──────────────────────────────────────────────────
async function runAnalysis(){
  if(!selectedFile)return;
  const btn=document.getElementById('abtn');
  btn.disabled=true;btn.classList.remove('ready');btn.classList.add('busy');
  btn.textContent='Analyzing...';
  document.getElementById('stxt').textContent='Uploading geometry...';

  const fd=new FormData();
  fd.append('file',selectedFile);
  fd.append('question',document.getElementById('qtxt').value);

  try{
    const res=await fetch('/analyze',{method:'POST',body:fd});
    if(!res.ok)throw new Error('Server '+res.status);
    const d=await res.json();
    showResult(d);
  }catch(e){
    document.getElementById('stxt').textContent='Error: '+e.message;
    btn.disabled=false;btn.classList.add('ready');btn.classList.remove('busy');
    btn.textContent='Retry →';
  }
}

function showResult(d){
  const score=d.score||70;
  const sc=document.getElementById('sc');
  sc.style.color=score>=80?'#2d6a4f':score>=60?'#888':'#c0392b';
  let n=0;const iv=setInterval(()=>{n+=2;sc.textContent=Math.min(n,score);if(n>=score)clearInterval(iv)},16);

  const dim=d.stats['尺寸(mm)'];
  document.getElementById('r-dim').textContent=dim.X+'×'+dim.Y+'×'+dim.Z+' mm';
  document.getElementById('r-vol').textContent=d.stats['体积(mm³)']+' mm³';
  document.getElementById('r-faces').textContent=d.stats['面数'].toLocaleString();
  document.getElementById('r-verts').textContent=d.stats['顶点数'].toLocaleString();

  const il=document.getElementById('iss-list');il.innerHTML='';
  if(d.issues.length===0){
    il.innerHTML='<div class="ok">— No issues detected</div>';
  }else{
    d.issues.forEach(i=>{
      il.innerHTML+=`<div class="iss"><span class="iss-d">—</span><span class="iss-t">${i}</span></div>`;
    });
  }

  const rep=document.getElementById('rep');rep.textContent='';
  let i=0;const tw=setInterval(()=>{
    rep.textContent+=d.report[i++];
    if(i>=d.report.length)clearInterval(tw);
  },6);

  document.getElementById('rp').classList.add('show');
  document.getElementById('stxt').textContent='Analysis complete';
  const btn=document.getElementById('abtn');
  btn.disabled=false;btn.classList.add('ready');btn.classList.remove('busy');
  btn.textContent='Analyze →';
}

function closeResult(){
  document.getElementById('rp').classList.remove('show');
  document.getElementById('stxt').textContent='System ready';
}
</script></body></html>"""

def analyze_stl(fp):
    mesh=trimesh.load(fp)
    issues=[];stats={}
    stats["面数"]=len(mesh.faces)
    stats["顶点数"]=len(mesh.vertices)
    stats["体积(mm³)"]=round(float(mesh.volume),2)
    b=mesh.bounds;sz=b[1]-b[0]
    stats["尺寸(mm)"]={"X":round(float(sz[0]),2),"Y":round(float(sz[1]),2),"Z":round(float(sz[2]),2)}
    if not mesh.is_watertight:issues.append("网格不封闭（有破洞），打印前必须修复")
    if not mesh.is_winding_consistent:issues.append("法线方向不一致，可能导致打印错误")
    mn=float(min(sz))
    if mn<1.5:issues.append(f"最薄处约{mn:.2f}mm，低于FDM最小壁厚1.5mm")
    norms=mesh.face_normals;dw=norms[:,2]<-0.5
    r=float(np.sum(dw)/len(norms))
    if r>0.15:issues.append(f"约{r*100:.0f}%的面存在悬空，需要支撑结构")
    if mesh.volume<=0:issues.append("体积异常，模型存在几何错误")
    return stats,issues

def xscore(t):
    m=re.search(r'(\d{1,3})\s*[/／]\s*100|评分[：:]\s*(\d{1,3})|(\d{1,3})\s*分',t)
    if m:
        for g in m.groups():
            if g:return min(int(g),100)
    return 70

@app.route('/')
def index():return render_template_string(HTML)

@app.route('/analyze',methods=['POST'])
def analyze():
    f=request.files['file'];q=request.form.get('question','')
    with tempfile.NamedTemporaryFile(suffix='.stl',delete=False) as tmp:
        f.save(tmp.name);stats,issues=analyze_stl(tmp.name);os.unlink(tmp.name)
    client=Groq(api_key="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")
    prompt=f"""你是3D打印专业顾问Agent。
模型数据：{json.dumps(stats,ensure_ascii=False)}
问题：{json.dumps(issues,ensure_ascii=False) if issues else "无"}
用户问题：{q if q else "给出完整打印方案"}
用中文回答，包含：1.可打印性评分(0-100) 2.主要风险 3.推荐FDM或光固化及理由 4.层高/支撑/填充率参数 5.预估打印时间 6.最关键修改建议"""
    resp=client.chat.completions.create(model="llama-3.3-70b-versatile",messages=[{"role":"user","content":prompt}],max_tokens=1024)
    report=resp.choices[0].message.content
    return jsonify({"stats":stats,"issues":issues,"report":report,"score":xscore(report)})

if __name__=='__main__':app.run(debug=True,port=5001)
