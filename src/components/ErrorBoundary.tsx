import React, { Component, ReactNode } from 'react';

interface Props { children: ReactNode; fallback?: ReactNode; }
interface State { hasError: boolean; error?: Error; }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  componentDidCatch(error: Error, info: any) { console.error('Component crash:', error, info); }
  render() {
    if (this.state.hasError) {
<<<<<<< HEAD
      return this.props.fallback || (
        <div className="min-h-screen flex items-center justify-center bg-gradient-subtle p-8">
          <div className="max-w-md text-center space-y-4 bg-card/90 backdrop-blur-xl p-10 rounded-3xl shadow-2xl border border-border/50">
            <h2 className="text-2xl font-extrabold text-foreground">Something went wrong</h2>
            <p className="text-muted-foreground">The chat encountered an error. Please refresh and try again.</p>
=======
      const msg = this.state.error?.message || String(this.state.error);
      const stack = this.state.error?.stack || '';
      return this.props.fallback || (
        <div className="min-h-screen flex items-start justify-center bg-gradient-subtle p-8 overflow-auto">
          <div className="max-w-2xl w-full text-left space-y-6 bg-card/90 backdrop-blur-xl p-8 rounded-3xl shadow-2xl border border-border/50">
            <h2 className="text-2xl font-extrabold text-foreground">Something went wrong</h2>
            <p className="text-muted-foreground">The chat encountered an error. Details below.</p>
            <pre className="text-xs bg-red-950 text-red-100 p-4 rounded-xl overflow-auto whitespace-pre-wrap break-words" style={{ maxHeight: '50vh' }}>
              {msg}
              {stack ? '\n' + stack : ''}
            </pre>
>>>>>>> arena/01a04805-real-room-node
            <button onClick={() => window.location.reload()} className="px-6 py-2.5 rounded-xl bg-gradient-primary text-white font-semibold shadow-lg hover:brightness-110 transition-all">Refresh Page</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
