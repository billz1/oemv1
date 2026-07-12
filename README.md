# OEM Supplier Research — Static Vercel Build

This version has no backend, no Python, no Docker, and no npm dependencies.

## Deploy to Vercel

Use these settings:

- Framework preset: Other
- Install command: leave empty
- Build command: leave empty
- Output directory: `.`

If Vercel asks for a build command, use:

```bash
sh -c "echo static"
```

## Files

- `index.html`
- `styles.css`
- `app.js`
- `vercel.json`

## Usage

1. Open the deployed app.
2. Enter your OpenAI API key.
3. Select an OEM.
4. Click Research selected OEM.
5. Accept useful findings.
6. Export CSV, JSON, or HTML report.

## Note

Because there is no backend, your OpenAI key is used in the browser. Do not hardcode it or share a deployment with a saved key.

If direct browser calls to OpenAI are blocked, use the Manual import fallback: copy the generated prompt, run it in ChatGPT/OpenAI, paste the JSON, then export.
