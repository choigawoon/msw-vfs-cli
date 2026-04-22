# MSW VFS CLI — 명령 카탈로그

`msw-vfs` 의 모든 명령을 **역기획**해서 정리한 문서. 왜 이 명령이 존재하는지, 어느 레이어에 속하는지, 다른 명령과 어떤 관계인지를 밝힌다.

---

## 두 개의 멘탈 모델

`.map` / `.ui` / `.gamelogic` 에셋은 플랫 `Entities[]` 배열을 담은 JSON 이지만, VFS 레이어는 이를 두 가지 방식으로 동시에 노출한다:

| | Layer 1: **VFS (파일시스템 은유)** | Layer 2: **Entity/Component (GameObject 은유)** |
|---|---|---|
| 대상 | 디렉토리·파일 경로 | 엔티티·컴포넌트 |
| 은유 | Unix shell | Unity GameObject / Unreal Actor |
| 표현 | `entity/ ↔ dir`, `component.json ↔ file`, `_entity.json ↔ meta 파일` | `entity` 한 단위에 `{metadata, components[]}` |
| 사용처 | LLM 탐색·grep·batch | 뷰어 인스펙터·엔티티 CRUD |
| 입출력 단위 | 경로 1개 | 엔티티 1개 (번들) |

**두 레이어는 겹친다** — 같은 데이터를 다른 각도로 본다. 이 겹침이 혼란의 원인이 되므로, 각 명령이 어느 레이어인지 명확히 표기한다.

---

## Layer 1 — VFS 읽기 (bash-like)

경로 기반. 파이프/스크립팅 친화.

### `ls [path] [-l|--long] [--json]`
경로 아래 항목 나열. `-l`은 엔티티 디렉토리에 `[N comp, M child]` 태그 추가. `--json`은 구조화된 `LsItem[]` 출력(뷰어가 소비).

### `tree [path] [-d N | --depth N]`
유니코드 박스 드로잉으로 서브트리 출력. LLM 컨텍스트 한정용 `--depth` 필수.

### `read <path> [--raw] [--json] [--offset N] [--limit N]`
파일(=컴포넌트) 또는 엔티티 메타(`_entity.json`) 내용 출력. 기본은 컴팩트된 JSON(노이즈 키 제거) + 줄번호. `--raw`는 날것, `--json`은 머신리더블, `--offset/--limit`은 페이징.

### `glob <pattern> [path] [--max-results N]`
`*.json` 같은 fnmatch 패턴으로 파일 탐색.

### `grep <pattern> [path] [--head-limit N] [--output-mode content|files_with_matches|count]`
컴포넌트 값 안의 문자열 검색. 세 가지 출력 모드.

### `stat <path>`
경로의 메타데이터 — 엔티티면 id/componentNames/modelId, 파일이면 타입/사이즈. **컴포넌트 내용은 없음** (그래서 `read-entity` 가 필요한 이유).

### `summary`
파일 전체 요약 — entity_count, component_counts, scripts 등. 최상위 진입점.

### `validate`
무결성 검사 — 빈 id/path, 고아 엔티티 등. `{ok, warnings[]}` 리턴.

---

## Layer 2 — Entity/Component (GameObject 조작)

엔티티를 단위로 CRUD. 뷰어와 LLM 의 "엔티티 감각"을 직접 반영.

### `add-entity <parent> <name> [-c Type ...] [--model-id ID] [--disabled] [--invisible] [-o out]`
자식 엔티티 추가. GUID·path·componentNames 자동 채움. `-c`로 컴포넌트를 여러 개 붙일 수 있다.

### `remove-entity <path> [-o out]`
엔티티와 서브트리 제거. 자식·형제 displayOrder reindex.

### `edit-entity <path> --set key=value [...] [-o out]`
**엔티티 메타만** 수정 (enable / visible / name / displayOrder / modelId / …). 컴포넌트 값은 건드리지 않음. `edit`와 헷갈리지 말 것 — `edit`는 경로로, `edit-entity`는 엔티티 디렉토리 경로로.

### `rename-entity <path> <new-name> [-o out]`
엔티티 이름 + path 동시 업데이트. 자식 path 재구성 포함.

### `add-component <entity> <Type> [--properties JSON] [-o out]`
엔티티에 컴포넌트 추가. `--properties`로 초기값 주입 가능.

### `remove-component <entity> <Type> [-o out]`
엔티티에서 컴포넌트 떼어내기.

### `edit <path> --set key=value [...] [-o out]`
**컴포넌트(또는 임의 경로)** 값 수정. `key=value`는 JSON 파싱 우선, 실패 시 raw string. `edit-entity`와 역할 분리됨 — 컴포넌트면 `edit`, 엔티티 메타면 `edit-entity`.

---

## ⚠️ `edit` vs `edit-entity` — 가장 헷갈리는 경계

| 수정 대상 | 명령 | 경로 형태 |
|---|---|---|
| 컴포넌트 값 (`Enable`, `Position`, …) | `edit` | `/maps/map01/Hero/TransformComponent.json` |
| 엔티티 메타 (`enable`, `visible`, `name`, `displayOrder`) | `edit-entity` | `/maps/map01/Hero` |

