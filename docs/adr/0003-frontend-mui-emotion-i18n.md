---
status: accepted
date: 2026-07-03
---

# Context
The frontend must be modern, tidy, accessible and easy to translate later.
A styling approach and component library had to be chosen.

# Decision
Use MUI (Material UI) with Emotion `sx` styling on the Next.js App Router.
All design values come from a central `theme`; global tweaks go through
`theme.components`. Static UI text lives in locale files (`src/locales/en.json`)
behind a small i18n layer, with English (`en`) as the default language.

# Rationale
- MUI ships accessible, standard components — fewer custom widgets to maintain.
- Theme-first styling keeps design consistent and avoids scattered magic values.
- Externalising strings makes future translation a matter of adding a locale file.

# Consequences
- No Tailwind or separate CSS framework; `sx` + theme only.
- Component-level overrides are allowed only when strictly necessary and minimal.
- Adding a language = add a locale JSON + register it; no component changes.

# Related
- ADR 0001 (diffusers engine), ADR 0002 (Windows GPU install)
