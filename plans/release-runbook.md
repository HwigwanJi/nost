# Release Runbook — GitHub Release 발행 종합 절차

> 사용자 명시적 허락 후에만 진행. 8단계 + 검증.
> 작성: 2026-05-14 (v1.3.33 배포 경험 기반).

---

## 🚨 절대 잊지 말 것

1. **사용자 "릴리스해줘" 명시 허락 없이 진행 X** — 토큰 비용 + 거버넌스
2. **자동 업데이트 파일명 = `latest.yml` 의 파일명** — 공백 → 하이픈 변환 필수. 안 맞으면 기존 사용자 404
3. **태그는 한 번 발행되면 immutable** — 망쳤으면 다음 patch 버전으로

---

## 0. 사전 점검 (1분)

```bash
# 1. 작업 디렉토리 이동
cd "D:\01_개인\06. launcher"

# 2. 현재 상태 확인
git status --short           # 미커밋 있으면 OK (다음 단계에서 커밋)
git describe --tags --abbrev=0   # 마지막 태그 (e.g. v1.3.33)
cat package.json | python -c "import json,sys; print(json.load(sys.stdin)['version'])"

# 3. 빌드된 release/ 폴더가 stale 한지 확인 — 오래됐으면 제거
ls "release" 2>&1 | grep -iE "\.exe$|\.yml$|\.blockmap$"
```

---

## 1. Version bump (10초)

`package.json` 만 수정. `frontend/package.json` 은 건드리지 않음 (vite 가 root 에서 주입).

```bash
# 현재 1.3.33 이면 → 1.3.34 로
```

Edit `package.json::version` 한 줄만.

---

## 2. Git status 정리 + 커밋 (1분)

```bash
git status --short
# 의도된 변경만 staged 인지 확인 (특히 .env / token 파일 누락 여부)

git add -A
git commit -m "$(cat <<'EOF'
vX.Y.Z: <한 줄 요약>

<3-5줄 변경사항 — 사용자 영향 위주>

Co-Authored-By: <agent identity>
EOF
)"

git push origin main
```

### 커밋 메시지 스타일 (이전 릴리스 참조)

- 첫 줄: `vX.Y.Z: <한국어 핵심>` (gitlog -10 으로 톤 확인)
- 빈 줄
- 카테고리별 ("주요 변경 / 버그 수정 / UI / 인프라"). 5줄 이내.
- 자동 업데이트 알림에 노출되는 건 따로 (§6 NOTES.md), 커밋 메시지는 개발자용

---

## 3. Frontend 빌드 (3초)

```bash
cd "D:\01_개인\06. launcher\frontend" && npm run build
```

성공 시: `✓ built in N.NN s` 마지막 줄 확인. `dist/assets/` 에 hash된 파일들 생성됨.

### 에러 발생 시
- TS error → `plans/troubleshooting.md` §빌드
- 그래도 안 되면 `rm -rf dist && rm -rf node_modules/.vite` 후 재시도

---

## 4. Electron 빌드 (30초)

```bash
cd "D:\01_개인\06. launcher" && npx electron-builder
```

성공 시 출력:
```
• building target=nsis     file=release\nost Setup X.Y.Z.exe
• building target=portable  file=release\nost X.Y.Z.exe
```

생성물 (4개):
- `release/nost Setup X.Y.Z.exe` (NSIS 설치파일, ~118 MB)
- `release/nost X.Y.Z.exe` (포터블, ~118 MB)
- `release/nost Setup X.Y.Z.exe.blockmap` (delta update용)
- `release/latest.yml` (electron-updater 메타데이터)

### 주의
- 파일명에 **공백** 들어감 — 다음 단계에서 하이픈으로 변환 필수
- 코드 사이닝이 잘 됐는지 출력 마지막 부분에서 `signtool.exe` 라인 확인

---

## 5. Asset 하이픈 변환 + ASCII 경로 복사 (10초)

