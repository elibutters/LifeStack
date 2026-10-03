# Tailscale

The stack never listens on a public interface. Compose binds `web` and `mcp` to
`BIND_ADDR` (default `127.0.0.1`) and Tailscale Serve fronts them with HTTPS on the
host's `*.ts.net` name, which iOS needs for PWA install and web push.

On the host, once it has joined your tailnet:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:3000
tailscale serve --bg --https=8443 http://127.0.0.1:3001
tailscale serve status
```

Do not use `tailscale funnel`; that would expose the service to the public internet.

Install on the phone: open `https://<host>.<tailnet>.ts.net` in Safari with Tailscale
connected, then Share -> Add to Home Screen.

Your tailnet name is personal. Keep it in `.env` or `local/`, never in a tracked file.
