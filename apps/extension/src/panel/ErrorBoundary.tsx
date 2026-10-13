import { Component, type ReactNode } from 'react';

/** If Audion's UI throws, remove it quietly. Meet itself is unaffected: a crash here must never become Meet's problem. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    console.error('Audion: the panel crashed and was removed.', error);
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}
