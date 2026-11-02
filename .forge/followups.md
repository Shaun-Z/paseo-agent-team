# Follow-ups

<!-- followup: fu-47de9e53039d | source: paseo-project-team-plugin | task: 1 | date: 2026-10-29 | status: open | taken: - -->
- `paseo.workspaces.list()`·`agents.list()`의 페이지네이션을 따라가지 않음. workspace가 많은 호스트에서는 이름 매칭이 누락돼 중복 생성될 수 있음. 팀 삭제(`deleteTeam`)도 같은 한계를 가짐: 다음 페이지의 팀 에이전트는 보관되지 않음

<!-- followup: fu-e0953b53000b | source: paseo-project-team-plugin | task: 1 | date: 2026-10-29 | status: open | taken: - -->
- 계획 에이전트를 읽기 전용 모드(claude Plan Mode 등)로 띄우기. 현재는 프롬프트로만 파일 변경을 막음

<!-- followup: fu-4a2dd60fb648 | source: paseo-project-team-plugin | task: 1 | date: 2026-10-29 | status: open | taken: - -->
- Paseo 기본 UI로 workspace에서 에이전트를 띄울 때 역할 모델을 자동 적용(생성 시점 훅 확인 필요)

<!-- followup: fu-bdf2f2bad552 | source: sidebar-team-create | task: 2 | date: 2026-10-29 | status: taken | taken: 3 -->
- Apply 성공 시 계획 에이전트 정리: 플러그인이 만든 "Team planner" workspace는 `paseo.workspaces.archive()`로 보관하고, 기존 workspace에서 띄운 계획 에이전트는 에이전트만 보관한다. 검토 중에는 "계획 에이전트 열기"가 필요하므로 제안 완료가 아니라 Apply 성공 시점에 정리한다.
  근거: UAT 중 사용자가 agents-test 프로젝트에 남은 "Team planner" workspace를 닫을 수 있는지 문의. 이번 계획은 이 정리를 비목표로 두었다.

<!-- followup: fu-0520c8ed98cc | source: max-permission-mode | task: 4 | date: 2026-10-30 | status: open | taken: - -->
- 배포 스킬(`.claude/skills/deploy/SKILL.md`) 5단계를 실제 환경에 맞게 고친다. `getpaseo/plugins`에는 lockfile이 없어 `npm ci`가 실패하고, `node scripts/validate.ts`는 auto mode 분류기가 막는다. 의존성 설치 방식을 바꾸거나, 사용자가 직접 실행하는 단계로 명시하거나, 권한 규칙을 추가해야 한다.
  근거: v0.1.3 배포 때 release 에이전트와 오케스트레이터가 모두 거부당했고, 사용자가 직접 실행했을 때 `npm ci`가 EUSAGE로 실패했다.

<!-- followup: fu-1145da606e5c | source: max-permission-mode | task: 4 | date: 2026-10-30 | status: taken | taken: 7 -->
- `tests/daemon.e2e.test.ts`가 끝날 때 자기가 만든 오케스트레이터와 그 오케스트레이터가 띄운 역할 에이전트를 보관(archive)하게 한다. 지금은 임시 `pwa-game-*` workspace에 idle 에이전트가 쌓인다.
  근거: 이번 e2e 3회로 오케스트레이터 3개와 smoke test 역할 에이전트 5개가 남았다.

<!-- followup: fu-3c0b7a9e21d4 | source: agent-dashboard-tab | task: 5 | date: 2026-10-30 | status: taken | taken: 6 -->
- 대시보드 effort 칩: effort 값(`thinkingOptionId`/`effectiveThinkingOptionId`)이 비어 있으면 provider snapshot의 모델 `defaultThinkingOptionId`를 흐리게 표시한다. Paseo 화면이 하는 방식과 같다.
  근거: 오케스트레이터 입력창은 effort가 비어 있는데도 "Medium"을 표시했고, snapshot의 claude-opus-5-5 기본값도 medium이다. 대시보드의 claude 카드에는 effort 칩이 없다.

<!-- followup: fu-9d41c6a2e7b0 | source: per-workspace-orchestrator | task: 9 | date: 2026-10-30 | status: open | taken: - -->
- e2e가 만든 임시 `pwa-game-*` 프로젝트의 워크스페이스는 보관되지 않아 사이드바에 쌓인다(에이전트는 보관됨). e2e의 `afterAll`에서 임시 워크스페이스도 보관한다.
  근거: UAT 중 사이드바에 `pwa-game-*` 프로젝트가 4개 이상 보였다.

<!-- followup: fu-f442abd3e622 | source: keep-orchestrator-after-clear | task: 12 | date: 2026-10-30 | status: open | taken: - -->
같은 에이전트를 그 자리에서 비우는 세션 리셋을 검토한다. 테스트 에이전트에 플러그인 send("/clear")를 보내 Paseo가 보관 후 새로 만드는지, 같은 에이전트 안에서 비우는지 측정하고, 라벨·시스템 프롬프트를 유지하는 /clear를 Paseo에 기능 요청할지 판단한다.

<!-- followup: fu-14efcc321792 | source: agent-dashboard-explorer | task: 13 | date: 2026-10-30 | status: open | taken: - -->
- 아주 좁은 폭(오른쪽 사이드바)에서는 오케스트레이터 카드를 줄여도 역할 카드가 넘친다. 역할 카드 축소나 세로 쌓기를 검토할 것.
  Evidence: app.paseo.sh 사이드바에서 축소 카드 옆 역할 카드가 오른쪽으로 잘려 하단 스크롤이 필요했다.

<!-- followup: fu-64d8c26f699a | source: keep-team-proposal-across-navigation | task: 14 | date: 2026-10-30 | status: open | taken: - -->
- e2e "applies the team: file, workspaces and orchestrator"가 `tests/daemon.e2e.test.ts:163`에서 실패한다. `projectTeamsList`는 팀 파일 경로를 상대 경로로, Apply는 절대 경로로 돌려준다. 어느 쪽이 맞는지 정해 한쪽을 맞출 것.
  Evidence: 2026-10-30 e2e 실행에서 기대값은 `/var/folders/.../pwa-game-KWDUAb/.agents/teams/orchestrator.json`, 실제값은 `.agents/teams/orchestrator.json`이었다.

<!-- followup: fu-83ae26233411 | source: team-editor-select-layout | task: 14 | date: 2026-11-02 | status: taken | taken: 16 -->
- 팀이 이미 있는 워크스페이스의 팀 패널에 "This workspace has no team yet…" 생성 카드가 팀 요약 아래에 함께 보인다. 문구가 사실과 다르고, 같은 워크스페이스에 두 번째 팀을 만들라는 것처럼 읽힌다.
  Evidence: app.paseo.sh orchestrator-2 팀 패널에서 확인. `client/TeamPanel.tsx`의 생성 카드 조건이 `!draft`뿐이고, 5fa77ca에도 같은 조건이었다.