뷰어 Tauri 브릿지(`lib.rs::vfs_edit`)는 이 분기를 자동화한다 — 경로가 `_entity.json`으로 끝나면 `edit-entity`로 라우팅. CLI 직접 사용 시에는 사용자가 선택해야 함.

---

## 🆕 제안: `read-entity`

`stat`이 메타+componentNames **리스트**만 주기 때문에, 엔티티 하나 전체를 보려면 컴포넌트 수만큼 `read`를 반복해야 한다. LLM도 뷰어도 같은 고통.

```
read-entity <path> [--json]
```

출력:

```json
{
  "path": "/maps/map01/Hero",
  "metadata": { "id": "...", "name": "Hero", "enable": true, ... },
  "components": {
    "MOD.Core.TransformComponent": { "Position": [0,0,0], ... },
    "MOD.Core.SpriteRendererComponent": { ... }
  }
}
```

확장:
- `read-entity <path> --deep` — 자식 엔티티까지 재귀 번들 (서브트리 전체 dump). 맵 전체를 한 번에 읽고 싶을 때.

**기존 명령 영향 없음** — additive.

---

## Model 계열 (`.model` 전용)

`.model`은 엔티티 트리가 없는 별개 자산 — 키-값 테이블 형태의 오버라이드. 레이어 개념이 안 맞아서 독립 서브커맨드 세트.

| 명령 | 역할 |
|---|---|
| `info` | 어셈블리/베이스 모델/metadata |
| `list` | Values[] 전체 (name, type, value) |
| `get <name> [--target-type T]` | 단일 값 조회 |
| `set <name> <json> [--type T] [--target-type T] [-o out]` | 값 쓰기 (int/float/string/bool/vector2,3/color/quaternion/dataref) |
| `remove <name> [--target-type T] [-o out]` | 값 삭제 |
| `validate` | 타입 일관성 검사 |

Python 호환: `set speed 5` → int32, `set speed 5.0` → single(float). `--type`으로 강제 가능.

---

## YAML / World

선언형 포맷과 에셋 사이 왕복.

### `export-yaml [-o out.yaml] [--data-dir DIR]`
`.map`/`.ui`/`.gamelogic` → YAML. `--data-dir` 주면 무거운 엔티티는 별도 YAML로 분리.

### `import-yaml [-o out.map]`
역방향. 출력 타입은 YAML의 `meta.ContentType` / `asset_type`로 자동 감지.

### `--type world <world.yaml> build-world -o <dir> [-f values.yaml ...]`
선언형 `world.yaml` 한 개로 맵·UI·gamelogic 트리 전체 생성. `-f` 여러 번으로 values 오버라이드 딥머지.

---

## 퍼시스턴트 모드

한 번 시작하면 여러 호출이 Node 콜드 스타트 비용을 아낀다.

### `daemon [--port N] [--host H] [--idle-ms N] [--detach] [--quiet]`
HTTP 데몬. 살아있으면 일반 명령이 자동 프록시(`MSW_VFS_NO_DAEMON=1`로 우회 가능). `--detach`로 백그라운드.

### `stop` / `status`
데몬 제어.

### `serve`
stdin/stdout 파이프. 한 줄에 `{"argv":[...]}` JSON을 받고 `{"stdout","stderr","code"}` 응답. MCP-스타일 어댑터 만들 때 유용.

---

## 전역 옵션

| 플래그 | 효과 |
|---|---|
| `--type <map\|ui\|gamelogic\|model\|world>` | 확장자 감지 우회. YAML 파일에 필수. |
| `--help`, `-h` | USAGE 출력 |
| `--version`, `-v` | 버전 |
| 환경: `MSW_VFS_NO_DAEMON=1` | 프록시 비활성화 (뷰어 Tauri 브릿지가 항상 설정) |

---

## 레이어 매핑 빠른 참조

동일 연산을 두 레이어에서 본 예시:

| 목표 | Layer 1 (VFS) | Layer 2 (Entity) |
|---|---|---|
| Hero 엔티티 전체 보기 | `ls /maps/map01/Hero -l` + N× `read` | `read-entity /maps/map01/Hero` ✨ |
| Hero 의 Transform 위치 바꾸기 | `edit /maps/map01/Hero/TransformComponent.json --set Position='[1,0,0]'` | (동일, 컴포넌트 단위 연산) |
| Hero 비활성화 | `edit-entity /maps/map01/Hero --set enable=false` | (동일) |
| 새 적 추가 | — (어색) | `add-entity /maps/map01 Enemy -c MOD.Core.TransformComponent` |
| "BossRush" 포함 값 찾기 | `grep BossRush /` | — (어색) |

→ **탐색·검색은 Layer 1, 엔티티 단위 CRUD는 Layer 2** 라는 기준으로 선택.

---

## 작성 당시 버전

`@choigawoon/msw-vfs-cli` 0.3.0 기준. 변경 시 이 문서와 `CHANGELOG.md` 동기화.
