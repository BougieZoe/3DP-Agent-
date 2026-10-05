# 打印闭环 CASE 模板（攒10个就能打单）

> 一个CASE = 同一个模型：切片预测 → 真实打印 → 翻车/成功 → 你判对了 → 成本。
> 抄Boolean的路：故事+证据+数字，三件齐才有人签字。

## CASE-{nnn}-{short-name}

- 模型：{fileName}（{triangles}面）/ 尺寸：{x}×{y}×{z}mm
- 工法/材料/机器：{process} / {material} / {machine}
- 切片设置：层高{layerHeight} / 填充{infill} / 支撑{support} / 朝向{orientation}
- 预测（报告截图贴这里）：分数{score} / 风险{risks} / 估时{hours}h / 估重{grams}g
- 实际：成功/失败 / 用时{actualHours}h / 用料{actualGrams}g / 成本¥{actualCost}
- 偏差：{delta}（预测差在哪，为什么）
- 结论句（给客户看的）：{oneLiner}
- 照片：`./photos/{nnn}-sliced.png` `./photos/{nnn}-printed.jpg` `./photos/{nnn}-failed.jpg`

## 闭环表（10行填满即毕业）

| # | 模型 | 工法 | 预测分 | 实际 | 命中? | 成本误差 | 一句话 |
|---|------|------|--------|------|-------|----------|--------|
| 1 | | | | | | | |
| 2 | | | | | | | |

填满标准：至少3个失败件且你提前判对，至少1个米级/FGF件。
