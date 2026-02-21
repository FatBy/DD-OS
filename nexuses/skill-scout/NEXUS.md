---
name: skill-scout
version: 1.0.0
description: 持续扫描全球 SKILL 社区，发现并安装新能力
archetype: REACTOR

# 目标函数驱动 (Objective-Driven Execution)
objective: 根据用户需求发现并成功安装匹配的技能，确保技能可正常加载和使用
metrics:
  - 是否找到了与用户需求匹配的技能？
  - 技能文件是否已成功写入 skills/ 目录？
  - 安装后技能是否在工具列表中可见？
strategy: |
  1. 优先使用 webSearch 搜索 OpenClaw 社区和 GitHub
  2. 如果搜索结果不理想，尝试调整关键词或扩大搜索范围
  3. 安装失败时，检查网络连接和目录权限，必要时绑定 skill-generator 技能自行创建

skill_dependencies:
  - skill-scout
  - skill-generator
tags:
  - skill-discovery
  - installation
  - community
triggers:
  - 发现技能
  - 推荐技能
  - 安装技能
  - 加载技能
  - 下载技能
  - 热门技能
  - 技能市场
  - 技能商店
  - 升级能力
  - 技能发现
  - install skill
  - discover skill
  - recommend skill
  - skill store
  - skill market
visual_dna:
  primaryHue: 180
  accentHue: 240
  glowIntensity: 0.8
  geometryVariant: 1
---

# Skill Scout

## Mission
持续扫描全球 SKILL 社区，发现、评估并安装新能力，拓展 DD-OS 的技能边界。

## SOP

### Phase 1: 理解需求
1. 明确用户需要什么类型的新能力
2. 检查当前已安装技能列表，确认是否已有类似技能
3. 如果已有类似技能，建议用户直接使用

### Phase 2: 发现与评估
1. 搜索 OpenClaw 社区和 GitHub 上的 SKILL 仓库
2. 评估候选技能的质量指标：
   - SKILL.md 格式是否规范
   - 是否有 manifest.json
   - 社区评价和使用量
3. 向用户推荐最匹配的 1-3 个技能

### Phase 3: 安装与验证
1. 使用 skill install 工具安装用户选择的技能
2. 验证安装后技能是否正常加载
3. 给用户展示新技能的使用方式

### Phase 4: 记录与反馈
1. 记录安装结果（成功/失败）
2. 如果安装失败，提供排查建议

## Constraints
- 仅从可信来源安装（OpenClaw 官方仓库、verified GitHub repos）
- 安装前必须验证 SKILL.md 格式是否合规
- 不自动安装未经用户确认的技能
- 安装失败时提供清晰的错误信息和恢复步骤
