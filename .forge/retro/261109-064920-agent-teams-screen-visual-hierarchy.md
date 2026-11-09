# 2026-11-09 — Agent teams 화면에 타이틀바·상태 색 띠로 시각 위계 넣기 (#17)

## Plan vs actual
- What went as planned: 시안 C(상태 색 띠)대로 팀 행 카드·workspace 제목·목표 2줄·주황 배지·재연결 주 버튼·"+ 새 팀" 링크를 넣었고, 기계 확인 DoD 1~6이 모두 통과했다.
- Divergences:
  - 1회차: ui role(codex/gpt-6.1-sol)이 사용량 한도로 착수 직후 중단. 팀 규칙상 대체 불가라 사용자가 팀 파일에서 ui·core를 Claude로 바꾼 뒤 재실행했다.
  - 2회차 UAT 실패: 맨 위 프로젝트 헤더가 팀 행과 같은 무게라 눈에 안 들어온다는 피드백. 시안 3개를 보여 주고 A(옅은 색 타이틀바 + 팀 행 축소)로 수정 재실행해 통과.
  - 공용 Button에 작은 크기 옵션이 없어 "버튼도 작게"는 반영하지 못했다(후속 작업).
  - S2에서 release 에이전트가 세션 시작 훅의 "미봉인 작업" 안내를 보고 같은 작업을 먼저 닫을지 되물으며 멈췄다. 같은 작업이라고 다시 전달한 뒤 진행.

## Learnings
- Do differently next time: 화면 위계 작업은 "무엇을 강조할지"를 처음 시안 단계에서 최상위 그룹(프로젝트 헤더)까지 포함해 비교한다. 이번에는 팀 행만 강조해 한 번 더 돌았다.
- Do differently next time: 사용자는 맨 위 프로젝트(폴더)를 "워크스페이스"라고 불렀다. 용어집의 Project/Workspace와 다르게 쓰일 수 있으니, UI 강조 대상을 말할 때는 화면의 위치(맨 위 헤더/팀 행 제목)로 확인한다.
- Do differently next time: 역할 에이전트에 forge 작업의 일부를 맡길 때는 "forge 명령을 실행하지 말고 .forge/를 건드리지 말 것"을 처음 지시에 넣는다. 세션 시작 훅의 미봉인 안내 때문에 멈출 수 있다.
- Do differently next time: provider 사용량 한도는 위임 직전에 짧은 응답 요청으로 확인할 수 있다. 같은 provider를 쓰는 역할이 여럿이면 함께 막힌다.

## Doc updates
- CONTEXT.md promotion: none
- ADR added: none

## Follow-up candidates
<!-- followup: fu-ed054f0ae86b | source: agent-teams-screen-visual-hierarchy | task: 17 | date: 2026-11-08 | status: open | taken: - -->
- 공용 Button에 작은 크기(compact) 옵션을 추가해 Agent teams 팀 행의 팀 열기·재연결·삭제 버튼도 한 단계 줄인다. 시안 A가 요청한 "버튼도 작게"가 빠져 있다.
  Evidence: ui#2B7D 보고 — 공용 Button에 compact 옵션이 없어 버튼 크기를 그대로 두었다(run.md S1 ⚠).
