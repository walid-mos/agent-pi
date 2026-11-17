---
name: coding-tdd
description: >-
    Red-green work order for a test that catches a reproduced bug or a new
    unit branching on input or state, and the triage of a failing test:
    mechanical breakage, intended behaviour change, pre-existing failure or
    regression. Load before authoring a test or changing a test's
    expectation.
---

# Test-driven work

Follow `~/.pi/agent/AGENTS.md` under Tests. This skill adds the work order.

## Pick the work order

| The change | Work order |
|---|---|
| Fixes a reproduced defect: wrong result, crash, wrong state or regression | Reproduce it through a public interface. Write one test named after it. Run it and show red, apply the smallest fix, then show green. |
| Adds a unit whose behaviour branches on input or state: pure function, reducer, validation, permission, money rule, stateful hook or component | State each observable requirement. Write one failing test for the next requirement, implement enough to pass, then refactor with the test green. Repeat only for another stated requirement. |
| Presentation, wording, wiring, configuration, dependencies, builds, renames, behaviour-preserving refactors, prototypes, one-off scripts, docs | Build directly. Run the existing checks that cover the change. |

## Triage a failing test

Read the failing assertion and the diff of your task, then act on the first row that holds:

| The failure | Action |
|---|---|
| Follows formatting, a moved or renamed import, a renamed symbol or a changed call signature whose meaning stays | Update the test to follow the code. |
| Checks behaviour your task changed on purpose | Rewrite the expectation from the new requirement, never from the value the code now returns, and name the test and the behaviour in your report. |
| Fails the same way on the base commit | Pre-existing: report it, and fix it only when it is in your task. |
| Anything else | Regression: fix the code and keep the expectation. |

## Keep the cycle small

- Exercise the public input and output. The named bug or requirement is the test's title.
- Show the failing assertion before the fix. An unrelated runner, import or environment failure does not reproduce the bug.
- Run the single case or file during the cycle. Run the required suite once before presenting or committing.
- Refactor only after green. A new requirement starts a new failing test.
- Read `~/.pi/agent/skills/coding/testing.md` before authoring. It owns falsifiability, independent expected values, boundary fakes and determinism.

Failure contracts: `~/.pi/agent/skills/coding-error-design/SKILL.md`. Dependency boundaries: `~/.pi/agent/skills/coding-boundaries/SKILL.md`.
