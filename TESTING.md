# CLI 동작 테스트 체크리스트

실제 배포 전 로컬에서 `msw-vfs` 커맨드를 CLI로 검증.
`npm link` 완료 상태 가정 — 어느 디렉토리에서나 `msw-vfs` 호출 가능.

> **Git Bash 주의**: `/` 경로 인자가 포함된 명령은 `export MSYS_NO_PATHCONV=1` 먼저
> 실행하거나, 각 명령 앞에 `MSYS_NO_PATHCONV=1`을 붙인다. PowerShell/CMD/WSL은 불필요.

## 0. 전역 설치 확인

```bash
which msw-vfs        # /c/Program Files/nodejs/msw-vfs (Windows) 또는 /usr/local/bin/msw-vfs
msw-vfs --version    # 0.1.0
msw-vfs --help       # usage 출력
```

## 1. 읽기 명령 (.map)

```bash
export MSYS_NO_PATHCONV=1
MAP="D:/ai-agent-tf/benchmark-games/2.SimpleBossRush/map/map01.map"

msw-vfs "$MAP" summary
# → tile_map_mode, entity_count: 7, component_counts, scripts 확인

msw-vfs "$MAP" ls / -l
msw-vfs "$MAP" ls /maps/map01 -l
# → BG/, Background/, BossRushManager/ 등 + [N comp] 태그

msw-vfs "$MAP" tree / -d 3
# → 유니코드 트리 드로잉, [N comp] 표시

msw-vfs "$MAP" stat /maps/map01/BossRushManager
# → id, componentNames, modelId, 파일 목록 JSON

msw-vfs "$MAP" read /maps/map01/BG/TransformComponent.json --limit 20
# → 라인번호 + compact JSON

msw-vfs "$MAP" glob "*Component.json" /maps --max-results 10
msw-vfs "$MAP" grep "BossRush" / --head-limit 5
msw-vfs "$MAP" grep "script" / --output-mode count
```

## 2. 읽기 명령 (.ui / .model)

```bash
UI="D:/ai-agent-tf/benchmark-games/2.SimpleBossRush/ui/DefaultGroup.ui"
msw-vfs "$UI" summary
# → ui_group_type, buttons, texts, sprites

MODEL="D:/ai-agent-tf/benchmark-games/1.Defence/Global/DefaultPlayer.model"
msw-vfs "$MODEL" info
msw-vfs "$MODEL" list
msw-vfs "$MODEL" get speed
msw-vfs "$MODEL" validate
```

## 3. Mutation — 원본 보호를 위해 항상 복사본에 작업

```bash
SRC="D:/ai-agent-tf/benchmark-games/2.SimpleBossRush/map/map01.map"
TMP="$TEMP/test-map01.map"     # Git Bash에선 $TEMP 사용 가능
cp "$SRC" "$TMP"

# 엔티티 추가
msw-vfs "$TMP" add-entity /maps/map01 TestEnemy \
  -c MOD.Core.TransformComponent -c MOD.Core.SpriteRendererComponent

# 수정
msw-vfs "$TMP" edit /maps/map01/TestEnemy/TransformComponent.json --set Enable=false
msw-vfs "$TMP" edit-entity /maps/map01/TestEnemy --set visible=false

# 확인
msw-vfs "$TMP" ls -l /maps/map01
msw-vfs "$TMP" stat /maps/map01/TestEnemy

# 이름 변경
msw-vfs "$TMP" rename-entity /maps/map01/TestEnemy TestEnemy2

# 컴포넌트 CRUD
msw-vfs "$TMP" add-component /maps/map01/TestEnemy2 MOD.Core.FootholdComponent
msw-vfs "$TMP" remove-component /maps/map01/TestEnemy2 MOD.Core.SpriteRendererComponent

# 삭제
msw-vfs "$TMP" remove-entity /maps/map01/TestEnemy2

# 최종 검증
msw-vfs "$TMP" validate

rm -f "$TMP"
```

## 4. Model 파라미터 튜닝

