# Tests

Automated tests run via vitest (single runner, tag-filtered by test-title
substring — vitest 4 has no native tag system):

| Script | Scope |
|---|---|
| `npm test` | full suite (all files) |
| `npm run test:unit` | pure unit (`resume-scheduler`, `composer`, `normalize`) — node env |
| `npm run test:smoke` | `-t "@smoke"` — the field-churn guard |
| `npm run test:e2e` | `resume-lifecycle.e2e.test.ts` — jsdom, real DOM events |
| `npm run test:regression` | `-t "@regression"` — locks prior fixes |

`@smoke` / `@regression` are literal substrings in the relevant
`describe`/`it` titles. The E2E file opts into jsdom via its first-line
`/** @vitest-environment jsdom */` docblock; the global env stays `node`.

## Manual on-glasses / simulator E2E (not CI-automatable)

True device behavior (BLE, real visibility throttling) can't run in CI. After
any resume-lifecycle change, validate manually on the simulator or glasses:

1. **Quick flap**: open the app from the glasses, then pull the phone out and
   put it back several times within ~1 s each. Expect: **no glasses
   flicker/redraw**, and the first command after the flap is immediate (debug
   log shows no `SmartThings client invalidated (hidden)` for short flaps, and
   a single coalesced `Resume sync triggered`).
2. **Long background**: background the app > 30 s, return. Expect: one full
   resync (glasses redraw once, `Resume sync triggered (... )` *without*
   `[lightweight]`, auth re-verified).
3. **Backgrounded launch**: open from glasses with the phone screen off.
   Expect: data loads complete without the prolonged "Scene/Scene" jank
   (favorites show `Loading…` then resolve).
4. **Expired session in background**: invalidate the session server-side while
   backgrounded, then resume. Expect: the connect panel still appears
   (resume outcome preserved).

Capture the in-app debug log (Connection tab → Copy log) for any regression.
