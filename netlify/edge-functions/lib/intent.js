// Lightweight regex intent classifier for free-text WhatsApp messages —
// adapted from src/ecobot/intentDetection.js (built for the website widget,
// which detects interest in "UKEP" as a third party the AI concierge is
// discussing). Here every message is already addressed directly to UKEP's
// own WhatsApp number, so the UKEP-reference gating in the original doesn't
// apply — these patterns are the same buying-signal patterns, simplified.
//
// Used by whatsapp-webhook.js to route free text straight into the right
// flow when confident, and to flag anything else for human review instead
// of silently re-showing the menu.

const PURCHASE_INTENT = /\b(buy|buying|bought|purchase|purchasing|purchased)\b|place\s+an\s+order|want\s+to\s+order|looking\s+to\s+order|wholesale|bulk\s+order|get\s+a\s+quote|\bkharid\w*|\bkhareed\w*|खरीद/i

// "how much" alone is enough on a narrow-domain B2B bot like this one — real
// WhatsApp messages skip the verb ("how much garbage bags", not "how much do
// garbage bags cost"), unlike the website widget this was ported from.
const PRICING_INTENT = /\bprice\b|\bpricing\b|\bcost\b|\bcosts\b|\bhow\s+much\b|\bquote\b|\bquotation\b|\brate\b|\brates\b|keemat|कीमत|daam|दाम/i

const SAMPLE_INTENT = /\bsamples?\b/i

// "I need bags for pallet wrapping" — need/want verb plus a product-type noun.
const PRODUCT_NEED = /\b(need|want|looking\s+for|require)\b.{0,40}\b(bags?|film|wrap|sheets?|covers?|pouches?|liners?|packaging)\b|\b(bags?|film|wrap|sheets?|covers?|pouches?|liners?|packaging)\b.{0,40}\b(need|want|looking\s+for|require)\b/i

// Browsing the catalogue rather than naming a specific need.
const CATALOG_INTENT = /what\s+(products?|bags?|items?)\s+(do\s+you|you)|which\s+(products?|bags?)\s+(do\s+you|you)|product\s+range|what\s+do\s+you\s+(sell|manufacture|make|offer|supply)|show\s+me\s+your\s+products|what\s+all\s+(do\s+you|products)|types?\s+of\s+bags\s+(do\s+you|you\s+have)|\ball\b[^.?!]{0,20}\b(products?|items?)\b|full\s+(product\s+)?range|entire\s+range|complete\s+(list|range)|catalog(ue)?/i

// Checked in priority order: a stronger buying signal should win over a
// weaker/more generic one when a message matches more than one pattern.
export function detectIntent(text) {
  const m = (text || '').toLowerCase()
  if (!m.trim()) return null
  if (PURCHASE_INTENT.test(m)) return 'purchase'
  if (PRICING_INTENT.test(m)) return 'pricing'
  if (SAMPLE_INTENT.test(m)) return 'sample'
  if (PRODUCT_NEED.test(m)) return 'product_need'
  if (CATALOG_INTENT.test(m)) return 'catalog'
  return null
}
