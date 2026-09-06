# Fate UI system

This is the working example for how Fate frontend code should be designed and
maintained. It describes the product hierarchy, the component ownership model,
and the interaction standards for the Next.js app in `app/`.

## Product direction

Fate is a calm, dark, serious Solana product interface. It is an operational
app, not a marketing landing page and not a casino dashboard.

- Use a text Fate wordmark, one accent color, restrained typography, and clear
  spacing.
- Put the current draw and the user's next action first on mobile.
- Prefer cardless composition: sections, columns, dividers, lists, and native
  disclosure controls.
- Use utility copy that explains phase, status, risk, amount, timing, and
  outcome. Do not use promotional language to describe protocol behavior.
- Do not add casino imagery, decorative gradients, notification systems,
  analytics, or a card-grid dashboard.
- Treat motion as hierarchy and feedback. Every animation must remain useful
  when `prefers-reduced-motion: reduce` is active.

The primary app surface should answer these questions quickly:

1. What phase is the draw in?
2. What can this wallet do now?
3. What amount is at risk or claimable?
4. What will happen before the wallet signs?

## Engineering model

Use shadcn/ui as a selective source registry and engineering model, not as a
visual style or mandatory dependency. Its useful property is that component
source is copied into the repository and then owned by the product team.

Fate components must remain local, inspectable, and shaped around protocol
behavior. Do not hide transaction state, lifecycle rules, or custody warnings
behind generic abstractions.

### Component decision order

Before adding a component:

1. Search `app/src` for an existing component that already owns the behavior.
2. Use native HTML when it already provides the right semantics:
   `<details>`, `<summary>`, `<button>`, `<input>`, `<fieldset>`, `<label>`,
   and semantic sections are preferred.
3. Extract a small local primitive when the same interaction has earned reuse
   in at least three places.
4. Copy and adapt one shadcn primitive only when native HTML and existing Fate
   components are insufficient.

Never run `add --all`. Never add a component only because it is available.
Avoid a new dependency or utility when a short local implementation is easier
to inspect and has only one consumer.

### Current selective choices

- **Transaction review:** use a local Dialog or AlertDialog-style component
  when the review becomes a true modal. It must show cluster, fee payer,
  transfers, recipients, simulation status, and the possible outcome before
  signature.
- **Staker / Player selection:** keep the current local switch while it is
  sufficient. Consider a ToggleGroup-style primitive only if the interaction
  needs clearer selected-state, keyboard, or orientation behavior.
- **Refresh and lifecycle controls:** use a Tooltip-style primitive only when
  an icon-only control cannot have a clear visible label. A tooltip never
  replaces an accessible name.
- **Toasts:** keep Fate's custom toast stack. It owns transaction and RPC
  feedback and should not be replaced by a generic notification package.
- **Cards:** do not introduce a generic Card component or card-grid layout.
  A bordered panel is justified only when it is the interaction itself, such
  as transaction review or a focused action surface.

There is no need to install shadcn or add a component registry configuration
until the first real primitive needs it. Source lookup may inform the local
implementation without committing Fate to the shadcn visual defaults.

## Tokens and visual language

Use semantic roles rather than scattering raw colors through JSX or CSS. The
current variables in `app/src/app/globals.css` are the source of truth for the
existing palette; preserve their visual meaning while improving their names or
structure incrementally.

| Semantic role | Fate meaning |
| --- | --- |
| background | page and app canvas |
| foreground | primary readable text |
| muted | supporting text and secondary labels |
| border | quiet dividers and control boundaries |
| panel | restrained elevated surface |
| primary | the single action accent |
| destructive / warning | risk, failure, or irreversible action |
| focus | the visible keyboard focus indicator |

Do not create a new color for each component state. Prefer a semantic token,
an existing opacity treatment, or a layout change. Preserve the one-accent
hierarchy and keep contrast strong enough for text, controls, and status.

## Interaction contract

