# Hosting Brickhouse

The code lives on GitHub; the server runs on Render, which builds it from this repo and redeploys
on every push. GitHub Pages can't host it: Pages serves static files, and designing a house needs
the Node server (it calls Claude and renders drafts in headless Chromium).

## One-time setup (about 10 minutes)

1. Sign in at https://render.com with GitHub and allow it to see `bobshoemaker/Test`.
2. New > Blueprint, pick the repo. Render reads `render.yaml` and proposes a web service named
   `brickhouse` on the branch named there.
3. Fill in the secrets it asks for:
   - `BRICKHOUSE_PASSWORD`: the password everyone types to open the site (any user name).
   - `BRICKHOUSE_ANTHROPIC_API_KEY`: your Anthropic key. Never commit it: this repo is public.
   - `BRICKHOUSE_ANTHROPIC_WORKSPACE_ID`: only if the key is organization-scoped.
   - `MAPILLARY_TOKEN`: optional, for street photos from the address box.
4. Apply. The first build takes a few minutes (the image includes Chromium). The site is then at
   `https://brickhouse-XXXX.onrender.com`; share that and the password.

## Costs

- Render Starter web service plus a 1 GB disk: about $7 to $8 a month. The free plan sleeps when
  idle and has too little memory for the renders.
- Each house designed: about $3 to $4 of Anthropic API credit, charged to the key above, 15 to 25
  minutes. Anyone with the password can start one, so share it only with people you trust, and set
  a monthly spend limit on the key in the Anthropic console.

## Notes

- Generated designs are saved on the disk at `designs/generated` and listed in the viewer's design
  picker.
- A design keeps running on the server if the browser tab closes; reopen the site and pick it from
  the list when it's done.
- To deploy from `master` instead, merge the branch and change `branch:` in `render.yaml`.
