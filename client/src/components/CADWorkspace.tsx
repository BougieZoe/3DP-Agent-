import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Grid, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { Download, FileCode2, RotateCcw, SlidersHorizontal, Sparkles, WandSparkles } from 'lucide-react';
import { STLExporter } from 'three-stdlib';
import * as THREE from 'three';
import {
  CADDesign,
  CADParams,
  CADTemplate,
  buildCADGroup,
  createCADDesignAI,
  downloadTextFile,
  generateOpenSCAD,
} from '@/lib/cadGenerator';
import { Language } from '@/lib/i18n';

interface CADWorkspaceProps {
  language: Language;
}

const STARTER_PROMPTS: Record<Language, string[]> = {
  en: [
    'Create a 60mm x 45mm mounting plate with four 5mm holes and rounded corners',
    'Make a flange, outer diameter 100mm, inner diameter 50mm, 8 bolt holes',
    'Create a small cabinet, width 500mm depth 400mm height 600mm, two drawers',
  ],
  ja: [
    '60mm x 45mm の取付プレート、5mm穴を4つ、角丸',
    '外径100mm、内径50mm、8個のボルト穴があるフランジ',
    '幅500mm、奥行400mm、高さ600mm、引き出し2段の小さな棚',
  ],
  zh: [
    '做一个60mm x 45mm的安装板，四个5mm孔，边角圆角',
    '做一个法兰盘，外径100mm，内径50mm，8个螺栓孔',
    '创建一个小柜子，宽500mm，深400mm，高600mm，两个抽屉',
  ],
};

const TEMPLATE_BADGE: Record<CADTemplate, string> = {
  cabinet: 'ASSEMBLY',
  flange: 'SCAD READY',
  plate: 'SCAD READY',
  router_shell: 'MVP SHELL',
  pipe_rack: 'PARAMETRIC',
};

function ParamSlider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = 'mm',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground font-mono">{label}</span>
        <span className="text-xs text-primary font-mono tabular-nums">
          {value.toFixed(step < 1 ? 1 : 0)}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-primary"
      />
    </label>
  );
}

function EmptyPreview() {
  return (
    <group>
      <mesh>
        <boxGeometry args={[4, 2.5, 0.3]} />
        <meshBasicMaterial color={0x00ffcc} wireframe transparent opacity={0.22} />
      </mesh>
      <mesh position={[0, 0.2, 1]}>
        <torusGeometry args={[1, 0.12, 18, 64]} />
        <meshBasicMaterial color={0x2ea3ff} wireframe transparent opacity={0.16} />
      </mesh>
    </group>
  );
}

function CADScene({ design, groupRef }: { design: CADDesign | null; groupRef: React.RefObject<THREE.Group | null> }) {
  const { camera } = useThree();

  useEffect(() => {
    if (!groupRef.current || !design) return;
    groupRef.current.clear();
    const generated = buildCADGroup(design);
    groupRef.current.add(generated);

    const box = new THREE.Box3().setFromObject(groupRef.current);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    groupRef.current.position.sub(center);

    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const dist = maxDim * 1.6;
    camera.position.set(dist * 0.7, dist * 0.55, dist);
    camera.lookAt(0, 0, 0);
    if (camera instanceof THREE.PerspectiveCamera) camera.updateProjectionMatrix();
  }, [design, groupRef, camera]);

  return (
    <>
      <ambientLight intensity={0.45} color={0xb9f8ff} />
      <directionalLight position={[8, 9, 6]} intensity={1.5} color={0xffffff} />
      <directionalLight position={[-9, 5, -5]} intensity={0.65} color={0x3cf0b6} />
      <pointLight position={[0, 7, 8]} intensity={0.5} color={0x50a7ff} />
      <group ref={groupRef}>{!design && <EmptyPreview />}</group>
      <Grid
        args={[500, 500]}
        cellSize={10}
        cellThickness={0.35}
        cellColor="#0b2b33"
        sectionSize={50}
        sectionThickness={0.9}
        sectionColor="#124650"
        fadeDistance={450}
        fadeStrength={1}
        position={[0, -0.02, 0]}
      />
      <OrbitControls enableDamping dampingFactor={0.08} />
    </>
  );
}

