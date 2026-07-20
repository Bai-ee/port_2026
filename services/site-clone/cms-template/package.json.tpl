{
  "name": "{{PROJECT}}-cms",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "cross-env NODE_OPTIONS=--no-deprecation next dev -p 3100",
    "build": "cross-env NODE_OPTIONS=--no-deprecation next build",
    "start": "cross-env NODE_OPTIONS=--no-deprecation next start -p 3100",
    "seed": "cross-env NODE_OPTIONS=--no-deprecation tsx src/seed.ts"
  },
  "dependencies": {
    "@payloadcms/db-sqlite": "3.86.0",
    "@payloadcms/next": "3.86.0",
    "@payloadcms/richtext-lexical": "3.86.0",
    "@payloadcms/ui": "3.86.0",
    "cross-env": "^7.0.3",
    "graphql": "^16.9.0",
    "next": "15.4.11",
    "payload": "3.86.0",
    "react": "19.1.0",
    "react-dom": "19.1.0",
    "sharp": "^0.34.2"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/react": "19.1.0",
    "@types/react-dom": "19.1.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2"
  },
  "engines": {
    "node": ">=20"
  }
}
