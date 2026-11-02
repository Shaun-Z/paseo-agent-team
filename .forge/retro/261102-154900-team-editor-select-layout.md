<!-- auto-retro: fg-next all -->
# 2026-11-02 — 팀 편집 화면 제공자·모델 검색 선택 상자와 역할 카드 레이아웃

## 계획 대비 실제
- 계획대로 된 것: 검색 팝업 선택 상자, "Provider and model" 한 줄, 이름·지시 라벨, 폴더 접기, Chips 제거, README 설명(S1·S2·S4). typecheck와 npm test는 끝까지 통과.
- 어긋난 것:
  - S1의 첫 구현은 선택 상자마다 플러그인 `Modal`을 하나씩 두었다. 실제 앱에서 열린 팝업이 다른 상자의 것이었고(qa 모델 팝업에 codex 모델), 고른 값이 엉뚱한 역할(docs)에 들어갔다. review와 테스트로는 잡히지 않았고 UAT에서만 드러났다. 화면 단위 공유 Modal 하나로 바꿔 해결했다.
  - review의 모바일 수정으로 넣은 `Modal.Content scrollable={false}`가 팝업을 창 높이만큼 늘렸다. 사용자가 지적해 기본값과 목록 maxHeight로 되돌렸다.
  - UAT 중 사용자 요청으로 키보드 선택(↑/↓, Enter)을 추가했다.

## 배운 것
- 다음엔 다르게:
  - Paseo 플러그인 `Modal`은 화면에 하나만 둔다. 행마다 Modal을 두면 호스트가 다른 인스턴스의 내용과 핸들러를 띄운다. 목록형 화면의 팝업은 처음부터 공유 상태 하나로 설계한다.
  - `Modal.Content`의 `scrollable={false}`는 본문을 꽉 찬 높이로 만든다. 내용에 맞춘 팝업이 필요하면 기본값을 두고 안쪽 목록 높이만 제한한다.
  - 리뷰가 플랫폼별 수정(모바일 스크롤)을 권하면, 그 수정이 웹 레이아웃을 어떻게 바꾸는지 실제 앱에서 같이 확인한다.
  - 팝업 선택 UI는 처음부터 키보드 탐색을 명세에 넣는다. 사용자는 검색 다음 동작으로 화살표와 Enter를 바로 기대했다.

## 문서 갱신
- 검토되지 않음(자동 회고)

## Follow-up candidates

<!-- followup: fu-83ae26233411 | source: team-editor-select-layout | task: 14 | date: 2026-11-02 | status: open | taken: - -->
- 팀이 이미 있는 워크스페이스의 팀 패널에 "This workspace has no team yet…" 생성 카드가 팀 요약 아래에 함께 보인다. 문구가 사실과 다르고, 같은 워크스페이스에 두 번째 팀을 만들라는 것처럼 읽힌다.
  Evidence: app.paseo.sh orchestrator-2 팀 패널에서 확인. `client/TeamPanel.tsx`의 생성 카드 조건이 `!draft`뿐이고, 5fa77ca에도 같은 조건이었다.
