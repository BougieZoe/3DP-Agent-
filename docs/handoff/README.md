# Manufacturing Handoff Pack（交接包）

> 工具给的是分析，客户买的是“敢签字”。交接包就是把分析变成可签字的东西：
> 报价、法规、邮件，一套三件。先有日本版（最严），再铺全球 hubs。

## 长啥样

```
docs/handoff/
├── README.md              ← 本文件：矩阵 + 用法
├── ja/                    ← 日本（最严，先行）
│   ├── quote.md           ← 見積書：材料+工时+失败险
│   ├── compliance.md      ← 法规check：建築基準法 / 食品 / 电气
│   └── email.md           ← 初回 + 交期延迟 + 失败报告三封邮件
├── en/                    ← 全球版（美/欧通用）
│   ├── quote.md
│   ├── compliance.md
│   └── email.md
├── zh/                    ← 中国版（深圳量产链）
│   ├── quote.md
│   ├── compliance.md
│   └── email.md
└── regions.md             ← 全球 hubs：哪里接单、哪里打、哪里寄
```

## 全球 hubs（不只日本）

| Hub | 角色 | 盯什么 |
|-----|------|--------|
| 日本 北九州/東京 | 高附加值PoC、建築、品牌故事 | Takenaka/Daicel系、Expo遗产 |
| 中国 深圳/广东 | 量产、便宜大机、粒子料 | Formnext Asia、Hanevex类FGF |
| 欧盟 法兰克福 | 材料认证、Formnext本家 | 可降解、医疗、汽车 |
| 美国 德州/中西部 | 大尺寸、建筑、创客 | R&D免税、高校合作 |

打法：日本拿故事+签字，深圳拿量产+成本，法兰克福拿认证，德州拿尺寸。
报价三段永远一样：材料费 + 工时/机时 + 失败险（重打一次的钱先写进去）。
