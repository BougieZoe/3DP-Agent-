from flask import Flask, request, jsonify, render_template_string
import trimesh, numpy as np, json, os, tempfile, re
from groq import Groq

app = Flask(__name__)

HTML = r"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>3DP Agent — Lusion</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#000;overflow:hidden;height:100vh;cursor:none;font-family:'Courier New',monospace}
canvas{position:fixed;inset:0}
#cur{position:fixed;width:6px;height:6px;border-radius:50%;background:#fff;pointer-events:none;z-index:9999;transform:translate(-50%,-50%)}
#cur-ring{position:fixed;width:40px;height:40px;border-radius:50%;border:1px solid rgba(255,255,255,0.3);pointer-events:none;z-index:9998;transform:translate(-50%,-50%);transition:left .1s,top .1s,width .3s,height .3s}
#ui{position:fixed;inset:0;z-index:100;pointer-events:none}
#nav{display:flex;justify-content:space-between;align-items:center;padding:24px 40px;pointer-events:all}
#logo{font-size:13px;letter-spacing:3px;color:rgba(255,255,255,0.9);text-transform:uppercase}
.nl{font-size:9px;letter-spacing:2px;color:rgba(255,255,255,0.3);cursor:pointer;transition:color .2s;text-transform:uppercase;pointer-events:all}
.nl:hover{color:#fff}
#hero{position:absolute;left:40px;bottom:100px;pointer-events:none}
#h1{font-size:56px;line-height:1.05;letter-spacing:-2px;color:#fff;font-weight:300}
#h1 em{font-style:italic;color:rgba(255,255,255,0.4)}
#hsub{font-size:9px;letter-spacing:3px;color:rgba(255,255,255,0.25);margin-top:20px;text-transform:uppercase}
#card{position:absolute;right:40px;bottom:100px;width:220px;pointer-events:all}
#drop{border:1px solid rgba(255,255,255,0.1);padding:24px 20px;cursor:pointer;transition:border-color .3s;background:rgba(0,0,0,0.4);backdrop-filter:blur(20px)}
#drop:hover,#drop.drag{border-color:rgba(255,255,255,0.4)}
#drop-icon{font-size:18px;color:rgba(255,255,255,0.5);margin-bottom:12px}
#drop-t{font-size:10px;letter-spacing:2px;color:rgba(255,255,255,0.8);text-transform:uppercase;margin-bottom:3px}
#drop-s{font-size:9px;letter-spacing:1px;color:rgba(255,255,255,0.25)}
#fileinput{display:none}
#qtxt{width:100%;margin-top:1px;padding:10px 12px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.08);color:#fff;font-family:'Courier New',monospace;font-size:9px;letter-spacing:1px;outline:none;resize:none;backdrop-filter:blur(20px)}
#qtxt::placeholder{color:rgba(255,255,255,0.15)}
#qtxt:focus{border-color:rgba(255,255,255,0.2)}
#abtn{width:100%;margin-top:1px;padding:13px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);color:rgba(255,255,255,0.2);font-family:'Courier New',monospace;font-size:9px;letter-spacing:3px;text-transform:uppercase;cursor:not-allowed;transition:all .3s}
#abtn.ready{color:rgba(255,255,255,0.8);border-color:rgba(255,255,255,0.2);cursor:pointer}
#abtn.ready:hover{background:rgba(255,255,255,0.08);border-color:rgba(255,255,255,0.5);color:#fff}
#abtn.busy{color:rgba(255,255,255,0.4);cursor:wait}
#rp{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,0.95);backdrop-filter:blur(30px);display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .6s}
#rp.show{opacity:1;pointer-events:all}
#ri{width:620px;max-height:88vh;overflow-y:auto;padding:48px}
#ri::-webkit-scrollbar{width:1px}
#ri::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1)}
#srow{display:flex;align-items:baseline;gap:20px;margin-bottom:40px;padding-bottom:32px;border-bottom:1px solid rgba(255,255,255,0.06)}
#sc{font-size:88px;font-weight:200;letter-spacing:-4px;line-height:1;color:#fff}
#sclbl{font-size:9px;letter-spacing:2.5px;color:rgba(255,255,255,0.25);text-transform:uppercase;line-height:2.2}
#mgrid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:rgba(255,255,255,0.05);margin-bottom:32px}
.mc{padding:18px 20px;background:#000}
.ml{font-size:9px;letter-spacing:2px;color:rgba(255,255,255,0.25);margin-bottom:6px;text-transform:uppercase}
.mv{font-size:18px;color:rgba(255,255,255,0.85);letter-spacing:.5px;font-weight:300}
.iss{display:flex;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:10px;line-height:1.8}
.iss-d{color:rgba(255,255,255,0.2);flex-shrink:0}
.iss-t{color:rgba(255,255,255,0.45);letter-spacing:.3px}
.ok{font-size:10px;letter-spacing:1px;color:rgba(255,255,255,0.2);padding:10px 0}
#rep{font-size:10px;line-height:2.1;color:rgba(255,255,255,0.3);letter-spacing:.3px;white-space:pre-wrap;margin-top:24px;padding-top:24px;border-top:1px solid rgba(255,255,255,0.05)}
#cbtn{margin-top:32px;float:right;padding:12px 24px;background:transparent;border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.3);font-family:'Courier New',monospace;font-size:9px;letter-spacing:2px;text-transform:uppercase;cursor:pointer;transition:all .2s}
#cbtn:hover{border-color:rgba(255,255,255,0.4);color:#fff}
#sb{position:fixed;bottom:0;left:0;right:0;display:flex;justify-content:space-between;padding:14px 40px;border-top:1px solid rgba(255,255,255,0.04);z-index:100;font-size:9px;letter-spacing:2px;color:rgba(255,255,255,0.2);text-transform:uppercase}
.dot{display:inline-block;width:4px;height:4px;border-radius:50%;background:#fff;margin-right:8px;animation:blink 2.5s ease infinite}
@keyframes blink{0%,100%{opacity:.8}50%{opacity:.1}}
</style></head><body>
<canvas id="c"></canvas>
<div id="cur"></div>
<div id="cur-ring"></div>
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
    <div id="h1">Geometry<br><em>intelligence</em><br>for makers</div>
    <div id="hsub">Industrial STL Analysis · 2026</div>
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
</div>
<div id="rp">
  <div id="ri">
    <div id="srow">
      <div id="sc">--</div>
      <div id="sclbl">Printability<br>score / 100</div>
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
  <div>3DP_AGENT v3.0</div>
</div>

<script>
const canvas=document.getElementById('c');
const ctx=canvas.getContext('2d');
let W,H;
const mouse={x:window.innerWidth/2,y:window.innerHeight/2,px:window.innerWidth/2,py:window.innerHeight/2};

function resize(){W=canvas.width=window.innerWidth;H=canvas.height=window.innerHeight}
resize();window.addEventListener('resize',resize);

// Fluid particle system
const N=1800;
const px=new Float32Array(N),py=new Float32Array(N);
const vx=new Float32Array(N),vy=new Float32Array(N);
const life=new Float32Array(N),maxLife=new Float32Array(N);
const hue=new Float32Array(N);

for(let i=0;i<N;i++){
  px[i]=Math.random()*1800;py[i]=Math.random()*900;
  vx[i]=(Math.random()-.5)*.4;vy[i]=(Math.random()-.5)*.4;
  maxLife[i]=120+Math.random()*200;life[i]=Math.random()*maxLife[i];
  hue[i]=180+Math.random()*60; // teal-blue range
}

let frame=0;
function animate(){
  // Motion blur trail
  ctx.fillStyle='rgba(0,0,0,0.18)';
  ctx.fillRect(0,0,W,H);

  const mdx=mouse.x-mouse.px;
  const mdy=mouse.y-mouse.py;
  mouse.px=mouse.x;mouse.py=mouse.y;

  for(let i=0;i<N;i++){
    life[i]++;
    if(life[i]>maxLife[i]){
      px[i]=Math.random()*W;py[i]=Math.random()*H;
      vx[i]=(Math.random()-.5)*.4;vy[i]=(Math.random()-.5)*.4;
      life[i]=0;maxLife[i]=120+Math.random()*200;
      hue[i]=180+Math.random()*60;
      continue;
    }

    // Mouse fluid influence
    const dx=px[i]-mouse.x,dy=py[i]-mouse.y;
    const dist=Math.sqrt(dx*dx+dy*dy);
    if(dist<160){
      const f=(160-dist)/160;
      vx[i]+=(mdx*f*.08)+(dx/dist*f*.6);
      vy[i]+=(mdy*f*.08)+(dy/dist*f*.6);
    }

    // Noise-like drift
    const nx=Math.sin(px[i]*.006+frame*.008)*0.12;
    const ny=Math.cos(py[i]*.006+frame*.007)*0.12;
    vx[i]+=nx;vy[i]+=ny;

    // Damping
    vx[i]*=.97;vy[i]*=.97;
    px[i]+=vx[i];py[i]+=vy[i];

    // Wrap
    if(px[i]<0)px[i]=W;if(px[i]>W)px[i]=0;
    if(py[i]<0)py[i]=H;if(py[i]>H)py[i]=0;

    const t=life[i]/maxLife[i];
    const alpha=t<.2?t/.2:t>.8?(1-t)/.2:1;
    const speed=Math.sqrt(vx[i]*vx[i]+vy[i]*vy[i]);
    const bright=40+speed*80;

    ctx.beginPath();
    ctx.arc(px[i],py[i],0.7+speed*.4,0,Math.PI*2);
    ctx.fillStyle=`hsla(${hue[i]},${40+speed*60}%,${bright}%,${alpha*.55})`;
    ctx.fill();
  }

  // Glow on mouse
  const mg=ctx.createRadialGradient(mouse.x,mouse.y,0,mouse.x,mouse.y,140);
  mg.addColorStop(0,'rgba(100,220,255,0.06)');
  mg.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=mg;ctx.fillRect(0,0,W,H);

  frame++;requestAnimationFrame(animate);
}
animate();

// Cursor
const cur=document.getElementById('cur');
const ring=document.getElementById('cur-ring');
document.addEventListener('mousemove',e=>{
  mouse.x=e.clientX;mouse.y=e.clientY;
  cur.style.left=e.clientX+'px';cur.style.top=e.clientY+'px';
  setTimeout(()=>{ring.style.left=e.clientX+'px';ring.style.top=e.clientY+'px'},90);
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
  sc.style.color=score>=80?'#7fffd4':score>=60?'#fff':'#ff6b6b';
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
    m=re.search(r'(\d{1,3})\s*[/／]\s*100|评分(?:为|是)?[：:：]?\s*(\d{1,3})|(\d{1,3})\s*分',t)
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
    api_key=os.environ.get("GROQ_API_KEY")
    if not api_key:
        return jsonify({"error":"GROQ_API_KEY is not set"}),500
    client=Groq(api_key=api_key)
    prompt=f"""你是3D打印专业顾问Agent。
模型数据：{json.dumps(stats,ensure_ascii=False)}
问题：{json.dumps(issues,ensure_ascii=False) if issues else "无"}
用户问题：{q if q else "给出完整打印方案"}
用中文回答，包含：1.可打印性评分(0-100) 2.主要风险 3.推荐FDM或光固化及理由 4.层高/支撑/填充率参数 5.预估打印时间 6.最关键修改建议"""
    resp=client.chat.completions.create(model="llama-3.3-70b-versatile",messages=[{"role":"user","content":prompt}],max_tokens=1024)
    report=resp.choices[0].message.content
    return jsonify({"stats":stats,"issues":issues,"report":report,"score":xscore(report)})

if __name__=='__main__':app.run(debug=True,port=int(os.environ.get("PORT",5002)))