Every interactive component must define its behavior in all of these states:

- **Default:** the action and current state are understandable without hover.
- **Focus:** keyboard focus is visible and not removed for visual reasons.
- **Keyboard:** buttons, inputs, disclosure controls, menus, and dialogs work
  without a pointer; Escape and focus return behavior must be explicit where
  applicable.
- **Disabled:** explain why an action is unavailable when the reason is not
  obvious. Disabled controls must not look like a loading state.
- **Loading / submitted:** prevent duplicate actions, preserve the user's
  context, and show whether the transaction is submitted, confirming, failed,
  stale, or dropped.
- **Error:** state what failed, what remains safe, and the next available
  action. Do not turn an RPC or wallet error into a vague success/failure
  toast.
- **Reduced motion:** remove ornamental transitions and preserve state changes
  and status communication without animation.

For wallet and lifecycle actions, derive phase and balances from confirmed
on-chain state. Browser timers may display an expected deadline, but they are
never the source of truth. A composed lifecycle action must make the phase
change, accounts, fee payer, and possible outcome visible before signature.

## Fate composition rules

The page is one mobile-first workspace with a clear reading order:

1. Navigation, network, and wallet state.
2. Current draw phase, progress, and countdown.
3. Staker / Player action and current position.
4. Transaction review or pending state.
5. Advanced terms, claim state, and recent results in collapsed disclosures.

Keep feature behavior close to the feature that owns it. A page component may
compose `DrawHeader`, `DrawProgress`, `PositionActionForm`, `TransactionReview`,
and the disclosure sections, but protocol calculations belong in the domain or
view-model layer rather than in presentational JSX.

The existing app is the reference shape:

- `FateMain` composes the workspace and keeps the page order readable.
- `DrawTerms` and `RecentDraws` use native `<details>` for secondary context.
- `PositionActionForm` owns the Staker / Player action surface.
- `TransactionReview` owns pre-signature review content.
- `FateToastStack` owns transient wallet, transaction, and RPC feedback.
- `fate-view-model.ts` translates confirmed state into display decisions.

The source boundaries stay flat and capability-oriented:

- `app/` contains Next route entrypoints, providers, global CSS, and page
  composition only.
- `components/` contains reusable Fate UI, kept flat until a repeated visual
  family earns a narrower folder.
- `hooks/` contains client-side session, snapshot, lifecycle, and action
  orchestration.
- `features/draw/` owns draw-specific reads, action rules, lifecycle types,
  and settlement data. Future capability folders should represent real
  product capabilities such as chat or stats; do not create a generic
  `features/fate/` bucket.
- `domain/fate/` remains the protocol model and instruction boundary.
- `lib/` contains transport, wallet, RPC, and transaction infrastructure.

Keep the page controller as the composition boundary. Move code when its
responsibility clearly belongs to one of these boundaries; do not split files
just to make the tree look more modular.

If `app/src` is reworked, preserve these responsibilities before changing file
names or introducing a component library. Improve boundaries where evidence
shows duplicated behavior, unclear ownership, or missing state coverage.

## Review checklist

Before calling a frontend change complete, check:

- Does the UI use Staker and Player consistently?
- Is the primary action obvious on a narrow viewport?
- Does the screen expose phase, amount, risk, timing, and outcome honestly?
- Are existing local components and native HTML reused first?
- Are semantic tokens used instead of new raw colors?
- Are focus, keyboard, disabled, loading, error, and reduced-motion states
  covered?
- Does transaction review happen before wallet signature?
- Are confirmed on-chain values distinguished from browser estimates?
- Does the change preserve cardless composition and the single accent?
- Is a new primitive genuinely justified, locally owned, and small enough to
  understand?

For protocol, lifecycle, or transaction-UX changes, also follow the evidence
and release requirements in `README.md`, `docs/BUILD_PLAN.md`, and
`data-simulation/simulate.py` before changing behavior.
