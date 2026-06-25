# Client Brain Card Spec

The Client Brain card is a strategic control panel, not a raw document manager.

Required surfaces:

- Brain Health: status, generated time, enabled sources, missing high-priority fields, confidence
- Input Sources: source label/type, enabled toggle, trust/freshness/relevance, use-for controls, summary
- Generated Brain: identity, positioning, voice, audience, offers, proof, content pillars
- Output Context Pack: short and long `CLIENT_CONTEXT`
- Downstream Usage: consumers that can read the context pack
- Actions: save sources, regenerate, approve, mark stale, export/copy context

Current implementation is admin/gated through the existing dashboard gating model.

