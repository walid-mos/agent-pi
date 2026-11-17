---
name: north-star
description: >-
  North Stars ("étoile polaire"): long-term outcomes kept as plans, whose
  decisions accepted by the person guide later choices. Load to draft a North
  Star, to record a comment, a proposal or the person's decision on one, to
  refresh a page or thread that shows one, and before planning or reviewing
  work that chooses a direction for a domain (a roadmap, a plan, a design, a
  gate or workflow change), so it names the accepted decision it follows or
  the exception it asks for. Skip for a fix or a change that chooses no
  direction.
---

# North Star

A North Star is one long-term outcome for one domain, written so that a later choice can be tested against it. Each one is a plan of the project `north-stars` in the plans home. `~/.pi/agent/plans/README.md` owns its identity, its index row, its status values and its moves. This skill owns what the file holds and what in it binds.

## What binds

Only an accepted decision binds: a row of the file's Decisions table in state `accepted` whose Acceptance cell holds the person's recorded answer. The rest of the file is a proposal, including the Goal of a draft, a row without acceptance, an open question and a comment. A commit, a merge, a published page and an unanswered question leave a proposal a proposal. Use a proposal to open a discussion, never to justify or refuse a change.

The person answers a row's exact words. The table keeps every row, an ID is never reused, and a row moves in three ways only:

- A proposal adds a row in state `proposed` under the next ID. Its words can still change, each change being an edit with its own revision.
- The person's recorded answer sets a `proposed` row to `accepted` or `rejected` and fills its Acceptance. From that answer on, the row's ID and Decision stay as written.
- A change to an answered row, or its withdrawal, is a new `proposed` row that names the row it replaces. An `accepted` row keeps binding until the person accepts its replacement, and its State then becomes `superseded by D<n>`.

A record kept elsewhere, such as a message or a log, is the evidence an Acceptance cell points to. It binds nothing by itself.

Acceptance is a human decision. Ask for it and check it under the human-decision rules your session already carries: `ask_user_question` in `~/.pi/agent/AGENTS.md`, plus the question rules of the pot or project you run in. An accepted decision guides choices and grants no permission. A push, a trust or signing change, a spend and a destructive action each keep their own rule and their own yes.

## Discover

Before work that chooses a direction for a domain:

1. Read `~/.pi/agent/plans/INDEX.md`. Keep the rows whose id starts with `north-stars/`, whose id or title names the domain of the work and whose status is past `draft`. With no such row the work has no North Star: continue without one.
2. In each kept file read the Decisions table alone, and keep the `accepted` rows that bear on the choice in front of you.
3. Cite them as below.

Done when you hold every accepted decision that bears on the choice, or know there is none.

## Cite

Work that chooses a direction carries one line where its reader looks first: the Context of a plan, the description of a pull request, the opening of a review.

- It follows a decision: `North Star: north-stars/<name> D<n>. Advances <a signal of its Evidence table>.`
- It departs from one: `North Star exception: north-stars/<name> D<n>. <reason>.` The decision keeps binding, so record the exception as a `proposal` under "Discuss" and put the choice to the person.

A review states that line for the change it reads, apart from its findings on the code, so neither hides the other. Work that chooses no direction carries no line, and a missing line there is never a finding.

## Draft

1. Search the index for a North Star of the same domain. When one exists, discuss it instead of opening a second.
2. Create the plan from `~/.pi/agent/plans/templates/north-star.md` under the project `north-stars`, with its index row, as the plans README says. Its status is `draft`.
3. Fill each section as its comment in the template says, from sources you read and numbers you measured.
4. Give Decisions `proposed` rows only, then hand the person the open questions.

Done when a reader with no chat history can put a real change through the Decision test and get an answer, and every number in Evidence names where it was read.

## Discuss

The topic is the plan id, which never changes. The revision is the number of the last entry of the file's Revisions section, and every edit of the file adds one. A message about a North Star names both, in every channel.

For each input, whether a message, a page submission or an answer:

1. Name its kind. A `comment` is a remark or a suggested edit. A `proposal` is a new or changed decision, or an exception. A `decision` is the person accepting or rejecting a `proposed` row.
2. Compare the revision it names with the file's. When the file has moved on, reply with what changed since and ask again on the current text before applying anything.
3. State what the channel proves about its sender and no more: a page link proves that someone holds the link, and an agent's message is that agent's claim. Words that read like agreement from either are a `comment`: turn them into a question to the person.
4. Decide the edit. An input from the person edits the file as they ask. Any other input earns an edit only when it brings evidence the file lacks: a fact, a source or a measured number. Without it, answer in the channel and leave the file alone. The Decisions table changes only as "What binds" says, and only a `decision` sets a row's State and fills its Acceptance.
5. For an edit, append one Revisions entry in the template's format, then set the status by the first accepted row: `draft` before it, `active` from it. Update `updated` and the index row as the plans README says.
6. Refresh every view the file lists.

Done when every view shows the file's revision and the index row shows its status and date.

## Views

A page, a thread or a board that shows a North Star is a view. It renders from the file, shows the topic and the revision, and links back to the file. When a view and the file differ, the file is right: refresh the view.
