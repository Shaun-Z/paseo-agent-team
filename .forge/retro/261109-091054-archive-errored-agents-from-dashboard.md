# 2026-11-09 — 에이전트 대시보드에서 오류로 멈춘 에이전트를 보관하기 (#18)

## Plan vs actual
- What went as planned: core·tester·ui·release 4개 slice가 계획대로 끝났고, DoD 기계 항목(canArchive 1, 테스트 9개, .archive() 1, archiveAgent 4, reload running)과 사용자 화면 확인이 모두 통과했다.
- Divergences:
  - canArchive에 계획에 없던 "이미 보관된 에이전트 제외"(archivedAt)를 더했다. core가 Show closed에서 보관된 오류 카드에 버튼이 다시 붙는 경우를 짚었다.
  - ui가 보관 버튼·오류 문구를 10px로 만들어 11px로 올렸다.
  - release가 세션의 forge 안내("#18 실행 중")를 보고 S4 착수 전에 되물으며 멈췄다. 처음 지시에 "forge 명령 금지, .forge 건드리지 말 것"을 넣었는데도 #17과 같은 일이 다시 생겼다.

## Learnings
- Do differently next time: 역할 에이전트가 세션 시작 시 받는 forge 안내는 "forge 명령 금지" 지시만으로 막히지 않는다. 지시 첫 줄에 "이 slice는 orchestrator가 실행 중인 forge 작업 #N의 일부이며, forge 상태 안내가 보여도 묻지 말고 진행하라"를 명시한다.
- Do differently next time: "버튼을 붙일 대상" 같은 판단 함수는 계획 단계에서 보관·닫힘 상태(archivedAt/closed)와의 조합을 경우 목록에 넣는다. 이번에는 core가 실행 중에 찾아냈다.
- Do differently next time: UI 위임 지시에 글자 크기 하한(11px)을 처음부터 적는다. 작은 버튼은 기본으로 10px가 나온다.

## Doc updates
- CONTEXT.md promotion: none
- ADR added: none