GitHub upload API 가 한글 경로 + 공백을 받지 못함. `/c/Temp/` 로 복사하면서 동시에 rename:

```bash
mkdir -p /c/Temp/nost_vX_Y_Z
cp "D:/01_개인/06. launcher/release/nost Setup X.Y.Z.exe"          "/c/Temp/nost_vX_Y_Z/nost-Setup-X.Y.Z.exe"
cp "D:/01_개인/06. launcher/release/nost Setup X.Y.Z.exe.blockmap" "/c/Temp/nost_vX_Y_Z/nost-Setup-X.Y.Z.exe.blockmap"
cp "D:/01_개인/06. launcher/release/nost X.Y.Z.exe"                "/c/Temp/nost_vX_Y_Z/nost-X.Y.Z.exe"
cp "D:/01_개인/06. launcher/release/latest.yml"                    "/c/Temp/nost_vX_Y_Z/latest.yml"

ls -la /c/Temp/nost_vX_Y_Z/
```

### 자동 업데이트 무결성 검증

```bash
cat /c/Temp/nost_vX_Y_Z/latest.yml
```

확인 사항:
- `version: X.Y.Z` 가 맞나
- `path:` 와 `files[0].url:` 이 **하이픈** 이름인가 (`nost-Setup-X.Y.Z.exe`)
- 안 맞으면 → electron-builder 가 안에서 이미 처리. 그래도 다르면 수동 sed:
  ```bash
  sed -i 's/nost Setup/nost-Setup/g; s/nost /nost-/g' /c/Temp/nost_vX_Y_Z/latest.yml
  ```

---

## 6. NOTES.md 작성 (3분)

`/c/Temp/nost_vX_Y_Z/NOTES.md` 작성. 사용자가 자동 업데이트 알림에서 볼 텍스트.

### 템플릿

```markdown
## vX.Y.Z — 한 줄 요약

이번 릴리스의 톤 한 문장. 사용자가 신경 쓸 가치 강조.

### 🎯 카테고리 1 (이모지 + 한국어)

- 변경사항 1 줄로 사용자 영향 중심
- 변경사항 2

### 🔧 카테고리 2

- ...

### 🐋 카테고리 3 (deprecation / cleanup)

- ...

---

기존 사용자는 자동 업데이트로 받습니다.
```

### 톤 가이드

- "기존 사용자" 시점 ("당신의 입장에서 뭐가 바뀌나")
- 코드 변경 (refactor, internal SSOT) 은 1줄로 묶거나 생략
- 마크다운 code blocks 는 단순 (백틱) — GitHub release 페이지 렌더링 호환
- 한국어 비중 90%+, 영어는 코드 식별자/제품명 만

### 참조 — 이전 릴리스 노트

```bash
gh release view v1.3.33 --repo HwigwanJi/nost
```

---

## 7. GitHub Release 발행 (30초)

### 7.1 gh CLI 로그인 (첫 1회만)

```bash
gh auth status
# 미로그인이면:
gh auth login
# → GitHub.com → HTTPS → "Y" Git creds → Login with web browser
# → 8자리 코드 입력 → 승인 → "✓ Authentication complete"
```

### 7.2 Release 생성 + asset 업로드

```bash
cd /c/Temp/nost_vX_Y_Z

gh release create vX.Y.Z --repo HwigwanJi/nost \
  --title "vX.Y.Z" \
  --notes-file "NOTES.md"

gh release upload vX.Y.Z --repo HwigwanJi/nost \
  "nost-Setup-X.Y.Z.exe" \
  "nost-Setup-X.Y.Z.exe.blockmap" \
  "nost-X.Y.Z.exe" \
  "latest.yml"
```

### 7.3 검증

