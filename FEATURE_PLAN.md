# 3DP-Agent- 前沿功能实现计划

## 概述

基于现有架构，实现 5 个前沿功能，提升 3DP-Agent- 到工业级水平。

---

## 功能 1: WebGPU 实时可视化

### 目标
用 WebGPU 在浏览器内渲染热力图、应力场等分析结果，替代 CPU 计算的点云叠加层。

### 架构
```
STL Geometry
    ↓
WebGPU Compute Shader (应力/热力计算)
    ↓
GPU Texture (RGBA 颜色图)
    ↓
Three.js Custom ShaderMaterial (叠加到模型)
```

### 实现步骤

#### 1.1 WebGPU 初始化层
- **文件**: `client/src/lib/webgpu.ts`
- 检查 `navigator.gpu` 支持
- 请求 `GPUAdapter` → `GPUDevice`
- 创建 `GPUComputePipeline` 用于应力计算
- **降级策略**: 无 WebGPU 时回退到 Web Workers

#### 1.2 GPU Compute Shader
- **文件**: `client/src/lib/shaders/stressCompute.wgsl`
- 输入: 顶点位置 (Float32Array)、面索引 (Uint32Array)
- 计算: 每个顶点的应力值 (von Mises)
- 输出: 应力颜色纹理 (RGBA)

#### 1.3 自定义 ShaderMaterial
- **文件**: `client/src/components/3D/WebGPUOverlay.tsx`
- `THREE.ShaderMaterial` 接收 GPU 纹理
- 实时混合: `baseColor * (1 - alpha) + stressColor * alpha`
- 支持热力图、应力场、流场 3 种模式

#### 1.4 与现有 Overlay 系统集成
- **修改**: `client/src/components/3D/VisualizationToolbar.tsx`
- 新增 "GPU 加速" 开关
- 替换 `OverhangHeatmap`, `WallThicknessHeatmap`, `ThermalField`

### 关键文件
- `client/src/lib/webgpu.ts` (新)
- `client/src/lib/shaders/stressCompute.wgsl` (新)
- `client/src/components/3D/WebGPUOverlay.tsx` (新)
- `client/src/components/3D/VisualizationToolbar.tsx` (改)

---

## 功能 2: 多 Agent 协作编排

### 目标
让 4 个 AI Agent (Geometry, Scorer, Failure, Optimization) 真正协作，而不是简单并行+辩论。

### 架构
```
Orchestrator (路由)
    ↓
AgentGraph (DAG 依赖图)
    ↓
┌─────────┬──────────┬──────────┬────────────┐
│ Geometry │ Failure  │Optimizer │  Scorer    │
│ Analyst  │ Predictor│ Advisor  │            │
└────┬─────┴────┬─────┴────┬─────┴─────┬──────┘
     ↓          ↓          ↓           ↓
   共享状态 (AgentState)
     ↓
   最终报告
```

### 实现步骤

#### 2.1 Agent 状态管理
- **文件**: `client/src/agents/agentState.ts`
- 全局状态: `AgentState` (geometry, failures, optimizations, score)
- 依赖追踪: `DependencyGraph` (哪些 Agent 依赖哪些)
- 事件总线: `AgentEventEmitter` (进度、错误、完成)

#### 2.2 Agent 图执行器
- **文件**: `client/src/agents/agentGraph.ts`
- DAG 拓扑排序
- 并行执行无依赖的 Agent
- 失败重试 + 降级

#### 2.3 Agent 协议扩展
- **修改**: `shared/domain/agent.ts`
- 新增 `AgentCapability` (vision, geometry, scoring, optimization)
- 新增 `AgentMessage` (请求、响应、反馈)
- 新增 `WorkflowStep` (定义 DAG 节点)

#### 2.4 可视化执行追踪
- **文件**: `client/src/components/AgentExecutionGraph.tsx`
- 实时显示 Agent 执行状态
- 依赖关系可视化
- 耗时统计

### 关键文件
- `client/src/agents/agentState.ts` (新)
- `client/src/agents/agentGraph.ts` (新)
- `shared/domain/agent.ts` (改)
- `client/src/agents/orchestrator.ts` (改)
- `client/src/components/AgentExecutionGraph.tsx` (新)

---

## 功能 3: Print Digital Twin

### 目标
用笔记本摄像头实时监控 3D 打印进度，AI 检测失败，预测完成时间。

### 架构
```
Webcam Feed
    ↓
Frame Capture (Web Worker)
    ↓
AI Analysis (LLM Vision)
    ↓
┌─────────────────────────────┐
│ Progress Estimation         │
│ Failure Detection           │
│ Remaining Time Prediction   │
│ Anomaly Alert               │
└─────────────────────────────┘
    ↓
Dashboard UI
```

### 实现步骤

#### 3.1 摄像头捕获层
- **文件**: `client/src/lib/webcam.ts`
- `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })`
- 定时截图: `canvas.toDataURL()` (每 5-10 秒)
- 帧缓冲: 保留最近 5 帧用于趋势分析

