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
   - `BRICKHOUSE_KIT_CLASSIC_CENTS` and `BRICKHOUSE_KIT_GRAND_CENTS`: the kit's price in cents for each size.
     Until a kit is ordered, customers see a preview of their design (the model, the first few guide steps and
     the kit's totals); a kit order through Stripe Checkout (with their shipping address) unlocks the full guide
     and parts list. Without a Stripe key, "Order your kit" is a test order that unlocks at once, so set Stripe up
     before launch. `node scripts/orders.js` (in the Render Shell) lists kit orders to fulfill.
   - `BRICKHOUSE_ADMIN_PASSWORD`: turns on the admin page at `/admin` (sign in with it): every design with its
     status and any error (Run again for a failed one), and the kit orders to fulfill, each with the customer's
     shipping address, the parts file for Brickwith's part-list upload, and its progress (ordered, packed, shipped;
     a tracking number emails the customer), with GoBricks' stock for its parts (checked when the kit is ordered;
     Check stock again before ordering at Brickwith). Signed in, you see every design in full. Use a long password.
   - `BRICKHOUSE_SUPPLIER`: customer designs are held to what GoBricks makes (the kits come from Brickwith); set it
     to an empty value to hold them to LEGO availability instead.
   - `RESEND_API_KEY`: turns on email through Resend (resend.com): the link to each design when it's ready (to the
     email on the form or from Stripe), a kit order's confirmation, and "find my designs" by email.
     `BRICKHOUSE_MAIL_FROM` is the sender, for example `Brickhouse <hello@yourdomain.com>`, on a domain you've verified
     at Resend (Domains, then add the DNS records it shows). Until then it sends from Resend's test address, which only
     delivers to your own Resend account's email.
   - `MAPILLARY_TOKEN`: optional, for street photos from the address box.
   It also sets `BRICKHOUSE_GOBRICKS_QUOTES` (`0` turns off live GoBricks quotes on the Parts tab) and
   `BRICKHOUSE_CNY_PER_USD` (how many of GoBricks' yuan make a dollar at Brickwith, its store: about 3.5); change them
   on the service's Environment tab. `0` also turns off the admin page's stock check, which uses the same matcher.
4. Apply. The first build takes a few minutes (the image includes Chromium). The site is then at
   `https://brickhouse-XXXX.onrender.com`; share that and the password.

## GoBricks catalog refresh

On the 1st of each month a GitHub Action (`.github/workflows/gobricks-catalog.yml`) asks GoBricks again what it makes.
When anything changed it opens a pull request with the new catalog, a list of what was dropped, added or repriced, and
whether the tests still pass. For it to open pull requests, turn on "Allow GitHub Actions to create and approve pull
requests" in the repository's Settings, Actions, General. You can also run it by hand from the Actions tab.

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
