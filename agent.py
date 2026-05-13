import trimesh
import numpy as np
from groq import Groq
import json
import sys
import os

def analyze_stl(filepath):
    mesh = trimesh.load(filepath)
    issues = []
    stats = {}
    
    stats["面数"] = len(mesh.faces)
    stats["顶点数"] = len(mesh.vertices)
    stats["体积(mm³)"] = round(float(mesh.volume), 2)
    bounds = mesh.bounds
    size = bounds[1] - bounds[0]
    stats["尺寸(mm)"] = {
        "X": round(float(size[0]), 2),
        "Y": round(float(size[1]), 2),
        "Z": round(float(size[2]), 2)
    }
    
    if not mesh.is_watertight:
        issues.append("网格不封闭（有破洞），打印前必须修复")
    if not mesh.is_winding_consistent:
        issues.append("法线方向不一致，可能导致打印错误")
    
    min_dim = float(min(size))
    if min_dim < 1.5:
        issues.append(f"最薄处约{min_dim:.2f}mm，低于FDM最小壁厚1.5mm，建议加厚")
    
    normals = mesh.face_normals
    downward = normals[:, 2] < -0.5
    overhang_ratio = float(np.sum(downward) / len(normals))
    if overhang_ratio > 0.15:
        issues.append(f"约{overhang_ratio*100:.0f}%的面存在悬空，需要支撑结构")
    
    if mesh.volume <= 0:
        issues.append("体积异常（≤0），模型可能存在几何错误")
    
    return stats, issues

def ask_agent(stats, issues, user_question=""):
    client = Groq(api_key="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")
    
    prompt = f"""你是一个3D打印专业顾问Agent，专门帮助设计师快速判断模型的可打印性。

模型分析数据：
{json.dumps(stats, ensure_ascii=False, indent=2)}

检测到的问题：
{json.dumps(issues, ensure_ascii=False, indent=2) if issues else "未发现明显问题"}

用户问题：{user_question if user_question else "请给出完整的打印方案建议"}

请用简洁专业的中文回答，包含：
1. 可打印性评分（0-100）
2. 主要风险点
3. 推荐打印方式（FDM/光固化）及理由
4. 具体参数建议（层高、支撑、填充率）
5. 预估打印时间范围
6. 最关键的一个修改建议

格式清晰，像精密制造背景的工程师在做评审。"""

    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1024
    )
    
    return response.choices[0].message.content

def main():
    if len(sys.argv) < 2:
        print("用法: python3 agent.py <STL文件路径> [问题]")
        sys.exit(1)
    
    filepath = sys.argv[1]
    user_question = sys.argv[2] if len(sys.argv) > 2 else ""
    
    print(f"\n🔍 正在分析: {filepath}")
    print("─" * 50)
    
    stats, issues = analyze_stl(filepath)
    
    print("📐 模型基本信息:")
    for k, v in stats.items():
        print(f"  {k}: {v}")
    
    print(f"\n⚠️  检测到 {len(issues)} 个问题:")
    for i, issue in enumerate(issues, 1):
        print(f"  {i}. {issue}")
    
    print("\n🤖 Agent分析中...\n")
    print("─" * 50)
    
    result = ask_agent(stats, issues, user_question)
    print(result)
    print("─" * 50)

if __name__ == "__main__":
    main()
