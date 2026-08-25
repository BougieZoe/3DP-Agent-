# 3DP-Agent- 前沿功能 + 代码修复实施计划

## 第一部分: 关键 Bug 修复 (必须先做)

### Bug 1: Worker Pool 竞态条件 [CRITICAL]
**文件**: `client/src/analysis/workerPool.ts`
**问题**: `pendingJobs.find(j => j.resolve)` 匹配错误的 job 到错误的 worker
**修复**: 
- 给每个 PendingJob 添加 `workerId` 字段
- `processQueue()` 记录 job → worker 映射
- `handleWorkerMessage()` 按 `workerId` 精确匹配

### Bug 2: 邮件 HTML 注入 [HIGH]
**文件**: `client/src/lib/notifications.ts`
**问题**: `fileName` 直接插入 HTML，XSS 风险
**修复**: 
- 添加 `escapeHtml()` 函数
- 对所有用户输入进行转义
- Subject 也需转义

### Bug 3: LLM 配置重复 [MEDIUM]
**文件**: `api/llm.ts` + `server/llmRelay.ts`
**问题**: 模型允许列表、端点 URL 完全重复
**修复**:
- 创建 `shared/config/llm.ts`
- 两端统一导入
- 同步 plan limit 逻辑

### Bug 4: Performance Monitor 内存泄漏 [HIGH]
**文件**: `client/src/lib/performanceMonitor.ts`
**问题**: `setInterval` 返回值未存储，`destroy()` 无法清除
**修复**:
- 添加 `private memoryInterval: ReturnType<typeof setInterval> | null = null`
- `destroy()` 中清除 interval

### Bug 5: Stripe Router 空值断言 [HIGH]
**文件**: `server/stripeRouter.ts`
**问题**: 6 处 `sb!` 在 Supabase 未配置时会崩溃
**修复**:
- 每个路由开头检查 `if (!sb) return res.status(503).json(...)`
- 或统一在 `getStripe()` 中处理

### Bug 6: useComposition 定时器泄漏 [MEDIUM]
**文件**: `client/src/hooks/useComposition.ts`
**问题**: `timer2` 未在 unmount 时清除
**修复**:
- 添加 `useEffect` cleanup

---

## 第二部分: 前沿功能实现

### 功能 1: WebGPU 实时可视化

**目标**: GPU 加速热力图/应力场渲染

**新增文件**:
```
client/src/lib/webgpu.ts                    # WebGPU 初始化 + 降级
client/src/lib/shaders/stressCompute.wgsl   # 计算着色器
client/src/components/3D/WebGPUOverlay.tsx   # 自定义 ShaderMaterial
```

**修改文件**:
```
client/src/components/3D/VisualizationToolbar.tsx  # 添加 GPU 开关
client/src/components/3D/OverhangHeatmap.tsx       # 可选替换为 GPU 版本
client/src/components/3D/ThermalField.tsx          # 可选替换为 GPU 版本
```

**实现要点**:
1. `webgpu.ts`:
   - 检查 `navigator.gpu` 支持
   - 请求 adapter + device
   - 创建 compute pipeline
   - 降级: 无 WebGPU 时返回 null

2. `stressCompute.wgsl`:
   ```wgsl
   @group(0) @binding(0) var<storage, read> positions: array<f32>;
   @group(0) @binding(1) var<storage, read> normals: array<f32>;
   @group(0) @binding(2) var<storage, read_write> colors: array<f32>;
   
   @compute @workgroup_size(256)
   fn main(@builtin(global_invocation_id) id: vec3<u32>) {
     let i = id.x;
     // 计算 von Mises 应力
     let stress = computeStress(positions, normals, i);
     // 映射到颜色
     colors[i * 4 + 0] = stressToR(stress);
     colors[i * 4 + 1] = stressToG(stress);
     colors[i * 4 + 2] = stressToB(stress);
     colors[i * 4 + 3] = 1.0;
   }
   ```

3. `WebGPUOverlay.tsx`:
   - `THREE.ShaderMaterial` 接收 GPU 纹理
   - 混合公式: `baseColor * (1 - alpha) + stressColor * alpha`
   - 支持热力图、应力场、流场模式

---

### 功能 2: 多 Agent 协作编排

**目标**: Agent 间真正协作，共享状态

**新增文件**:
```
client/src/agents/agentState.ts            # 全局状态 + 事件总线
client/src/agents/agentGraph.ts            # DAG 执行器
client/src/components/AgentExecutionGraph.tsx  # 可视化 UI
```

