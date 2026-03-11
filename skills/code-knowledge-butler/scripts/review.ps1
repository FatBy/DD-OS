#!/usr/bin/env pwsh
# Code Knowledge Butler - 代码审查工具

param(
    [Parameter(Mandatory=$true)]
    [string[]]$Files,

    [ValidateSet("security", "performance", "maintainability", "all")]
    [string]$Focus = "all"
)

Write-Host "🔮 Code Knowledge Butler - 代码审查" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Gray
Write-Host "📁 审查文件: $($Files -join ', ')" -ForegroundColor Gray
Write-Host "🎯 审查重点: $Focus" -ForegroundColor Gray
Write-Host ""

# 验证文件存在
foreach ($file in $Files) {
    if (-not (Test-Path $file)) {
        Write-Host "❌ 文件不存在: $file" -ForegroundColor Red
        exit 1
    }
}

# 构建审查问题
$focusMap = @{
    "security" = "请从安全角度审查这些代码：`n1. 输入验证是否充分？`n2. 是否有SQL注入、XSS、命令注入风险？`n3. 认证授权逻辑是否健全？`n4. 敏感信息是否硬编码？`n5. 是否有已知漏洞模式？`n6. 详细修复建议（包含代码示例）。"
    "performance" = "请从性能角度审查：`n1. 算法时间复杂度`n2. 数据库查询优化（N+1问题、索引使用）`n3. 内存使用和泄漏风险`n4. 网络请求优化`n5. 缓存策略`n6. 具体优化方案（含代码）。"
    "maintainability" = "请从可维护性审查：`n1. 代码复杂度（圈复杂度）`n2. 函数/类长度是否合理`n3. 命名是否清晰`n4. 注释是否充分`n5. 重复代码`n6. SOLID原则遵循情况`n7. 重构建议。"
    "all" = "请全面审查这些代码，涵盖：`n1. 安全性（30%）`n2. 性能（25%）`n3. 可维护性（25%）`n4. 代码规范（20%）`n5. 测试覆盖率建议`n6. 按优先级列出问题（紧急/高/中/低）`n7. 每个问题附带修复示例。"
}

$prompt = $focusMap[$Focus]
$prompt += "`n`n请以结构化格式输出：`n"
$prompt += "## 审查总结`n[总览]`n`n## 发现的问题`n"
$prompt += "### 🔴 紧急`n- 问题1`n  - 位置: file:line`n  - 描述: ...`n  - 修复: ...`n`n"
$prompt += "### 🟠 高`n...`n### 🟡 中`n...`n### 🟢 低`n...`n"
$prompt += "`n## 改进建议`n- 建议1`n- 建议2"

Write-Host "⚡ 开始审查（可能需要 2-5 分钟）..." -ForegroundColor Yellow
Write-Host ""

$cmd = "oracle -p `"$prompt`""
foreach ($file in $Files) {
    $cmd += " --file `"$file`""
}
$cmd += " --engine browser --model gpt-5.2-pro --temperature 0.1"

Invoke-Expression $cmd

Write-Host ""
Write-Host "✨ 审查完成！" -ForegroundColor Green
Write-Host "💡 提示：按建议优先级逐步修复问题" -ForegroundColor Yellow
