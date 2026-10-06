import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'

const STEP_TYPES = [
  { value: 'message', label: 'Send a message' },
  { value: 'buttons', label: 'Show buttons (up to 3)' },
  { value: 'list', label: 'Show a list (up to 10 options)' },
  { value: 'question', label: 'Ask a question & save the reply' },
  { value: 'save_to_contact', label: 'Save a collected answer to the contact' },
  { value: 'human_handoff', label: 'Hand off to a human' },
  { value: 'end', label: 'End the flow' },
]

// Must stay in lockstep with updateContact in netlify/edge-functions/lib/supabase.js
// — that's the other half of this contract (see whatsapp-webhook.js's applySaveToContact).
const CONTACT_COLUMNS = ['name', 'company', 'email', 'product_interest', 'city', 'status', 'notes']

function genId() {
  return `step-${crypto.randomUUID().slice(0, 8)}`
}

function emptyStepFor(type, id = genId()) {
  switch (type) {
    case 'message': return { id, type, text: '', next: null }
    case 'buttons': return { id, type, text: '', buttons: [] }
    case 'list': return { id, type, text: '', buttonLabel: 'Select', rows: [] }
    case 'question': return { id, type, text: '', variable: '', next: null }
    case 'save_to_contact': return { id, type, mappings: [], next: null }
    case 'human_handoff': return { id, type, message: '' }
    case 'end': return { id, type, message: '' }
    default: return { id, type, next: null }
  }
}

// Every `question` step earlier in the list defines a variable that a later
// save_to_contact step can draw from.
function collectVariables(steps) {
  return steps.filter(s => s.type === 'question' && s.variable).map(s => s.variable)
}

// Walks the actual branch structure (not array order) starting from the
// entry step (steps[0]), so the tree the user sees matches the conversation
// they're building — a button's target renders nested under that button,
// not as an unrelated card further down the page. A single shared `rendered`
// Set means a step reached a second time (a converging branch, or a cycle
// back to an ancestor) renders as a lightweight reference instead of being
// walked again — this is also what prevents infinite recursion on a cycle.
// Steps never reached from the entry step come back as separate orphanRoots
// (still walked the same way, so a connected *chain* of orphans nests
// correctly among themselves too).
function buildTree(steps) {
  const byId = new Map(steps.map(s => [s.id, s]))
  const rendered = new Set()

  function visit(id) {
    if (!id || !byId.has(id)) return null
    if (rendered.has(id)) return { kind: 'ref', id }
    rendered.add(id)
    const step = byId.get(id)
    let children = []
    if (step.type === 'buttons') {
      children = step.buttons.map(b => ({ label: b.title || '(untitled button)', node: visit(b.next) }))
    } else if (step.type === 'list') {
      children = step.rows.map(r => ({ label: r.title || '(untitled row)', node: visit(r.next) }))
    } else if (step.type === 'message' || step.type === 'question' || step.type === 'save_to_contact') {
      children = [{ label: null, node: visit(step.next) }]
    }
    return { kind: 'step', step, children }
  }

  const root = steps[0] ? visit(steps[0].id) : null
  const orphanRoots = []
  for (const s of steps) {
    if (!rendered.has(s.id)) orphanRoots.push(visit(s.id))
  }
  return { root, orphanRoots }
}

