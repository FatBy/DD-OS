#!/usr/bin/env pwsh
# Code Knowledge Butler - 架构分析工具

param(
    [Parameter(Mandatory=$true)]
    [string]$Path,

    [ValidateSet("architecture", "dependencies", "quality", "security")]
    [string]$AnalysisType = "architecture"
)

Write-Host "🔮 Code Knowledge Butler - 架构分析" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Gray
Write-Host "📂 路径: $Path" -ForegroundColor Gray
Write-Host "🔍 分析类型: $AnalysisType" -ForegroundColor Gray
Write-Host ""

# 收集关键文件
Write-Host "📁 收集项目文件..." -ForegroundColor Yellow

$allFiles = Get-ChildItem -Path $Path -Recurse -File |
    Where-Object { $_.FullName -notmatch 'node_modules|\.git|dist|build|coverage|__pycache__' } |
    Where-Object { $_.Extension -match '\.(py|js|ts|jsx|tsx|java|go|rs|c|cpp|h)$' }

$keyFiles = $allFiles | Where-Object { $_.Name -notmatch 'test|spec|mock|dummy' } | Select-Object -First 25

Write-Host "✅ 选定 $($keyFiles.Count) 个关键文件进行分析" -ForegroundColor Green
Write-Host ""

# 构建问题描述
$promptMap = @{
    "architecture" = "分析这个项目的整体架构，包括：1) 目录结构和模块划分 2) 主要模块的职责 3) 模块之间的依赖关系和调用流向 4) 使用的设计模式 5) 数据流向。请用文字和ASCII图展示。"
    "dependencies" = "分析这个项目的依赖关系，包括：1) 外部依赖（npm/pip包）及其用途 2) 内部模块依赖图 3) 循环依赖检测 4) 依赖版本问题 5) 建议的优化。"
    "quality" = "进行代码质量评估，包括：1) 代码复杂度 2) 命名规范性 3) 函数/类大小 4) 重复代码检测 5) 可测试性 6) 具体改进建议。"
    "security" = "进行安全审查，包括：1) 输入验证 2) SQL注入/XSS风险 3) 认证授权漏洞 4) 敏感信息泄露 5) 依赖漏洞 6) 修复建议。"
}

$prompt = $promptMap[$AnalysisType]

# 执行 oracle
Write-Host "⚡ 调用 Oracle 进行深度分析..." -ForegroundColor Yellow
Write-Host "   （这可能需要 1-5 分钟）" -ForegroundColor Gray
Write-Host ""

$cmd = "oracle -p `"$prompt`""
foreach ($file in $keyFiles) {
    $cmd += " --file `"$($file.FullName)`""
}
$cmd += " --engine browser --model gpt-5.2-pro --temperature 0.2"

Invoke-Expression $cmd

Write-Host ""
Write-Host "✨ 分析完成！" -ForegroundColor Green
