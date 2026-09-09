# openclaw-webhook

## OpenClaw on Render

This repository's application start command is `node index.js`; it contains no
Dockerfile or OpenClaw startup wrapper. Do not add `GATEWAY_MODE` (or another
guessed environment variable) to this application: `gateway.mode` is an
OpenClaw configuration key, not an environment variable.

For the separate OpenClaw Render service, provide the contents of
[`openclaw-render.json`](openclaw-render.json) as the OpenClaw configuration
file at the service user's standard path:

```text
~/.openclaw/openclaw.json
```

On Render, configure that file through the OpenClaw service's persistent
configuration volume (or bake/copy it to that path in the OpenClaw image). The
minimum file contents are:

```json
{
  "gateway": {
    "mode": "local"
  }
}
```

The mounted/baked file must be present before the existing OpenClaw start
command runs. Preserve the current gateway command and its Render port/bind
arguments; no change is needed to this webhook application's `npm start`
command.

After deploying the OpenClaw service, verify the effective setting in its
Render shell with:

```sh
openclaw config get gateway.mode
```

It must output `local`. Redeploy **only the OpenClaw Render service** after the
configuration file has been mounted or baked. The Fluent with Kyle webhook
service does not need a rebuild or redeploy for this configuration change.