```bash
curl -s "https://api.github.com/repos/HwigwanJi/nost/releases/tags/vX.Y.Z" | python -c "
import json, sys
r = json.load(sys.stdin)
print(f'tag: {r[\"tag_name\"]}')
print(f'published: {r[\"published_at\"]}')
print(f'url: {r[\"html_url\"]}')
print(f'')
print(f'assets ({len(r.get(\"assets\",[]))}):')
for a in r.get('assets', []):
    size_mb = a['size'] / 1024 / 1024
    print(f'  - {a[\"name\"]:42s} {size_mb:>7.1f} MB')
"
```

Expected:
- 4 assets
- 사이즈 ~118 MB / 0 MB / 118 MB / 0 KB
- URL 클릭 시 release 페이지 정상 표시

---

## 8. 정리 + 자동 업데이트 검증 (5분)

### 8.1 임시 파일 정리

```bash
rm -rf /c/Temp/nost_vX_Y_Z
```

### 8.2 자동 업데이트 dry-run (선택)

기존 사용자 시점 확인 — 현재 설치된 nost (X.Y.Z-1) 실행하면:
1. 부팅 시 electron-updater 가 `latest.yml` fetch
2. version 비교 → 새 버전 감지
3. "vX.Y.Z 다운로드 중" 알림센터 표시
4. 다운로드 완료 → "vX.Y.Z 설치 준비 완료" + 재시작 버튼
5. 재시작 → 새 버전 실행
6. 부팅 시 stale "설치 준비 완료" 알림 자동 dismiss (v1.3.33+)

본인 PC 에서 확인 가능 — 트레이 아이콘 우클릭 → "업데이트 확인" 메뉴 또는 슬래시 `/setting` → 데이터 탭 → 업데이트.

---

## 🔥 자주 발생하는 실패 모드

### Failure 1 — `gh release create` 가 401
- 원인: gh CLI 미로그인. §7.1 진행.

### Failure 2 — Asset 업로드 후 자동 업데이트가 404
- 원인: `latest.yml` 의 파일명과 실제 업로드한 파일명 불일치.
- 확인: `latest.yml::path:` vs GitHub release 페이지 asset 이름.
- 해결: §5 의 sed 명령으로 latest.yml 수동 수정 후 재업로드 (`gh release upload --clobber`).

### Failure 3 — `electron-builder` 가 코드 사이닝 단계에서 멈춤
- 원인: 보통 antivirus 가 signtool.exe 차단. 또는 인증서 만료.
- 해결: Windows Defender / 백신 일시 비활성화 후 재시도.

### Failure 4 — 빌드는 됐는데 portable 만 누락
- 원인: `package.json::build.win.target` 에 `portable` 빠짐.
- 확인: targets 에 `["nsis", "portable"]` 둘 다 있는지.

### Failure 5 — git push 가 reject (non-fast-forward)
- 원인: 다른 세션 / 협업자가 main 에 새 커밋 푸시.
- 해결: `git pull --rebase origin main` 후 재시도.

### Failure 6 — 한글 경로 때문에 gh CLI 가 file not found
- 원인: bash가 D:/01_개인/... 경로의 공백+한글을 인자로 못 넘김.
- 해결: §5 처럼 /c/Temp/ ASCII 경로로 먼저 복사. 직접 한글 경로에서 업로드 시도 금지.

---

## 📊 릴리스 후 모니터링

배포 후 24~48시간:

- [ ] GitHub Release 페이지 download 카운트 증가 (자동 업데이트 풀)
- [ ] 사용자 신규 이슈 보고 — `gh issue list`
- [ ] electron-log 파일에서 update flow 에러 검색 (`%APPDATA%\nost\logs\main.log`)
- [ ] 만약 hotfix 필요 → patch bump (X.Y.Z+1) 후 본 runbook 재실행

---

## 참고 링크

- 이전 release 노트 톤: `gh release list --repo HwigwanJi/nost --limit 5`
- electron-builder 설정: `package.json::build` 필드
- 자동 업데이트 원리: `walkthrough_v2.md` §3 (자동 업데이트 + paths)