#### 3.2 打印进度检测
- **文件**: `client/src/lib/printProgress.ts`
- 基于视觉特征的进度估算:
  - 层数已打印 (对比 CAD 模型)
  - 已填充体积
  - 剩余高度
- 与切片数据对比验证

#### 3.3 失败检测 AI
- **文件**: `client/src/lib/failureDetection.ts`
- 常见失败模式:
  - 拉丝 (stringing)
  - 翘曲 (warping)
  - 脱层 (delamination)
  - 堵头 (clogging)
  - 偏移 (layer shift)
- 使用现有 `failureDiagnosis.ts` 的 LLM Vision 能力

#### 3.4 实时 Dashboard
- **文件**: `client/src/components/PrintDashboard.tsx`
- 摄像头预览 + 进度环
- 失败警报卡片
- 剩余时间预测
- 历史趋势图

#### 3.5 集成到主界面
- **修改**: `client/src/pages/Home.tsx`
- 新增 "打印监控" 模式
- 与现有分析结果并列显示

### 关键文件
- `client/src/lib/webcam.ts` (新)
- `client/src/lib/printProgress.ts` (新)
- `client/src/lib/failureDetection.ts` (新)
- `client/src/components/PrintDashboard.tsx` (新)
- `client/src/pages/Home.tsx` (改)

---

## 功能 4: AI 语音控制

### 目标
用自然语言控制 3D 打印流程: "打印这个花瓶，用 PETG，层高 0.2mm"

### 架构
```
语音输入 (Web Speech API)
    ↓
自然语言理解 (LLM)
    ↓
意图提取 (Intent Parser)
    ↓
┌─────────────────────────────┐
│ Intent Router               │
│  ├─ analyze    → 分析模型   │
│  ├─ slice      → 切片       │
│  ├─ print      → 发送到打印机│
│  ├─ settings   → 修改设置   │
│  └─ query      → 查询状态   │
└─────────────────────────────┘
    ↓
Action Executor
```

### 实现步骤

#### 4.1 语音识别层
- **文件**: `client/src/lib/voiceInput.ts`
- Web Speech API (`SpeechRecognition`)
- 支持 EN/JA/ZH
- 实时转写 + 最终结果

#### 4.2 意图提取器
- **文件**: `client/src/lib/intentParser.ts`
- 使用 LLM 解析用户意图
- 输出结构化意图:
  ```typescript
  interface UserIntent {
    action: 'analyze' | 'slice' | 'print' | 'settings' | 'query';
    params: Record<string, any>;
    confidence: number;
  }
  ```
- 示例:
  - "打印这个花瓶" → `{ action: 'print', params: { model: 'current' } }`
  - "用 PETG，层高 0.2" → `{ action: 'settings', params: { material: 'PETG', layerHeight: 0.2 } }`

#### 4.3 动作执行器
- **文件**: `client/src/lib/actionExecutor.ts`
- 映射意图到现有函数:
  - `analyze` → `runAnalysisPipeline()`
  - `slice` → `callSliceAPI()`
  - `print` → `submitToPrinter()`
  - `settings` → `updatePrintSettings()`
  - `query` → `getPrintStatus()`

#### 4.4 语音 UI
- **文件**: `client/src/components/VoiceControl.tsx`
- 麦克风按钮 + 波形动画
- 转写文本显示
- 意图确认卡片
- 历史命令列表

#### 4.5 集成到主界面
- **修改**: `client/src/pages/Home.tsx`
- 右下角悬浮麦克风按钮
- 语音命令面板

### 关键文件
- `client/src/lib/voiceInput.ts` (新)
- `client/src/lib/intentParser.ts` (新)
- `client/src/lib/actionExecutor.ts` (新)
- `client/src/components/VoiceControl.tsx` (新)
- `client/src/pages/Home.tsx` (改)

---

## 功能 5: On-device ML 推理

### 目标
在浏览器内运行 ML 模型，实现离线分析，无需 API 调用。

### 架构
```
STL Geometry
    ↓
WebGPU/WebNN Backend
    ↓
┌─────────────────────────────┐
│ ONNX Runtime Web            │
│  ├─ 壁厚预测模型            │
│  ├─ 过悬检测模型            │
│  ├─ 支撑生成模型            │
│  └─ 打印时间预测模型        │
└─────────────────────────────┘
    ↓
分析结果 (无需 API)
```

### 实现步骤

#### 5.1 ONNX Runtime 集成
- **文件**: `client/src/lib/mlRuntime.ts`
- 使用 `onnxruntime-web` (支持 WebGPU/WebNN/WASM)
- 模型加载 + 推理接口
- 后端自动选择: WebGPU > WebNN > WASM

#### 5.2 壁厚预测模型
- **文件**: `client/src/lib/models/wallThickness.ts`
- 输入: 顶点 + 法线
- 输出: 每顶点壁厚值
- 模型: 轻量 CNN (100KB)

