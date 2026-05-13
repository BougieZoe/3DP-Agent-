from flask import Flask, request, jsonify, render_template_string
import trimesh, numpy as np, json, os, tempfile, re
from groq import Groq

app = Flask(__name__)

HTML = r"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>3DP Agent — Active Theory</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d0d0d;overflow:hidden;height:100vh;cursor:none;font-family:'Courier New',monospace}
canvas{position:fixed;inset:0;z-index:0}
#cur{position:fixed;width:5px;height:5px;border-radius:50%;background:#fff;pointer-events:none;z-index:9999;transform:translate(-50%,-50%);mix-blend-mode:difference}
#cur-ring{position:fixed;width:44px;height:44px;border-radius:50%;border:1px solid rgba(255,255,255,0.2);pointer-events:none;z-index:9998;transform:translate(-50%,-50%);transition:left .12s ease,top .12s ease,transform .3s}
#ui{position:fixed;inset:0;z-index:50;pointer-events:none}
#nav{display:flex;justify-content:space-between;align-items:center;padding:26px 44px;pointer-events:all}
#logo{font-size:11px;letter-spacing:4px;color:#fff;text-transform:uppercase;mix-blend-mode:difference}
.nl{font-size:9px;letter-spacing:2.5px;color:rgba(255,255,255,0.3);cursor:pointer;transition:color .2s;text-transform:uppercase;pointer-events:all}
.nl:hover{color:#fff}
#hero{position:absolute;left:44px;bottom:110px;pointer-events:none;mix-blend-mode:difference}
#h1{font-size:62px;line-height:1.02;letter-spacing:-2.5px;color:#fff;font-weight:200}
#h1 b{font-weight:700;font-style:italic}
#hsub{font-size:9px;letter-spacing:3px;color:rgba(255,255,255,0.35);margin-top:18px;text-transform:uppercase}
#card{position:absolute;right:44px;bottom:110px;width:216px;pointer-events:all}
#drop{border:1px solid rgba(255,255,255,0.08);padding:22px 20px;cursor:pointer;transition:all .3s;background:rgba(13,13,13,0.6);backdrop-filter:blur(24px)}
#drop:hover,#drop.drag{border-color:rgba(255,255,255,0.3);background:rgba(255,255,255,0.03)}
#drop-icon{font-size:14px;color:rgba(255,255,255,0.4);margin-bottom:12px;transition:color .3s}
#drop:hover #drop-icon{color:#fff}
#drop-t{font-size:10px;letter-spacing:2px;color:rgba(255,255,255,0.7);text-transform:uppercase;margin-bottom:3px}
#drop-s{font-size:9px;letter-spacing:1px;color:rgba(255,255,255,0.2)}
#fileinput{display:none}
#qtxt{width:100%;margin-top:1px;padding:10px 12px;background:rgba(13,13,13,0.6);border:1px solid rgba(255,255,255,0.06);color:rgba(255,255,255,0.7);font-family:'Courier New',monospace;font-size:9px;letter-spacing:1px;outline:none;resize:none;backdrop-filter:blur(24px);transition:border-color .2s}
#qtxt::placeholder{color:rgba(255,255,255,0.12)}
#qtxt:focus{border-color:rgba(255,255,255,0.18)}
#abtn{width:100%;margin-top:1px;padding:13px;background:transparent;border:1px solid rgba(255,255,255,0.06);color:rgba(255,255,255,0.18);font-family:'Courier New',monospace;font-size:9px;letter-spacing:3px;text-transform:uppercase;cursor:not-allowed;transition:all .3s}
#abtn.ready{color:rgba(255,255,255,0.7);border-color:rgba(255,255,255,0.18);cursor:pointer}
#abtn.ready:hover{background:rgba(255,255,255,0.05);border-color:rgba(255,255,255,0.4);color:#fff}
#abtn.busy{color:rgba(255,255,255,0.3);cursor:wait}
#rp{position:fixed;inset:0;z-index:200;background:rgba(13,13,13,0.97);backdrop-filter:blur(40px);display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .7s}
#rp.show{opacity:1;pointer-events:all}
#ri{width:600px;max-height:88vh;overflow-y:auto;padding:52px}
#ri::-webkit-scrollbar{width:1px}
#ri::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.08)}
#srow{display:flex;align-items:baseline;gap:20px;margin-bottom:44px;padding-bottom:36px;border-bottom:1px solid rgba(255,255,255,0.05)}
#sc{font-size:96px;font-weight:100;letter-spacing:-5px;line-height:1;color:#fff;transition:color 1s}
#sclbl{font-size:9px;letter-spacing:2.5px;color:rgba(255,255,255,0.2);text-transform:uppercase;line-height:2.4}
#mgrid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:rgba(255,255,255,0.04);margin-bottom:36px}
.mc{padding:20px 22px;background:#0d0d0d}
.ml{font-size:9px;letter-spacing:2px;color:rgba(255,255,255,0.2);margin-bottom:7px;text-transform:uppercase}
.mv{font-size:20px;color:rgba(255,255,255,0.75);letter-spacing:.3px;font-weight:200}
.iss{display:flex;gap:12px;padding:11px 0;border-bottom:1px solid rgba(255,255,255,0.03);font-size:10px;line-height:1.8}
.iss-d{color:rgba(255,255,255,0.15);flex-shrink:0}
.iss-t{color:rgba(255,255,255,0.38);letter-spacing:.3px}
.ok{font-size:10px;letter-spacing:1px;color:rgba(255,255,255,0.18);padding:11px 0}
#rep{font-size:10px;line-height:2.2;color:rgba(255,255,255,0.25);letter-spacing:.3px;white-space:pre-wrap;margin-top:28px;padding-top:28px;border-top:1px solid rgba(255,255,255,0.04)}
#cbtn{margin-top:36px;float:right;padding:13px 26px;background:transparent;border:1px solid rgba(255,255,255,0.08);color:rgba(255,255,255,0.25);font-family:'Courier New',monospace;font-size:9px;letter-spacing:2px;text-transform:uppercase;cursor:pointer;transition:all .25s}
#cbtn:hover{border-color:rgba(255,255,255,0.3);color:#fff}
#sb{position:fixed;bottom:0;left:0;right:0;display:flex;justify-content:space-between;padding:14px 44px;border-top:1px solid rgba(255,255,255,0.03);z-index:100;font-size:9px;letter-spacing:2px;color:rgba(255,255,255,0.18);text-transform:uppercase}
.dot{display:inline-block;width:4px;height:4px;border-radius:50%;background:#fff;margin-right:8px;animation:blink 3s ease infinite}
@keyframes blink{0%,100%{opacity:.6}50%{opacity:.05}}
</style></head><body>
<canvas id="c"></canvas>
<div id="cur"></div><div id="cur-ring"></div>
<div id="ui">
  <div id="nav">
    <div id="logo">3DP Agent</div>
    <div style="display:flex;gap:28px">
      <div class="nl">Analysis</div>
      <div class="nl">Geometry</div>
      <div class="nl">Report</div>
    </div>
  </div>
  <div id="hero">
    <div id="h1">The geometry<br><b>lives here</b><br>now.</div>
    <div id="hsub">Industrial STL Analysis · 2026</div>
  </div>
  <div id="card">
    <div id="drop" onclick="document.getElementById('fileinput').click()">
      <div id="drop-icon">↑</div>
      <div id="drop-t">Load STL file</div>
      <div id="drop-s">Click or drag to upload</div>
    </div>
    <input type="file" id="fileinput" accept=".stl">
    <textarea id="qtxt" rows="2" placeholder="// Optional query..."></textarea>
    <button id="abtn" disabled onclick="runAnalysis()">Analyze →</button>
  </div>
</div>
<div id="rp">
  <div id="ri">
    <div id="srow"><div id="sc">--</div><div id="sclbl">Printability<br>score / 100</div></div>
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
  <div>3DP_AGENT v4.0</div>
</div>

<script>
const canvas=document.getElementById('c');
const ctx=canvas.getContext('2d');
let W,H;
const mouse={x:0,y:0,vx:0,vy:0,px:0,py:0};
function resize(){W=canvas.width=window.innerWidth;H=canvas.height=window.innerHeight}
resize();window.addEventListener('resize',resize);

// Active Theory: WebGL-style grid warp on CPU canvas
// Warping dot grid that follows mouse like a magnetic field
const COLS=38,ROWS=22;
const dots=[];
for(let r=0;r<ROWS;r++){
  for(let c=0;c<COLS;c++){
    dots.push({
      bx:(c/(COLS-1))*1.15-.075,
      by:(r/(ROWS-1))*1.15-.075,
      x:0,y:0,vx:0,vy:0,
      size:1.2+Math.random()*.8,
      phase:Math.random()*Math.PI*2
    });
  }
}

// Large flowing lines (Active Theory signature)
const lines=[];
for(let i=0;i<14;i++){
  lines.push({
    y:0.05+i*.065,
    phase:Math.random()*Math.PI*2,
    amp:0.012+Math.random()*.018,
    freq:1.5+Math.random()*2,
    speed:0.004+Math.random()*.003,
    alpha:0.03+Math.random()*.04
  });
}

let frame=0;
function draw(){
  ctx.fillStyle='rgba(13,13,13,0.82)';
  ctx.fillRect(0,0,W,H);

  const mx=mouse.x/W,my=mouse.y/H;
  mouse.vx=mouse.x-mouse.px;
  mouse.vy=mouse.y-mouse.py;
  mouse.px=mouse.x;mouse.py=mouse.y;

  // Flowing horizontal lines
  lines.forEach(l=>{
    l.phase+=l.speed;
    const yBase=l.y*H;
    ctx.beginPath();
    for(let x=0;x<=W;x+=3){
      const nx=x/W;
      const distX=nx-mx,distY=l.y-my;
      const dist=Math.sqrt(distX*distX+distY*distY);
      const warp=Math.max(0,1-dist/.45)*.06;
      const wave=Math.sin(nx*l.freq*Math.PI*2+l.phase)*l.amp;
      const mouseWarp=Math.sin((nx-mx)*8)*warp;
      const py=yBase+(wave+mouseWarp)*H;
      x===0?ctx.moveTo(x,py):ctx.lineTo(x,py);
    }
    ctx.strokeStyle=`rgba(255,255,255,${l.alpha})`;
    ctx.lineWidth=.7;ctx.stroke();
  });

  // Dot grid — warps toward mouse
  dots.forEach(d=>{
    const tx=d.bx*W,ty=d.by*H;
    const dx=mouse.x-tx,dy=mouse.y-ty;
    const dist=Math.sqrt(dx*dx+dy*dy);
    const pull=Math.max(0,1-dist/320)*55;
    const ang=Math.atan2(dy,dx);
    const warpX=Math.cos(ang)*pull;
    const warpY=Math.sin(ang)*pull;
    d.vx+=(tx+warpX-d.x)*.06;
    d.vy+=(ty+warpY-d.y)*.06;
    d.vx*=.78;d.vy*=.78;
    d.x+=d.vx;d.y+=d.vy;
    d.phase+=.018;

    const proximity=Math.max(0,1-dist/200);
    const alpha=0.06+proximity*.35+Math.sin(d.phase)*.02;
    const size=d.size+proximity*2.5;

    ctx.beginPath();
    ctx.arc(d.x,d.y,size,0,Math.PI*2);
    ctx.fillStyle=`rgba(255,255,255,${alpha})`;
    ctx.fill();
  });

  // Mouse glow
  const g=ctx.createRadialGradient(mouse.x,mouse.y,0,mouse.x,mouse.y,200);
  g.addColorStop(0,'rgba(255,255,255,0.04)');
  g.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=g;ctx.fillRect(0,0,W,H);

  frame++;requestAnimationFrame(draw);
}
draw();

// Cursor
const cur=document.getElementById('cur');
const ring=document.getElementById('cur-ring');
document.addEventListener('mousemove',e=>{
  mouse.x=e.clientX;mouse.y=e.clientY;
  cur.style.left=e.clientX+'px';cur.style.top=e.clientY+'px';
  setTimeout(()=>{ring.style.left=e.clientX+'px';ring.style.top=e.clientY+'px'},100);
});

// File
const drop=document.getElementById('drop');
drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('drag')});
drop.addEventListener('dragleave',()=>drop.classList.remove('drag'));
drop.addEventListener('drop',e=>{
  e.preventDefault();drop.classList.remove('drag');
  const f=e.dataTransfer.files[0];
  if(f&&f.name.toLowerCase().endsWith('.stl'))setFile(f);
});
document.getElementById('fileinput').addEventListener('change',e=>{
  if(e.target.files[0])setFile(e.target.files[0]);
});

let selectedFile=null;
function setFile(f){
  selectedFile=f;
  document.getElementById('drop-t').textContent=f.name;
  document.getElementById('drop-s').textContent=Math.round(f.size/1024)+' KB · Ready';
  document.getElementById('sfile').textContent=f.name;
  const btn=document.getElementById('abtn');
  btn.disabled=false;btn.classList.add('ready');btn.textContent='Analyze →';
}

async function runAnalysis(){
  if(!selectedFile)return;
  const btn=document.getElementById('abtn');
  btn.disabled=true;btn.classList.remove('ready');btn.classList.add('busy');
  btn.textContent='Analyzing...';
  document.getElementById('stxt').textContent='Processing geometry...';
  const fd=new FormData();
  fd.append('file',selectedFile);
  fd.append('question',document.getElementById('qtxt').value);
  try{
    const res=await fetch('/analyze',{method:'POST',body:fd});
    if(!res.ok)throw new Error('Server '+res.status);
    const d=await res.json();showResult(d);
  }catch(e){
    document.getElementById('stxt').textContent='Error: '+e.message;
    btn.disabled=false;btn.classList.add('ready');btn.classList.remove('busy');
    btn.textContent='Retry →';
  }
}

function showResult(d){
  const score=d.score||70;
  const sc=document.getElementById('sc');
  sc.style.color=score>=80?'#fff':score>=60?'rgba(255,255,255,0.6)':'rgba(255,100,100,0.8)';
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
    mesh=trimesh.load(fp);issues=[];stats={}
    stats["面数"]=len(mesh.faces);stats["顶点数"]=len(mesh.vertices)
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

if __name__=='__main__':app.run(debug=True,port=5003)
