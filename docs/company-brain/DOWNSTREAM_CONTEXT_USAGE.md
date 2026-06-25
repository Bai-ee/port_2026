# Downstream Context Usage

Downstream cards should load Client Brain opportunistically.

Pattern:

```js
const clientBrainContext = await loadClientBrainContext(clientId);
```

If no context exists, the card must proceed as before.

Current first consumer:

- Strategy Builder reads `CLIENT_CONTEXT` when the `client-brain` source toggle is enabled.

Planned consumers:

- Post Me
- Social Preview
- Creative Brief
- Executive / Market Brief
- Email Digest
- Marketing Insights
- Lead Gen

