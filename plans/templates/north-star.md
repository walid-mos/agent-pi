---
id: north-stars/<name>
title: <The outcome in a few words>
project: north-stars
status: draft
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

<!--
A North Star, not an implementation plan. Read ~/.pi/agent/skills/north-star/SKILL.md before editing:
it owns the workflow and what in this file binds.
- These sections replace the plan template's: no diagram, phases, steps or file list.
  Implementation lives in ordinary plans that cite a decision ID from here.
- Telegraphic and one fact, one place, as for every plan.
- Keep the line under the title in every North Star.
-->

# <Title>

> Proposal, except the `accepted` rows of Decisions. Rules: `~/.pi/agent/skills/north-star/SKILL.md`.

## Goal

<!-- The end state as a fact someone can observe. 1-3 lines. No approach, no rationale. -->
<what is true once this North Star is reached>

## Context

<!-- Why it matters: what its absence costs today. Verified facts only, one line each, with the source. -->
- <fact, source>

## Evidence

<!-- How progress is observed: one row per signal, each read from a command, a log or a query. -->
<!-- Baseline is measured and dated, never estimated. "not measured" is a valid baseline. -->

| Signal | Read from | Baseline (date) | Wanted |
| --- | --- | --- | --- |
| <what is counted or checked> | <command, log, query> | <value, YYYY-MM-DD> | <value or direction> |

## Guardrails

<!-- What is never traded for the goal, the tradeoffs taken, the non-goals. One line each. -->
- Never: <what stays true whatever the goal costs>
- Tradeoff: <what is given up, and for what>
- Non-goal: <what this North Star does not ask for>

## Decision test

<!-- 1-3 yes/no questions a later task or review answers from its own plan or diff, each naming the decision it tests. -->
<!-- Prefer a question a check, a gate or a signal can answer over one that needs a reader's judgment. -->
1. <question> (D1)

## Sources

<!-- One row per source read. Keep what the author says apart from what we infer, and name what was not read. -->

| Source (link, author, date) | Author's claim | Our inference | Not read |
| --- | --- | --- | --- |

## Open questions

<!-- At most three. Each is a choice only the person can make: the question, the options, the proposal. -->
- <question>. Options: <a>, <b>. Proposal: <a>.

## Decisions

<!-- Ledger: append rows, never rewrite one. -->
<!-- State: proposed, accepted, rejected or superseded. -->
<!-- Acceptance, required for accepted and rejected: the date, the revision the person read, the question asked, their answer in their words, where the record is kept. -->

| ID | State | Decision | Acceptance |
| --- | --- | --- | --- |
| D1 | proposed | <one sentence a change can follow or break> | |

## Views

<!-- Each page, thread or board that shows this North Star, with its link. -->

## Revisions

<!-- One entry per edit of this file, newest last. The last number is this North Star's revision. -->

### r1, YYYY-MM-DD, proposal

- From: <what the channel proves about the sender>
- Kept at: <receipt, message link, log or session that holds the input>
- Change: <sections edited, decision IDs opened or moved>