function jumpToStep(id) {
  const el = document.getElementById(`flow-step-${id}`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('flow-step-jumped')
  setTimeout(() => el.classList.remove('flow-step-jumped'), 1200)
}

// ── Starter templates — a blank list is the hardest thing to start from,
// so the empty state offers these instead of just an "add step" button. ──
const TEMPLATES = {
  lead_capture: {
    label: 'Lead capture',
    description: 'Greet, ask a couple of questions, save them to the contact.',
    steps: [
      { id: 'step-1', type: 'message', text: 'Hi! Thanks for reaching out — a couple of quick questions first.', next: 'step-2' },
      { id: 'step-2', type: 'question', text: "What's your name?", variable: 'customer_name', next: 'step-3' },
      { id: 'step-3', type: 'question', text: 'And what are you looking for?', variable: 'need', next: 'step-4' },
      { id: 'step-4', type: 'save_to_contact', mappings: [{ variable: 'customer_name', column: 'name' }, { variable: 'need', column: 'product_interest' }], next: 'step-5' },
      { id: 'step-5', type: 'end', message: "Thanks! We'll be in touch shortly." },
    ],
  },
  customer_support: {
    label: 'Customer support',
    description: 'Menu that routes between tracking an order, a human, or an FAQ answer.',
    steps: [
      { id: 'step-1', type: 'message', text: 'Hi! How can we help?', next: 'step-2' },
      { id: 'step-2', type: 'buttons', text: 'Choose an option', buttons: [
        { id: 'b1', title: 'Track my order', next: 'step-3' },
        { id: 'b2', title: 'Talk to a human', next: 'step-5' },
        { id: 'b3', title: 'Shipping info', next: 'step-6' },
      ] },
      { id: 'step-3', type: 'question', text: "What's your order ID?", variable: 'order_id', next: 'step-4' },
      { id: 'step-4', type: 'end', message: "Thanks! We'll look into your order and get back to you shortly." },
      { id: 'step-5', type: 'human_handoff', message: 'Connecting you to our team now.' },
      { id: 'step-6', type: 'message', text: 'We typically ship within 2-3 business days.', next: 'step-7' },
      { id: 'step-7', type: 'end', message: 'Anything else just message us anytime.' },
    ],
  },
  simple_faq: {
    label: 'Simple FAQ',
    description: 'One list of common questions, each with its own answer.',
    steps: [
      { id: 'step-1', type: 'message', text: 'Hi! Pick a topic below and I\'ll help.', next: 'step-2' },
      { id: 'step-2', type: 'list', text: 'What do you need help with?', buttonLabel: 'Select', rows: [
        { id: 'r1', title: 'Pricing', next: 'step-3' },
        { id: 'r2', title: 'Opening hours', next: 'step-4' },
      ] },
      { id: 'step-3', type: 'end', message: "Our pricing depends on quantity — reply here and we'll send a quote." },
      { id: 'step-4', type: 'end', message: "We're open Monday-Saturday, 9am-7pm." },
    ],
  },
}

export default function FlowBuilderPanel({ orgId }) {
  const [flow, setFlow] = useState(undefined) // undefined = loading, null = no row yet
  const [steps, setSteps] = useState([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [highlightId, setHighlightId] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error } = await supabase.from('flows').select('*').eq('org_id', orgId).maybeSingle()
      if (cancelled) return
      if (error) { setError(error.message); setFlow(null); return }
      setFlow(data || null)
      setSteps(data?.draft_steps || [])
    }
    load()
    return () => { cancelled = true }
  }, [orgId])

  useEffect(() => {
    if (!highlightId) return
    const t = setTimeout(() => setHighlightId(null), 4000)
    return () => clearTimeout(t)
  }, [highlightId])

  const variables = useMemo(() => collectVariables(steps), [steps])
  const tree = useMemo(() => buildTree(steps), [steps])

  async function createFlow(initialSteps) {
    const { data, error } = await supabase.from('flows').insert({ org_id: orgId, draft_steps: initialSteps }).select().single()
    if (error) { setError(error.message); return }
    setFlow(data)
    setSteps(initialSteps)
  }

  function updateStep(id, patch) {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
  }

  function changeStepType(id, newType) {
    setSteps(prev => prev.map(s => s.id === id ? emptyStepFor(newType, id) : s))
  }

  // Used by "+ Create a new step here" in any next-step dropdown — appends
  // a fresh step to the end (position in the list is just authoring order,
  // not structure) and returns its id so the caller can wire the pointer
  // that triggered creation to it, then scrolls it into view.
  function createStepReturningId() {
    const step = emptyStepFor('message')
    setSteps(prev => [...prev, step])
    setHighlightId(step.id)
    setTimeout(() => jumpToStep(step.id), 50)
    return step.id
  }

  function addStep(type) {
    const step = emptyStepFor(type)
    setSteps(prev => [...prev, step])
    setHighlightId(step.id)
    setTimeout(() => jumpToStep(step.id), 50)
  }

  function removeStep(id) {
    setSteps(prev => prev.filter(s => s.id !== id))
  }

  // Conversation order is now determined by the tree (who points to whom),
  // not array position — the only thing array position still controls is
  // which step is the entry point (steps[0], per the webhook's contract).
  function setEntryStep(id) {
    setSteps(prev => {
      const idx = prev.findIndex(s => s.id === id)
      if (idx <= 0) return prev
      const next = [...prev]
      const [item] = next.splice(idx, 1)
      next.unshift(item)
      return next
    })
  }

  function validate() {
    if (steps.length === 0) return 'Add at least one step before publishing.'
    const ids = new Set(steps.map(s => s.id))
    for (const s of steps) {
      if (s.type === 'buttons') {
        if (s.buttons.length > 3) return `"${s.text || s.id}" has more than 3 buttons — WhatsApp allows at most 3.`
        for (const b of s.buttons) if (b.next && !ids.has(b.next)) return `A button on "${s.text || s.id}" points to a step that no longer exists.`
      }
      if (s.type === 'list') {
        if (s.rows.length > 10) return `"${s.text || s.id}" has more than 10 rows — WhatsApp allows at most 10.`
        for (const r of s.rows) if (r.next && !ids.has(r.next)) return `A row on "${s.text || s.id}" points to a step that no longer exists.`
      }
      if ((s.type === 'message' || s.type === 'question' || s.type === 'save_to_contact') && s.next && !ids.has(s.next)) {
        return `"${s.text || s.id}" points to a step that no longer exists.`
      }
    }
    return ''
  }

  async function saveDraft() {
    setSaving(true)
    setError('')
    setNotice('')
    const { error } = await supabase.from('flows').update({ draft_steps: steps }).eq('id', flow.id)
    setSaving(false)
    if (error) setError(error.message)
    else setNotice('Draft saved.')
  }

  async function publish() {
    const problem = validate()
    if (problem) { setError(problem); setNotice(''); return }
    setSaving(true)
    setError('')
    setNotice('')
    const { error } = await supabase.from('flows').update({
      draft_steps: steps,
      published_steps: steps,
      published_at: new Date().toISOString(),
    }).eq('id', flow.id)
    setSaving(false)
    if (error) setError(error.message)
    else setNotice('Published — this is now live for new and ongoing conversations.')
  }

  async function toggleActive() {
    const { data, error } = await supabase.from('flows').update({ is_active: !flow.is_active }).eq('id', flow.id).select().single()
    if (error) { setError(error.message); return }
    setFlow(data)
  }

  if (flow === undefined) return <p className="panel-muted">Loading…</p>

  if (flow === null) {
    return (
      <div className="dashboard-panel">
        <p className="panel-muted">Start from a template, or build from scratch — you can change anything afterward.</p>
        <div className="flow-template-grid">
          {Object.entries(TEMPLATES).map(([key, t]) => (
            <button type="button" key={key} className="flow-template-card" onClick={() => createFlow(t.steps)}>
              <strong>{t.label}</strong>
              <span>{t.description}</span>
            </button>
          ))}
          <button type="button" className="flow-template-card" onClick={() => createFlow([])}>
            <strong>Start from scratch</strong>
            <span>An empty flow — add your own steps one at a time.</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flow-builder-layout">
      <div className="flow-builder-main">
        <div className="flow-toolbar">
          <span className={`badge ${flow.is_active ? 'badge-active' : 'badge-warning'}`}>
            {flow.is_active ? 'Active' : 'Inactive'}
          </span>
          <button type="button" className="link-button" onClick={toggleActive}>
            {flow.is_active ? 'Pause this flow' : 'Activate this flow'}
          </button>
          <span className="flow-toolbar-spacer" />
          <button type="button" onClick={saveDraft} disabled={saving}>Save draft</button>
          <button type="button" onClick={publish} disabled={saving}>Publish</button>
        </div>

        {error && <p className="form-error">{error}</p>}
        {notice && <p className="panel-muted">{notice}</p>}
        {flow.published_at && (
          <p className="panel-muted">Last published {new Date(flow.published_at).toLocaleString()}.</p>
        )}

        {steps.length === 0 ? (
          <p className="panel-muted">No steps yet — add one below. The first step is where every new conversation starts.</p>
        ) : (
          <>
            {steps.length > 1 && (
              <label className="flow-field flow-entry-picker">
                Conversation starts at
                <select className="status-select" value={steps[0]?.id || ''} onChange={e => setEntryStep(e.target.value)}>
                  {steps.map(s => (
                    <option key={s.id} value={s.id}>Step {steps.findIndex(x => x.id === s.id) + 1}: {s.text || s.message || '(untitled)'}</option>
                  ))}
                </select>
              </label>
            )}

            <TreeNode
              entry={{ label: null, node: tree.root }}
              steps={steps} variables={variables} highlightId={highlightId}
              onUpdateStep={updateStep} onChangeType={changeStepType} onRemoveStep={removeStep} onCreateStep={createStepReturningId}
            />

            {tree.orphanRoots.length > 0 && (
              <div className="flow-orphans">
                <p className="flow-hint">Not connected to the conversation yet — wire one of these up from another step's "Next step," or set it as the starting step above.</p>
                {tree.orphanRoots.map((node, i) => (
                  <TreeNode
                    key={node?.kind === 'step' ? node.step.id : i}
                    entry={{ label: null, node }}
                    steps={steps} variables={variables} highlightId={highlightId}
                    onUpdateStep={updateStep} onChangeType={changeStepType} onRemoveStep={removeStep} onCreateStep={createStepReturningId}
                  />
                ))}
              </div>
            )}
          </>
        )}

        <AddStepPicker onAdd={addStep} />
      </div>

      <FlowPreview steps={steps} />
    </div>
  )
}