**修改文件**:
```
shared/domain/agent.ts                     # 新增类型
client/src/agents/orchestrator.ts          # 集成 Agent 图
```

**实现要点**:
1. `agentState.ts`:
   ```typescript
   interface AgentState {
     geometry: GeometryResult | null;
     failures: FailureResult | null;
     optimizations: OptimizationResult | null;
     score: number | null;
     status: Record<AgentId, 'pending' | 'running' | 'done' | 'error'>;
   }
   
   type AgentEvent = 
     | { type: 'agent:start'; agentId: AgentId }
     | { type: 'agent:complete'; agentId: AgentId; result: any }
     | { type: 'agent:error'; agentId: AgentId; error: string };
   ```

2. `agentGraph.ts`:
   - 定义 DAG: Geometry → (Failure, Optimization) → Scorer
   - 拓扑排序
   - 并行执行无依赖节点
   - 超时 + 降级

3. `AgentExecutionGraph.tsx`:
   - 实时显示 Agent 执行状态
   - 耗时统计
   - 依赖关系可视化

---

### 功能 3: Print Digital Twin

**目标**: 摄像头实时监控打印进度

**新增文件**:
```
client/src/lib/webcam.ts                   # 摄像头捕获
client/src/lib/printProgress.ts            # 进度检测
client/src/lib/failureDetection.ts         # 失败检测
client/src/components/PrintDashboard.tsx   # 实时 Dashboard
```

**修改文件**:
```
client/src/pages/Home.tsx                  # 集成监控模式
```

**实现要点**:
1. `webcam.ts`:
   ```typescript
   async function startWebcam(): Promise<MediaStream> {
     return navigator.mediaDevices.getUserMedia({
       video: { facingMode: 'environment', width: 640, height: 480 }
     });
   }
   
   function captureFrame(video: HTMLVideoElement): ImageData {
     const canvas = document.createElement('canvas');
     canvas.width = video.videoWidth;
     canvas.height = video.videoHeight;
     const ctx = canvas.getContext('2d')!;
     ctx.drawImage(video, 0, 0);
     return ctx.getImageData(0, 0, canvas.width, canvas.height);
   }
   ```

2. `printProgress.ts`:
   - 基于视觉特征的进度估算
   - 对比 CAD 模型的已打印层数
   - 剩余高度估算

3. `failureDetection.ts`:
   - 复用现有 `failureDiagnosis.ts` 的 LLM Vision 能力
   - 检测: 拉丝、翘曲、脱层、堵头、偏移

4. `PrintDashboard.tsx`:
   - 摄像头预览 + 进度环
   - 失败警报卡片
   - 剩余时间预测

---

### 功能 4: AI 语音控制

**目标**: 自然语言控制打印流程

**新增文件**:
```
client/src/lib/voiceInput.ts               # 语音识别
client/src/lib/intentParser.ts             # 意图提取
client/src/lib/actionExecutor.ts           # 动作执行
client/src/components/VoiceControl.tsx     # 语音 UI
```

**修改文件**:
```
client/src/pages/Home.tsx                  # 集成语音控制
```

**实现要点**:
1. `voiceInput.ts`:
   ```typescript
   function startVoiceInput(): AsyncGenerator<string> {
     const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
     recognition.continuous = true;
     recognition.interimResults = true;
     
     return (async function* () {
       recognition.onresult = (event) => {
         // yield 最终结果
       };
     })();
   }
   ```

2. `intentParser.ts`:
   - 使用 LLM 解析意图
   - 输出结构化意图:
     ```typescript
     interface UserIntent {
       action: 'analyze' | 'slice' | 'print' | 'settings' | 'query';
       params: Record<string, any>;
       confidence: number;
     }
     ```

3. `actionExecutor.ts`:
   - 映射意图到现有函数
   - 示例: "打印这个花瓶" → `submitToPrinter()`

4. `VoiceControl.tsx`:
   - 麦克风按钮 + 波形动画
   - 转写文本显示
   - 意图确认卡片

---

### 功能 5: On-device ML 推理

**目标**: 浏览器内运行 ML 模型

**新增文件**:
```
client/src/lib/mlRuntime.ts                # ONNX Runtime 集成
client/src/lib/models/wallThickness.ts     # 壁厚预测
client/src/lib/models/overhang.ts          # 过悬检测
client/src/lib/models/supportGen.ts        # 支撑生成
client/src/lib/models/printTime.ts         # 打印时间预测
```

