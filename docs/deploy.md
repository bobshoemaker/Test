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
   - `STRIPE_SECRET_KEY`: your Stripe secret key (Stripe dashboard > Developers > API keys). With it, a
     design only starts after its design fee is paid; without it, designs are free to start. Try it
     first with a test key (`sk_test_...`) and Stripe's test card 4242 4242 4242 4242.
   - `BRICKHOUSE_DESIGN_FEE_CENTS`: the fee in cents (1500 = $15), credited toward the kit if you like.
   - `MAPILLARY_TOKEN`: optional, for street photos from the address box.
   It also sets `BRICKHOUSE_GOBRICKS_QUOTES` (`0` turns off live GoBricks quotes on the Parts tab) and
   `BRICKHOUSE_CNY_PER_USD` (how many of GoBricks' yuan make a dollar at Brickwith, its store: about 3.5); change them
   on the service's Environment tab.
4. Apply. The first build takes a few minutes (the image includes Chromium). The site is then at
   `https://brickhouse-XXXX.onrender.com`; share that and the password.

## Costs

- Render Starter web service plus a 1 GB disk: about $7 to $8 a month. The free plan sleeps when
  idle and has too little memory for the renders.
- Each house designed: about $3 to $4 of Anthropic API credit, charged to the key above, 15 to 25
  minutes. With Stripe set up, each one is paid for first by the design fee; the free first look
  (the survey, about $0.07) and new jobs are rate-limited per visitor. Still set a monthly spend
  limit on the key in the Anthropic console as a backstop.

## Notes

- Generated designs are saved on the disk at `designs/generated` and listed in the viewer's design
  picker.
- A design keeps running on the server if the browser tab closes; reopen the site and pick it from
  the list when it's done.
- It deploys from `master` (`branch:` in `render.yaml`): merge work into `master` to put it live.
