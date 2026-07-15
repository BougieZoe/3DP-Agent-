import { CADDesign, CADParams } from "@/lib/cadGenerator";
import { ParamSlider } from "./ParamSlider";

export function ParameterPanel({
  design,
  onChange,
}: {
  design: CADDesign;
  onChange: (patch: Partial<CADParams>) => void;
}) {
  const p = design.params;

  if (design.template === "flange") {
    return (
      <>
        <ParamSlider
          label="Outer Dia"
          value={p.outerDiameter}
          min={30}
          max={220}
          onChange={outerDiameter => onChange({ outerDiameter })}
        />
        <ParamSlider
          label="Inner Dia"
          value={p.innerDiameter}
          min={5}
          max={160}
          onChange={innerDiameter => onChange({ innerDiameter })}
        />
        <ParamSlider
          label="Thickness"
          value={p.thickness}
          min={2}
          max={30}
          onChange={thickness => onChange({ thickness })}
        />
        <ParamSlider
          label="Bolt Holes"
          value={p.holeCount}
          min={3}
          max={16}
          unit=""
          onChange={holeCount => onChange({ holeCount })}
        />
        <ParamSlider
          label="Hole Dia"
          value={p.holeDiameter}
          min={2}
          max={24}
          onChange={holeDiameter => onChange({ holeDiameter })}
        />
        <ParamSlider
          label="Bolt Circle"
          value={p.boltCircleDiameter}
          min={20}
          max={190}
          onChange={boltCircleDiameter => onChange({ boltCircleDiameter })}
        />
      </>
    );
  }

  if (design.template === "router_shell") {
    return (
      <>
        <ParamSlider
          label="Width"
          value={p.width}
          min={40}
          max={220}
          step={0.5}
          onChange={width => onChange({ width })}
        />
        <ParamSlider
          label="Depth"
          value={p.depth}
          min={40}
          max={220}
          step={0.5}
          onChange={depth => onChange({ depth })}
        />
        <ParamSlider
          label="Height"
          value={p.height}
          min={10}
          max={120}
          step={0.5}
          onChange={height => onChange({ height })}
        />
        <ParamSlider
          label="Wall"
          value={p.wallThickness}
          min={0.8}
          max={6}
          step={0.1}
          onChange={wallThickness => onChange({ wallThickness })}
        />
        <ParamSlider
          label="Clearance"
          value={p.clearance}
          min={0}
          max={2}
          step={0.1}
          onChange={clearance => onChange({ clearance })}
        />
      </>
    );
  }

  if (design.template === "cabinet") {
    return (
      <>
        <ParamSlider
          label="Width"
          value={p.width}
          min={80}
          max={800}
          onChange={width => onChange({ width })}
        />
        <ParamSlider
          label="Depth"
          value={p.depth}
          min={80}
          max={800}
          onChange={depth => onChange({ depth })}
        />
        <ParamSlider
          label="Height"
          value={p.height}
          min={80}
          max={800}
          onChange={height => onChange({ height })}
        />
        <ParamSlider
          label="Panel"
          value={p.thickness}
          min={3}
          max={40}
          onChange={thickness => onChange({ thickness })}
        />
        <ParamSlider
          label="Drawers"
          value={p.drawerCount}
          min={1}
          max={6}
          unit=""
          onChange={drawerCount =>
            onChange({ drawerCount: Math.round(drawerCount) })
          }
        />
        <ParamSlider
          label="Leg Height"
          value={p.legHeight}
          min={0}
          max={160}
          onChange={legHeight => onChange({ legHeight })}
        />
      </>
    );
  }

  if (design.template === "pipe_rack") {
    return (
      <>
        <ParamSlider
          label="Width"
          value={p.width}
          min={60}
          max={400}
          onChange={width => onChange({ width })}
        />
        <ParamSlider
          label="Depth"
          value={p.depth}
          min={30}
          max={180}
          onChange={depth => onChange({ depth })}
        />
        <ParamSlider
          label="Height"
          value={p.height}
          min={15}
          max={160}
          onChange={height => onChange({ height })}
        />
        <ParamSlider
          label="Tube Dia"
          value={p.tubeDiameter}
          min={6}
          max={60}
          onChange={tubeDiameter => onChange({ tubeDiameter })}
        />
        <ParamSlider
          label="Channels"
          value={p.holeCount}
          min={2}
          max={12}
          unit=""
          onChange={holeCount => onChange({ holeCount: Math.round(holeCount) })}
        />
        <ParamSlider
          label="Base"
          value={p.thickness}
          min={2}
          max={24}
          onChange={thickness => onChange({ thickness })}
        />
      </>
    );
  }

  return (
    <>
      <ParamSlider
        label="Width"
        value={p.width}
        min={20}
        max={220}
        onChange={width => onChange({ width })}
      />
      <ParamSlider
        label="Depth"
        value={p.depth}
        min={20}
        max={220}
        onChange={depth => onChange({ depth })}
      />
      <ParamSlider
        label="Thickness"
        value={p.thickness}
        min={1}
        max={30}
        step={0.5}
        onChange={thickness => onChange({ thickness })}
      />
      <ParamSlider
        label="Holes"
        value={p.holeCount}
        min={1}
        max={12}
        unit=""
        onChange={holeCount => onChange({ holeCount: Math.round(holeCount) })}
      />
      <ParamSlider
        label="Hole Dia"
        value={p.holeDiameter}
        min={1}
        max={24}
        step={0.5}
        onChange={holeDiameter => onChange({ holeDiameter })}
      />
      <ParamSlider
        label="Corner"
        value={p.cornerRadius}
        min={0}
        max={20}
        step={0.5}
        onChange={cornerRadius => onChange({ cornerRadius })}
      />
    </>
  );
}
