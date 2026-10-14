# SCCS Launcher

> Русская версия: [README.md](README.md)

Launcher for the fan-run Star Conflict Community Server: it downloads and updates
game files from a patch server (with SHA256 verification) and then starts the game.
Checking supports a fast mode (size + modification time) and a full check that
re-hashes everything.

Built for the [Star Conflict Community Server](https://sccs.dsrt.app/) project
and developed within it.

Repository layout:

- root — Electron launcher (React + TypeScript);
- [`server/`](server/) — tiny Rust server that generates the manifest and serves files;
- [`.github/workflows/build.yml`](.github/workflows/build.yml) — CI: Windows installer build.

---

## For players: usage

### Requirements

- Windows 10/11 x64, or Linux / macOS via Wine (CrossOver, Whisky, stock Wine).
- Disk space for the full game install (~13 GB at the moment).

### Install and first run

1. Download the `sccs-launcher-*-setup.exe` installer from
   [Releases](https://github.com/AlexIndustrial/sccs-launcher/releases) and install it.
2. On first run, choose:
   - **Server** — the default `https://cdn.sccs.dsrt.app` cannot be removed;
     you can add your own via "Custom server" → "Add" and pick from the list.
     ⚠️ Only add servers you trust: the game is downloaded from the selected
     server, and a stranger server could serve malware.
   - **Install folder** — via the "Browse…" button or typed manually.
   - **Download threads** (1–16) — how many files to fetch at once.
3. Press **"Check"** — the launcher compares local files against the server manifest.
   **"Full check"** does the same but re-hashes every file (slow, but exact).
4. Press **"Update"** — missing/changed files download with progress.
5. Press **"Play"** — starts `win64/game.exe` from the install folder.

The UI language (RU/EN) is switched with the buttons at the top and remembered.

### Linux / macOS (Wine): important flags

The Electron installer checks running processes via PowerShell, and its
Wine stub misbehaves, so the installer may endlessly complain that
`sccs-launcher is running`. Work around it by disabling the PowerShell stub
during install:

```bash
WINEDLLOVERRIDES=powershell.exe=d wine sccs-launcher-1.0.1-setup.exe
```

In CrossOver, set the same as a bottle environment variable (or in the launch command).

If the launcher itself crashes/hangs on graphics under Wine (black window, GPU process
crash), start it with the Chromium flag:

```bash
wine sccs-launcher.exe --in-process-gpu
```

Both flags are only needed when you hit problems: stock Windows and healthy
Wine bottles work without them.

---

## For server owners: hosting

### 1. Build

```bash
cd server
cargo build --release
# binary: server/target/release/sccs-server
```

### 2. Game folder and manifest

Put the game files in a separate folder (or symlink it — the symlink is git-ignored):

```bash
ln -s "/path/to/star conflict" game   # or pass your own --game-dir
./target/release/sccs-server generate --game-dir game --version v1
```

The `manifest.json` lands in the game folder root. Format:

```json
{
  "version": "v1",
  "generated_at": "1791757489",
  "files": [{ "path": "win64/game.exe", "size": 15826704, "sha256": "hex", "mtime": 1791540653 }]
}
```

`path` is relative with `/` separators, `mtime` is the modification time (unix seconds):
when size + mtime match, the launcher skips hashing (checks finish in seconds).

### 3. Run the distribution

```bash
./target/release/sccs-server serve --game-dir game --host 127.0.0.1 --port 8080
```

Endpoints:

- `GET /health` → `ok`;
- `GET /manifest.json` — the manifest;
- `GET /files/<path>` — files, `Range` supported (server-side resume works
  out of the box via tower-http).

### 4. systemd (example)

Run the service as a **dedicated unprivileged user, not root** — root is not
needed (port 8081 > 1024, so no privileges required):

```bash
# User and ownership of the distribution folder:
useradd -r -s /usr/sbin/nologin -d /opt/sccs-cdn sccs
chown -R sccs:sccs /opt/sccs-cdn

cat > /etc/systemd/system/sccs-cdn.service <<'EOF'
[Unit]
Description=SCCS Star Conflict patch server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=sccs
Group=sccs
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

> If you know what you're doing: `serve` itself isn't required for distribution.
> The protocol is plain static files (`GET /manifest.json` + `GET /files/<path>`
> with `Range`, which nginx/caddy handle out of the box), so nginx/caddy or any
> other web server can serve the files directly. Then you only need sccs-server's
> `generate` to build the manifest.

### 5. Reverse proxy (recommended)

The server speaks plain HTTP with no TLS — expose it through nginx/Caddy with HTTPS.
For nginx, disabling buffering matters, otherwise multi-gigabyte files go
through the proxy's memory/disk:

```nginx
location / {
    proxy_pass http://127.0.0.1:8081;
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

### 6. Updating the game on the host

1. Replace/add files in the game folder.
2. Regenerate the manifest with a new version:
   `sccs-server generate --game-dir game --version v2`.
3. **No** service restart needed — files and manifest are read from disk on every request.

Players' launchers pick up the changes on the next check.
To let players connect, give them a URL like `https://your-domain`,
which can be added in the launcher via "Custom server".
