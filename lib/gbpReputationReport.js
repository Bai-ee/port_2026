// gbpReputationReport.js — PRECOMPUTED Rosita's GBP reputation projection (ESM, client-safe).
//
// The source of truth is the CommonJS analyzer features/gbp-reputation/analyzer.js,
// which cannot be imported into the client bundle (its dir is type:commonjs and
// React Fast Refresh injects import.meta). This file is the analyzer output for the
// Rosita's mock, regenerated and kept in sync by the gbp-reputation sync test.
// DO NOT hand-edit — change the analyzer/mock and re-run the generator.

export const ROSITAS_GBP_REPORT = {
  "connected": true,
  "setupRequired": false,
  "locationName": "Rosita's Mexican Restaurant",
  "profileUrl": "https://www.google.com/maps/place/Rositas+Mexican+Restaurant",
  "ratingAverage": 4.4,
  "reviewCount": 186,
  "unrepliedCount": 4,
  "negativeUnrepliedCount": 2,
  "newestReviews": [
    {
      "name": "accounts/rositas/locations/main/reviews/r3",
      "starRating": "ONE",
      "reviewer": {
        "displayName": "Jessica R."
      },
      "comment": "Rude host and cold food. Not what it used to be.",
      "createTime": "2026-06-24T13:15:00Z",
      "_rating": 1
    },
    {
      "name": "accounts/rositas/locations/main/reviews/r2",
      "starRating": "TWO",
      "reviewer": {
        "displayName": "Mike T."
      },
      "comment": "Waited 40 minutes for our food and the order was wrong. Disappointed this time.",
      "createTime": "2026-06-23T19:05:00Z",
      "_rating": 2
    },
    {
      "name": "accounts/rositas/locations/main/reviews/r4",
      "starRating": "THREE",
      "reviewer": {
        "displayName": "John D."
      },
      "comment": "Food was good but the place was understaffed on a Friday night.",
      "createTime": "2026-06-22T21:40:00Z",
      "_rating": 3
    },
    {
      "name": "accounts/rositas/locations/main/reviews/r1",
      "starRating": "FIVE",
      "reviewer": {
        "displayName": "Sarah M."
      },
      "comment": "Best Mexican food in DeKalb! The carnitas were perfect and service was fast.",
      "createTime": "2026-06-21T18:30:00Z",
      "reviewReply": {
        "comment": "Thank you so much, Sarah! We're thrilled you enjoyed it. See you again soon!",
        "updateTime": "2026-06-21T20:10:00Z"
      },
      "_rating": 5
    },
    {
      "name": "accounts/rositas/locations/main/reviews/r5",
      "starRating": "FIVE",
      "reviewer": {
        "displayName": "Carlos V."
      },
      "comment": "Authentic and affordable. The margaritas are the best in town.",
      "createTime": "2026-06-20T22:00:00Z",
      "_rating": 5
    }
  ],
  "reviewsNeedingReply": [
    {
      "name": "accounts/rositas/locations/main/reviews/r3",
      "starRating": "ONE",
      "reviewer": {
        "displayName": "Jessica R."
      },
      "comment": "Rude host and cold food. Not what it used to be.",
      "createTime": "2026-06-24T13:15:00Z",
      "_rating": 1
    },
    {
      "name": "accounts/rositas/locations/main/reviews/r2",
      "starRating": "TWO",
      "reviewer": {
        "displayName": "Mike T."
      },
      "comment": "Waited 40 minutes for our food and the order was wrong. Disappointed this time.",
      "createTime": "2026-06-23T19:05:00Z",
      "_rating": 2
    },
    {
      "name": "accounts/rositas/locations/main/reviews/r4",
      "starRating": "THREE",
      "reviewer": {
        "displayName": "John D."
      },
      "comment": "Food was good but the place was understaffed on a Friday night.",
      "createTime": "2026-06-22T21:40:00Z",
      "_rating": 3
    },
    {
      "name": "accounts/rositas/locations/main/reviews/r5",
      "starRating": "FIVE",
      "reviewer": {
        "displayName": "Carlos V."
      },
      "comment": "Authentic and affordable. The margaritas are the best in town.",
      "createTime": "2026-06-20T22:00:00Z",
      "_rating": 5
    }
  ],
  "negativeReviews": [
    {
      "name": "accounts/rositas/locations/main/reviews/r2",
      "starRating": "TWO",
      "reviewer": {
        "displayName": "Mike T."
      },
      "comment": "Waited 40 minutes for our food and the order was wrong. Disappointed this time.",
      "createTime": "2026-06-23T19:05:00Z",
      "_rating": 2
    },
    {
      "name": "accounts/rositas/locations/main/reviews/r3",
      "starRating": "ONE",
      "reviewer": {
        "displayName": "Jessica R."
      },
      "comment": "Rude host and cold food. Not what it used to be.",
      "createTime": "2026-06-24T13:15:00Z",
      "_rating": 1
    }
  ],
  "suggestedReplies": [
    {
      "reviewName": "accounts/rositas/locations/main/reviews/r3",
      "reviewer": "Jessica R.",
      "rating": 1,
      "sentiment": "negative",
      "draft": "We sincerely apologize that your experience didn't meet expectations. Your feedback matters to us and we'd like to make it right. Please reach out to us directly at (815) 756-3817 so we can address your concerns."
    },
    {
      "reviewName": "accounts/rositas/locations/main/reviews/r2",
      "reviewer": "Mike T.",
      "rating": 2,
      "sentiment": "negative",
      "draft": "We sincerely apologize that your experience didn't meet expectations. Your feedback matters to us and we'd like to make it right. Please reach out to us directly at (815) 756-3817 so we can address your concerns."
    },
    {
      "reviewName": "accounts/rositas/locations/main/reviews/r4",
      "reviewer": "John D.",
      "rating": 3,
      "sentiment": "neutral",
      "draft": "Thank you for taking the time to share your feedback. We truly appreciate it and are always looking for ways to improve. We'd love the chance to give you a 5-star visit next time!"
    },
    {
      "reviewName": "accounts/rositas/locations/main/reviews/r5",
      "reviewer": "Carlos V.",
      "rating": 5,
      "sentiment": "positive",
      "draft": "Thank you so much for your wonderful review! We're thrilled you enjoyed your experience at Rosita's. We look forward to seeing you again soon!"
    }
  ],
  "profileHealth": {
    "hasWebsite": true,
    "hasPhone": true,
    "hasHours": true,
    "hasPhotos": true,
    "hasRecentPosts": false,
    "hasMenuOrProducts": false
  },
  "profileGaps": [
    "hasRecentPosts",
    "hasMenuOrProducts"
  ],
  "seoChecklist": {
    "completed": 9,
    "total": 25,
    "priorityItems": [
      {
        "id": "respond-reviews-24h",
        "label": "Respond to every single review within 24 hours",
        "frequency": "daily",
        "category": "Google Business Profile"
      },
      {
        "id": "ask-every-customer-review",
        "label": "Ask every single customer for a review — every single one",
        "frequency": "daily",
        "category": "Google Business Profile"
      },
      {
        "id": "site-indexed",
        "label": "Make sure rositas.com is indexed — if Google can't find your pages, nothing else matters",
        "frequency": "weekly",
        "category": "Website Foundations"
      },
      {
        "id": "gbp-updates-keyword-location",
        "label": "Include your keyword and location in every GBP update you post",
        "frequency": "weekly",
        "category": "Google Business Profile"
      }
    ]
  },
  "riskLevel": "urgent",
  "priorityAction": {
    "label": "Reply to 2 negative reviews",
    "reason": "Negative unreplied reviews are the highest reputation risk.",
    "severity": "high"
  }
};
