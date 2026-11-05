# iOS candidate — provider-retention disclosure

Before consent to each AI document scan, display Anthropic's standard API retention policy, possible processing outside Australia, safety/legal/separately-agreed exceptions, and the fact that iDogs account deletion does not immediately erase provider copies. Link directly to the commercial API retention policy. Reuse this component in the Privacy draft. Manual entry and per-document permission remain available; no scan request is sent by displaying the disclosure or cancelling it.

Sources checked 27 October 2026:
- https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data
- https://platform.claude.com/docs/en/manage-claude/api-and-data-retention

Authenticated Console observation: izi's Individual Org displays organization default retention On / 30 days. The owner answered that they are unsure whether this organization supplies the Production iDogs key. This is therefore **not** verified Production configuration. No API key was retrieved, no provider setting was changed and no claim of zero retention is made.

Production baseline independently resolved through Vercel: idogs.com.au and www.idogs.com.au alias deployment dpl_ERJ8DsmiapMMJMpCBkbdnEAqFfdM, source ba574cdb0388e007f73ff62bdb40028307ce97d1. The prior backend candidate db1a1fc80bd19a06f428ca370c0caf11bd71b1ba has a READY staging Preview dpl_3LDP4mZuh3L4Ek9AX7hMiWqSR4Ts. These are different sources and environments; do not blindly promote the release branch.

Local checks: 383 Vitest tests / 48 files, TypeScript, Vite production build and diff check passed. The consent regression verifies the disclosure is visible while the selected file remains local and cancellation sends nothing. React review: pure shared component, no effects, state or network calls, descriptive link text and safe external-link attributes.

App Store UI readback: build 86 still selected, saved notes and required four screenshot files still present; version remains Prepare for Submission. This candidate needs its own signed-build evidence and owner device acceptance before replacing build 86. No effective policy, Production activation or App Review submission is implied.
