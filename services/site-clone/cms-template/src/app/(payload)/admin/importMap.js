// Client components Payload's admin must resolve at runtime. The
// storage-vercel-blob plugin registers its upload handler here — an empty
// importMap made the ENTIRE admin render die (blank page; prod hides the
// error as a forever-suspended RSC boundary). Regenerate with
// `payload generate:importmap` if more plugins are added.
import { VercelBlobClientUploadHandler } from '@payloadcms/storage-vercel-blob/client';

export const importMap = {
  '@payloadcms/storage-vercel-blob/client#VercelBlobClientUploadHandler': VercelBlobClientUploadHandler,
};