**修改文件**:
```
client/src/analysis/pipeline.ts            # 集成 ML 分析
```

**实现要点**:
1. `mlRuntime.ts`:
   ```typescript
   import * as ort from 'onnxruntime-web';
   
   class MLRuntime {
     private session: ort.InferenceSession | null = null;
     
     async loadModel(modelPath: string): Promise<void> {
       // 自动选择后端: WebGPU > WebNN > WASM
       const backend = await this.selectBackend();
       this.session = await ort.InferenceSession.create(modelPath, { executionProviders: [backend] });
     }
     
     async infer(input: ort.Tensor): Promise<ort.Tensor> {
       if (!this.session) throw new Error('Model not loaded');
       return await this.session.run({ input });
     }
   }
   ```

2. `wallThickness.ts`:
   - 输入: 顶点 + 法线
   - 输出: 每顶点壁厚值
   - 模型: 轻量 CNN (100KB)

3. `overhang.ts`:
   - 输入: 面法线
   - 输出: 过悬角度 + 支撑区域

4. `pipeline.ts` 集成:
   ```typescript
   // 新增 mlAnalysis 模块
   if (webgpuAvailable) {
     results.ml = await runMLAnalysis(geometry);
   } else {
     results.ml = await runRuleBasedAnalysis(geometry); // 降级
   }
   ```

---

## 第三部分: 实施顺序

### Phase 0: Bug 修复 (Day 1)
1. Worker Pool 竞态条件
2. 邮件 HTML 注入
3. Performance Monitor 内存泄漏
4. Stripe Router 空值断言
5. useComposition 定时器泄漏

### Phase 1: 基础设施 (Day 2-3)
1. WebGPU 初始化层 (`webgpu.ts`)
2. Agent 状态管理 (`agentState.ts`)
3. 摄像头捕获层 (`webcam.ts`)
4. 语音识别层 (`voiceInput.ts`)
5. ONNX Runtime 集成 (`mlRuntime.ts`)
6. LLM 配置统一 (`shared/config/llm.ts`)

### Phase 2: 核心功能 (Day 4-7)
1. GPU Compute Shader (stressCompute.wgsl)
2. Agent 图执行器 (`agentGraph.ts`)
3. 打印进度检测 (`printProgress.ts`)
4. 意图提取器 (`intentParser.ts`)
5. 壁厚预测模型 (`wallThickness.ts`)

### Phase 3: UI 集成 (Day 8-10)
1. WebGPU Overlay 组件
2. Agent 执行追踪 UI
3. 打印监控 Dashboard
4. 语音控制 UI
5. ML 推理集成

### Phase 4: 测试优化 (Day 11-12)
1. 单元测试
2. 集成测试
3. 性能优化
4. 降级策略测试

---

## 文件清单

### 新增文件 (约 25 个)
```
shared/config/llm.ts                        # LLM 配置统一
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

### 修改文件 (约 10 个)
```
client/src/analysis/workerPool.ts           # Bug 1: 竞态条件
client/src/lib/notifications.ts             # Bug 2: HTML 注入
client/src/lib/performanceMonitor.ts        # Bug 4: 内存泄漏
server/stripeRouter.ts                      # Bug 5: 空值断言
client/src/hooks/useComposition.ts          # Bug 6: 定时器泄漏
api/llm.ts                                  # Bug 3: 配置统一
server/llmRelay.ts                          # Bug 3: 配置统一
shared/domain/agent.ts                      # 功能 2: 类型扩展
client/src/agents/orchestrator.ts           # 功能 2: 集成 Agent 图
client/src/components/3D/VisualizationToolbar.tsx  # 功能 1: GPU 开关
client/src/analysis/pipeline.ts             # 功能 5: ML 集成
client/src/pages/Home.tsx                   # 功能 3,4: 集成
```

---

## 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| WebGPU 支持不足 (Chrome 113+, Edge 113+) | 功能 1, 5 | 降级到 Web Workers |
| 摄像头权限被拒 | 功能 3 | 仅在用户授权后使用 |
| 语音识别准确率低 | 功能 4 | LLM 增强 + 文本输入备选 |
| ONNX 模型太大 (>10MB) | 功能 5 | 量化 + 懒加载 |
| Agent 协作死锁 | 功能 2 | 超时 + 降级 |
| Vercel Serverless 不支持 WebGPU | 功能 1, 5 | 仅客户端执行 |

---

*计划创建时间: 2026-08-25*
*预计工期: 12 天*
*负责人: AI Agent*
