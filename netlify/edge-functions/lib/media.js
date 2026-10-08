// Canonical mime-type -> our media_type classification. A near-identical
// copy lives at src/lib/media.js for the frontend bundle — edge functions
// (Deno runtime) and the Vite browser bundle are separate builds with no
// shared import path in this repo, so this is duplicated rather than
// extracted into a new shared package for one ~10-line function. Keep both
// copies in sync if the mapping changes.
export function classifyMediaType(contentType) {
  if (!contentType) return null
  const [type] = contentType.split('/')
  if (type === 'image' || type === 'audio' || type === 'video') return type
  return 'document' // pdf, docx, xlsx, etc. — anything else Meta accepts
}
