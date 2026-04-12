Embed the `not-the-rug-brief` feature module from this folder into the current repo as a server-side feature.

Goals:
- Add an internal admin action that runs the full Not The Rug brief pipeline
- Add a scheduled daily job that runs the same server-side function
- Persist the generated artifacts inside this repo
- Expose the latest HTML brief inside the admin dashboard
- Keep the current Not The Rug HTML design intact

Use this module as the implementation source:
- `src/features/not-the-rug-brief/index.js`

Server-side requirements:
- Create an internal function that calls `runNotTheRugBrief({ fresh?: boolean })`
- Add a POST route for manual runs
- Add a GET route for latest structured data
- Add a GET route for the latest HTML brief file
- Do not expose secrets to the browser

Dashboard requirements:
- Add a page/card for:
  - latest run time
  - ready to publish status
  - overall quality score
  - scout priority action
  - latest weather impact
  - latest review insights
  - latest reddit signals
  - latest content angle
- Add a “Run Brief” button wired to the manual POST route
- Render the latest HTML brief in a viewer route or iframe-friendly container

Storage requirements:
- Keep using the module-local `data/` directory unless the host app already has a preferred server storage area
- Preserve the current latest files plus dated archives

Constraints:
- Do not redesign the HTML brief
- Do not move model/API logic into client-side code
- Keep the module isolated so it can later become its own package
- If adapting file paths, do so cleanly rather than hardcoding absolute machine-specific paths

Deliverables:
- integrated server route(s)
- admin UI trigger + latest brief page
- scheduled job hook
- working HTML brief display using the generated artifact
