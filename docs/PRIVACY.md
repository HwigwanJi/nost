# nost Bridge — Privacy Policy / 개인정보처리방침

**Last updated / 최종 업데이트:** 2026-04-20

## English

**nost Bridge** is a browser extension that connects to the **nost** desktop launcher running on the same computer. It is a local-only integration — no data ever leaves your machine.

### What we collect
**Nothing.** The extension does not collect, store, transmit, or share any personal data, browsing history, credentials, or analytics.

### How it works
The extension reads the **title** and **URL** of your currently active browser tab and sends them exclusively to `http://127.0.0.1:14502`, a loopback (localhost) address served by the nost desktop application running on your own machine. The data never crosses your local network and never reaches any external server.

### Permissions used
- `tabs`, `activeTab` — to read the title/URL of the current tab so nost can display and focus it.
- `host_permissions` for `http://127.0.0.1:14502/*` — strictly the local loopback address of the nost desktop application. No other hosts are contacted.

### Third-party services
None. No analytics, no telemetry, no advertising, no external APIs.

### Contact
Issues or questions: <https://github.com/HwigwanJi/nost/issues>

---

## 한국어

**nost Bridge**는 같은 컴퓨터에서 실행 중인 **nost** 데스크톱 런처와 브라우저 탭을 연동하는 확장 프로그램입니다. 모든 통신은 로컬 루프백 내에서만 이루어지며, 데이터가 사용자 기기 외부로 나가지 않습니다.

### 수집하는 정보
**없음.** 본 확장은 어떠한 개인정보, 방문 기록, 자격 증명, 분석 데이터도 수집·저장·전송·공유하지 않습니다.

### 동작 방식
확장은 현재 활성 탭의 **제목**과 **URL**을 읽어 `http://127.0.0.1:14502`(사용자 본인 컴퓨터에서 실행 중인 nost 데스크톱 앱이 수신하는 루프백 주소)로만 전송합니다. 이 데이터는 로컬 네트워크를 벗어나지 않으며, 외부 서버에 도달하지 않습니다.

### 사용 권한
- `tabs`, `activeTab` — 현재 탭의 제목과 URL을 nost 런처에 표시·포커스하기 위함.
- `host_permissions` (`http://127.0.0.1:14502/*`) — nost 데스크톱 앱의 로컬 루프백 주소로만 한정. 다른 도메인으로의 통신 없음.

### 제3자 서비스
없음. 분석 도구, 원격 측정, 광고, 외부 API 일절 사용 안 함.

### 문의
<https://github.com/HwigwanJi/nost/issues>