// Picks (or creates) where a branch leads — used everywhere a target step
// is chosen, so a user never has to stop and pre-create a target before
// wiring up a button/question/etc.
function NextStepPicker({ value, onChange, steps, excludeId, onCreateStep }) {
  function handleCreate() {
    onChange(onCreateStep())
  }
  return (
    <div className="flow-field">
      <label>Next step</label>
      <div className="flow-next-row">
        <select className="status-select" value={value || ''} onChange={e => onChange(e.target.value || null)}>
          <option value="">— End flow here —</option>
          {steps.filter(s => s.id !== excludeId).map(s => (
            <option key={s.id} value={s.id}>Step {steps.findIndex(x => x.id === s.id) + 1}: {s.text || s.message || '(untitled)'}</option>
          ))}
        </select>
        {value && <button type="button" className="link-button" onClick={() => jumpToStep(value)}>Jump</button>}
        <button type="button" className="link-button" onClick={handleCreate}>+ New step</button>
      </div>
    </div>
  )
}

function StepCard({ step, steps, variables, highlighted, onChange, onChangeType, onRemove, onCreateStep }) {
  const number = steps.findIndex(s => s.id === step.id) + 1
  return (
    <div id={`flow-step-${step.id}`} className={`flow-step-card ${highlighted ? 'flow-step-new' : ''}`}>
      <div className="flow-step-header">
        <span className="flow-step-number">Step {number}</span>
        <select className="status-select" value={step.type} onChange={e => onChangeType(e.target.value)}>
          {STEP_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <div className="flow-step-controls">
          <button type="button" className="link-button" onClick={onRemove}>Remove</button>
        </div>
      </div>

      {step.type === 'message' && (
        <>
          <textarea placeholder="Message text" value={step.text} onChange={e => onChange({ text: e.target.value })} />
          <NextStepPicker value={step.next} onChange={next => onChange({ next })} steps={steps} excludeId={step.id} onCreateStep={onCreateStep} />
        </>
      )}

      {step.type === 'question' && (
        <>
          <textarea placeholder="What do you want to ask?" value={step.text} onChange={e => onChange({ text: e.target.value })} />
          <label className="flow-field">
            What should we call this answer?
            <input type="text" placeholder="e.g. budget" value={step.variable} onChange={e => onChange({ variable: e.target.value.trim() })} />
            <span className="flow-hint">Used later if you want to save it onto the contact, or just to keep track of what was asked.</span>
          </label>
          <NextStepPicker value={step.next} onChange={next => onChange({ next })} steps={steps} excludeId={step.id} onCreateStep={onCreateStep} />
        </>
      )}

      {step.type === 'buttons' && (
        <ButtonsEditor step={step} steps={steps} onChange={onChange} onCreateStep={onCreateStep} />
      )}

      {step.type === 'list' && (
        <ListEditor step={step} steps={steps} onChange={onChange} onCreateStep={onCreateStep} />
      )}

      {step.type === 'save_to_contact' && (
        <SaveToContactEditor step={step} steps={steps} variables={variables} onChange={onChange} onCreateStep={onCreateStep} />
      )}

      {(step.type === 'human_handoff' || step.type === 'end') && (
        <textarea
          placeholder="Optional closing message"
          value={step.message}
          onChange={e => onChange({ message: e.target.value })}
        />
      )}
    </div>
  )
}

// Renders one node of the tree built by buildTree(): a nested StepCard +
// its own children, a terminal "ends here" leaf (node is null — nothing
// wired up yet), or a "already shown above" reference chip (node.kind ===
// 'ref', a converging branch or a cycle back to an ancestor). The branch
// label (e.g. a button's title) is rendered by the parent, not here — see
// the .flow-tree-child mapping below.
function TreeNode({ entry, steps, variables, highlightId, onUpdateStep, onChangeType, onRemoveStep, onCreateStep }) {
  const { node } = entry

  if (!node) {
    return <div className="flow-tree-leaf">↳ ends flow here</div>
  }
  if (node.kind === 'ref') {
    const refStep = steps.find(s => s.id === node.id)
    const refNumber = steps.findIndex(s => s.id === node.id) + 1
    return (
      <div className="flow-tree-leaf">
        <button type="button" className="link-button" onClick={() => jumpToStep(node.id)}>
          ↪ Already shown above — Step {refNumber}: {refStep?.text || refStep?.message || '(untitled)'} · Jump
        </button>
      </div>
    )
  }
  return (
    <div className="flow-tree-branch">
      <StepCard
        step={node.step} steps={steps} variables={variables} highlighted={highlightId === node.step.id}
        onChange={patch => onUpdateStep(node.step.id, patch)}
        onChangeType={newType => onChangeType(node.step.id, newType)}
        onRemove={() => onRemoveStep(node.step.id)}
        onCreateStep={onCreateStep}
      />
      {node.children.length > 0 && (
        <div className="flow-tree-children">
          {node.children.map((child, i) => (
            <div className="flow-tree-child" key={i}>
              {child.label && <div className="flow-tree-branch-label">{child.label}</div>}
              <TreeNode
                entry={child} steps={steps} variables={variables} highlightId={highlightId}
                onUpdateStep={onUpdateStep} onChangeType={onChangeType} onRemoveStep={onRemoveStep} onCreateStep={onCreateStep}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ButtonsEditor({ step, steps, onChange, onCreateStep }) {
  function updateButton(id, patch) {
    onChange({ buttons: step.buttons.map(b => b.id === id ? { ...b, ...patch } : b) })
  }
  function addButton() {
    if (step.buttons.length >= 3) return
    onChange({ buttons: [...step.buttons, { id: genId(), title: '', next: null }] })
  }
  function removeButton(id) {
    onChange({ buttons: step.buttons.filter(b => b.id !== id) })
  }

  return (
    <>
      <textarea placeholder="Message text" value={step.text} onChange={e => onChange({ text: e.target.value })} />
      {step.buttons.map(b => (
        <div className="flow-option-row" key={b.id}>
          <input type="text" placeholder="Button label" value={b.title} onChange={e => updateButton(b.id, { title: e.target.value })} />
          <NextStepPicker value={b.next} onChange={next => updateButton(b.id, { next })} steps={steps} excludeId={step.id} onCreateStep={onCreateStep} />
          <button type="button" className="link-button" onClick={() => removeButton(b.id)}>Remove</button>
        </div>
      ))}
      {step.buttons.length < 3 && (
        <button type="button" className="link-button" onClick={addButton}>+ Add button</button>
      )}
    </>
  )
}

function ListEditor({ step, steps, onChange, onCreateStep }) {
  function updateRow(id, patch) {
    onChange({ rows: step.rows.map(r => r.id === id ? { ...r, ...patch } : r) })
  }
  function addRow() {
    if (step.rows.length >= 10) return
    onChange({ rows: [...step.rows, { id: genId(), title: '', next: null }] })
  }
  function removeRow(id) {
    onChange({ rows: step.rows.filter(r => r.id !== id) })
  }

  return (
    <>
      <textarea placeholder="Message text" value={step.text} onChange={e => onChange({ text: e.target.value })} />
      <input type="text" placeholder="Button label (e.g. Select)" value={step.buttonLabel} onChange={e => onChange({ buttonLabel: e.target.value })} />
      {step.rows.map(r => (
        <div className="flow-option-row" key={r.id}>
          <input type="text" placeholder="Row label" value={r.title} onChange={e => updateRow(r.id, { title: e.target.value })} />
          <NextStepPicker value={r.next} onChange={next => updateRow(r.id, { next })} steps={steps} excludeId={step.id} onCreateStep={onCreateStep} />
          <button type="button" className="link-button" onClick={() => removeRow(r.id)}>Remove</button>
        </div>
      ))}
      {step.rows.length < 10 && (
        <button type="button" className="link-button" onClick={addRow}>+ Add row</button>
      )}
    </>
  )
}

function SaveToContactEditor({ step, steps, variables, onChange, onCreateStep }) {
  function updateMapping(index, patch) {
    const mappings = step.mappings.map((m, i) => i === index ? { ...m, ...patch } : m)
    onChange({ mappings })
  }
  function addMapping() {
    onChange({ mappings: [...step.mappings, { variable: variables[0] || '', column: CONTACT_COLUMNS[0] }] })
  }
  function removeMapping(index) {
    onChange({ mappings: step.mappings.filter((_, i) => i !== index) })
  }

  if (variables.length === 0) {
    return <p className="panel-muted">Add a "question" step earlier in the flow first — there's nothing collected yet to save.</p>
  }

  return (
    <>
      <p className="flow-hint">Map a collected answer onto this customer's contact record.</p>
      {step.mappings.map((m, i) => (
        <div className="flow-option-row" key={i}>
          <select className="status-select" value={m.variable} onChange={e => updateMapping(i, { variable: e.target.value })}>
            {variables.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <span>→</span>
          <select className="status-select" value={m.column} onChange={e => updateMapping(i, { column: e.target.value })}>
            {CONTACT_COLUMNS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button type="button" className="link-button" onClick={() => removeMapping(i)}>Remove</button>
        </div>
      ))}
      <button type="button" className="link-button" onClick={addMapping}>+ Add mapping</button>
      <NextStepPicker value={step.next} onChange={next => onChange({ next })} steps={steps} excludeId={step.id} onCreateStep={onCreateStep} />
    </>
  )
}

function AddStepPicker({ onAdd }) {
  const [type, setType] = useState(STEP_TYPES[0].value)
  return (
    <div className="flow-add-step-picker">
      <select className="status-select" value={type} onChange={e => setType(e.target.value)}>
        {STEP_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
      <button type="button" onClick={() => onAdd(type)}>+ Add step</button>
    </div>
  )
}

// ── Live preview ─────────────────────────────────────────────────────────
// Simulates the flow exactly the way the webhook's interpreter would,
// always taking each branch's FIRST option — this is "what a customer
// following the obvious path sees," not an interactive simulator (that
// would mean re-implementing click-through state here). Recomputed on
// every edit via useMemo, so it's always in sync with what's on screen.
const PREVIEW_MAX_STEPS = 25

function buildPreview(steps) {
  if (steps.length === 0) return []
  const byId = new Map(steps.map(s => [s.id, s]))
  const messages = []
  let current = steps[0]
  for (let i = 0; i < PREVIEW_MAX_STEPS && current; i++) {
    if (current.type === 'message') {
      if (current.text) messages.push({ from: 'bot', text: current.text })
      current = byId.get(current.next)
      continue
    }
    if (current.type === 'save_to_contact') {
      current = byId.get(current.next)
      continue
    }
    if (current.type === 'buttons') {
      if (current.text) messages.push({ from: 'bot', text: current.text, options: current.buttons.map(b => b.title).filter(Boolean) })
      const first = current.buttons[0]
      if (!first) break
      if (first.title) messages.push({ from: 'customer', text: first.title })
      current = byId.get(first.next)
      continue
    }
    if (current.type === 'list') {
      if (current.text) messages.push({ from: 'bot', text: current.text, options: current.rows.map(r => r.title).filter(Boolean) })
      const first = current.rows[0]
      if (!first) break
      if (first.title) messages.push({ from: 'customer', text: first.title })
      current = byId.get(first.next)
      continue
    }
    if (current.type === 'question') {
      if (current.text) messages.push({ from: 'bot', text: current.text })
      messages.push({ from: 'customer', text: '(example answer)', placeholder: true })
      current = byId.get(current.next)
      continue
    }
    if (current.type === 'human_handoff') {
      if (current.message) messages.push({ from: 'bot', text: current.message })
      messages.push({ from: 'note', text: 'Handed off to a human' })
      break
    }
    if (current.type === 'end') {
      if (current.message) messages.push({ from: 'bot', text: current.message })
      messages.push({ from: 'note', text: 'Flow ends' })
      break
    }
    break
  }
  return messages
}

function FlowPreview({ steps }) {
  const preview = useMemo(() => buildPreview(steps), [steps])
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [preview.length])

  return (
    <div className="flow-preview">
      <div className="flow-preview-header">Preview — default path</div>
      <div className="flow-preview-body">
        {preview.length === 0 ? (
          <p className="panel-muted">Add a step to see a preview.</p>
        ) : preview.map((m, i) => (
          m.from === 'note' ? (
            <div className="flow-preview-note" key={i}>{m.text}</div>
          ) : (
            <div key={i}>
              <div className={`thread-bubble ${m.from === 'bot' ? 'out' : 'in'} ${m.placeholder ? 'flow-preview-placeholder' : ''}`}>
                {m.text}
              </div>
              {m.options?.length > 0 && (
                <div className="flow-preview-options">
                  {m.options.map((o, oi) => <span key={oi}>{o}</span>)}
                </div>
              )}
            </div>
          )
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
