## What

<!-- What does this change, and why? One topic per pull request. -->

## How

<!-- The approach, and anything a reviewer should look at first. -->

## Checklist

- [ ] The title follows Conventional Commits (`feat(scope): ...`)
- [ ] Commits are signed off (`git commit -s`)
- [ ] `pnpm --filter @dfa/shared build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` pass
- [ ] `pnpm --filter @dfa/web i18n:check` passes, and no text is hard-coded in the UI
- [ ] New business table: `tenant_id` NOT NULL and row level security, with a tenant isolation test
- [ ] New migration: a matching script in `db/migrations/down/`
- [ ] New or changed API route: OpenAPI contract updated (`pnpm api:openapi`, `pnpm web:types`)
- [ ] Money stays in integer cents, never a float
- [ ] No secret, customer data, real hostname or IP address in the diff
- [ ] Documentation and `CHANGELOG.md` updated when behaviour changes
