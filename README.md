# Mostyn Rota Maker

**Live tool:** https://hassan-younas18.github.io/mostyn-rota/

A one-page web app that generates the fortnightly staff rota for the Mostyn Broadway site — a job that used to be done entirely by hand.

## The problem

I work at Mostyn Broadway. Our manager built every rota manually in a spreadsheet: 14 days, 3 shifts a day (morning 06:00–14:00, afternoon 14:00–22:00, night 22:00–06:00), 10 staff members — 42 slots to fill, one by one, plus a delivery every Tuesday.

What made it genuinely hard wasn't the size, it was the rules. Every single slot had to respect all of these at once:

1. **Rest rule** — nobody can work two shifts close together. There must be at least two full shift-slots between one shift and the next, which in practice means nobody can ever move to an *earlier* shift than the one they worked the day before (a night shift can only be followed by another night, or a day off).
2. **Arooj** can only work afternoons, and only until 21:30 — so on her days the afternoon shift is 7.5 hours and the night shift stretches to 21:30–06:00 (8.5 hours). The times of *other people's* shifts change depending on who works the afternoon.
3. **Elaine, Rida Fatima and Zeeshan** can only work mornings — so between them they compete for the same 14 slots. Elaine is available on Saturdays; Rida Fatima never works Sundays.
4. **Jerry** can work afternoons and nights, **Usama** can work mornings and nights, and **Wes** only works afternoons. **Rida Bilal** never works nights.
5. Everyone needs the **right number of shifts** for the fortnight, and the totals have to land on exactly 42.
6. Every **Tuesday there's a 4-hour delivery**, and whoever does it can't also be on a regular shift that day.
7. On top of all that, people ask for **specific days or shifts off**.

Checking one placement against all of this is easy. Checking placement number 30, against everything already on the sheet, while three people have requested time off — that's where the mistakes crept in. A single rota took days of back-and-forth, and fixing one clash usually created another somewhere else.

## The solution

This tool reduces the manager's job to the decisions only she can make, and automates everything else:

1. **Choose the dates** — first day and length of the rota (default 14 days).
2. **Set each person's shift count** — with +/− buttons and a live counter that shows when the numbers balance to exactly 3 × days.
3. **Pick the delivery person** — for each Tuesday, click who's doing the 4-hour delivery (one person or more, e.g. both Ridas). They aren't given a regular shift that Tuesday or the Monday night shift that runs into it, and the 4 hours are added to their total.
4. **Mark time off** — click M / A / N to block a single shift for a person on a day, or ✕ for the whole day. A whole day off also rules out the *previous* evening's night shift, since 22:00–06:00 would run past midnight into the day off. Days someone never works (Rida Fatima's Sundays) are already greyed out.
5. **Fix specific shifts (optional)** — choose a person for a date's morning, afternoon or night shift, leaving the other slots on **Automatic**. Fixed assignments count towards that person's total in step 2. Conflicts with time off, deliveries, allowed shifts, rest or shift totals are flagged. Pick **Automatic** again to release one assignment, or use **Clear fixed shifts** to release them all. If the rota dates change, fixed assignments stay on their calendar dates; those outside the new range are cleared with a notice.
6. **Generate** — a constraint solver (randomised backtracking over all 42 slots) fills the remaining rota so that *every* rule above holds. If it cannot find a valid completion, it asks you to adjust the inputs instead of producing a broken rota. "Generate again" keeps your fixed assignments and searches for a different valid arrangement for the remaining slots. Fixed assignments are labelled in the output and printed rota.

The output looks exactly like the rota everyone is used to — same columns including the Tuesday delivery, same colour coding, same shift times including the 21:30 handover on Arooj's days — plus a per-person summary of shifts, deliveries and hours. One click prints it on A4 landscape or saves it as a PDF.

### Adjust a generated rota

- **Click or tap a name** in the generated rota, choose a person, and press **Save change**. The edit window previews any warnings before saving.
- **Drag a name onto another shift** to swap the two people. Both shifts stay filled. On a phone or with a keyboard, open a shift and choose **Swap with another shift** instead.
- **Manual changes are allowed even when they break a rule.** Warnings flag allowed shift types, time off, non-working weekdays, deliveries, nights running into days off, rest, multiple shifts on one day, differences from each person's target, and changes to fixed assignments. Warnings and **! Review** markers appear only in the app; they are hidden when printing or saving as PDF.
- **Hours, shift totals and Arooj's handover times update immediately.** Changed assignments are labelled **Edited**; the original targets and fixed-shift settings remain in steps 2 and 5.
- Use **Undo last change** to reverse edits, or **Reset edits** to restore the generated rota. Reset can also be undone.

Manual edits apply to the current rota and its printout. **Generate again** creates a new rota from steps 1–5 and replaces those edits. Changing a generation setting clears the displayed rota. Reloading the page clears the rota and settings; print or save a PDF to keep a copy.

What took days now takes about a minute.

## Under the hood

- A single self-contained HTML file — no installs, no server, no dependencies. It runs entirely in the browser and works offline; the hosted copy is just this repository served by GitHub Pages.
- The scheduler is a backtracking search with pruning (restricted workers are checked against their remaining eligible slots, and every partial assignment is checked for feasibility) plus randomised restarts, so it both *proves* impossibility quickly and produces varied rotas on repeated runs.
- Run the scheduling and editing regression checks with `node --test test/rota.test.cjs` (Node.js required for tests only). They cover fixed assignments, repeated generation, exact totals, rest before and after fixed shifts, time off, deliveries, date changes, the 1–28 day range, manual reassignment and swaps, warning detection, and Arooj's handover times.
- Optional browser checks: with Playwright and Google Chrome installed, run `node --test test/rota.browser.test.cjs`. Set `ROTA_PLAYWRIGHT_MODULE` to the Playwright module's path if it is not installed locally. These checks cover actual drag-and-drop, the editor, keyboard and touch controls, undo/reset, regenerated output, and print styles. The app itself still needs no dependencies.

---

Built by Hassan with help from Claude Code.
