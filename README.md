<div align="center">

🌌 DD-OS — Digital Dimension Operating System

Build your LLM-driven world.

</div>

"LLMs are the emergence of data intelligence, while Agents are the emergence of tool intelligence."

INITIALIZE! IMMERSE!

If GPT and Claude compressed humanity's vast data into sparks of intelligence, then the mission of DD-OS is to weave the scattered tools in your system into a fully automated execution network.

DD-OS is a next-generation spatial Agent Operating System running on your local device. It is not satisfied with being just a "brain" spitting out text in a chat box. Through the native MCP (Model Context Protocol) and the Turing-complete Prose Workflow Engine, it allows AI to truly take over your file system, browser, enterprise collaboration software, and development environment—bridging the gap from "conversation" to "execution."

Website · Docs · World View · Wiki · Getting Started · Skills Hub · FAQ

🔮 The Nexus: Spatial Entities of Intelligence

DD-OS completely discards the "file-folder" tree metaphor that has persisted since Windows 95. Here, all digital assets, Agents, and executing tasks are represented as visual Nexus (Hub Nodes) within the immersive WorldView canvas.

From "New Folder" to "Build Proposal": When you want to launch a new project (e.g., "Draft a deep business strategy analysis" or "Develop a frontend component"), you don't create a file in a cold system. Instead, you instantiate a new Nexus on the digital canvas via the BuildProposalModal.

Holographic Control Panel: Every Nexus is a living entity. Click into it, and it can be an execution container mounting a specific .prose workflow, or a daemon listening to external events (like Feishu/GitHub).

Topology & Neural Links: Memory, Skills, and Tasks orbit the core Nexus, establishing connections between them. The flow of data is rendered in real-time before your eyes through Matrix Rain (MatrixRain) and dynamic Radar Charts (RadarChart).

Your desktop is no longer a dead plane storing shortcuts, but a dynamically evolving neural network resembling a star map.

⚡ Core Evolution: Tool Emergence & Order Reconstruction

1. 🛠️ The Gateway of Tool Emergence: MCP Skills Matrix

In the skills/ directory, we have built-in and standardized massive capabilities. The Agent is no longer isolated; it can mount these tools on demand at any time:

Dev Environments: Code Search (cross-file semantic retrieval), Tmux terminal control, GitHub Issues/PRs deep integration.

Enterprise Collaboration: Feishu (Docs/Wiki/Drive deep integration), Slack, Discord communication.

Information Throughput: Browser Automation (headless browser), 1Password credential management, local file-level native read/write.

2. 📝 The Order Builder: Prose Workflow Engine

To ensure "tool emergence" is controllable and stable, DD-OS invented the .prose script engine (located in skills/prose/). It allows you to abstract complex business logic into reusable pipelines:

Concurrent Execution: 16-parallel-reviews.prose (Multi-Agent parallel code review).

Recursive Self-Correction: 40-rlm-self-refine.prose (Result filtering and self-iteration).

Full-Chain Orchestration: From cross-platform data retrieval and cleaning, to cross-validation, to final text generation. No black boxes; every execution step is traceable.

🚀 Quick Start

Dependencies: Node.js ≥ 20, Python ≥ 3.10

DD-OS adopts a frontend-backend separated architecture: the frontend provides holographic visual interaction, while the backend provides a secure sandbox environment and system-level permissions.

1. Launch the Local Control Plane Frontend (Vite + React)

git clone [https://github.com/FatBy/dd-os.git](https://github.com/FatBy/dd-os.git)
cd dd-os
npm install  # or pnpm install
npm run dev


2. Launch the Core Engine & MCP Gateway (Local Server)

# Running in a virtual environment is recommended
pip install -r requirements.txt
python ddos-local-server.py


Now, visit http://localhost:5173, and you will enter an immersive digital dimension featuring Soul Orbs (SoulOrb) and dynamic waveforms (WaveformBar).

🛡️ Local-First & Security Sandbox

Because the Agent has the ability to touch real physical tools, security is DD-OS's top priority.

Interception & Authorization: All tool calls involving underlying system modifications (like file deletion or command execution) will trigger an ApprovalModal interception on the frontend, waiting for human explicit approval.

Data Isolation: All keys and Tokens are strictly stored in local .env files. The gateway engine runs on local loopback, refusing unauthorized public network penetration.

Run python ddos-local-server.py --doctor to perform a one-click audit of running environment permissions and security risks.

📖 Documentation & Wiki

For a deeper dive into the system architecture, how to write your own .prose workflows, and managing your SoulHouse personas, please visit our GitHub Wiki.

Understanding Prose Workflows

Creating Custom MCP Skills

WorldView & Nexus Architecture

🤝 Contributing (Join the Dimension)

This LLM-driven world has just completed its initialization.

DD-OS is by no means a closed system. We look forward to more developers, creators, researchers, and explorers joining us. Whether it's writing a brand new MCP skill, sharing a brilliant .prose workflow you've refined, or optimizing the holographic rendering of WorldView, you are warmly welcome.

Please read our CONTRIBUTING.md for details on our code of conduct, and the process for submitting pull requests to us.

Feel free to submit PRs or share your inspirations in our Discord. Let's perfect this emerging new dimension together.

<div align="center">
<i>Built with 🌌 by the DD-OS Community</i>
</div>
