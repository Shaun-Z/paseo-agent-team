<!-- auto-retro: fg-loop -->
# 2026-11-06 — Issue #6: 프롬프트 하나로 팀 초안 전체를 AI로 편집

## Plan vs actual
- What went as planned: S1(core)·S2(tester)·S4(release)가 계획대로 끝났고, 종료 조건 C1~C8이 모두 통과했다(team-edit 테스트 21개).
- Divergences: S3을 맡은 ui role(antigravity/gemini-4-argon-high)이 quota 소진으로 착수 전에 종료돼 fork 벽에서 멈췄다. 사용자가 팀 파일에서 ui를 codex/gpt-6.1-sol로 바꿔 해소했다. 대기 중 종료 조건 점검의 C8이 미완성 작업 트리를 실제로 reload해 플러그인이 failed가 됐고, 사용자가 발견해 보고했다. WIP를 stash로 옮기고 reload해 복구했다.

## Learnings
- Do differently next time: 실제 환경을 바꾸는 종료 조건(이번 C8의 plugin reload)은 빌드가 통과하는 트리에서만 실행되게 앞 조건을 거는 형태로 처음부터 작성한다. 출력에서 줄을 가려도(grep -v) 명령은 실행된다.
- Do differently next time: 여러 role이 공유 계약을 바꾸는 작업(S1이 RPC 제거)은 다른 role(S3)이 끝나기 전까지 작업 트리가 빌드되지 않는다. 로컬 디렉터리 설치 플러그인은 이 트리를 그대로 쓰므로, 중간 상태에서 reload가 일어나지 않게 하거나 제거를 마지막 slice로 미룬다.
- Do differently next time: 한 role의 provider 한도가 막히면 무인 반복은 진행할 수 없다(팀 규칙상 대체 금지). 긴 작업 전에는 각 role provider의 남은 한도를 확인할 방법이 있는지 본다.

## Doc updates
- CONTEXT.md promotion: 미검토 (auto retro)
- ADR added: 미검토 (auto retro)

## Follow-up candidates
<!-- followup: fu-b09bdbecf2ea | source: team-edit-with-ai | task: 15 | date: 2026-11-06 | status: open | taken: - -->
- 앱에서 "AI로 팀 편집"을 실제로 돌려 요약 카드·적용/버리기·Cancel 동작과 planner 응답 품질(요청하지 않은 role을 건드리지 않는지)을 확인한다.
  Evidence: 종료 조건 C1~C8은 계약·로직·문구·로드만 검사하며 화면과 실제 planner 출력은 확인하지 않았다.

<!-- followup: fu-b22ddb3a5c98 | source: team-edit-with-ai | task: 15 | date: 2026-11-06 | status: open | taken: - -->
- tests/daemon.e2e.test.ts에서 지운 "proposes one role from a description" 케이스 대신 team.edit.propose/proposal을 실제 데몬으로 돌리는 E2E 케이스를 추가한다.
  Evidence: S2에서 role planner E2E 케이스를 제거했고 대체 E2E는 없다(PASEO_E2E는 토큰 비용 때문에 이번 범위에서 제외).
