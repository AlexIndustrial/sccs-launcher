# SCCS Launcher

> English version: [README.en.md](README.en.md)

Лаунчер фанатского Star Conflict Community Server: скачивает и обновляет файлы игры
с патч-сервера (со сверкой SHA256), после чего запускает игру. Проверка умеет быстрый
режим по размеру + времени изменения и полную проверку с пересчётом хешей.

Создан для проекта [Star Conflict Community Server](https://sccs.dsrt.app/)
и развивается в его рамках.

Состав репозитория:

- корень — Electron-лаунчер (React + TypeScript);
- [`server/`](server/) — маленький Rust-сервер, который генерирует манифест и раздаёт файлы;
- [`.github/workflows/build.yml`](.github/workflows/build.yml) — CI: сборка Windows-установщика.

---

## Для игроков: использование

### Требования

- Windows 10/11 x64, либо Linux / macOS через Wine (CrossOver, Whisky, обычный Wine).
- Место на диске под полную установку игры (~13 ГБ на данный момент).

### Установка и первый запуск

1. Скачай установщик `sccs-launcher-*-setup.exe` из
   [Releases](https://github.com/AlexIndustrial/sccs-launcher/releases) и установи.
2. При первом запуске выбери:
    - **Сервер** — по умолчанию основной `https://cdn.sccs.dsrt.app`, его убрать нельзя;
     свои можно добавлять через «Свой сервер» → «Добавить» и выбирать из списка.
     ⚠️ Добавляй только серверы, которым доверяешь: игра скачивается с выбранного
     сервера, чужой сервер может подсунуть вредоносное ПО.
   - **Папку установки** — кнопкой «Выбрать…» или вручную.
   - **Потоки загрузки** (1–16) — сколько файлов качать одновременно.
3. Нажми **«Проверить»** — лаунчер сверит локальные файлы с манифестом сервера.
   **«Полная проверка»** — то же, но с пересчётом хешей всех файлов (медленно, зато точно).
4. Нажми **«Обновить»** — недостающие/изменённые файлы скачаются с прогрессом.
5. Нажми **«Играть»** — запустится `win64/game.exe` из папки установки.

Язык интерфейса (RU/EN) переключается кнопками вверху, выбор запоминается.

### Linux / macOS (Wine): важные флаги

Установщик Electron проверяет запущенные процессы через PowerShell, а его
Wine-заглушка работает криво и установщик может бесконечно жаловаться
`sccs-launcher is running`. Лечится отключением powershell-заглушки на время установки:

```bash
WINEDLLOVERRIDES=powershell.exe=d wine sccs-launcher-1.0.1-setup.exe
```

В CrossOver то же самое задаётся переменной окружения бутылки (или в команде запуска).

Если сам лаунчер под Wine падает/виснет с графикой (чёрное окно, краш GPU-процесса),
запускай его с флагом Chromium:

```bash
wine sccs-launcher.exe --in-process-gpu
```

Оба флага нужны только при проблемах: на обычном Windows и на здоровых
Wine-бутылках всё работает без них.

---

## Для владельцев серверов: свой хост

### 1. Сборка

```bash
cd server
cargo build --release
# бинарник: server/target/release/sccs-server
```

### 2. Папка игры и манифест

Положи файлы игры в отдельную папку (или сделай симлинк — в git он не попадёт):

```bash
ln -s "/path/to/star conflict" game   # либо укажи свой --game-dir
./target/release/sccs-server generate --game-dir game --version v1
```

Манифест `manifest.json` ляжет в корень папки игры. Формат:

```json
{
  "version": "v1",
  "generated_at": "1791757489",
  "files": [{ "path": "win64/game.exe", "size": 15826704, "sha256": "hex", "mtime": 1791540653 }]
}
```

`path` — относительный путь с `/`, `mtime` — время изменения (unix-секунды):
по совпадению размера + mtime лаунчер пропускает хеширование (проверка за секунды).

### 3. Запуск раздачи

```bash
./target/release/sccs-server serve --game-dir game --host 127.0.0.1 --port 8080
```

Эндпоинты:

- `GET /health` → `ok`;
- `GET /manifest.json` — манифест;
- `GET /files/<path>` — файлы, поддерживается `Range` (докачка на стороне сервера
  из коробки через tower-http).

### 4. systemd (пример)

```bash
cat > /etc/systemd/system/sccs-cdn.service <<'EOF'
[Unit]
Description=SCCS Star Conflict patch server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/sccs-cdn
ExecStart=/opt/sccs-cdn/target/release/sccs-server serve --game-dir /opt/sccs-cdn/game --host 127.0.0.1 --port 8081
Restart=always
RestartSec=5
LimitNOFILE=65536
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now sccs-cdn
curl http://127.0.0.1:8081/health
```

### 5. Reverse proxy (рекомендуется)

Сервер отдаёт HTTP без TLS — наружу его лучше выпускать через nginx/Caddy с HTTPS.
Для nginx важно отключить буферизацию, иначе многогигабайтные файлы пойдут
через память/диск прокси:

```nginx
location / {
    proxy_pass http://127.0.0.1:8081;
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

### 6. Обновление игры на хосте

1. Замени/доложи файлы в папке игры.
2. Перегенерируй манифест с новой версией:
   `sccs-server generate --game-dir game --version v2`.
3. Рестарт сервиса **не нужен** — файлы и манифест читаются с диска при каждом запросе.

Лаунчеры игроков сами подтянут изменения при следующей проверке.
Чтобы игроки могли подключиться — дай им URL вида `https://твой-домен`,
его можно добавить в лаунчере через «Свой сервер».
