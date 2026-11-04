# Does it build what was said?

## The test

Each test case is a spoken-style description of a home (a person describing a place to a listener, with hesitations, self-corrections and vague bits) plus an answer key: every thing whose existence was stated, every position that was stated ("on the left as you come in", "at the back", "inside"), and every size that was stated. The descriptions and keys were not written by any of the Meta models under test, and the keys were written from the transcripts alone, without seeing the build code, using the app's list of relation and element kinds.

Each description is built three ways, with the same builder model (Muse Wonder) and the same building rules:

1. **Graph and checks** (this project): Muse Spark maps the words into a house graph, Wonder writes the build program, code checks the blocks against the graph, and failures go back to Wonder (up to three repairs).
2. **Wonder alone**: Wonder builds straight from the transcript.
3. **Wonder with self-review**: Wonder builds from the transcript, then reviews its own program against the transcript and returns a corrected one. No code checks.

Every build is then measured by the same code against the same key. One Muse Spark call per build matches the build's own names to the key's names ("nalka" and "hand_pump" are the same thing); the same matcher is used for all three.

## Held-out results (8 homes, written after the system was tuned)

| | All stated facts (things, sizes and positions) | Positions alone | Built but not in the key, per home | Cost per home | Time per home |
|---|---|---|---|---|---|
| Graph and checks | **456 of 486 (93.8%)** | **203 of 219 (92.7%)** | 1.0 | $0.59 | 217 s |
| Wonder alone | 384 of 484 (79.3%) | 157 of 219 (71.7%) | 0.5 | $0.15 | 63 s |
| Wonder with self-review | 373 of 479 (77.9%) | 152 of 219 (69.4%) | 1.0 | $0.30 | 122 s |

Things and sizes alone were 253 of 267 (94.8%), 227 of 265 (85.7%) and 221 of 260 (85.0%). Totals differ because a size can only be measured on a thing that was built. Graph and checks got more facts right than both other approaches on all 8 homes, and more positions right on 7 of them (tied on the other). The homes: a Punjabi courtyard house near Jalandhar, a Sikh family's house in Surrey BC, a Hanoi tube house, a Kumasi compound house, a Minho granite house, a ger in an Ulaanbaatar yard, an adobe farmhouse above Urcos, and a Chouf mountain house. Per-home numbers are in `eval/results/heldout1/`.

### After the building kit (October 28)

The builder now composes a kit of detailed parts (rooms with plinths, beams and parapets, open gates, cots, pumps, trees by species) at 0.25 m instead of placing raw half-metre blocks. Same 8 held-out homes, graph and checks only:

| | All stated facts (things, sizes and positions) | Positions alone | Cost per home | Time per home |
|---|---|---|---|---|
| Graph and checks, with the kit | **462 of 486 (95.1%)** | **205 of 219 (93.6%)** | $0.79 | 261 s |

Faithfulness held while the houses got far more detailed. Most remaining misses are parts the kit cannot yet express on its own: an upper floor, a named back wall, a road outside. Per-home numbers: `eval/results/heldout2-kit/`.

### With the full kit and real places (October 28, later)

The kit then gained grand-place parts (domes, towers, portals, gardens), wall trim, a per-build scale, and a layer for well-known features of real places. Same 8 homes, graph and checks only:

| | All stated facts (things, sizes and positions) | Positions alone | Built but not in the key, per home | Cost per home | Time per home |
|---|---|---|---|---|---|
| Graph and checks, full kit | **471 of 486 (96.9%)** | **211 of 219 (96.3%)** | 0.63 | $0.68 | 208 s |

A caution on this number: these 8 homes have now been used to check three versions. Nothing was tuned on their individual cases, but the misses seen in the second check (upper floors, a road) did shape the multi-storey building part, so the set is no longer perfectly unseen. Per-home numbers: `eval/results/heldout3-grand/`.

## Development set (16 homes, used to improve the system)

These homes were used to find and fix problems, so their numbers after the fix are not a fair test; they are shown for completeness.

| | All stated facts | Positions alone | Built but not in the key |
|---|---|---|---|
| First run: graph and checks | 90.4% | 91.1% | 0.75 per home |
| First run: Wonder alone | 84.7% | 80.3% | 1.50 |
| First run: Wonder with self-review | 76.7% | 67.1% | 1.63 |
| After the fix: graph and checks (15 of 16 homes; one failed on a cut-off response, since fixed) | 96.8% | 97.2% | 2.33 |

The fix: the first run showed that almost every miss was a small object or building part that the house graph left out (a TV, boots by the door, icons in a corner, a raised plinth, posts under the house), because the mapping rules favoured leaving things out. The rules now ask for everything that was said, and the code checks still reject anything that was not.

## What this does and does not show

- Self-review did not help overall: 77.9% against 79.3%, with fewer facts right on 5 of 8 homes. One home (h05) accounts for the whole gap; on the other 7 the two are about level.
- "Built but not in the key" counts named things in the build that the matcher could not pair with the key. Most are the build splitting a group the key kept as one ("four rooms on each side" built as eight rooms) or things that were said but left out of the key (a tulsi plant); a few are real additions. Grey guesses are not counted.
- The descriptions are typed text, not audio, and synthetic, not real people. Speech recognition and translation errors are not measured here; the real recordings in the app show those directly, with each quote playable.
- Each approach was run once per home. Model output varies between runs, so differences of a few points on one home mean little; the gap across all 8 is the signal.
- Graph and checks costs about four times as much and takes about three and a half times as long as Wonder alone.

Rerun on the current code: `EVAL_SET=heldout RUN=heldout1 node eval/run.ts` (writes to `data/eval/heldout1`). Expect different numbers: this table came from the version before the kit, and the baseline arms now use the current building rules.

## Minecraft data packs

Each of the 15 places was built from its own downloadable data pack on the official Minecraft: Java Edition 26.3 server. After each build, 2,000 randomly chosen blocks from the file were compared with the world using `execute unless block`. A few blocks change by themselves after placing, so small differences are expected. `eval/minecraft-check.py` writes that comparison; the runs themselves were made by hand against a local server, so their logs are not in this repository.

| Place | Blocks that differed, of 2,000 |
|---|---|
| Bibi Ji's house | 3 |
| Korona shopping street | 0 |
| Haveli in Lahore | 2 |
| Plaza in Oaxaca | 1 |
| School in Ibadan | 0 |
| Castle game level | 0 |
| Hawa Mahal | 4 |
| St. Basil's Cathedral | 6 |
| The Golden Temple | 1 |
| Big temple in Nara | 5 |
| Kinkaku-ji | 1 |
| The Taj Mahal | 1 |
| Machu Picchu | 4 |
| Rialto Bridge | 1 |
| Angkor Wat | 5 |

## Places built from uploaded audio

| Place | Language | First build | Final | Cost |
|---|---|---|---|---|
| Bibi Ji's house with the vehra | Punjabi | 30 of 32 | 32 of 32 | $0.36 |
| Our haveli in Lahore near Mochi Gate | Punjabi | 23 of 24 | 24 of 24 | $0.72 |
| Mi pueblo, la plaza del centro | Spanish | 19 of 21 | 21 of 21 | $0.53 |
| My primary school in Ibadan | English | 40 of 41 | 41 of 41 | $1.07 |
| Korona shopping street on a straight road | Japanese | 23 of 23 | 23 of 23 | $0.30 |
| Castle on a hill with dragon tower | English | 21 of 29 | 28 of 29 | $1.16 |

These checks come from the app's own map of each speaker's words, so they measure the build against that map rather than an outside answer key.

The per-build data behind this table, with each failed check, is in `eval/results/audio-places.json`.
