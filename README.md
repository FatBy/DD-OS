<div align="center">

# <img width="50" height="50" alt="Gemini_Generated_Image_yuphzayuphzayuph(1)" src="https://github.com/user-attachments/assets/89ec1d77-3614-4ff8-bd06-162bad8210c6" />  DD-OS

### Digital Dimension Operating System

*Build your LLM-driven world. Shatter the chatbox.*

[Website](https://github.com/FatBy/dd-os) • [Docs](https://github.com/FatBy/dd-os/wiki) • [World View](https://github.com/FatBy/dd-os/wiki/WorldView) • [Skills Hub](https://github.com/FatBy/dd-os/tree/main/skills) • [Discord](https://discord.gg/ddos)

</div>

> **"LLMs are the emergence of data intelligence, while Agents are the emergence of tool intelligence."**

**DD-OS** is a personal, spatial AI operating system that runs entirely on your local devices. It moves beyond the traditional 2D chatbot interface, rendering a live, interconnected **WorldView** canvas. By leveraging the native **Model Context Protocol (MCP)** and a Turing-complete **Prose Workflow Engine**, DD-OS seamlessly connects LLMs to your actual file system, browser, and enterprise apps (Slack, Notion, GitHub).

If you want an AI assistant that doesn't just "talk" but actively "executes" complex, multi-step workflows on your local machine—this is it.

## ✨ Highlights

* **Local-First Gateway** — A single control plane (`ddos-local-server.py`) managing all WebSocket sessions, LLM routing, and MCP tool execution safely on your loopback address.

* **The Spatial Nexus** — No more "files" or "folders". Every asset, agent, and background task is an interconnected node (Nexus) inside an immersive React-based spatial canvas.

* **Prose Workflow Engine (`.prose`)** — Eliminate LLM hallucinations on complex tasks. Abstract multi-step logic (e.g., *Parallel PR Reviews*, *Recursive Self-Refinement*) into traceable, code-level pipelines.

* **Native MCP Skills Matrix** — Out-of-the-box integration with the tools you already use. Mount capabilities on demand:

  * **Workspace**: Notion, Obsidian, Local File Systems.

  * **DevOps**: Code Search, GitHub Issues/PRs, Tmux, Code Runner.

  * **Automation**: Headless Browser Control, Apple Script, 1Password.

## 🕹️ Quick Start (TL;DR)

**Prerequisites**: `Node.js ≥ 20`, `Python ≥ 3.10`.

DD-OS runs with a decoupled frontend (React) and backend (Python gateway).

### 1. Start the Local Control Plane (Frontend)

```bash
git clone [https://github.com/FatBy/dd-os.git](https://github.com/FatBy/dd-os.git)
cd dd-os

npm install
npm run dev
```

### 2. Ignite the Core Engine (Backend)

Open a new terminal session. We strongly recommend using a virtual Python environment.

```bash
cd dd-os

python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

pip install -r requirements.txt
python ddos-local-server.py
```

*Access `http://localhost:5173` in your browser to enter the dimension.*

## 🛡️ Security Defaults (Important)

DD-OS connects to your real file system and enterprise surfaces. **Treat all external inbound prompts as untrusted input.**

* **Strict Approval Gate**: Any destructive or system-level tool calls (e.g., executing bash commands, deleting files) are intercepted by the `ApprovalModal` on the frontend, requiring explicit human consent.

* **Environment Isolation**: All API keys and tokens must be stored in your local `.env` file. The local server binds to `127.0.0.1` by default and refuses public ingress unless explicitly configured via reverse proxy.

* **Health Check**: Run `python ddos-local-server.py --doctor` to surface any risky or misconfigured workspace policies.

## 🗺️ How it works (Architecture)

```text
  GitHub / Slack / Notion / Chrome / Local Bash
               │
               ▼  (Mapped via MCP Standard Protocol)
┌───────────────────────────────┐
│     Local Server Manager      │  <-- Tool Emergence Layer (Executor)
│      (Python / MCP Host)      │
└──────────────┬────────────────┘
               │  (Zustand State & Websocket)
┌──────────────┴────────────────┐
│      Prose Workflow Engine    │  <-- Order Builder Layer (Orchestrator)
│   (Pipelines & Error Retries) │
└──────────────┬────────────────┘
               │
      [DeepSeek / Local Models] <-- Data Emergence Layer (The Brain)
```

## 📖 Deep Dives & Documentation

Use these guides when you're past the onboarding flow and want to deeply customize your dimension:

* [**Platform Architecture**](https://github.com/FatBy/dd-os/wiki/Architecture) — Understand the Gateway WebSocket network and WorldView topologies.

* [**Writing Prose Workflows**](https://github.com/FatBy/dd-os/tree/main/skills/prose/lib) — How to write `.prose` files to orchestrate parallel agents.

* [**Creating Custom MCP Skills**](https://github.com/FatBy/dd-os/tree/main/skills/skill-creator) — A guide to wrapping your own Python/Node scripts into DD-OS skills.

* [**The Soul & Memory Houses**](https://github.com/FatBy/dd-os/wiki/Houses) — How to configure long-term memory and distinct personas for your agents.

## 🤝 Community & Contributing

DD-OS is built for those who want to shatter the chatbox and build real automated workflows. We welcome all AI/vibe-coded PRs! 🤖

See [**CONTRIBUTING.md**](https://github.com/FatBy/dd-os/blob/main/CONTRIBUTING.md) for guidelines on code style, UI standards (Tailwind/MatrixRain effects), and how to submit pull requests.