```bash
SRC="D:/ai-agent-tf/benchmark-games/1.Defence/Global/DefaultPlayer.model"
TMP="$TEMP/test-player.model"
cp "$SRC" "$TMP"

msw-vfs "$TMP" set speed 5.5            # single (float)
msw-vfs "$TMP" set jumpForce 3          # int32
msw-vfs "$TMP" set jumpForce 3 --type single   # force single
msw-vfs "$TMP" set startPos '[1.5, 2.5]'       # vector2
msw-vfs "$TMP" set bgRef '{"DataId":"abc"}' --type dataref
msw-vfs "$TMP" list
msw-vfs "$TMP" remove bgRef
msw-vfs "$TMP" validate

rm -f "$TMP"
```

## 5. YAML round-trip

```bash
MAP="D:/ai-agent-tf/benchmark-games/2.SimpleBossRush/map/map01.map"
YOUT="$TEMP/rt.yaml"
MOUT="$TEMP/rt.map"

msw-vfs "$MAP" export-yaml -o "$YOUT"
msw-vfs "$YOUT" import-yaml -o "$MOUT"

# 비교
diff <(msw-vfs "$MAP" summary) <(msw-vfs "$MOUT" summary)
# → "file" 필드만 다르고 나머지(entity_count, component_counts, scripts, tile_map_mode)는 일치

rm -f "$YOUT" "$MOUT"
```

## 6. build-world (선언형 world.yaml)

```bash
WY="D:/ai-agent-tf/msw-ai-coding-plugins-official/plugins/sample-msw-creator-skills/skills/msw-map-ui-edit/docs/samples/world.yaml"
OUT="$TEMP/built-world"
rm -rf "$OUT"

msw-vfs --type world "$WY" build-world -o "$OUT"
# → { maps: [...], ui: [...], gamelogic: "..." }

# 생성된 파일 검증
for f in "$OUT"/map/*.map "$OUT"/ui/*.ui "$OUT"/Global/*.gamelogic; do
  echo "--- $f ---"
  msw-vfs "$f" validate
done

rm -rf "$OUT"
```

## 7. 실패 케이스 — exit code / 메시지 확인

```bash
msw-vfs nonexistent.map summary               # → 파일 없음 에러
msw-vfs ./random.txt summary                  # → 타입 감지 실패
msw-vfs "$MAP" ls /nonexistent/path           # → 경로 없음 에러

# validate 강제 실패
TMP="$TEMP/bad.map"
echo '{"ContentProto":{"Entities":[{"id":"","path":""}]}}' > "$TMP"
msw-vfs "$TMP" validate     # → warnings 출력
```

## 8. 성능 벤치

```bash
# 1.Defence map01.map (500+ entities, 수 MB)
MAP="D:/ai-agent-tf/benchmark-games/1.Defence/map/map01.map"

time msw-vfs "$MAP" summary          # 대략 100-200ms
time msw-vfs "$MAP" tree / -d 10     # 트리 전체 생성

# Python 버전과 비교
VFS="D:/ai-agent-tf/msw-ai-coding-plugins-official/plugins/sample-msw-creator-skills/skills/msw-map-ui-edit/tools/msw_vfs.py"
time python "$VFS" "$MAP" summary
```

---

## 테스트 통과 후

### npm publish (공개)

```bash
cd D:/ai-agent-tf/msw-vfs-cli
npm login                              # 1회 (브라우저로 OTP)
npm publish --access public            # @choigawoon scope는 default로 private → --access public 필수
```

공개 직후 확인:
```bash
npm view @choigawoon/msw-vfs-cli       # 메타 표시
npm uninstall -g @choigawoon/msw-vfs-cli  # link 해제
npm install -g @choigawoon/msw-vfs-cli    # 정식 설치
msw-vfs --version
```

### 스킬 repo push

```bash
cd D:/ai-agent-tf/msw-ai-coding-plugins-official
git log --oneline -1                   # 로컬 커밋 확인
git push origin main
```
