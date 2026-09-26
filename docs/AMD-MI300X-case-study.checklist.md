# AMD MI300X Case Study — 投稿 Checklist

**三份文件对应关系**
- `AMD-MI300X-case-study.md` — 主文（完整版，含使命感章节，用于个人博客 / AMD DevRel / 求职附件）
- `AMD-MI300X-case-study.hn.md` — HN 版（技术全保留，使命感压缩成 "The part worth arguing about"）
- `AMD-MI300X-case-study.local-llama.md` — r/LocalLLaMA 版（对话式，技术向，带 3 个交流问题）

---

## 0. 前置：需要一个公开 URL

文章现在躺在本地。发布前先把**主文**发到一个公开地址。三个选项（按推荐序）：

1. **GitHub Gist**（最快，5 分钟）— `gist.github.com` 新建 → 贴主文 → Public。适合 HN 首发
2. **个人博客**（如果有）— 长期留存价值最高
3. **仅用 lablab 提交页 + GitHub README** — 不加新 URL，HN 流量会差一些

> 无论选哪个，把主文 URL 填进 `AMD-MI300X-case-study.local-llama.md` 里的 `[link]` 占位符。

---

## 1. 首发平台顺序（一次只发一个，观察反馈再动下一个）

**第一发：Hacker News**（流量天花板最高，评论质量好）
- 用 `AMD-MI300X-case-study.hn.md` 作为正文
- 标题从下方候选挑 1 个，**不要改字**（HN 修改标题会掉分）

**第二发（HN 发完 6-12 小时后）：r/LocalLLaMA**
- 用 `AMD-MI300X-case-study.local-llama.md`
- 正文里保留 3 个问题——r/LocalLLaMA 的互动靠问题驱动，不要删

**第三发（随时）：个人渠道**
- 完整版发个人 blog / LinkedIn / X
- X 的 thread 版可以另出（要的话说一声）

---

## 2. HN 标题候选（已验证 ≤ 80 字符）

| # | 标题 | 字符数 |
|---|------|--------|
| A |  I moved production LLM inference to AMD MI300X — 7 fixes in a week |  66 |
| B | ROCm is real: a 5-agent pipeline ran on MI300X without a hardware bug | 74 |
| C | Building on AMD ROCm: when the failures become ordinary, the platform has arrived | 89 ❌ 超了 |

- A 是首选：具体、有冲突（"7 failures in 7 days"），HN 的 clickbait 阈值刚好
- C 是 Gemini 建议的原标题，超出 80 字符会被截断，要缩短成：
  `Building on AMD ROCm: when failures become ordinary`（58 字符）
- **发布时机**：美东时间周一至周四 08:00–10:00（约等于北京时间 20:00–22:00 或次日凌晨），HN 活跃高峰。周五下午和周末流量最差

---

## 3. AMD 官方渠道（另起炉灶，不跟 HN 混在一起）

走正规投稿路径，定位是"**参与者的深度复盘**"，不是"获奖项目"：

- **渠道**：AMD Developer Hackathon Discord（有 #showcase / #projects 频道）、AMD AI Developer Program 社区、lablab 获奖者/展示提名入口
- **措辞草稿**（投 AMD 官方时用）：
  > Hi — I participated in ACT II with "3DP Agent — Multi-Agent STL Analysis for AMD ROCm" (Track 3, team AetherForge). Didn't place in the finals, but I wrote up the full deployment retrospective — 7 days, 7 failures, all traceable to commits — and I'd be happy for it to be shared or featured. Happy to add anything the team needs (containerized repro, credits note, etc.). [URL]

- 一句话定位（发帖/私信都能用）：*"A participant's honest retrospective on shipping a real multi-agent product on MI300X + ROCm — no benchmark numbers, no PR fluff, all traceable to git."*

---

## 4. 发布前终检（每条都要过）

- [ ] 主文无性能数字、无编造数据（已确认：文中写 "No invented benchmarks"）
- [ ] 三个链接（lablab / GitHub / Vercel）在文末，可点击
- [ ] 真实 IP 已脱敏为 `129.212.x.x`（已确认）
- [ ] 本地三份文件不进 git（docs/ 下，未 add；发布后从仓库删掉或移走）
- [ ] HN 版标题 ≤ 80 字符
- [x] LocalLLaMA 版的 [link] 已填主文 URL
- [ ] 决定要不要在文中加一句对 AMD 官方渠道的致谢（仅投 AMD 时考虑，HN 版不加）

---

## 5. 风险预案

- **HN 上有人质疑"这跟 ROCm 有什么关系"** → 文章里 "The part worth arguing about" 段就是回答，直接在评论区贴那段
- **有人要性能数字** → 诚实回答："shipping not benchmarking, won't invent numbers"（LocalLLaMA 版已有此措辞）
- **被质疑 hackathon 结果** → "didn't place, that's not what this is about"——文章从头到尾没说获奖，不需要解释