#### 5.3 过悬检测模型
- **文件**: `client/src/lib/models/overhang.ts`
- 输入: 面法线
- 输出: 过悬角度 + 需要支撑的区域
- 模型: 规则 + ML 混合

#### 5.4 支撑生成模型
- **文件**: `client/src/lib/models/supportGen.ts`
- 输入: 过悬区域
- 输出: 支撑结构点云
- 模型: 点云网络

#### 5.5 打印时间预测模型
- **文件**: `client/src/lib/models/printTime.ts`
- 输入: 体积、表面积、层数、填充率
- 输出: 预计时间 (秒)
- 模型: 轻量回归 (50KB)

#### 5.6 与分析管道集成
- **修改**: `client/src/analysis/pipeline.ts`
- 新增 `mlAnalysis` 模块
- WebGPU 可用时使用 ML，否则回退到规则引擎

### 关键文件
- `client/src/lib/mlRuntime.ts` (新)
- `client/src/lib/models/wallThickness.ts` (新)
- `client/src/lib/models/overhang.ts` (新)
- `client/src/lib/models/supportGen.ts` (新)
- `client/src/lib/models/printTime.ts` (新)
- `client/src/analysis/pipeline.ts` (改)

---

## 实施顺序

### Phase 1: 基础设施 (Week 1)
1. WebGPU 初始化层 (`webgpu.ts`)
2. Agent 状态管理 (`agentState.ts`)
3. 摄像头捕获层 (`webcam.ts`)
4. 语音识别层 (`voiceInput.ts`)
5. ONNX Runtime 集成 (`mlRuntime.ts`)

### Phase 2: 核心功能 (Week 2)
1. GPU Compute Shader (stressCompute.wgsl)
2. Agent 图执行器 (`agentGraph.ts`)
3. 打印进度检测 (`printProgress.ts`)
4. 意图提取器 (`intentParser.ts`)
5. 壁厚预测模型 (`wallThickness.ts`)

### Phase 3: UI 集成 (Week 3)
1. WebGPU Overlay 组件
2. Agent 执行追踪 UI
3. 打印监控 Dashboard
4. 语音控制 UI
5. ML 推理集成

### Phase 4: 测试优化 (Week 4)
1. 单元测试
2. 集成测试
3. 性能优化
4. 降级策略测试
5. 文档更新

---

## 技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| WebGPU 支持不足 | 功能 1, 5 | 降级到 Web Workers |
| 摄像头权限被拒 | 功能 3 | 仅在用户授权后使用 |
| 语音识别准确率低 | 功能 4 | LLM 增强 + 文本输入备选 |
| ONNX 模型太大 | 功能 5 | 量化 + 懒加载 |
| Agent 协作死锁 | 功能 2 | 超时 + 降级 |

---

## 预期收益

| 功能 | 用户价值 | 技术价值 |
|------|----------|----------|
| WebGPU 可视化 | 实时热力图，响应 <16ms | GPU 加速计算 |
| 多 Agent 协作 | 更准确的分析报告 | 分布式 AI 架构 |
| Print Digital Twin | 实时监控，减少失败 | 计算机视觉应用 |
| AI 语音控制 | 无手操作，提升效率 | 自然语言理解 |
| On-device ML | 离线可用，隐私保护 | 边缘计算 |

---

## 文件清单

### 新增文件 (约 25 个)
```
client/src/lib/webgpu.ts
client/src/lib/shaders/stressCompute.wgsl
client/src/components/3D/WebGPUOverlay.tsx
client/src/agents/agentState.ts
client/src/agents/agentGraph.ts
client/src/components/AgentExecutionGraph.tsx
client/src/lib/webcam.ts
client/src/lib/printProgress.ts
client/src/lib/failureDetection.ts
client/src/components/PrintDashboard.tsx
client/src/lib/voiceInput.ts
client/src/lib/intentParser.ts
client/src/lib/actionExecutor.ts
client/src/components/VoiceControl.tsx
client/src/lib/mlRuntime.ts
client/src/lib/models/wallThickness.ts
client/src/lib/models/overhang.ts
client/src/lib/models/supportGen.ts
client/src/lib/models/printTime.ts
```

### 修改文件 (约 8 个)
```
shared/domain/agent.ts
client/src/agents/orchestrator.ts
client/src/components/3D/VisualizationToolbar.tsx
client/src/analysis/pipeline.ts
client/src/pages/Home.tsx
client/src/components/STLUploadHandler.tsx
```

---

## 测试策略

### 单元测试
- WebGPU 初始化和降级
- Agent 状态管理
- 意图提取准确性
- ML 模型推理

### 集成测试
- WebGPU Overlay 渲染
- Agent 图执行流程
- 摄像头 → AI 分析管道
- 语音 → 意图 → 执行链

### E2E 测试
- 完整打印监控流程
- 语音控制端到端
- 离线 ML 分析

---

*计划创建时间: 2026-08-25*
*预计工期: 4 周*
*负责人: AI Agent*
