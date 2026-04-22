# 로컬 동작 테스트 체크리스트

릴리스 전 CLI(`msw-vfs`) 와 뷰어(`msw-vfs-viewer`)를 로컬에서 검증하는 순서.

> 모노레포 루트에서 `npm ci`가 한 번 끝나 있다고 가정 — CLI와 뷰어의 의존성이
> 모두 설치된다. 경로 예시는 macOS 기준, Windows는 `%TEMP%` 등으로 치환.
> Git Bash에서 `/` 인자 전달 시 `export MSYS_NO_PATHCONV=1` 선행.

## 0. CLI 준비

```bash
npm run build:cli
# 모노레포 루트에서 npm link가 없으면 node 경로 직접 호출
alias msw-vfs="node $(pwd)/packages/cli/bin/cli.js"

msw-vfs --version    # matches packages/cli/package.json
msw-vfs --help       # USAGE splits into "Primary — entity-oriented" + "Advanced — VFS"
```

전역 설치 검증이 필요하면:

```bash
npm install -g ./packages/cli
which msw-vfs
```

## 1. Layer 2 — entity-oriented (primary, .map)

```bash
MAP=/path/to/benchmark-games/2.SimpleBossRush/map/map01.map

msw-vfs "$MAP" summary
# → tile_map_mode, entity_count, component_counts, scripts

msw-vfs "$MAP" list-entities /maps/map01
# → 각 자식 엔티티 path · [Nc Me] · name <modelId>

msw-vfs "$MAP" list-entities / -r --json | head -c 400
# → recursive + 구조화 JSON

msw-vfs "$MAP" read-entity /maps/map01/BG
# → { path, name, metadata, components: { "MOD.Core....": {...} } }

msw-vfs "$MAP" find-entities "BG" --by name
msw-vfs "$MAP" find-entities "TransformComponent" --by component
msw-vfs "$MAP" grep-entities "Enable"
```

## 2. Layer 1 — VFS / file-level (advanced, .map)

```bash
msw-vfs "$MAP" ls / -l
msw-vfs "$MAP" ls /maps/map01 -l
msw-vfs "$MAP" tree / -d 3
msw-vfs "$MAP" stat /maps/map01/BossRushManager
msw-vfs "$MAP" read /maps/map01/BG/TransformComponent.json --limit 20
msw-vfs "$MAP" glob "*Component.json" /maps --max-results 10
msw-vfs "$MAP" grep "BossRush" / --head-limit 5
msw-vfs "$MAP" grep "script" / --output-mode count
```

## 3. 읽기 명령 (.ui / .model)

```bash
UI=/path/to/benchmark-games/2.SimpleBossRush/ui/DefaultGroup.ui
msw-vfs "$UI" summary
msw-vfs "$UI" list-entities /
msw-vfs "$UI" read-entity /<첫 엔티티 path>

MODEL=/path/to/benchmark-games/1.Defence/Global/DefaultPlayer.model
msw-vfs "$MODEL" summary     # 뷰어 호환 요약 (asset_type:model, values_count)
msw-vfs "$MODEL" info
msw-vfs "$MODEL" list
msw-vfs "$MODEL" list --json | head -c 300
msw-vfs "$MODEL" get speed
msw-vfs "$MODEL" validate
```

## 4. Mutation — 원본 보호를 위해 항상 복사본에 작업

```bash
SRC=/path/to/benchmark-games/2.SimpleBossRush/map/map01.map
TMP=$(mktemp -t msw-test).map
cp "$SRC" "$TMP"

msw-vfs "$TMP" add-entity /maps/map01 TestEnemy \
  -c MOD.Core.TransformComponent -c MOD.Core.SpriteRendererComponent
# L2: edit by (entity, @type) — 뷰어가 쓰는 경로
msw-vfs "$TMP" edit-component /maps/map01/TestEnemy MOD.Core.TransformComponent \
  --set Enable=false
# L1: edit by file path — 같은 @type이 2개 이상일 때 탈출구
msw-vfs "$TMP" edit /maps/map01/TestEnemy/TransformComponent.json --set Enable=true
msw-vfs "$TMP" edit-entity /maps/map01/TestEnemy --set visible=false
msw-vfs "$TMP" ls -l /maps/map01
msw-vfs "$TMP" stat /maps/map01/TestEnemy
msw-vfs "$TMP" rename-entity /maps/map01/TestEnemy TestEnemy2
msw-vfs "$TMP" add-component /maps/map01/TestEnemy2 MOD.Core.FootholdComponent
msw-vfs "$TMP" remove-component /maps/map01/TestEnemy2 MOD.Core.SpriteRendererComponent
msw-vfs "$TMP" remove-entity /maps/map01/TestEnemy2
msw-vfs "$TMP" validate
rm -f "$TMP"
```

