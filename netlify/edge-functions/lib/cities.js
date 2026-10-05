// Mirrors src/utils/detectCity.js — duplicated rather than shared since that
// file runs in the browser (Vite/React bundle) and this one runs server-side
// in a Deno edge function, same reasoning ContactsPanel.jsx already documents
// for its own normalizePhone duplicate. Keep the city list in sync manually
// if either side changes.
//
// Used by whatsapp-webhook.js to auto-populate contacts.city straight from
// the bot's "delivery location" quote-flow answer, instead of leaving it
// sitting unindexed inside the quote's free-text message field.
const KNOWN_CITIES = [
  'Hyderabad', 'Secunderabad', 'Warangal', 'Nizamabad', 'Karimnagar', 'Khammam', 'Nalgonda', 'Mahbubnagar',
  'Vijayawada', 'Visakhapatnam', 'Vizag', 'Guntur', 'Nellore', 'Kurnool', 'Rajahmundry', 'Tirupati', 'Kadapa', 'Kakinada', 'Anantapur',
  'Bangalore', 'Bengaluru', 'Mysore', 'Mysuru', 'Hubli', 'Mangalore', 'Belgaum',
  'Chennai', 'Coimbatore', 'Madurai', 'Trichy', 'Salem', 'Tiruppur', 'Erode',
  'Kochi', 'Cochin', 'Thiruvananthapuram', 'Trivandrum', 'Kozhikode', 'Calicut',
  'Mumbai', 'Pune', 'Nagpur', 'Nashik', 'Aurangabad', 'Thane', 'Navi Mumbai', 'Kolhapur',
  'Delhi', 'New Delhi', 'Gurgaon', 'Gurugram', 'Noida', 'Faridabad', 'Ghaziabad',
  'Ahmedabad', 'Surat', 'Vadodara', 'Rajkot', 'Gandhinagar',
  'Jaipur', 'Jodhpur', 'Udaipur', 'Kota',
  'Lucknow', 'Kanpur', 'Varanasi', 'Agra', 'Allahabad', 'Prayagraj', 'Meerut', 'Bareilly',
  'Kolkata', 'Howrah', 'Durgapur', 'Siliguri',
  'Bhopal', 'Indore', 'Jabalpur', 'Gwalior',
  'Chandigarh', 'Ludhiana', 'Amritsar', 'Jalandhar',
  'Patna', 'Ranchi', 'Jamshedpur', 'Dhanbad',
  'Bhubaneswar', 'Cuttack', 'Rourkela',
  'Raipur', 'Bilaspur',
  'Guwahati', 'Dehradun', 'Shimla', 'Panaji', 'Goa',
]

const SORTED_CITIES = [...KNOWN_CITIES].sort((a, b) => b.length - a.length)

export function detectCity(text) {
  if (!text) return null
  for (const city of SORTED_CITIES) {
    const pattern = new RegExp(`\\b${city.replace(/\s+/g, '\\s+')}\\b`, 'i')
    if (pattern.test(text)) return city
  }
  return null
}
