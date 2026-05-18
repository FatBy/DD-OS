---
name: Delegate to Claude Code
description: 将复杂编码任务委托给本机 Claude Code Agent 独立执行
version: "1.0.0"
executable: execute.py
runtime: python
tools:
  - toolName: delegate_to_claude
    description: "委托编码任务给 Claude Code（适用于多文件修改、代码重构、测试编写等复杂任务）"
    dangerLevel: medium
    inputs:
      task:
        type: string
        required: true
        description: "任务描述（自然语言）"
      workdir:
        type: string
        required: false
        description: "工作目录路径（默认当前项目）"
      allowed_tools:
        type: string
        required: false
        description: "允许的工具列表，逗号分隔（如 Read,Edit,Bash）"
      timeout:
        type: integer
        required: false
        default: 120
        description: "超时秒数"
    keywords: [Claude, 委托, 编码, 代码生成, 重构]
---

## 功能说明

将复杂的编码任务委托给本机安装的 Claude Code Agent 独立执行。Claude Code 拥有完整的 agentic 能力：
- 读取和编辑文件
- 执行 shell 命令
- 搜索代码库
- Git 操作

适用场景：
- 多文件代码修改/重构
- 编写测试用例
- Bug 修复（给出错误描述，让 Claude 自行定位和修复）
- 代码生成（从需求描述生成完整实现）

## 使用示例

委托一个编码任务：
```
delegate_to_claude(task="在 src/utils/ 中添加一个日期格式化工具函数，支持中文日期格式")
```

指定工作目录和工具权限：
```
delegate_to_claude(task="修复 auth 模块的登录 bug", workdir="d:/projects/myapp", allowed_tools="Read,Edit,Bash")
```

## 安全规则

- 默认允许 Read,Edit,Bash 工具（dangerLevel: medium）
- 执行前需要用户审批
- 有超时保护（默认 120 秒）
- Claude Code 在独立子进程中运行，不影响 DunCrew 主进程
