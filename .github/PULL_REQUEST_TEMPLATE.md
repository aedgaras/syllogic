# Pull Request

## Description

Please include a summary of the changes and the related issue.  
Also include relevant motivation and context.

Fixes #(issue_number)

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update
- [ ] Other (please describe):

## Checklist

- [ ] My code follows the project’s style guidelines
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] All new and existing tests pass
- [ ] I have checked my changes for sensitive data or secrets

### Frontend architecture (when `frontend/` changes)

- [ ] Routes only compose features; workflow behavior lives in orchestration
- [ ] Domain code is framework-independent, and presentation only renders data/emits intent
- [ ] Client and presentation code use feature contracts rather than DB or server-action types
- [ ] Cross-feature imports use `public.ts` or `server.ts`; shared/UI code imports no features
- [ ] I ran `pnpm lint:boundaries` and did not expand the legacy allowlist
- [ ] I documented remote-state/cache ownership and added proportional characterization tests

## Additional Context

Add any other context or screenshots about the PR here.