function ParameterPanel({
  design,
  onChange,
}: {
  design: CADDesign;
  onChange: (patch: Partial<CADParams>) => void;
}) {
  const p = design.params;

  if (design.template === 'flange') {
    return (
      <>
        <ParamSlider label="Outer Dia" value={p.outerDiameter} min={30} max={220} onChange={(outerDiameter) => onChange({ outerDiameter })} />
        <ParamSlider label="Inner Dia" value={p.innerDiameter} min={5} max={160} onChange={(innerDiameter) => onChange({ innerDiameter })} />
        <ParamSlider label="Thickness" value={p.thickness} min={2} max={30} onChange={(thickness) => onChange({ thickness })} />
        <ParamSlider label="Bolt Holes" value={p.holeCount} min={3} max={16} unit="" onChange={(holeCount) => onChange({ holeCount })} />
        <ParamSlider label="Hole Dia" value={p.holeDiameter} min={2} max={24} onChange={(holeDiameter) => onChange({ holeDiameter })} />
        <ParamSlider label="Bolt Circle" value={p.boltCircleDiameter} min={20} max={190} onChange={(boltCircleDiameter) => onChange({ boltCircleDiameter })} />
      </>
    );
  }

  if (design.template === 'router_shell') {
    return (
      <>
        <ParamSlider label="Width" value={p.width} min={40} max={220} step={0.5} onChange={(width) => onChange({ width })} />
        <ParamSlider label="Depth" value={p.depth} min={40} max={220} step={0.5} onChange={(depth) => onChange({ depth })} />
        <ParamSlider label="Height" value={p.height} min={10} max={120} step={0.5} onChange={(height) => onChange({ height })} />
        <ParamSlider label="Wall" value={p.wallThickness} min={0.8} max={6} step={0.1} onChange={(wallThickness) => onChange({ wallThickness })} />
        <ParamSlider label="Clearance" value={p.clearance} min={0} max={2} step={0.1} onChange={(clearance) => onChange({ clearance })} />
      </>
    );
  }

  if (design.template === 'cabinet') {
    return (
      <>
        <ParamSlider label="Width" value={p.width} min={80} max={800} onChange={(width) => onChange({ width })} />
        <ParamSlider label="Depth" value={p.depth} min={80} max={800} onChange={(depth) => onChange({ depth })} />
        <ParamSlider label="Height" value={p.height} min={80} max={800} onChange={(height) => onChange({ height })} />
        <ParamSlider label="Panel" value={p.thickness} min={3} max={40} onChange={(thickness) => onChange({ thickness })} />
        <ParamSlider label="Drawers" value={p.drawerCount} min={1} max={6} unit="" onChange={(drawerCount) => onChange({ drawerCount: Math.round(drawerCount) })} />
        <ParamSlider label="Leg Height" value={p.legHeight} min={0} max={160} onChange={(legHeight) => onChange({ legHeight })} />
      </>
    );
  }

  if (design.template === 'pipe_rack') {
    return (
      <>
        <ParamSlider label="Width" value={p.width} min={60} max={400} onChange={(width) => onChange({ width })} />
        <ParamSlider label="Depth" value={p.depth} min={30} max={180} onChange={(depth) => onChange({ depth })} />
        <ParamSlider label="Height" value={p.height} min={15} max={160} onChange={(height) => onChange({ height })} />
        <ParamSlider label="Tube Dia" value={p.tubeDiameter} min={6} max={60} onChange={(tubeDiameter) => onChange({ tubeDiameter })} />
        <ParamSlider label="Channels" value={p.holeCount} min={2} max={12} unit="" onChange={(holeCount) => onChange({ holeCount: Math.round(holeCount) })} />
        <ParamSlider label="Base" value={p.thickness} min={2} max={24} onChange={(thickness) => onChange({ thickness })} />
      </>
    );
  }

  return (
    <>
      <ParamSlider label="Width" value={p.width} min={20} max={220} onChange={(width) => onChange({ width })} />
      <ParamSlider label="Depth" value={p.depth} min={20} max={220} onChange={(depth) => onChange({ depth })} />
      <ParamSlider label="Thickness" value={p.thickness} min={1} max={30} step={0.5} onChange={(thickness) => onChange({ thickness })} />
      <ParamSlider label="Holes" value={p.holeCount} min={1} max={12} unit="" onChange={(holeCount) => onChange({ holeCount: Math.round(holeCount) })} />
      <ParamSlider label="Hole Dia" value={p.holeDiameter} min={1} max={24} step={0.5} onChange={(holeDiameter) => onChange({ holeDiameter })} />
      <ParamSlider label="Corner" value={p.cornerRadius} min={0} max={20} step={0.5} onChange={(cornerRadius) => onChange({ cornerRadius })} />
    </>
  );
}

