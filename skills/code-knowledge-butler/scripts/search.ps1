#!/usr/bin/env pwsh
# Code Knowledge Butler - 语义搜索工具
# 调用 oracle 进行代码语义检索

param(
    [Parameter(Mandatory=$true)]
    [string]$Query,

    [string]$Path = ".",

    [string]$FilePattern = "*.py,*.js,*.ts,*.jsx,*.tsx,*.java,*.go,*.rs,*.c,*.cpp,*.h"
)

Write-Host "🔮 Code Knowledge Butler - 语义搜索" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Gray
Write-Host "💬 查询: $Query" -ForegroundColor White
Write-Host "📂 路径: $Path" -ForegroundColor Gray
Write-Host "📝 文件类型: $FilePattern" -ForegroundColor Gray
Write-Host ""

# 收集文件
Write-Host "📁 正在扫描代码文件..." -ForegroundColor Yellow

$extensions = $FilePattern -split ',' | ForEach-Object { $_.Trim() }
$files = @()

foreach ($ext in $extensions) {
    $files += Get-ChildItem -Path $Path -Recurse -Filter $ext -File |
        Where-Object { $_.FullName -notmatch 'node_modules|\.git|dist|build|coverage|__pycache__' } |
        Select-Object -First 30  # 限制数量
    if ($files.Count -ge 30) { break }
}

if ($files.Count -eq 0) {
    Write-Host "❌ 未找到任何代码文件" -ForegroundColor Red
    Write-Host "   请检查路径: $Path" -ForegroundColor Gray
    exit 1
}

Write-Host "✅ 找到 $($files.Count) 个文件，开始分析..." -ForegroundColor Green
Write-Host ""

# 构建 oracle 命令
$cmd = "oracle -p `"$Query`""
foreach ($file in $files) {
    $cmd += " --file `"$($file.FullName)`""
}
$cmd += " --engine browser --model gpt-5.2-pro --temperature 0.3"

Write-Host "⚡ 执行命令（这可能需要 30 秒 - 几分钟）..." -ForegroundColor Yellow
Write-Host ""

# 执行
Invoke-Expression $cmd

Write-Host ""
Write-Host "✨ 搜索完成！" -ForegroundColor Green
Write-Host "💡 提示：" -ForegroundColor Yellow
Write-Host "   - 如需更精确，缩小文件范围或增加关键词" -ForegroundColor Gray
Write-Host "   - 使用 'explain' 工具深入理解特定文件" -ForegroundColor Gray
