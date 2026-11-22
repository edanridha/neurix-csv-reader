# Neurix CSV — a faster broken-CSV reader

[![make.fun bounty](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![make.fun rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/edanridha/neurix-csv-reader/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![make.fun reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/edanridha/neurix-csv-reader/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

An entry for the make.fun bounty [Read broken CSV files faster, 21 November 2026](https://make.fun/bounty/csv-reader-speed-01-run-20261121).

`solve.js` is a dependency-free ES module whose `run({text, header})` returns
exactly what csv-reader 1.0.0 returns — `{columns, rows, errors}` — under the
same broken-row policy (BOM drop, stray CRs, doubled quotes, quote junk,
unterminated quotes read again as unquoted, ragged rows padded or cut to the
first record's width, and `{code, line, row}` errors in the order met). Where
the reference builds every field a character at a time, this reader scans by
char code and slices each run of ordinary characters out of the text in one
piece.

`main.ts` is the driver the harness runs: it reads every case from
`/input/cases.json`, answers each with `run`, and writes
`/output/answers.json`.

Node 22, no dependencies, no WebAssembly or native addons.

## Verification and speed

Checked against csv-reader 1.0.0 itself before submission:

- the kit's practice set: 6/6 cases byte-identical;
- 70,324 randomized broken-CSV fuzz cases (plus a hand-written edge-case
  battery covering every rule corner), each compared exactly against the
  reference implementation: zero mismatches;
- CPU time over the full practice set (20 passes, `process.cpuUsage`,
  `--no-incremental-marking` as the house driver sets it): csv-reader
  1.0.0 took 681.6 ms per pass, this reader 75.4 ms per pass — about
  **9.0× faster**. Two structurally different scanners (native `indexOf`
  search, and a lookup-table scan) were also built, verified and timed;
  both were slower, so the shipped reader is the char-code scanner.
