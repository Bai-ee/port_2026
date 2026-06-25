'use strict';

// rositas-mock.js — Realistic Rosita's GBP payload for the GBP Reputation card.
//
// Rosita's Mexican Restaurant is a (to-be-created) local-business client.
// Profile facts are real (Claude_Rositas_GBP/contextService.js); reviews are
// representative sample data in the live GBP review shape. This is the raw
// input the gbp-reputation analyzer normalizes — swap for live OAuth data later.

const ROSITAS_GBP_PAYLOAD = {
  connected: true,
  locationName: "Rosita's Mexican Restaurant",
  brand: "Rosita's",
  phone: '(815) 756-3817',
  site: 'rositas.com',
  profileUrl: 'https://www.google.com/maps/place/Rositas+Mexican+Restaurant',
  ratingAverage: 4.4,
  reviewCount: 186,
  profileHealth: {
    hasWebsite: true,
    hasPhone: true,
    hasHours: true,
    hasPhotos: true,
    hasRecentPosts: false,
    hasMenuOrProducts: false,
  },
  checklistCompletedIds: [
    'address-in-footer',
    'meta-title-keyword',
    'h1-keyword-city',
    'phone-above-fold',
    'citation-yelp',
    'citation-bbb',
    'citation-yellowpages',
    'bing-listing',
    'gbp-photo-weekly',
  ],
  reviews: [
    {
      name: 'accounts/rositas/locations/main/reviews/r1',
      starRating: 'FIVE',
      reviewer: { displayName: 'Sarah M.' },
      comment: 'Best Mexican food in DeKalb! The carnitas were perfect and service was fast.',
      createTime: '2026-06-21T18:30:00Z',
      reviewReply: {
        comment: "Thank you so much, Sarah! We're thrilled you enjoyed it. See you again soon!",
        updateTime: '2026-06-21T20:10:00Z',
      },
    },
    {
      name: 'accounts/rositas/locations/main/reviews/r2',
      starRating: 'TWO',
      reviewer: { displayName: 'Mike T.' },
      comment: 'Waited 40 minutes for our food and the order was wrong. Disappointed this time.',
      createTime: '2026-06-23T19:05:00Z',
      // unreplied — negative
    },
    {
      name: 'accounts/rositas/locations/main/reviews/r3',
      starRating: 'ONE',
      reviewer: { displayName: 'Jessica R.' },
      comment: 'Rude host and cold food. Not what it used to be.',
      createTime: '2026-06-24T13:15:00Z',
      // unreplied — negative
    },
    {
      name: 'accounts/rositas/locations/main/reviews/r4',
      starRating: 'THREE',
      reviewer: { displayName: 'John D.' },
      comment: 'Food was good but the place was understaffed on a Friday night.',
      createTime: '2026-06-22T21:40:00Z',
      // unreplied — neutral
    },
    {
      name: 'accounts/rositas/locations/main/reviews/r5',
      starRating: 'FIVE',
      reviewer: { displayName: 'Carlos V.' },
      comment: 'Authentic and affordable. The margaritas are the best in town.',
      createTime: '2026-06-20T22:00:00Z',
      // unreplied — positive
    },
    {
      name: 'accounts/rositas/locations/main/reviews/r6',
      starRating: 'FOUR',
      reviewer: { displayName: 'Amanda K.' },
      comment: 'Solid spot for a family dinner, kids loved it.',
      createTime: '2026-06-19T18:00:00Z',
      reviewReply: {
        comment: 'Thanks Amanda — glad the family had a great time!',
        updateTime: '2026-06-19T19:30:00Z',
      },
    },
  ],
};

// Disconnected example — used to verify the setup-needed degrade path.
const ROSITAS_GBP_DISCONNECTED = {
  connected: false,
  locationName: "Rosita's Mexican Restaurant",
};

module.exports = { ROSITAS_GBP_PAYLOAD, ROSITAS_GBP_DISCONNECTED };
