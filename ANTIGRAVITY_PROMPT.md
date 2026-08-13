# 프랜차이즈 인사·근태·급여 시스템 — Google Antigravity 인계 프롬프트

이 문서를 Google Antigravity IDE의 첫 대화에 그대로 붙여넣고, 이 프로젝트 폴더(압축 해제한 `급여/`)를 워크스페이스로 열어서 이어서 작업해주세요.

---

## 0. 지금까지 진행 상황 (요약)

- **목표**: 프랜차이즈 외식업 본사가 매장(10개 이상)의 정직원·아르바이트·일용직 인사·근태를 관리하고, 한국 노동법을 준수하는 급여 계산까지 자동화하는 웹앱
- **기술 스택**: React 18 + Vite + Tailwind CSS + lucide-react 아이콘
- **현재 단계**: UI/UX 프로토타입은 디자인·색상·인터랙션까지 확정 완료. 지금까지는 `src/mockService.js`(로컬 useState 기반 목업)로 전체 워크플로우를 동작 검증했음
- **다음 단계 (이번 세션의 핵심 요청)**: **Firebase(Firestore + Auth)를 실제로 연동**해서 mockService를 대체하고, 프로덕션에 가까운 데이터베이스 연동 웹앱으로 완성
- **절대 바꾸지 말아야 할 것**: 현재 UI 디자인, 색상 시스템, 인터랙션 구조, 화면 레이아웃 — 이건 이미 확정되었고 사용자가 마음에 들어함. Firebase 연동은 **로직만 교체**하고 화면은 그대로 유지해야 함

---

## 1. UI/디자인 시스템 (그대로 유지할 것)

### 색상 팔레트
| 용도 | 색상 코드 / 클래스 |
|---|---|
| 상단바 배경 | `#16213E` (다크 네이비) |
| 상단바 포인트 아이콘 | `#7FB3A3` (세이지 그린) |
| 주요 버튼/포커스 | `#16213E` (hover: `#1f2d52`) |
| 확인/성공 상태 | `emerald-50/600/700` (에메랄드) |
| 대기/경고 상태 | `amber-50/600/700` (앰버) |
| 오류/위험 상태 | `red-50/600/700` |
| 잠김/비활성 상태 | `slate-50/100/400` (슬레이트 그레이) |
| 카드 배경 | `white`, 테두리 `slate-200` |
| 전체 배경 | `slate-50` |
| 본문 폰트 | `'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif` |

### 레이아웃 구조
- 상단바: 다크 네이비 바 + 아이콘 + 타이틀/서브타이틀(좌) + 안내문구(우)
- 역할 탭(4개): 매장(점장) / 회계팀 / 인사팀 / 본사 대시보드 — 각 탭에 대기건수 배지 표시
- 매장 화면: 사원등록/근태입력 서브탭, 2컬럼 그리드(입력폼 + 현황 리스트)
- 회계팀/인사팀 화면: 단일 컬럼 카드 리스트, 각 항목에 확인 버튼
- 본사 대시보드: 3컬럼 요약 카드 + 하단 상세 리스트 섹션들
- 토스트 알림: 화면 우하단 고정, 성공(슬레이트 다크)/실패(레드) 구분
- 게이트 상태 뱃지(`GatePill`): 매장입력 → 회계팀 → 인사팀 단계를 아이콘+색상으로 시각화, 회계팀 미확인 시 인사팀 뱃지는 자물쇠 아이콘으로 "잠김" 표시

이 톤앤매너, 컴포넌트 구조(`Field`, `Select`, `DocChip`, `SummaryCard`, `StageBadge`, `GatePill`)를 그대로 재사용하면서 데이터 소스만 Firebase로 교체해주세요.

---

## 2. 사용자 역할 (권한 구조)

