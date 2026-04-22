# MSW VFS CLI — 명령 카탈로그

`msw-vfs` 의 모든 명령을 **역기획**해서 정리한 문서. 왜 이 명령이 존재하는지, 어느 레이어에 속하는지, 다른 명령과 어떤 관계인지를 밝힌다.

---

## 두 개의 멘탈 모델

`.map` / `.ui` / `.gamelogic` 에셋은 플랫 `Entities[]` 배열을 담은 JSON 이지만, CLI는 이를 두 가지 각도에서 동시에 노출한다:

| | Layer 1: **VFS (파일시스템 은유)** | Layer 2: **Entity/Component (GameObject 은유)** |
|---|---|---|
| 대상 | 디렉토리·파일 경로 | 엔티티·컴포넌트 |
| 은유 | Unix shell | Unity GameObject / Unreal Actor |
| 표현 | `entity/ ↔ dir`, `component.json ↔ file`, `_entity.json ↔ meta 파일` | `entity` 한 단위에 `{metadata, components[]}` |
| 주 사용처 | LLM grep·batch·파이프라인 | 뷰어 인스펙터·엔티티 CRUD·LLM 엔티티 단위 작업 |
| 입출력 단위 | 경로 1개 | 엔티티 1개 (번들) |
| 릴리스 상태 | 기존 (스킬과 호환성 유지 목적) | 0.4.0 신규 — **Primary** |

**두 레이어는 겹친다** — 같은 데이터를 다른 각도로 본다. 이 겹침이 혼란의 원인이 되므로, 각 명령이 어느 레이어인지 명확히 표기한다. 새 코드는 L2부터 고려하고, L2로 표현 어색한 탐색·grep이면 L1로 내려간다.

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

엔티티를 단위로 읽기/편집/CRUD. 뷰어와 LLM 의 "엔티티 감각"을 직접 반영. L1보다 먼저 고려할 것 — Primary API.

### 읽기 · 탐색

#### `read-entity <path> [--deep] [--compact]`
엔티티 하나를 **한 방에** 번들해서 리턴 — 메타데이터 + 모든 컴포넌트를 `@type`로 키잉. `stat`이 componentNames 리스트만 주던 문제를 해결. `--deep`은 자식 엔티티까지 재귀, `--compact`은 노이즈 키 제거.

```json
{
  "path": "/maps/map01/Hero",
  "name": "Hero",
  "metadata": { "id": "...", "enable": true, "visible": true, ... },
  "components": {
    "MOD.Core.TransformComponent": { "Position": [0,0,0], ... },
    "MOD.Core.SpriteRendererComponent": { ... }
  }
}
```

#### `list-entities [path] [-r|--recursive] [--json]`
`path` 아래 **엔티티만** 나열 (컴포넌트 파일·`_entity.json` 숨김). 비-엔티티 디렉토리(`/maps/`, `/ui/`)는 투명하게 지나가 실제 엔티티 레이어를 반환 — 즉 `list-entities /` 하면 root 밑 passthrough를 넘어 첫 엔티티 층이 바로 나온다. 각 항목은 `{ path, name, components[], children_count, modelId? }`.

#### `find-entities <pattern> [--by name|component|modelId] [--path START]`
엔티티를 **이름 / 컴포넌트 @type / modelId**로 검색 (case-insensitive regex). 기본은 `--by name`. `--path`로 시작 경로 지정.

#### `grep-entities <pattern> [path] [--head-limit N]`
컴포넌트 값 검색을 **엔티티 단위로 그룹핑**해서 리턴 — `grep`(L1)이 파일 경로 기준으로 평면 출력하는 것과 대비.

### 편집

#### `edit-entity <path> --set key=value [...] [-o out]`
**엔티티 메타만** 수정 (enable / visible / name / displayOrder / modelId / …). 컴포넌트 값은 건드리지 않음.

