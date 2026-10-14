# sccs-server (MVP)

Маленький Rust-сервер для раздачи файлов игры Star Conflict.

## Протокол v1

- `GET /health` → `ok`
- `GET /manifest.json` → манифест:
```json
{
  "version": "test-v1",
  "generated_at": "1791752981",
  "files": [{ "path": "StarConflict.exe", "size": 24, "sha256": "hex", "mtime": 1791752981 }]
}
```
`path` — относительный путь от корня игры, всегда с `/`.
`mtime` — unix-секунды изменения файла: лаунчер пропускает хеширование,
если совпали размер и mtime (быстрая проверка за секунды).

Папки верхнего уровня из `EXCLUDED_TOP_LEVELS` в `src/manifest.rs` (сейчас: `cloud` —
серверные exe игрокам не нужны) исключаются из манифеста, а сервер дополнительно
отвечает на прямые запросы к ним `404` (включая обход через URL-encoding).
- `GET /files/<path>` → тело файла, поддерживается `Range` (206).

## Использование

```bash
# 1. привязать папку игры симлинком (путь у каждого свой, в git не коммитится)
ln -s "/path/to/star conflict" game

# 2. сгенерировать манифест (manifest.json ляжет в корень игры)
cargo run -- generate --game-dir game --version v1

# 3. раздавать
cargo run -- serve --game-dir game --port 8080
# manifest -> http://127.0.0.1:8080/manifest.json
# files    -> http://127.0.0.1:8080/files/StarConflict.exe
```

Обновление игры на сервере = заменить файлы в `game/` + заново `generate`.
Лаунчер сам скачает изменившиеся файлы по `sha256`.
