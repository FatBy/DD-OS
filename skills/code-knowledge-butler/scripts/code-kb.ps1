#!/usr/bin/env pwsh
# Code Knowledge Butler - 主入口
# 根据子命令分发到具体工具

param(
    [Parameter(Position=0)]
    [ValidateSet("search", "analyze", "explain", "review", "help")]
    [string]$Command = "help",

    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$RemainingArgs
)

function Show-Help {
    Write-Host "🔮 Code Knowledge Butler - 代码知识管家" -ForegroundColor Cyan
    Write-Host "===========================================" -ForegroundColor Gray
    Write-Host ""
    Write-Host "用法: code-kb <命令> [选项]" -ForegroundColor White
    Write-Host ""
    Write-Host "命令:" -ForegroundColor Yellow
    Write-Host "  search   语义搜索代码库" -ForegroundColor Gray
    Write-Host "  analyze  架构分析" -ForegroundColor Gray
    Write-Host "  explain  代码解释" -ForegroundColor Gray
    Write-Host "  review   代码审查" -ForegroundColor Gray
    Write-Host "  help     显示此帮助" -ForegroundColor Gray
    Write-Host ""
    Write-Host "示例:" -ForegroundColor Yellow
    Write-Host "  code-kb search --query `"用户认证逻辑`" --path `"src/`"" -ForegroundColor Gray
    Write-Host "  code-kb analyze --path `".`" --analysisType architecture" -ForegroundColor Gray
    Write-Host "  code-kb explain --file `"src/auth.py`"" -ForegroundColor Gray
    Write-Host "  code-kb review --files `"src/*.py`" --focus security" -ForegroundColor Gray
    Write-Host ""
    Write-Host "使用 `code-kb <命令> --help` 查看详细选项" -ForegroundColor Cyan
}

# 解析剩余参数
$argList = @{}
$currentParam = $null
foreach ($arg in $RemainingArgs) {
    if ($arg -match '^--') {
        $paramName = $arg.TrimStart('-')
        $currentParam = $paramName
        $argList[$paramName] = $null
    } elseif ($currentParam) {
        $argList[$currentParam] = $arg
        $currentParam = $null
    }
}

# 分发命令
switch ($Command) {
    "help" {
        Show-Help
        break
    }
    "search" {
        $query = $argList["query"]
        $path = $argList["path"] ?? "."
        $pattern = $argList["filePattern"] ?? "*.py,*.js,*.ts"

        if (-not $query) {
            Write-Host "❌ 错误: --query 参数必需" -ForegroundColor Red
            Show-Help
            exit 1
        }

        & "$PSScriptRoot\search.ps1" -Query $query -Path $path -FilePattern $pattern
        break
    }
    "analyze" {
        $path = $argList["path"] ?? "."
        $type = $argList["analysisType"] ?? "architecture"

        if (-not (Test-Path $path)) {
            Write-Host "❌ 错误: 路径不存在 - $path" -ForegroundColor Red
            exit 1
        }

        & "$PSScriptRoot\analyze.ps1" -Path $path -AnalysisType $type
        break
    }
    "explain" {
        $file = $argList["file"]
        $start = [int]($argList["startLine"])
        $end = [int]($argList["endLine"])

        if (-not $file) {
            Write-Host "❌ 错误: --file 参数必需" -ForegroundColor Red
            Show-Help
            exit 1
        }

        $params = @{ File = $file }
        if ($start) { $params["StartLine"] = $start }
        if ($end) { $params["EndLine"] = $end }

        & "$PSScriptRoot\explain.ps1" @params
        break
    }
    "review" {
        $files = $argList["files"]
        $focus = $argList["focus"] ?? "all"

        if (-not $files) {
            Write-Host "❌ 错误: --files 参数必需（多个文件用逗号分隔）" -ForegroundColor Red
            Show-Help
            exit 1
        }

        $fileArray = $files -split ','
        & "$PSScriptRoot\review.ps1" -Files $fileArray -Focus $focus
        break
    }
}
