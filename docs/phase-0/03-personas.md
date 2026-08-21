# 03 — Personas

Related: [04-user-journeys.md](04-user-journeys.md) · [24-screen-inventory.md](24-screen-inventory.md) · [02-scope.md](02-scope.md)

Four primary personas plus one anti-persona. Each persona exists to settle a specific class of
design argument; the "design tension it resolves" line is the reason the persona is in this
document at all.

---

## 3.1 P1 — Kai, the Casual FPS Player

**Design tension it resolves:** how much setup friction is acceptable before the first test.

| | |
|---|---|
| Age / context | 19, plays Apex and Delta Force a few evenings a week |
| Hardware | A mouse he bought because it was on sale. Has never opened its software |
| Technical knowledge | Knows the in-game sensitivity slider exists. Does not know what DPI is. Has never heard of cm/360 |
| Trigger to visit | A friend or a video said his sensitivity is "way too high" |

**Goals**
- Find out whether his sensitivity is wrong, in under half an hour.
- Get a number he can type into the game without understanding the theory.

**Frustrations**
- Every tool he has found starts by demanding numbers he does not have.
- Explanations assume he already knows the vocabulary.
- He does not trust results he cannot see any reasoning behind.

**Technical knowledge:** low. **Expected workflow:** guest, Quick mode, single game.

**Expected workflow**
Landing → Start Calibration → picks Apex → **stalls on DPI** → uses the "I don't know my DPI"
helper → default assumption path → skips every optional field → environment check → practice →
Quick calibration → result → copies the Apex number → probably does not create an account.

**Features that matter to him**
- A DPI helper that is genuinely useful when the answer is "I don't know" (doc 04 §4.4.3).
- Optional fields that are visibly optional and skippable in one action.
- A plain-language explanation of the result: "your aim was steadiest around here".
- The copy button.

**Features that do not matter to him**
Confidence intervals, per-scope settings, history, comparison, aim profile taxonomy.

**Design implications**
- DPI must be the *only* hard gate, and it must have an escape hatch (`SENS-FR-018`).
- Quick mode must be genuinely quick and must be the default suggestion for a first-time guest.
- The result must be readable at a glance before any statistics appear.
- Never block on account creation (`SENS-BR-001`).

---

## 3.2 P2 — Mara, the Competitive Player

**Design tension it resolves:** whether the product is allowed to show uncertainty. (It is —
this persona *requires* it.)

| | |
|---|---|
| Age / context | 24, CS2 Premier, plays 15–20 h/week, in a semi-serious team |
| Hardware | Knows her mouse, her DPI, her polling rate, and her pad's dimensions |
| Technical knowledge | High. Knows cm/360, has used converters, has read sensitivity debates |
| Trigger to visit | Plateaued. Suspects her sensitivity is a limiter but will not change it on a hunch |

**Goals**
- A data-backed answer with an error bar, not a confident guess.
- To know *which part* of her aim a sensitivity change would help or hurt.
- To verify the recommendation empirically before committing to it.

**Frustrations**
- Tools that output a single number with no evidence.
- Tools that are obviously guessing but present certainty.
- Being told to change something without being shown the trade-off it costs her.

**Technical knowledge:** high. **Expected workflow:** registered, Standard or Advanced, validation
always, fine-tune often, returns to compare.

**Expected workflow**
Creates an account early → full hardware profile → Standard mode → runs the whole battery →
scrutinises the response curve → reads dimension breakdown → runs validation → sees a mixed
result → runs fine-tune → saves profile → returns in three weeks to re-check.

**Features that matter to her**
- The response curve. This is the persona the chart exists for.
- Confidence index with a breakdown of *why* it is not higher (doc 15 §15.6).
- Validation with paired statistics and an explicit "no measurable difference" verdict.
- Session history and comparison.
- The honest familiarity-bias caveat — this is what earns her trust rather than losing it.

**Design implications**
- Uncertainty must be surfaced, not buried. A confidence of 68% must be presentable without
  the product feeling broken.
- Every derived number needs a "how was this calculated" affordance.
- Advanced mode must exist even though most users will not choose it.
- Never round away information she can use (show 31.2, not "about 31").

---

## 3.3 P3 — Diego, the Multi-Game Player

**Design tension it resolves:** whether cm/360 is an internal detail or a user-facing concept.
(For him it is user-facing and it is the whole point.)

| | |
|---|---|
| Age / context | 27, rotates between Apex, PUBG and Delta Force depending on who is online |
| Hardware | One good mouse, one setup, does not change DPI |
| Technical knowledge | Medium. Understands "same feel across games", found converters, distrusts them slightly |
| Trigger to visit | His aim feels inconsistent between games and he suspects his three sensitivities do not match |

**Goals**
- One physical sensitivity, correctly expressed in every game he plays.
- Confidence that ADS/scoped aiming is consistent too, not just hipfire.

**Frustrations**
- Converters that disagree with each other.
- No way to tell which of his three current settings is the "right" one to convert *from*.
- Games where he cannot find a trustworthy conversion at all.

**Technical knowledge:** medium. **Expected workflow:** guest first, registers to save the
multi-game settings block, uses "convert to another game" heavily.

**Expected workflow**
Landing → selects PUBG (the game he is worst in) → hardware setup with DPI and current PUBG
sens → Standard calibration → result → **immediately switches the output game** three times to
collect all his numbers → hits an unverified adapter and needs that state to be understandable →
registers to save → copies each game's settings.

