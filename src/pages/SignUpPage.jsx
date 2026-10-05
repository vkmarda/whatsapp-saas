import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'

export default function SignUpPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) setError(error.message)
    else setDone(true)
    setLoading(false)
  }

  if (done) {
    return (
      <div className="centered-page">
        <div className="auth-box">
          <h1>Check your inbox</h1>
          <p>
            We've sent a confirmation link to <strong>{email}</strong>. Once you've
            confirmed, our team will set up your workspace and WhatsApp connection —
            you'll get access as soon as that's ready.
          </p>
          <Link className="link-button" to="/login">Back to log in</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="centered-page">
      <form className="auth-box" onSubmit={handleSubmit}>
        <h1>Create your account</h1>
        <input
          type="email"
          placeholder="Work email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          autoFocus
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          minLength={6}
          required
        />
        {error && <p className="form-error">{error}</p>}
        <button type="submit" disabled={loading || !email.trim() || !password.trim()}>
          {loading ? 'Creating account…' : 'Sign up'}
        </button>
        <Link className="link-button" to="/login">Already have an account? Log in</Link>
      </form>
    </div>
  )
}