export function CADWorkspace({ language }: CADWorkspaceProps) {
  const [input, setInput] = useState(STARTER_PROMPTS[language][0]);
  const [design, setDesign] = useState<CADDesign | null>(null);
  const groupRef = useRef<THREE.Group>(null);

  const scad = useMemo(() => (design ? generateOpenSCAD(design) : ''), [design]);

  useEffect(() => {
    setInput(STARTER_PROMPTS[language][0]);
  }, [language]);

  const generate = (prompt = input) => {
    if (!prompt.trim()) return;
    createCADDesignAI(prompt).then(setDesign);
    setInput(prompt);
  };

  const updateParams = (patch: Partial<CADParams>) => {
    setDesign((current) => {
      if (!current) return current;
      return {
        ...current,
        params: { ...current.params, ...patch },
      };
    });
  };

  const downloadSCAD = () => {
    if (!design) return;
    downloadTextFile(`${design.template}.scad`, scad, 'text/x-openscad');
  };

  const downloadSTL = () => {
    if (!design || !groupRef.current) return;
    const exporter = new STLExporter();
    const stl = exporter.parse(groupRef.current, { binary: false });
    downloadTextFile(`${design.template}.stl`, stl, 'model/stl');
  };

  return (
    <div className="grid lg:grid-cols-[340px_minmax(0,1fr)_300px] gap-4 min-h-[calc(100vh-7rem)]">
      <section className="border border-border bg-card rounded-sm flex flex-col min-h-[520px]">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-mono text-primary tracking-widest">AI CAD STUDIO</div>
            <div className="text-xs text-muted-foreground/50 mt-1">Natural language to parametric part</div>
          </div>
          <WandSparkles className="w-4 h-4 text-primary" />
        </div>

        <div className="p-4 space-y-4 flex-1">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className="w-full h-36 resize-none bg-background border border-border rounded-sm px-3 py-3 text-xs font-mono leading-relaxed text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50"
            placeholder={language === 'zh' ? '描述你想生成的可打印零件...' : language === 'ja' ? '生成したい部品を説明...' : 'Describe the printable part you want...'}
          />

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <button
              onClick={() => generate()}
              className="h-10 inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-sm text-xs font-mono hover:bg-primary/90 transition-all"
            >
              <Sparkles className="w-4 h-4" />
              GENERATE
            </button>
            <button
              onClick={() => setDesign(null)}
              className="h-10 w-10 inline-flex items-center justify-center border border-border rounded-sm text-muted-foreground hover:text-primary hover:border-primary/40 transition-all"
              title="Reset preview"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-2">
            <div className="text-xs text-muted-foreground/40 font-mono tracking-widest">// EXAMPLES</div>
            {STARTER_PROMPTS[language].map((prompt) => (
              <button
                key={prompt}
                onClick={() => generate(prompt)}
                className="block w-full text-left border border-border/50 rounded-sm px-3 py-2 text-xs leading-relaxed text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-all"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 border-t border-border/60 space-y-2">
          <button
            onClick={downloadSCAD}
            disabled={!design}
            className="w-full h-10 inline-flex items-center justify-center gap-2 border border-primary/40 text-primary rounded-sm text-xs font-mono disabled:opacity-30 hover:bg-primary/10 transition-all"
          >
            <FileCode2 className="w-4 h-4" />
            DOWNLOAD SCAD
          </button>
          <button
            onClick={downloadSTL}
            disabled={!design}
            className="w-full h-10 inline-flex items-center justify-center gap-2 bg-foreground text-background rounded-sm text-xs font-mono disabled:opacity-30 hover:bg-foreground/90 transition-all"
          >
            <Download className="w-4 h-4" />
            DOWNLOAD STL
          </button>
        </div>
      </section>

      <section className="border border-border bg-card rounded-sm min-h-[520px] relative overflow-hidden">
        <div className="absolute top-3 left-4 z-10 flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground/40">// PARAMETRIC PREVIEW</span>
          {design && (
            <span className="text-xs font-mono border border-primary/25 text-primary bg-primary/5 px-2 py-0.5 rounded-sm">
              {TEMPLATE_BADGE[design.template]}
            </span>
          )}
        </div>
        <Canvas gl={{ antialias: true, alpha: true }} style={{ background: 'transparent' }}>
          <PerspectiveCamera makeDefault position={[120, 90, 160]} fov={50} />
          <CADScene design={design} groupRef={groupRef} />
        </Canvas>
        {design && (
          <div className="absolute left-4 right-4 bottom-4 grid sm:grid-cols-3 gap-2">
            <div className="border border-border/70 bg-background/85 backdrop-blur rounded-sm p-3">
              <div className="text-xs text-muted-foreground/40 font-mono">TEMPLATE</div>
              <div className="text-sm text-foreground mt-1">{design.title}</div>
            </div>
            <div className="border border-border/70 bg-background/85 backdrop-blur rounded-sm p-3 sm:col-span-2">
              <div className="text-xs text-muted-foreground/40 font-mono">SUMMARY</div>
              <div className="text-sm text-foreground/80 mt-1 leading-relaxed">{design.summary}</div>
            </div>
          </div>
        )}
      </section>

      <aside className="border border-border bg-card rounded-sm min-h-[520px] flex flex-col">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-primary" />
          <div className="text-xs font-mono text-primary tracking-widest">PARAMETERS</div>
        </div>
        {design ? (
          <>
            <div className="p-4 space-y-5 flex-1 overflow-y-auto">
              <ParameterPanel design={design} onChange={updateParams} />
              <div className="pt-2 space-y-2">
                <div className="text-xs text-muted-foreground/40 font-mono tracking-widest">// PRINT CHECK</div>
                {design.checks.map((check) => (
                  <div key={check} className="text-xs leading-relaxed border border-border/40 rounded-sm px-3 py-2 text-muted-foreground bg-background/40">
                    {check}
                  </div>
                ))}
              </div>
            </div>
            <div className="border-t border-border/60 p-4">
              <details className="group">
                <summary className="cursor-pointer text-xs font-mono text-primary hover:text-foreground transition-colors">
                  OpenSCAD SNAPSHOT
                </summary>
                <pre className="mt-3 max-h-64 overflow-auto rounded-sm bg-background border border-border/50 p-3 text-xs leading-relaxed text-muted-foreground">
                  {scad}
                </pre>
              </details>
            </div>
          </>
        ) : (
          <div className="flex-1 grid place-items-center p-6 text-center">
            <div>
              <div className="text-3xl font-mono text-primary/20">[ CAD ]</div>
              <div className="text-xs text-muted-foreground/50 mt-3">Generate a part to reveal editable parameters.</div>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