| 역할 | 권한 |
|---|---|
| 매장(점장) | 사원등록 최초 입력, 근태 당일 입력·수정 |
| 회계팀 (본사) | 사원등록 중 이름/주민번호/계좌번호/연락처 확인. **인사팀보다 먼저 확인해야 하는 게이트 역할** |
| 인사팀 (본사) | 사원등록 중 보건증/근로계약서 확인. **회계팀 확인이 끝난 건만 조회 가능** |
| 본사 대시보드 | 전체 현황 조회, 각종 알림 확인 |

## 3. 핵심 워크플로우 (게이트 로직 — 반드시 유지)

```
매장 입력 (이름/주민번호/계좌번호/연락처/입사일 + 서류 첨부)
  → 계좌번호·주민번호·핸드폰 중복 검증 (중복 시 등록 자체 차단)
  → 회계팀 확인 대기 상태
  → 회계팀이 확인 버튼 클릭 (accountingConfirmed = true)
      ※ 이 시점 전까지는 인사팀 조회 쿼리에서 아예 제외되어야 함
  → 인사팀 확인 대기 상태로 전환
  → 인사팀이 확인 버튼 클릭 (hrConfirmed = true)
  → 등록 확정, 이때부터 근태입력 대상 명단에 포함
```
- 등록 후 매장 사용자는 사원 문서를 수정할 수 없음 (Firestore 보안 규칙에서 원천 차단)
- 근태입력: 당일 입력분은 매장 수정 가능, 당일이 지나면 회계팀만 수정 가능
- 근무시간 입력 3방식 모두 지원: 시작만(자동 10h) / 시작+총시간 / 시작+종료(자동계산)
- 알바 주간 누적 근로시간 실시간 경고 (10h 이상 주의, 15h 이상 위험 — 주휴수당·퇴직금 발생 조건)

---

## 4. 이번 세션 요청사항 — Firebase 연동

