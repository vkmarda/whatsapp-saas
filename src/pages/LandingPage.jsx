import { Link } from 'react-router-dom'
import {
  MessageSquareText, Receipt, Inbox as InboxIcon, Gauge,
  ShieldCheck, Sparkles, ArrowRight, Check, Megaphone,
} from 'lucide-react'

const FEATURES = [
  {
    icon: MessageSquareText,
    title: 'Automated conversations',
    body: "A menu-driven bot greets every customer, shows your catalogue, and routes them to a quote or your sales team — customized per business, no coding required.",
  },
  {
    icon: Sparkles,
    title: 'Free-text understanding',
    body: 'Customers can skip the menu entirely — "how much for 500 units" still gets routed straight into the quote flow, with the product pre-filled when it recognizes it.',
  },
  {
    icon: Receipt,
    title: 'Structured quote capture',
    body: 'Every quote request — product, quantity, delivery location, contact details — lands in your dashboard as structured data, not a chat log you have to re-read.',
  },
  {
    icon: InboxIcon,
    title: 'Live team inbox',
    body: 'See every conversation in real time, reply directly from the dashboard, and know instantly which threads need a human instead of the bot.',
  },
  {
    icon: Gauge,
    title: 'One dashboard, real numbers',
    body: 'Contacts, quotes, and conversations — synced live the moment they happen, not on a refresh.',
  },
  {
    icon: ShieldCheck,
    title: 'Your data, isolated',
    body: "Every business gets its own fully isolated workspace, enforced at the database level — not just hidden in the interface.",
  },
]

const STEPS = [
  { n: '01', title: 'Connect your number', body: 'Link your WhatsApp Business number — we handle the webhook, you keep your existing number.' },
  { n: '02', title: 'Customize your bot', body: 'Set your welcome message, product list, and catalogue — the conversation flow is ready out of the box.' },
  { n: '03', title: 'Run it from one dashboard', body: 'Contacts, quotes, and live conversations, all in one place, updating in real time.' },
]

export default function LandingPage() {
  return (
    <div className="landing-page">
      <header className="land-nav">
        <div className="land-nav-inner">
          <span className="land-logo">Flowline</span>
          <nav className="land-nav-links">
            <a href="#features">Features</a>
            <a href="#how-it-works">How it works</a>
          </nav>
          <div className="land-nav-actions">
            <Link to="/login" className="land-btn-ghost">Log in</Link>
            <Link to="/signup" className="land-btn-solid">Sign up</Link>
          </div>
        </div>
      </header>

      <main>
        <section className="land-hero">
          <div className="land-hero-copy">
            <p className="land-eyebrow">WhatsApp business platform</p>
            <h1>Turn WhatsApp into a full-time sales channel</h1>
            <p className="land-standfirst">
              Flowline answers every customer, captures quote requests as structured data, and
              hands your team a live inbox — all on the number your customers already message.
            </p>
            <div className="land-hero-actions">
              <Link to="/signup" className="land-btn-solid land-btn-large">
                Get started free <ArrowRight size={17} />
              </Link>
              <a href="#how-it-works" className="land-btn-ghost land-btn-large">See how it works</a>
            </div>
          </div>

          <div className="land-hero-visual" aria-hidden="true">
            <div className="chat-mock">
              <div className="chat-mock-header">Your WhatsApp number</div>
              <div className="chat-mock-body">
                <div className="chat-bubble in">Hi, do you have this in bulk?</div>
                <div className="chat-bubble out">
                  Hi! Thanks for reaching out — how can we help you today?
                </div>
                <div className="chat-options">
                  <span>Product Catalogue</span>
                  <span>Request a Quote</span>
                  <span>Talk to Sales Team</span>
                </div>
                <div className="chat-bubble in tapped">Request a Quote</div>
                <div className="chat-bubble out">Great! Let's get your quote started.<br />What's your name?</div>
              </div>
            </div>
          </div>
        </section>

        <section className="land-section" id="features">
          <h2>Everything the conversation needs</h2>
          <p className="land-section-intro">Built around one real flow — menu, catalogue, quote, sales — not a generic chatbot builder you have to assemble yourself.</p>
          <div className="feature-grid">
            {FEATURES.map(f => {
              const Icon = f.icon
              return (
                <div className="feature-card" key={f.title}>
                  <div className="feature-icon"><Icon size={19} /></div>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </div>
              )
            })}
          </div>
          <div className="feature-soon">
            <Megaphone size={16} />
            <span>Scheduled broadcast campaigns — coming soon</span>
          </div>
        </section>

        <section className="land-section land-steps" id="how-it-works">
          <h2>Live in three steps</h2>
          <div className="steps-grid">
            {STEPS.map(s => (
              <div className="step-card" key={s.n}>
                <span className="step-n">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="land-cta">
          <h2>Put your WhatsApp number to work</h2>
          <p>Sign up and we'll get your workspace and number connected.</p>
          <Link to="/signup" className="land-btn-solid land-btn-large">
            Get started free <ArrowRight size={17} />
          </Link>
          <ul className="land-cta-list">
            <li><Check size={15} /> No credit card to start</li>
            <li><Check size={15} /> Keep your existing number</li>
          </ul>
        </section>
      </main>

      <footer className="land-footer">
        <span>Flowline</span>
        <span>WhatsApp sales &amp; support, automated.</span>
      </footer>
    </div>
  )
}