#### `edit-component <entity> <@type> --set key=value [...] [-o out]`
`(엔티티 경로, 컴포넌트 @type)` 튜플로 컴포넌트 값 수정. 같은 `@type`이 한 엔티티에 0개면 에러, 2개 이상이면 모호성 에러(+파일명 안내) → L1 `edit <path>`로 폴백.

### CRUD

#### `add-entity <parent> <name> [-c Type ...] [--model-id ID] [--disabled] [--invisible] [-o out]`
자식 엔티티 추가. GUID·path·componentNames 자동 채움. `-c`로 컴포넌트를 여러 개 붙일 수 있다.

#### `remove-entity <path> [-o out]`
엔티티와 서브트리 제거. 자식·형제 displayOrder reindex.

#### `rename-entity <path> <new-name> [-o out]`
엔티티 이름 + path 동시 업데이트. 자식 path 재구성 포함.

#### `add-component <entity> <Type> [--properties JSON] [-o out]`
엔티티에 컴포넌트 추가. `--properties`로 초기값 주입 가능.

#### `remove-component <entity> <Type> [-o out]`
엔티티에서 컴포넌트 떼어내기.

---

## ⚠️ `edit` vs `edit-entity` vs `edit-component` — 세 편집 명령

| 수정 대상 | 명령 | 경로/인자 형태 | 레이어 |
|---|---|---|---|
| 엔티티 메타 (`enable`, `visible`, `name`, `displayOrder`) | `edit-entity` | `<엔티티 경로>` | L2 |
| 컴포넌트 값, (엔티티, @type) 튜플로 | `edit-component` | `<엔티티 경로> <@type>` | L2 |
| 컴포넌트 값, 파일 경로로 | `edit` | `<경로>.json` | L1 |

뷰어는 전부 L2 경로를 사용 — Inspector에서 Entity 카드 편집은 `edit-entity`, 컴포넌트 카드 편집은 `edit-component`. L1 `edit`는 같은 `@type` 컴포넌트가 한 엔티티에 2개 이상인 모호성 상황의 탈출구.

---

## Model 계열 (`.model` — 엔티티 템플릿)

`.model`은 런타임에 엔티티 한 개로 인스턴스화되는 **entity 템플릿**. 엔티티 트리 대신 `Values[]` 오버라이드 테이블을 갖는 별도 자산 — 자체 서브커맨드 세트로 처리.

| 명령 | 역할 |
|---|---|
| `info` | 어셈블리 / baseModel / metadata 상세 |
| `summary` | 뷰어 호환 공통 요약 (asset_type, name, model_id, base_model_id, values_count) |
| `list` | `Values[]` 전체 (name, type, value). `--json`으로 `ModelListItem[]` 머신 출력 |
| `get <name> [--target-type T]` | 단일 값 조회 |
| `set <name> <json> [--type T] [--target-type T] [-o out]` | 값 쓰기 (single/int32/int64/string/boolean/vector2/vector3/color/quaternion/dataref) |
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

`@choigawoon/msw-vfs-cli` 0.4.0 (Unreleased) 기준. 변경 시 이 문서와 `CHANGELOG.md` 동기화.

## 내부 구조 (요약)

- **`EntryParser`** (`src/entry/parser.ts`) — MSW 엔트리(파일) 공통 계약: `type` / `filePath` / `isDirty` / `validate()` / `save()`.
  - `EntitiesEntryParser` (base) ⊃ `MapEntryParser` / `UIEntryParser` / `GameLogicEntryParser` — entity 컨테이너 (`.map` / `.ui` / `.gamelogic`).
  - `ModelEntryParser` — entity 템플릿 (`.model`).
- **`EntityModel`** (`src/entity/model.ts`) — entity 기반 entry 위에 얹힌 L2 파사드. 뷰어/LLM이 GameObject 단위로 사고할 때 사용.
- **CLI 핸들러**는 레이어별 분리:
  - `src/cli/vfs-handlers.ts` — L1
  - `src/cli/entity-handlers.ts` — L2
  - `src/cli/model-handlers.ts` — .model
  - `src/cli.ts` — 디스패처
