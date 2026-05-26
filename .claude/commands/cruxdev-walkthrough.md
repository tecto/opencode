# /cruxdev-walkthrough

Drive an interactive walkthrough for a build plan stub that has open topics requiring project-owner input before `/cruxdev-create` can produce the full plan body.

## Usage

```
/cruxdev-walkthrough <build-plan-path>
```

Example: `/cruxdev-walkthrough build_plans/BUILD_PLAN_243_RECALL_QUERY_PIPELINE_AND_UNIVERSAL_TRACEABILITY.md`

## What this does

1. Read the build plan at `<build-plan-path>`.
2. Find the "Walkthrough topics" section (or equivalent enumerated open questions).
3. Present **Topic 1 only** — one sentence of context, then the question. Wait for the user's answer.
4. After the user answers, capture the answer, acknowledge it in one line, then present **Topic 2 only**. Wait.
5. Continue topic-by-topic until all topics are resolved.
6. After the final topic: summarize the resolved answers (one line per topic), then tell the user to run `/cruxdev-create <build-plan-path>` to produce the full plan body with the locked-in answers.

## Hard rules (from memory)

- **One topic per turn.** Never present two topics at once. Never ask a follow-up that implies the next topic.
- **No auto-advance.** After capturing an answer, STOP. Do not proceed to the next topic in the same turn. Wait for the user to signal readiness (any reply works — even "ok" or "next").
- **Brief context, not a lecture.** Each topic intro is ≤ 2 sentences. The question itself is ≤ 1 sentence. If you need more than 3 sentences total, the question is too complex — split it.
- **Capture verbatim.** When the user answers, restate their answer in one short line (`> Answer: ...`) so they can correct misunderstandings before you advance.
- **No assumptions.** If the user's answer is ambiguous, ask one clarifying question before advancing to the next topic.

## Format per topic turn

```
**Topic N of M — <Topic title>**

<1-2 sentences of context>

<The question itself>
```

After the user answers:
```
> Answer: <their answer distilled to one line>

Ready for Topic N+1 when you are.
```

## After all topics are resolved

```
**All N topics resolved. Summary:**

1. <Topic 1 title>: <answer one-liner>
2. <Topic 2 title>: <answer one-liner>
...

Run `/cruxdev-create <build-plan-path>` to produce the full plan body with these answers locked in.
```
