# Git Conventions

This repository follows semantic commit message conventions, enforced by the
husky `commit-msg` hook (`.husky/commit-msg`). A message that does not match
`type(domain): Description` is rejected at commit time.

## Commit Message Format

All commit messages follow the format:

```
type(domain): Description
```

### Commit Types

The hook accepts exactly these types:

- `feat`: New user-facing feature in the extension (changes extension behavior or UI)
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks, scripts, and tooling that do not affect extension behavior (e.g. adding a package.json script, updating deps)
- `ci`: Continuous integration changes (CI/CD configuration, workflows, etc.)
- `ai`: AI-related changes or documentation (use when modifying `CLAUDE.md`, `.claude/docs/`, `.claude/agents/` or `.claude/skills/`)

Merge commits and `fixup!` / `squash!` commits are passed through unchecked.

### Domain

The domain specifies the area of the codebase affected:
- `manifest`: Extension manifest configuration
- `icons`: Extension icons
- `background`: Service worker, feature background handlers, the offscreen
  composition root (`src/offscreen/`), and `src/shared/offscreen-document.ts`
- `build`: Build system and tooling (`build-tools/`, Vite, Nix, husky)
- `content`: Content script
- `flashcard`: Flashcard review page
- `popup`: Popup UI components
- `stats`: Statistics page
- `dict`: Dictionary-related functionality
- `ocr`: Reading Chinese out of images (`src/ocr/`, its engine, overlay, and the
  offscreen cache/queue)
- `api`: API integration
- `agents`: Subagent definitions in `.claude/agents/`
- `git`: Git configuration and conventions
- `global`: Repository-wide changes

Multiple domains can be specified when a change affects multiple areas (e.g., `refactor(content, stats)`). Domains should be listed in alphabetical order (e.g., `refactor(background, dict)` not `refactor(dict, background)`). If more than 3 domains would be specified, use `global` instead.

### Description

- Start with a capitalized verb (e.g., "Add", "Fix", "Implement")
- Use present tense
- Be concise but descriptive
- Use a single sentence
- Avoid commas
- No period at the end

### Examples

```
feat(manifest): Add extension manifest configuration
fix(icons): Add blank placeholder icons for extension loading
feat(background): Implement dictionary API and statistics tracking
fix(api): Improve error handling and logging for API failures
refactor(background, dict): Replace runtime fetching with static imports
refactor(content, stats): Extract shared pronunciation section utilities
fix(build): Fix build path resolution and memory limit
ci(build): Add GitHub Actions workflow for automated builds
ai(git): Add ci commit type and build domain to git conventions
ai(global): Add agent documentation files
ai(agents): Add doc-reviewer subagent
```

## Branch Naming

- Use descriptive branch names
- Prefer kebab-case
- Include issue number if applicable: `fix-123-description`

## Commit Guidelines

1. Make atomic commits - each commit should represent a single logical change
2. Write clear, descriptive commit messages
3. Reference related issues when applicable
4. Keep commits focused on one domain when possible
5. Use multiple domains when a change affects multiple areas (e.g., `refactor(content, stats)`)
6. Use `global` domain if more than 3 domains would be specified
7. Commit from a shell with the Nix dev environment loaded — direnv does this
   automatically inside the repo, and the `pre-commit` hook runs `pnpm lint &&
   pnpm typecheck && pnpm test` and aborts if `pnpm` is not on `PATH`
