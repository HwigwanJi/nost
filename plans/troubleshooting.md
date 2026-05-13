# Troubleshooting — 자주 부딪치는 문제 + 해결

> 빌드/실행/배포/디버깅에서 반복적으로 부딪친 케이스 카탈로그.
> 작성: 2026-05-14. 새 케이스 발견 시 §X 신설.

---

## §A. 빌드

### A-1. `frontend/npm run build` — TypeScript 에러
**증상**: `tsc -b && vite build` 가 TS 에러로 실패.

**자주 발생하는 케이스**:

1. **Record 타입 에러** (e.g., "Property 'doc' is missing in type")
   - 원인: union 타입 (`LauncherItem['type']`) 에 새 멤버 추가했는데 그 union 을 키로 쓰는 `Record<>` 에 누락
   - 해결: 에러 메시지의 파일 + Record 정의에 누락된 멤버 추가
   - 예시: v1.3.34 'doc' 추가 시 `BatchDropDialog::TYPE_META` 누락

2. **declared but never read** (TS6133)
   - 원인: import 후 사용 안 함 (refactor 후 잔재)
   - 해결: import 제거 또는 underscore prefix (`_unused`)

3. **shadcn types 충돌** (e.g., dnd-kit `SyntheticListenerMap`)
   - 원인: 라이브러리 내부 타입을 외부에서 직접 typing 시도
   - 해결: `any` 또는 `unknown` 으로 escape (이미 ItemDialog DragActivator 에서 적용)

**일반 해결**:
```bash
# 캐시 클리어
cd "D:\01_개인\06. launcher\frontend"
rm -rf dist node_modules/.vite
npm run build
```

### A-2. `electron-builder` — 코드 사이닝 실패
**증상**: `signtool.exe` 가 멈춤 / 에러.

**확인**:
- Windows Defender / 안티바이러스가 signtool 차단 가능
- 인증서 만료 / 키 파일 누락 (current 코드사이닝 X — self-signed 또는 unsigned)

**해결**:
- 백신 일시 비활성화 후 재시도
- 사이닝 생략하려면 `package.json::build.win.signAndEditExecutable: false` (production 비추천)

### A-3. `electron-builder` — Multi-target 누락
**증상**: nsis 만 빌드되고 portable 안 나옴 (또는 그 반대).

**확인**: `package.json::build.win.target`
```json
"target": [
  { "target": "nsis", "arch": ["x64"] },
  { "target": "portable", "arch": ["x64"] }
]
```

---

## §B. 개발 모드

### B-1. `npm start` 후 화면이 빈 windowsill
**증상**: Electron 창 떴는데 흰 화면 / 아무것도 안 뜸.

**자주 발생하는 케이스**:

1. **Vite dev server 안 켜짐**
   - 확인: 별도 터미널에서 `cd frontend && npm run dev` 실행 중인지
   - `http://localhost:5173` 접속 시 정상이어야 함
   - main.js 가 `process.env.ELECTRON_RENDERER_URL` 또는 file:// 결정 — dev 모드면 URL 필요

2. **`electron-dev` 스크립트 사용 권장**
   ```bash
   cd "D:\01_개인\06. launcher"
   npm run electron-dev    # ELECTRON_RENDERER_URL=http://127.0.0.1:5173 자동 세팅
   ```

3. **렌더러 크래시** (v1.0.19 처럼 preload `require('os')` 늦은 호출 등)
   - DevTools 열어서 console 확인 (Ctrl+Shift+I)
   - `%APPDATA%\nost\logs\renderer.log` 확인

### B-2. Electron 인스턴스가 떠 있어서 새로 실행 안 됨
**증상**: `npm start` 가 조용히 종료 또는 충돌.

**해결**:
```bash
taskkill /f /im electron.exe
```

또는:
```bash
# 작업 관리자에서 "nost" 또는 "Electron" 프로세스 찾아 종료
```

### B-3. HMR (hot module reload) 안 됨
**증상**: 코드 수정해도 화면에 반영 X.

**해결**:
- Vite dev server 재시작 (`Ctrl+C` 후 `npm run dev`)
- `.vite` 캐시 삭제: `rm -rf frontend/node_modules/.vite`

---

## §C. Git / 한글 경로 / 환경

### C-1. `fatal: detected dubious ownership`
**증상**: `git status` 가 한글 경로 때문에 거부.

**해결** (한 번만):
```bash
git config --global --add safe.directory 'D:/01_개인/06. launcher'
```

### C-2. PowerShell 한글 경로 파일 못 찾음
**증상**: `Copy-Item "D:\01_개인\..."` 가 한글 mojibake로 실패.

**해결**: bash 사용 또는 `/c/Temp/` 같은 ASCII 경로로 먼저 복사:
```bash
cp "D:/01_개인/06. launcher/release/nost Setup 1.3.33.exe" /c/Temp/...
```

### C-3. `git push` 가 reject (non-fast-forward)
**증상**: 다른 세션 / 협업자가 main 에 새 커밋 push 함.

**해결**:
```bash
git pull --rebase origin main
# 컨플릭트 발생 시 해결 후
git rebase --continue
git push origin main
```

### C-4. `gh` CLI 명령이 401
**증상**: GitHub API 호출 시 인증 실패.

**해결**:
```bash
gh auth status
# 미로그인이면
gh auth login
```

### C-5. PowerShell 스크립트 `Invoke-RestMethod` 401
**증상**: 임베디드 토큰 (`ghp_...`) 이 만료/회수됨.

**해결**: `gh` CLI 사용 (위 C-4). 토큰을 PS 스크립트에 박지 말 것.

