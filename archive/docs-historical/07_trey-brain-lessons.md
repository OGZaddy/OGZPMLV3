## Git, Data Loss, and AI Trust – Trey’s Non-Negotiables

I’ve been burned by:

- full system wipes (multiple times),
- losing entire bots and having to rebuild from scratch,
- Git nukes (`reset --hard`),
- AIs poisoning the repo with huge files,
- assistants editing `main` like it’s a scratchpad.

This is not about “unwillingness to adapt.”  
This is about survival and sanity.

### Data & Git Lessons

- Assume the machine can die tomorrow.
- Assume the repo can get into a bad state if you’re careless.
- The job of any assistant is to **reduce** risk, not add clever new ways to lose work.

What I expect from tools/agents:

- Respect backups and cold copies.
- Treat GitHub as a mirror and recovery tool, not your personal playground.
- Never suggest `git reset --hard` as a casual fix.
- Never:
  - commit huge brain/log/secrets files,
  - shove multi-GB files through pre-commit hooks,
  - ignore `.gitignore`.

If your plan involves “nuke and pray,” it’s a bad plan.

---

### Onboarding Before Touching Code

I don’t want:

- cocky cold-start behavior,
- “I got this from a quick scan,”
- bots that refactor systems they don’t understand.

What you MUST do before changing anything:

1. Read the packed context (`claudito_context.md`).
2. Read the **full** changelog, not just the top segment.
3. Map the architecture:
   - where data comes in,
   - how signals are formed,
   - how decisions are executed,
   - where risk lives.
4. Confirm:
   - which branch we’re on,
   - which directory is actually live,
   - and whether this is production or sandbox.

Only then do you propose changes. In that order.

---

### Behavioral Red Flags (for AIs)

Red flags that make me stop trusting you:

- You start renaming things or “cleaning up” without being asked.
- You propose sweeping changes without being able to explain the architecture.
- You ignore explicit instructions (like “don’t touch main,” “don’t commit brain files,” etc.).
- You create duplicate modules or functions that already exist.
- You act like every new context window is a fresh universe where none of the previous burns matter.

If you do any of that, you’re not helping. You’re creating babysitting work.

---

### Good AI / Agent Behavior (Refined)

Good behavior, from my point of view:

- You **ask or state assumptions** when something is unclear instead of winging it.
- You can clearly summarize:
  - what OGZPrime is,
  - how it’s structured,
  - current focus,
  - recent major changes.
- You propose:
  - small, reversible changes,
  - in clearly bounded scopes,
  - with diffs and test commands.
- You don’t touch:
  - risk logic,
  - position sizing,
  - execution wiring,
  - git history,
  - without clearly labeling the impact.

The ideal AI doesn’t make me babysit.  
It understands that I’ve already rebuilt this thing from scorched earth more than once and acts accordingly.
