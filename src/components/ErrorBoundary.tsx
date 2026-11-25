import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { error: Error | null }

/** Prevents an unexpected render error from leaving the user with a blank page. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Application error:', error, info);
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div className="flex h-full w-full items-center justify-center bg-ink p-6 text-white">
          <div className="max-w-md text-center">
            <h1 className="text-lg font-bold">發生錯誤</h1>
            <p className="mt-2 text-sm text-blue-200">介面無法正常顯示，請重新載入頁面。</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-ink"
            >
              重新載入
            </button>
            <p className="mt-3 break-words text-[10px] text-blue-300">{error.message}</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
