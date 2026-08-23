# Context-Efficient Codex Work

Small, portable notes for reducing context use during repository tasks.

## Map first

- Run `git status --short` before reading files.
- Use `rg --files` to identify the relevant directories.
- Search with `rg -n` before opening a whole file.
- Read only the needed range with `sed -n 'start,endp'`.

## Keep an evidence ledger

Track three short fields while working:

```text
Claim: what appears to be true
Source: file, line, command, or test
Status: verified / inferred / open
```

Do not repeat a verified claim from memory. Reuse the source location.

## Progressive disclosure

1. Read the task instructions and repository map.
2. Read the smallest files that define behavior.
3. Search for callers and tests before opening neighboring code.
4. Expand only when evidence shows another file matters.

For protocol work, read the public model, settled build plan, and executable simulator before changing behavior.

## Proof before prose

- Run the narrowest relevant test first.
- Capture the failure or success that justifies the next edit.
- Prefer one focused patch over speculative refactoring.
- Re-run the affected test, then the smallest broader check.

## Protect context and state

- Keep unrelated changes untouched.
- Do not paste large logs into the working context; summarize the result and retain the command.
- Stop long-running processes before changing their inputs.
- Never send, sign, deploy, or publish without explicit approval.

## Handoff

End with:

- changed files;
- verified commands and outcomes;
- open risks or deferred work;
- one suggested commit message.
