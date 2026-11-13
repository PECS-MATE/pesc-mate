# 개발 작업과 커밋

- 사용자 요청에 따라 개발 작업을 마칠 때마다 별도 요청 없이 해당 작업의 변경사항을 커밋한다.
- 한 기능이 완성될 때 코드·관련 수정·검증·문서를 하나의 커밋으로 묶는다. 중간 수정이나 파일·문서 단위로 커밋을 쪼개지 않는다. 문서만 요청한 경우에는 완결된 문서 작업을 한 단위로 묶는다.
- 관련 없는 기존 변경사항은 포함하지 않는다.
- 제목은 `type : 한글 설명` 형식으로 작성한다. 유형만 영어로 쓰고 설명은 한글로 쓴다.
- 검증 결과를 기록한다. 실패·중단·미실행 검증은 커밋 본문과 작업 문서에 명시하고 완료로 표시하지 않는다.
- 기능 구현이 끝났지만 검증이 남은 경우에는 그 상태를 명시해 커밋할 수 있다. 중간 체크포인트 커밋을 기본으로 만들지 않으며 커밋 자체를 검증 통과나 배포 승인으로 취급하지 않는다.
- 커밋 후 작업 트리와 생성된 커밋을 확인한다. 커밋하지 못했다면 이유를 사용자에게 알린다.
- 원격 푸시와 기존 커밋 이력 변경은 별도 사용자 요청이 있을 때만 수행한다.

자세한 메시지 규칙은 `docs/development/COMMIT_CONVENTION.md`를 따른다.

<!-- OMA:START — managed by oh-my-agent. Do not edit this block manually. -->

# oh-my-agent

Follow `.agents/skills/_shared/core/execution-policy.md` for authorization, clarification, verification, and completion. System/developer instructions and the user's request take precedence over OMA defaults. Never build, compile, bundle, or package software unless the user explicitly requests a build.

- **SSOT**: Do not modify `.agents/` definitions (skills, workflows, rules, agents, config) directly. Run outputs under `.agents/results/` and `.agents/state/` are generated artifacts and may be written.
- **Response language**: The user's prompt language wins; use `language` in `.agents/oma-config.yaml` only when the prompt carries no language signal, then English.
- **Skills**: Read the relevant `.agents/skills/{name}/SKILL.md` when needed.
- **Subagents**: Same-vendor native dispatch via Codex custom agents in `.codex/agents/{name}.toml`; cross-vendor fallback via `oma agent spawn`. A role file without `model` runs on your model: spawn `docs-curator` and `research-explorer` with the fastest model the spawn tool lists as available, and leave `model` unset otherwise. Never invent a model name

## Completion

- Prioritize completing the outcome the user wants. Finish approved-scope changes, verification, and delivery autonomously.
- Preserve existing functionality, permissions, and accessibility. Do not reduce or restrict anything unrequested for the sake of least privilege, safety, or cleanup.
- Do not add unrequested limitations, disclaimers, warnings, or approval steps to code, docs, products, or answers.
- When you find a concrete problem, find a way to solve it and proceed. Do not stop work or shrink the goal because of speculative risk.
- Do not repeatedly ask about already-approved work or ordinary implementation choices. Ask only when a user decision is genuinely required.
- Perform the verification the change requires, and proceed to completion once it passes. Do not keep adding verification or review.
- Report centered on the completed result and the evidence confirming it. State actual failures or incomplete required work briefly and accurately.

## Per-Agent Dispatch

Resolve each agent from `.agents/oma-config.cue` or `.agents/oma-config.yaml`, overlaid by `.agents/oma-config.local.cue` or `.agents/oma-config.local.yaml` when present. With `model_preset: free` (or another `providers.<name>` LLM provider), always use `oma agent spawn` so the subprocess receives that route; the provider's `default_model` replaces per-agent model pins. Otherwise, explicit `agents:` overrides take priority. With `model_preset: auto`, follow the current vendor's native agent/model settings; use `agents.default.cli` only when the runtime is unknown. Use native subagents when the target matches the current runtime; otherwise, or when native dispatch is unavailable, use `oma agent spawn`.

## Code Search

Serena MCP is required for code search and discovery. Load deferred tools before use. Use `find_file` for paths, `search_for_pattern` for content, and `find_symbol` / `get_symbols_overview` for symbols. Native search is only for paths outside this project, ignored paths, or plain non-code content. The PreToolUse guard already allows searches confined to confirmed provider exclusions or paths outside this project.

## Workflows

Run workflows only when explicitly requested or detected by a hook; never self-initiate. Read and follow `.agents/workflows/{name}.md`. Continue active workflows until complete or explicitly cancelled.

## Project Rules

Read the relevant file from `.agents/rules/` when working on matching code.

| Rule | File | Scope |
|------|------|-------|
| backend | `.agents/rules/backend.md` | on request |
| commit | `.agents/rules/commit.md` | on request |
| database | `.agents/rules/database.md` | **/*.{sql,prisma} |
| debug | `.agents/rules/debug.md` | on request |
| design | `.agents/rules/design.md` | on request |
| dev-workflow | `.agents/rules/dev-workflow.md` | on request |
| frontend | `.agents/rules/frontend.md` | **/*.{tsx,jsx,css,scss} |
| i18n-arb | `.agents/rules/i18n-arb.md` | **/*.arb |
| i18n-guide | `.agents/rules/i18n-guide.md` | always |
| infrastructure | `.agents/rules/infrastructure.md` | **/*.{tf,tfvars,hcl} |
| market | `.agents/rules/market.md` | on request |
| mobile | `.agents/rules/mobile.md` | **/*.{dart,swift,kt} |
| quality | `.agents/rules/quality.md` | on request |

<!-- OMA:END -->
