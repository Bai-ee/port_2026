// twitter-errors.js — shared X/Twitter error mapping. Split out of
// twitter-service.js so both the legacy posting path and the new per-client
// adapters (adapters/x.js) can map errors identically without adapters
// depending back on the orchestrator that depends on them.

export function compactTwitterError(error) {
  return {
    code: error?.code || null,
    message: error?.message || null,
    data: error?.data || null,
    rateLimit: error?.rateLimit || null,
  };
}

export function mapTwitterError(error) {
  let message = 'Failed to post to Twitter.';
  let hint = null;
  if (error?.code === 403) {
    const detail = String(error?.data?.detail || '');
    const reason = String(error?.data?.reason || '');
    if (detail.includes('duplicate')) {
      message = 'Tweet content appears to be a duplicate. Edit it and try again.';
    } else if (reason === 'client-not-enrolled') {
      message = 'X rejected the post because this developer app is not attached to an API Project.';
      hint = 'In the X developer portal, attach this app to a Project with API access, then regenerate the Access Token and Access Secret for that app.';
    } else {
      message = 'Twitter rejected the request. Check API write permissions.';
      hint = 'The OAuth token authenticated, but X rejected the write. Confirm the API key belongs to the Read and Write app shown in the developer portal, then regenerate the Access Token and Access Secret for that app.';
    }
  } else if (error?.code === 401) {
    message = 'Twitter authentication failed. Check API credentials.';
    hint = 'Use the Consumer Key, Consumer Secret, Access Token, and Access Token Secret from the same X app. Regenerate the OAuth 1.0a access token pair after changing app permissions or switching apps.';
  } else if (error?.code === 429) {
    message = 'Twitter rate limit exceeded. Wait before posting again.';
    hint = 'Retry after the X API rate limit window resets.';
  } else if (error?.code === 402) {
    // X's credit-based API model: the enrolled developer account has no credits,
    // so even text posts are rejected. This is a billing action on X's side.
    message = 'X API posting is out of credits on this developer account.';
    hint = 'Add credits / upgrade the X API plan at developer.x.com for the enrolled account, or use the web composer to post manually.';
  } else if (error?.code === 400) {
    const detail = error?.data?.detail
      || error?.data?.error_description
      || error?.data?.title;
    message = detail
      ? `X rejected the request: ${detail}`
      : 'X rejected the request as invalid.';
    hint = 'Reconnect the account if this happened during authorization refresh; otherwise verify the media and post fields.';
  } else if (error?.message) {
    message = error.message;
  }
  const out = new Error(message);
  out.status = error?.code === 429
    ? 429
    : error?.code === 402
      ? 402
      : error?.code === 400
        ? 400
        : 500;
  out.code = error?.code || null;
  out.details = error?.message;
  out.hint = hint;
  out.twitterError = compactTwitterError(error);
  return out;
}
