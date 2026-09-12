# TSN Protocol Documentation Agent Guide

## About this project

Documentation for the TSN Protocol by TrustLink Labs. The audience is protocol integrators, node operators, and developers building on TSN.

## Source of truth

- Protocol source: `trustlink-labs/tsn-protocol`
- Always ground protocol claims (message formats, opcodes, RPC methods, error codes, parameters) in the source. Never invent behavior.
- When code and docs disagree, update the docs to match the code and note the change in the PR summary.

## Structure

- `overview/` — Introduction and high-level concepts
- Add new guides under a directory that matches an existing navigation group; new directories become new sidebar groups
- Every page needs frontmatter: `title`, `sidebarTitle` (1–3 words, Title Case), `description` (130–155 chars)
- Open every page with a plain prose paragraph before any component

## Writing rules

- Second person, active voice, imperative for instructions
- Use Mintlify components: `<Steps>`, `<CodeGroup>`, `<Tabs>`, `<Card>`/`<CardGroup>`, `<Note>`/`<Warning>`/`<Tip>`, `<ParamField>`, `<ResponseField>`
- No raw HTML card markup; use `<Card>` and `<CardGroup>`
- No em dashes or en dashes as punctuation
- Code blocks always have a language tag; use titles like ` ```rust node.rs ` for filenames

## What to document

- Protocol messages, RPC endpoints, and their parameters
- Node setup, configuration, and operator workflows
- SDK/client integration guides with working examples
- Error codes and troubleshooting

## What NOT to document

- Internal build tooling, CI config, contributor workflows
- Private infrastructure or deployment scripts
- Implementation details a consumer would never see
