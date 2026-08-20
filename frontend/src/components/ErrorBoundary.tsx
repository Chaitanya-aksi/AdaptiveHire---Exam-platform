import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '../lib/report-error';

interface FallbackProps {
  error: Error;
  /** Clears the error and remounts the subtree from scratch. */
  reset: () => void;
}

interface Props {
  children: ReactNode;
  /** Names the boundary in the error report. */
  name: string;
  /** Extra context to attach to the report — e.g. the session being sat. */
  context?: Record<string, unknown>;
  fallback: (props: FallbackProps) => ReactNode;
}

interface State {
  error: Error | null;
  /**
   * Bumped on reset and used as the children's `key`, which is what makes
   * recovery a real remount rather than a re-render of the same broken tree.
   *
   * That distinction is the whole point here: remounting re-runs the effects
   * that fetch state, so the subtree comes back from whatever the server
   * currently says instead of from the local state that just failed.
   */
  resetKey: number;
}

/**
 * Catches render errors in a subtree instead of letting them blank the page.
 *
 * A class component because `componentDidCatch` has no hook equivalent — this
 * is the one thing React still requires a class for.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(error, {
      boundary: this.props.name,
      componentStack: info.componentStack ?? undefined,
      ...this.props.context,
    });
  }

  private reset = (): void => {
    this.setState((prev) => ({ error: null, resetKey: prev.resetKey + 1 }));
  };

  render(): ReactNode {
    const { error } = this.state;

    if (error) {
      return this.props.fallback({ error, reset: this.reset });
    }

    return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>;
  }
}
