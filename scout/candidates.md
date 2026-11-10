# Scout 2026-11-10

## Add?

Claude marketplace feed of 2026-11-06: not carried, in the top 150 (first run: no growth figures yet).

| # | Item | Installs | Growth since last scout |
| --- | --- | --- | --- |
| 50 | claude-security | 32,337 | n/a |
| 59 | laravel-boost | 22,597 | n/a |
| 63 | atomic-agents | 20,336 | n/a |
| 64 | shopify-ai-toolkit | 18,034 | n/a |
| 68 | session-report | 14,974 | n/a |
| 71 | circleback | 12,751 | n/a |
| 72 | terraform | 12,540 | n/a |
| 73 | azure | 11,986 | n/a |
| 74 | deploy-on-aws | 11,841 | n/a |
| 75 | asana | 11,391 | n/a |
| 76 | qodo-skills | 11,282 | n/a |
| 77 | aikido | 11,276 | n/a |
| 78 | code-modernization | 11,121 | n/a |
| 79 | pinecone | 10,547 | n/a |
| 80 | mongodb | 10,523 | n/a |
| 81 | ruby-lsp | 9,927 | n/a |
| 82 | aws-serverless | 9,913 | n/a |
| 83 | desktop-commander | 9,382 | n/a |
| 84 | sonarqube | 9,325 | n/a |
| 85 | browser-use | 8,961 | n/a |

MCP Registry: 100 servers on the first page, first run:

- `ac.inference.sh/mcp`: Run 150+ AI apps — image, video, audio, LLMs, 3D and more. Browse, execute, stream results.
- `ac.inference.sh/mcp`: Run 150+ AI apps — image, video, audio, LLMs, 3D and more. Browse, execute, stream results.
- `ac.inference.sh/mcp`: run any ai model. compose agents, stack knowledge, connect tools. one api, pay per run.
- `ac.inference.sh/mcp`: run any ai model. compose agents, stack knowledge, connect tools. one api, pay per run.
- `ac.mizan/registry`: Player ban records from 560+ game community ban lists, with Steam's own bans. Reads need no key.
- `ac.snag/snag`: Gives your coding agent the captured console, network, replay and screenshot evidence for a bug.
- `ac.tandem/docs-mcp`: Remote MCP server for Tandem docs, install guides, SDKs, workflows, and agent setup help.
- `ac.tandem/docs-mcp`: Remote MCP server for Tandem docs, install guides, SDKs, workflows, and agent setup help.
- `ac.tandem/docs-mcp`: Remote MCP server for Tandem docs, install guides, SDKs, workflows, and agent setup help.
- `academy.apexai/apex-ai-academy`: Lessons, news and pricing from Apex AI Academy, an AI academy run by agents. Free lessons, no key.

Source repos (stars):

- anthropics/skills: 191,884
- openai/skills: 28,655
- NousResearch/hermes-agent: 262,297
- openclaw/openclaw: 394,291
- openclaw/clawhub: 9,550
- modelcontextprotocol/servers: 91,905

## Drop?

- mcp/postgres: upstream modelcontextprotocol/servers-archived is archived
- mcp/postgres: upstream untouched since 2025-05-28
- mcp/postgres: blocked by the gates: scan: npm marks @modelcontextprotocol/server-postgres@0.6.2 deprecated: Archived and unmaintained | install: handshake failed: MCP error -32000: Connection closed
- mcp/slack: blocked by the gates: install: handshake failed: Incompatible auth server: does not support dynamic client registration
- plugin/aws-core: blocked by the gates: lint: skip-approvals skills/aws-iam/references/aws-iam-policy-generation.md:221 "- If unavailable, proceed with the `curl` and `jq` fallback automatically — do NOT ask the user for permission to proceed"
- plugin/huggingface-skills: blocked by the gates: lint: read-credentials skills/hf-cloud-aws-context-discovery/SKILL.md:64 "`aws configure list` handles env-var overrides and shows the resolved effective values. Prefer it over parsing `~/.aws/config` yourself. If you need to 

## Overlap

- skill/skill-creator: merge with OpenClaw skill-creator
- skill/systematic-debugging: compare with superpowers

## Watch (ours, rewritten from upstream)

- office-docs ← anthropics/skills/skills/docx: last change 2026-11-06 "Move Office skills to the Apache 2.0 license (#2146)"
- office-docs ← anthropics/skills/skills/pdf: last change 2026-11-06 "Move Office skills to the Apache 2.0 license (#2146)"
- office-docs ← anthropics/skills/skills/pptx: last change 2026-11-06 "Move Office skills to the Apache 2.0 license (#2146)"
- office-docs ← anthropics/skills/skills/xlsx: last change 2026-11-06 "Move Office skills to the Apache 2.0 license (#2146)"
- figma-bridge ← figma/mcp-server-guide: last change 2026-11-09 "skills: Release Figma skills 2.2.193 (#126)"
- agenticode-setup ← anthropics/claude-plugins-official/plugins/claude-code-setup: last change 2026-05-28 "recommender: add Convex to database/backend MCP coverage (#1981)"
- brainbow ← microsoft/playwright-mcp: last change 2026-11-10 "chore(bots): add the "Agent: task" workflow (#1851)"
