#!/usr/bin/env pwsh
# Code Knowledge Butler - 代码解释工具

param(
    [Parameter(Mandatory=$true)]
    [string]$File,

    [int]$StartLine,

    [int]$EndLine
)

Write-Host "🔮 Code Knowledge Butler - 代码解释" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Gray
Write-Host "📄 文件: $File" -ForegroundColor Gray

if ($StartLine -and $EndLine) {
    Write-Host "📍 行号: $StartLine - $EndLine" -ForegroundColor Gray
}
Write-Host ""

if (-not (Test-Path $File)) {
    Write-Host "❌ 文件不存在: $File" -ForegroundColor Red
    exit 1
}

# 构建问题
$prompt = "请详细解释这段代码：`n`n"
if ($StartLine -and $EndLine) {
    $prompt += "（只分析第 $StartLine 到第 $EndLine 行）`n`n"
}
$prompt += "要求：`n"
$prompt += "1. 这段代码的整体功能是什么？`n"
$prompt += "2. 逐行或逐块解释关键逻辑`n"
$prompt += "3. 涉及的变量、函数、类的含义`n"
$prompt += "4. 可能的副作用和注意事项`n"
$prompt += "5. 如果有算法，解释其时间复杂度`n"
$prompt += "6. 如果有设计模式，指出并解释`n"

Write-Host "⚡ 正在解释..." -ForegroundColor Yellow

$cmd = "oracle -p `"$prompt`" --file `"$File`" --engine browser --model gpt-5.2-pro"
if ($StartLine -and $EndLine) {
    # 注意：oracle 可能不支持行号过滤，这里只是标记
    Write-Host "📌 注意：oracle 会分析整个文件，请在输出中关注指定行号" -ForegroundColor Yellow
}

Invoke-Expression $cmd

Write-Host ""
Write-Host "✨ 解释完成！" -ForegroundColor Green
