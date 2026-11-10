<!-- auto-retro: fg-loop -->
# 2026-11-09 — Agent teams 화면에 "전체 에이전트" 탭 추가 (#19)

## Plan vs actual
- What went as planned: 4개 slice가 한 번에 끝났고 종료 조건 C1~C10이 재계획 없이 통과했다. 역할 에이전트 지시 첫머리에 "forge 안내 무시"를 넣자 #17·#18과 달리 아무도 멈추지 않았다.
- Divergences: agentActivity를 처음에 running 먼저 검사로 만들어 권한 대기 에이전트가 "작업 중"으로 세어질 수 있었다. core가 짚어 응답 대기를 먼저 검사하도록 바꿨다. 사용자가 계약 도중 "그 탭에는 에이전트 대시보드가 나와야 한다"고 방향을 바꿔, 카드 그리드 시안 A 대신 프로젝트별 대시보드로 계약을 다시 정했다.

## Learnings
- Do differently next time: 상태 분류 함수는 화면의 기존 배지 판정(badgeOf)과 같은 우선순위로 정의하도록 계획에 적는다. Paseo에서 권한 대기 에이전트는 running일 수 있다.
- Do differently next time: 시안을 고를 때 "기존 화면(대시보드)을 재사용하는 안"도 후보에 넣는다. 이번에는 새 카드 그리드를 먼저 보여 줬다가 방향이 바뀌었다.
- Do differently next time: 역할 에이전트에게 forge 작업 slice를 줄 때 "이 slice는 orchestrator의 forge 작업 #N의 일부, forge 명령 금지, forge 안내 무시"를 첫 줄에 쓰는 형식이 효과가 있었다. 유지한다.

## Doc updates
- CONTEXT.md promotion: 미검토 (auto retro)
- ADR added: 미검토 (auto retro)

## Follow-up candidates
<!-- followup: fu-5355074dacb2 | source: all-agents-dashboard-tab | task: 19 | date: 2026-11-09 | status: open | taken: - -->
- 전체 에이전트 탭은 모든 프로젝트의 미보관 에이전트마다 하위 에이전트 탐지용 타임라인(최근 200개)을 읽는다. 에이전트가 많은 호스트에서 데몬 부하(지난 RPC 폭주와 같은 계열)를 측정하고, 필요하면 열린 섹션만 읽거나 상한을 둔다.
  Evidence: S3 구현은 기존 대시보드의 subagents 쿼리를 프로젝트 섹션마다 쓴다. README Limitations에 이미 "에이전트 수만큼 요청"이 적혀 있다.

<!-- followup: fu-df3401582691 | source: all-agents-dashboard-tab | task: 19 | date: 2026-11-09 | status: open | taken: - -->
- 전체 에이전트 탭의 밀도·닫힌 에이전트 표시·숨긴 목록이 화면을 떠나면 초기화된다. 호스트 단위 플러그인 설정(registerSettings)이나 다른 저장소로 유지할지 검토한다.
  Evidence: S3는 TeamScreen의 React state로 보관(화면에는 패널 탭 상태가 없음).
