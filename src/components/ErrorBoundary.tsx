import { Component, type ReactNode } from 'react'

// A query given an id it can't use (a stale link, another table's id) throws while rendering. This turns that into a
// calm "not found" screen instead of a blank page, and resets when the route changes.
export default class ErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; resetKey?: string },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false })
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