---

## §D. 런타임

### D-1. Multi-monitor 에서 창이 엉뚱한 위치
**증상**: 노드/덱 launch 시 창이 잘못된 모니터에 떨어짐 / 크기가 안 맞음.

**원인 후보**:
1. PS 가 DPI-unaware 인데 Electron DIP 좌표 사용 (v1.3.8 이전 회귀)
2. monitor 번호가 어긋남 (`QL_MONITOR` env 미설정)

**해결**:
- `plans/ssot-index.md` §A.7 + `walkthrough_v2.md` §7.2 (DPI 처리) 참고
- 모든 창 배치는 `_Position.ps1::Move-WindowToRect` 통과 확인
- `main.log` 에서 monitor index + workArea 디버그 출력 확인

### D-2. 자동 업데이트 404
**증상**: 사용자가 새 버전 알림 못 받음 / 다운로드 실패.

**확인**:
1. `latest.yml` 파일명과 실제 GitHub asset 파일명 일치 (공백 → 하이픈)
2. `package.json::build.publish.repo` = `HwigwanJi/nost` 정확
3. Repo public 인지 (private 이면 토큰 필요)

**해결**: `plans/release-runbook.md` Failure 2 참조.

### D-3. 확장이 작동 안 함 (Chrome 탭 스캔 실패)
**증상**: 스마트 스캔에서 브라우저 탭 안 보임.

**확인**:
1. Chrome 확장 설치됨? (chrome://extensions 에서 nost-bridge 활성화)
2. Chrome 창에 포커스 한 번 줬는지? (서비스 워커 sleep 상태)
3. v1.3.33 의 calm-by-default 정책으로 조용히 fail (의도된 동작)
4. `getExtensionBridgeStatus()` 호출 결과 확인 (`tabsCount > 0` 여부)

### D-4. Hold 제스처 (꾹 누르기) 작동 안 함
**증상**: 카드 길게 눌러도 4방향 메뉴 안 뜸.

**확인**:
1. `activeMode === 'normal'` 인지 (다른 모드에선 차단됨 — v1.3.31 `conflictPolicy`)
2. `isUserBusy()` 가 false 인지 (modal 안 열려있어야)
3. `HOLD_MS` (450ms) 동안 카드 위에서 mouse-up 없이 유지했는지
4. ItemCard `handlePointerDown` 의 holdTimer 가 set 됐는지 (DevTools 콘솔)

### D-5. ESC 가 엉뚱한 걸 닫음
**증상**: ESC 눌렀더니 의도와 다른 surface 가 닫힘.

**해결**: `plans/escape-stack-audit.md` 참고 — escapeStack LIFO 위반 가능.
- 컴포넌트마다 `keydown` 직접 처리 금지
- Dialog 안에서 ESC = base-ui 가 자동 처리
- 다른 surface 는 `pushEscape(() => closeMe())` 사용

---

## §E. 데이터 / Migration

### E-1. 부팅 시 카드 데이터 사라짐
**증상**: 재시작 후 카드/스페이스가 비어있음.

**확인**:
1. `%APPDATA%\nost\config.json` 존재 + 내용 검사
2. `localStorage` (DevTools → Application → Local Storage) 백업 존재 여부
3. `migrateData` 가 crash → 모두 default 로 떨어짐 (`main.log` 에 에러 트레이스)

**복구**:
- 사용자에게 자동 백업 안내: `userData/auto-backups/` 폴더
- 또는 수동 백업 (`.nost` 파일) 가져오기

### E-2. Type 변경 후 기존 데이터 broken
**증상**: 새 type 추가 후 기존 카드가 이상하게 표시.

**확인**:
- `useAppData::migrateData` 의 reclassify 룰이 추가됐는지 (`maybeReclassifyAsDoc` 패턴)
- 마이그레이션이 idempotent 한지

---

## §F. 자주 묻는 질문 (FAQ)

### "코드 어디 있는지 모르겠어요"
1. `walkthrough_v2.md` §3 디렉토리 트리 확인
2. `plans/ssot-index.md` §A.x 에서 영역 검색
3. `grep -rn "<keyword>" frontend/src` 직접 grep

### "TypeScript 에러 무서워요"
- 에러 메시지 + 파일 위치 정확히 읽기
- `Record<UnionType, ...>` 에러는 union 멤버 추가 시 가장 흔함
- shadcn / base-ui 내부 타입은 `any` 로 escape OK (지나치게 typing 시도 X)

### "PR 어떻게 만드나요?"
- 현재는 main 직접 push 패턴 (PR 없음). 사용자 운영 방식.
- 큰 작업은 임시 branch 만들어 push 한 뒤 사용자에게 검토 요청

### "테스트 어떻게 돌리나요?"
```bash
cd frontend
npm test                     # vitest 단발 실행
npm test -- --watch          # watch mode
```
- 현재 테스트 커버리지: `lib/typePlausibility.test.ts` (1개 파일) — 미흡, 늘려야 함

### "릴리스 어떻게 하나요?"
→ `plans/release-runbook.md` 통째로.

---

## §G. 새 케이스 추가 양식

본 문서에 새 케이스 추가 시:

```markdown
### <카테고리>-<번호>. <한 줄 증상>
**증상**: <구체적 관찰>

**자주 발생하는 케이스**:
1. ...
2. ...

**해결**:
- ...

**예방**: <코드 변경으로 재발 방지 가능한지>
```

영역별 분류:
- A. 빌드
- B. 개발 모드
- C. Git / 환경
- D. 런타임
- E. 데이터
- F. FAQ
- G. (메타)
