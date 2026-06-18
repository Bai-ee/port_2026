export const POST_TYPES = [
  'authority',
  'reply-loop',
  'proof-loop',
  'kol-adjacent',
  'case-study',
  'offer',
  'asset',
  'conversation-starter',
];

export const VALID_TARGET_ACTIONS = [
  'reply',
  'repost',
  'quote',
  'click',
  'profile_click',
  'video_view',
  'photo_expand',
  'dwell',
  'follow_author',
  'favorite',
  'share',
];

export function isValidPostType(type) {
  return POST_TYPES.includes(type);
}

export function isValidTargetAction(action) {
  return VALID_TARGET_ACTIONS.includes(action);
}
