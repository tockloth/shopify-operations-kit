# Codex Workflow

## Working Mode

Codex should implement narrow slices end to end:

1. inspect the current code and data model
2. reuse existing patterns
3. make the smallest coherent change
4. add focused tests or smoke checks
5. update documentation when the system decision changes
6. run the relevant checks
7. report what changed and how to verify it

## Scope Discipline

Do not mix platform slices with unrelated feature work. Avoid large refactors unless they are necessary to remove a current blocker.

## Security Discipline

- never commit secrets
- never log access tokens
- never log protected customer data
- keep tenant filters explicit
- use Shopify webhook authentication for webhook routes

## Documentation Discipline

For each major slice, update or create docs that explain:

- what is new
- why the decision was made
- how to see it in the app
- how to test it locally
- how to verify it on Render/Supabase
- what remains open

## Product Sync Rule

Codex must not add Shopify Product mutations or bidirectional Product sync unless the user explicitly changes the architecture decision.
