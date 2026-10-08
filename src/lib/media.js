// Frontend copy of netlify/edge-functions/lib/media.js's classifyMediaType —
// see that file's comment for why this is duplicated rather than shared.
export function classifyMediaType(contentType) {
  if (!contentType) return null
  const [type] = contentType.split('/')
  if (type === 'image' || type === 'audio' || type === 'video') return type
  return 'document'
}

// Mirrors Meta's documented size/format limits for outbound sends — client-
// side validation to catch an oversized/unsupported file before even
// attempting an upload. Meta's own API is still the authoritative backstop.
export const MEDIA_LIMITS = {
  image: { mimes: ['image/jpeg', 'image/png'], maxBytes: 5 * 1024 * 1024 },
  audio: { mimes: ['audio/aac', 'audio/mpeg', 'audio/ogg', 'audio/mp4', 'audio/amr'], maxBytes: 16 * 1024 * 1024 },
  video: { mimes: ['video/mp4', 'video/3gpp'], maxBytes: 16 * 1024 * 1024 },
  // Meta's accepted document list is long (pdf/doc/xls/ppt/txt/...) — no
  // exhaustive client-side mime allow-list, rely on Meta's own validation.
  document: { mimes: [], maxBytes: 100 * 1024 * 1024 },
}