**Features that matter to him**
- Output-game switching with no recalibration (`SENS-FR-078`).
- A game settings block that shows hipfire *and* ADS/scope where verified.
- A clear, non-embarrassing explanation when a game is not yet verified.
- cm/360 shown as the anchor so he understands what is actually being held constant.

**Design implications**
- The recommendation entity must be game-agnostic and re-projectable at read time.
- Conversion method (360-distance vs monitor-distance) must be user-visible and explained,
  because it is exactly the thing converters disagree about (doc 11 §11.6).
- An unverified adapter must produce a *good* empty state, not a broken one.

---

## 3.4 P4 — Yuki, the Advanced Aim Enthusiast

**Design tension it resolves:** how deep the "show your work" layer must go before it stops.

| | |
|---|---|
| Age / context | 31, software engineer, plays CS2 and 三角洲行动, reads the sensitivity literature for fun |
| Hardware | Two mice, three DPI presets, measured pad, knows her polling rate and monitor's real refresh |
| Technical knowledge | Very high. Knows yaw constants, monitor-distance matching, and why 0% MDC is not 360-distance |
| Trigger to visit | Curiosity plus scepticism. Wants to find out whether SensLab is rigorous or theatre |

**Goals**
- Understand the methodology well enough to decide whether to believe it.
- Maintain separate calibrations per hardware profile.
- Catch the product being wrong, and be told when the product does not know something.

**Frustrations**
- Hand-waving. Undisclosed constants. Fake precision.
- Tools that silently pick a conversion method.
- Being unable to tell whether a number came from measurement or from an assumption.

**Technical knowledge:** very high. **Expected workflow:** registered immediately, multiple
hardware profiles, Advanced mode, reads every methodology link, will report a bug.

**Expected workflow**
Reads "How it works" *before* starting → creates account → builds two hardware profiles →
Advanced calibration on the primary → inspects response curve, dimension weights, confidence
breakdown → checks which adapters are verified and against what → re-runs on the second profile
→ compares sessions.

**Features that matter to her**
- Methodology transparency: which algorithm version, which conversion method, which constants.
- The verification register being *visible* rather than internal (doc 36).
- Multiple hardware profiles with per-profile calibration history (`SENS-BR-018`).
- Environment quality reporting — she wants to know her frame stability was fine.

**Design implications**
- Every result must carry `scoring_model_version`, `calibration_version`, `adapter_version`.
- "Requires external verification" must be a first-class UI state, not an internal enum.
- A public methodology page is an MVP asset, not marketing fluff.
- She is the reason nothing in this product is allowed to be a magic number.

---

## 3.5 Anti-persona — "Sam, who wants the pro's number"

Sam wants SensLab to tell him what sensitivity a specific professional uses so he can copy it.

SensLab will not serve this need, and the refusal is deliberate: serving it would contradict the
product's central claim (doc 01 §1.4). Pro comparison is listed as a Future item only in the
form of *"here is where your measured optimum sits relative to a population"*, never as
*"here is the number to copy"*.

**Design implication:** no screen in the MVP presents another person's sensitivity as an input,
a default, or a suggestion.

---

## 3.6 Persona → feature priority matrix

| Feature | Kai (P1) | Mara (P2) | Diego (P3) | Yuki (P4) |
|---|---|---|---|---|
| Guest calibration | **Critical** | Low | High | Low |
| DPI helper / unknown-DPI path | **Critical** | — | Medium | — |
| Quick mode | **Critical** | Low | Medium | Low |
| Standard mode | Medium | **Critical** | **Critical** | High |
| Advanced mode | — | High | Low | **Critical** |
| Response curve | Medium | **Critical** | High | **Critical** |
| Confidence index + breakdown | Low | **Critical** | Medium | **Critical** |
| Aim DNA + profile | High | Medium | Medium | Low |
| Validation A/B | Low | **Critical** | Medium | High |
| Fine-tuning | — | High | Low | High |
| Output-game switching | Low | Medium | **Critical** | High |
| ADS / scope settings | Low | Medium | **Critical** | High |
| Hardware profiles | — | High | Medium | **Critical** |
| History + comparison | — | **Critical** | Medium | High |
| Methodology transparency | — | High | Medium | **Critical** |
| Verification status visibility | — | Medium | **Critical** | **Critical** |

**Reading of the matrix:** the MVP must be excellent for P1 at the *entry* (friction, defaults,
plain language) and excellent for P2/P4 at the *exit* (evidence, uncertainty, versioning). P3
determines that the recommendation entity is game-agnostic and re-projectable. No feature in the
MVP list lacks at least one **Critical**.

---

## 3.7 Accessibility and inclusion notes across personas

- **Hand and arm differences.** The 360 Comfort Test and mousepad constraint exist partly because
  achievable swipe distance varies with physiology and workspace, not only preference. The
  product must never frame a low achievable swipe range as a deficiency.
- **Colour vision.** Hit/miss and improved/worsened states must not rely on hue alone
  (doc 28 §28.6).
- **Motion sensitivity.** The calibration itself is a first-person camera; users with vestibular
  sensitivity may find it uncomfortable. `prefers-reduced-motion` cannot remove this, so the
  test introduction must warn before pointer lock engages (`SENS-UX-024`).
- **Language.** 三角洲行动 players are a launch audience; zh-Hans is an MVP locale for that
  game's surfaces at minimum (doc 08 §8.7).