**⚠️ Firebase 프로젝트가 아직 생성되지 않았습니다.** 첫 단계로 아래 중 하나를 진행해주세요:
- Antigravity가 Firebase CLI(`firebase login`, `firebase projects:create`, `firebase init firestore` 등)로 프로젝트 생성부터 안내/자동화 가능한지 확인하고, 가능하면 그 방식으로 진행
- CLI 자동화가 어렵다면, Firebase 콘솔(https://console.firebase.google.com)에서 사용자가 직접 프로젝트를 만들어야 하는 정확한 단계(프로젝트 생성 → 웹앱 등록 → Firestore 활성화 → Authentication 활성화 → firebaseConfig 값 확인)를 순서대로 안내
- 어느 방식이든, 프로젝트 생성 직후 **Firestore Database**와 **Authentication**(이메일/비밀번호 또는 필요한 방식)을 반드시 활성화하도록 안내

1. **`firebaseService.js`를 실제 동작하도록 완성**해주세요.
   - 현재 `firebaseConfig`는 플레이스홀더입니다. 위 단계에서 얻은 실제 값으로 채워야 합니다.
   - `registerEmployee`, `confirmAccounting`, `confirmHr`, `submitAttendance`, `listPendingHrEmployees`, `listConfirmedEmployees`, `getWeeklyHours`, `getDashboardAlerts`, `checkDuplicate` 함수가 이미 Firestore 호출 형태로 작성되어 있습니다 (아래 전체 코드 참고). 다만:
     - `confirmAccounting`은 계좌번호/직급/부서 등 추가 필드를 함께 저장할 수 있도록 3번째 인자(`extra` 객체)를 받아 병합 업데이트하도록 확장해야 합니다 (mockService.js는 이미 이렇게 구현되어 있음 — 동일하게 맞춰주세요).
     - `confirmHr`도 서류 체크리스트(`documents` 객체)를 3번째 인자로 받아 저장하도록 확장 필요.
     - "회계팀확인대기 목록 조회" 함수가 firebaseService.js에는 아직 없습니다 (`listPendingAccountingEmployees` — `accountingConfirmed == false`로 필터). mockService.js에는 있으니 동일하게 추가해주세요.
2. **`src/payroll_flow_prototype.jsx`의 데이터 로직을 Firebase 연동으로 교체**하되, 위 1번 섹션의 UI/디자인은 절대 변경하지 마세요. 현재는 컴포넌트 내부 `useState`로 employees/attendance를 관리하는 구조인데, 이를 Firestore 실시간 구독(`onSnapshot`) 또는 위 서비스 함수 호출 기반으로 바꿔주세요.
3. **Firebase Auth 연동**: 현재 역할(role)은 화면 상단 탭으로 그냥 전환하는 데모 방식입니다. 실전에서는 Firebase Auth 로그인 + 커스텀 클레임(`role`, `storeCode`)으로 실제 권한을 제어해야 합니다. `firestore.rules`는 이미 이 구조를 전제로 작성되어 있습니다 (아래 전체 규칙 참고). 로그인 화면 및 커스텀 클레임 설정 방법(Cloud Functions에서 관리자 지정)까지 설계해주세요.
4. **Firestore 보안 규칙 배포**: `firestore.rules` 파일을 그대로 Firebase 프로젝트에 배포할 수 있도록 안내해주세요.
5. **데이터 모델은 `PROJECT_SPEC.md`의 4번 섹션(`employees`, `attendance`, `naverWorksSync` 컬렉션)을 기준**으로 하되, 필요시 개선 제안 가능.
6. 1단계 범위(사원등록 게이트 워크플로우, 근태입력, 필수 검증 로직, Firebase 연동)에 집중하고, 급여 계산 자동화·고급 알림은 2단계로 남겨주세요 (`PROJECT_SPEC.md` 5-3~5-8 참고).

---

## 5. 프로젝트 파일 구조

```
급여/
├── ANTIGRAVITY_PROMPT.md   (이 문서)
├── PROJECT_SPEC.md          (원본 요구사항 스펙)
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── index.html
├── firebaseService.js       (Firebase 연동 서비스 레이어 — 완성 필요)
├── firestore.rules          (Firestore 보안 규칙 — 완성됨)
├── .claude/launch.json      (개발 서버 실행 설정, Antigravity에서는 무시해도 됨)
└── src/
    ├── main.jsx
    ├── styles.css            (Tailwind 지시어)
    ├── payroll_flow_prototype.jsx  (메인 UI 컴포넌트 — 디자인 확정본)
    └── mockService.js        (로컬 목업 서비스 — Firebase 연동 완료 후 제거 예정)
```

## 6. 실행 방법

```bash
npm install
npm run dev
```
개발 서버는 기본적으로 `http://localhost:5173` (포트 사용 중이면 5174 등으로 자동 전환)에서 실행됩니다.

## 7. 확인이 필요한 미결 사항 (PROJECT_SPEC.md 6번 섹션 발췌)

아래 항목은 하드코딩하지 말고 설정값(config)으로 분리해서, 나중에 값만 바꿔 끼울 수 있게 해주세요.
1. 연차 산정 기준 (회계연도 일괄 vs 입사일 기준 개별 산정)
2. 일용직 → 아르바이트 전환 기준
3. 일용직 주휴수당 발생 여부/조건
4. 일용직 시급 고정값 여부
5. 정직원 근태 매장입력 → 본사승인 워크플로우 적용 여부
6. 알바 주간 경고 임계값 정확한 수치 및 도달 시 조치
7. 아르바이트 하루 근무 초과 가산 적용 기준 시간
8. 장기요양보험료 요율 (스코프 밖일 수 있음)

---

**요약**: 화면 디자인은 완성됐으니 절대 건드리지 말고, `mockService.js`로 되어있는 데이터 계층을 실제 Firebase Firestore + Auth 연동으로 교체해주세요. 시작 전에 Firebase 프로젝트 생성 방식(콘솔 수동 설정 vs CLI 자동화)을 저에게 먼저 물어봐주세요.
