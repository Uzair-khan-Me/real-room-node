import React, { Component, ReactNode } from 'react';

interface Props { children: ReactNode; fallback?: ReactNode; }
interface State { hasError: boolean; error?: Error; }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  componentDidCatch(error: Error, info: any) { console.error('Component crash:', error, info); }
  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="min-h-screen flex items-center justify-center bg-gradient-subtle p-8">
          <div className="max-w-md text-center space-y-4 bg-card/90 backdrop-blur-xl p-10 rounded-3xl shadow-2xl border border-border/50">
            <h2 className="text-2xl font-extrabold text-foreground">Something went wrong</h2>
            <p className="text-muted-foreground">The chat encountered an error. Please refresh and try again.</p>
            <button onClick={() => window.location.reload()} className="px-6 py-2.5 rounded-xl bg-gradient-primary text-white font-semibold shadow-lg hover:brightness-110 transition-all">Refresh Page</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
