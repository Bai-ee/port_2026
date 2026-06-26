# Discovery Intelligence

Discovery Intelligence answers: where should this client be discovered?

It is the Client Brain domain that feeds search defaults, Market Insights, Strategy Builder, Lead Gen, watchlists, and future social listening.

## Fields

```ts
DiscoveryIntelligence {
  keywords: string[];
  primaryPlatforms: string[];
  communities: string[];
  publications: string[];
  podcasts: string[];
  events: string[];
  directories: string[];
  awards: string[];
  socialEcosystems: string[];
  hashtags: string[];
  watchLists: string[];
}
```

## Source Section

`CLIENT_BRAIN.md` supports:

```md
## Discovery Intelligence

### Keywords
- Creative Systems Architecture

### Primary Platforms
- web
- x
- linkedin

### Communities
- Creative technologists

### Publications
- Figma blog

### Podcasts
- Design Better

### Events
- Config

### Directories
- Product Hunt

### Awards
- Webby Awards

### Social Ecosystems
- Design Twitter

### Hashtags
- #designengineering

### Watch Lists
- @example
```

## Downstream Use

- Search defaults use `keywords`, `watchLists`, and `socialEcosystems`.
- Social defaults use `primaryPlatforms` and `watchLists`.
- Market Insights can use `keywords`, `communities`, `publications`, `events`, and `podcasts`.
- Lead Gen can use `directories`, `awards`, `communities`, and `socialEcosystems`.
- Strategy Builder can use the same fields to ground campaign angles in where the audience already spends attention.

## Rule

Store decisions, not raw research dumps.

Good:

```md
### Communities
- Creative technologists
- AI builders
```

Bad:

```md
### Communities
Here are 40 links I found, some maybe relevant...
```