## 5. Model 파라미터 튜닝

```bash
SRC=/path/to/benchmark-games/1.Defence/Global/DefaultPlayer.model
TMP=$(mktemp -t msw-test).model
cp "$SRC" "$TMP"

msw-vfs "$TMP" set speed 5.5            # single (float)
msw-vfs "$TMP" set jumpForce 3          # int32
msw-vfs "$TMP" set jumpForce 3 --type single
msw-vfs "$TMP" set startPos '[1.5, 2.5]'
msw-vfs "$TMP" set bgRef '{"DataId":"abc"}' --type dataref
msw-vfs "$TMP" list
msw-vfs "$TMP" remove bgRef
msw-vfs "$TMP" validate
rm -f "$TMP"
```

## 6. YAML round-trip

```bash
MAP=/path/to/benchmark-games/2.SimpleBossRush/map/map01.map
YOUT=$(mktemp -t rt).yaml
MOUT=$(mktemp -t rt).map

msw-vfs "$MAP" export-yaml -o "$YOUT"
msw-vfs "$YOUT" import-yaml -o "$MOUT"
diff <(msw-vfs "$MAP" summary) <(msw-vfs "$MOUT" summary)
# → "file" 필드만 달라야 함

rm -f "$YOUT" "$MOUT"
```

## 7. build-world (선언형 world.yaml)

```bash
WY=/path/to/world.yaml
OUT=$(mktemp -d -t built-world)
msw-vfs --type world "$WY" build-world -o "$OUT"

for f in "$OUT"/map/*.map "$OUT"/ui/*.ui "$OUT"/Global/*.gamelogic; do
  echo "--- $f ---"
  msw-vfs "$f" validate
done
rm -rf "$OUT"
```

## 8. 실패 케이스 — exit code / 메시지

```bash
msw-vfs nonexistent.map summary               # → 파일 없음
msw-vfs ./random.txt summary                  # → 타입 감지 실패
msw-vfs "$MAP" ls /nonexistent/path           # → 경로 없음

TMP=$(mktemp -t bad).map
echo '{"ContentProto":{"Entities":[{"id":"","path":""}]}}' > "$TMP"
msw-vfs "$TMP" validate     # → warnings 출력
rm -f "$TMP"
```

## 9. 퍼시스턴트 모드

```bash
msw-vfs daemon --detach
msw-vfs status
msw-vfs "$MAP" summary       # 데몬으로 자동 프록시
msw-vfs stop

# stdin 파이프
echo '{"argv":["'"$MAP"'","summary"]}' | msw-vfs serve
```

## 10. vitest 전체

```bash
npm test                     # packages/cli 하위 161 tests (map/ui/model/cli + entity-l2 + entity-model)
```

## 11. 뷰어(Tauri) 개발 실행

Rust 툴체인 + 플랫폼 WebView 의존성 필요 (macOS는 Xcode CLT, Windows는 WebView2).

```bash
npm run dev:viewer
# → Vite 1420 + Tauri 창 부팅
# 포트 점유되면: lsof -ti:1420 | xargs kill -9
```

뷰어는 `packages/viewer/src-tauri/src/lib.rs::resolve_cli`이 모노레포 내
`packages/cli/bin/cli.js`를 자동으로 찾으므로 별도 link 불필요. CLI 소스 변경
시 `npm run build:cli` 후 뷰어 새 동작 확인.

뷰어 프로덕션 번들:

```bash
npm run build:viewer         # vite build
cd packages/viewer && npx tauri build
# → macOS: .app / .dmg, Windows: .msi
```

> 현재 번들은 **호스트에 Node가 있어야** CLI를 스폰할 수 있음(Tauri sidecar 미적용 — P5).

## 릴리스

### CLI → npm (OIDC Trusted Publishing)

```bash
git tag cli-v0.4.0    # 또는 legacy v0.4.0
git push origin cli-v0.4.0
```

GitHub Actions의 `Release CLI` 워크플로우가 Node 24 + 최신 npm에서 OIDC로
`npm publish --provenance`. `NPM_TOKEN` 비밀은 사용하지 않음 — `id-token:
write` 권한만 필요. npm ≥ 11.5.1이 트러스티드 퍼블리싱 전제.

공개 후 확인:

```bash
npm view @choigawoon/msw-vfs-cli
npm install -g @choigawoon/msw-vfs-cli
msw-vfs --version
```

### 뷰어 → GitHub Releases

```bash
git tag viewer-v0.1.0
git push origin viewer-v0.1.0
```

`Release Viewer` 워크플로우가 macOS(universal) + Windows(x64) 인스톨러를
draft 릴리스에 업로드. 코드 사인 미적용 상태이므로 다운로드자는 macOS
"알 수 없는 개발자" / Windows SmartScreen 경고를 우회해야 함.
