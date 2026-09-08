import React from 'react'
import { AlertTriangle, RotateCcw, Home } from 'lucide-react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an unhandled error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className='min-h-screen bg-base-950 flex items-center justify-center p-6'>
          <div className='max-w-lg w-full panel border-bad p-6 space-y-4'>
            <div className='flex items-center gap-3'>
              <div className='w-9 h-9 rounded-full bg-bad/10 border border-bad flex items-center justify-center'>
                <AlertTriangle size={18} className='text-bad' />
              </div>
              <div>
                <h1 className='text-[14px] font-semibold text-steel-100 tracking-wide uppercase'>Rendering Error Intercepted</h1>
                <p className='text-[12px] text-steel-400'>The application recovered safely without crashing the viewport.</p>
              </div>
            </div>

            <div className='inset-panel p-3 font-mono text-[11px] text-bad break-words'>
              {this.state.error?.message || 'An unexpected rendering error occurred.'}
            </div>

            <div className='flex items-center gap-3 pt-2'>
              <button
                onClick={() => {
                  this.setState({ hasError: false, error: null })
                  window.location.href = '/dashboard'
                }}
                className='btn-base bg-accent border-accent text-base-950 hover:bg-accent-bright font-medium py-1.5'
              >
                <Home size={13} /> Back to Dashboard
              </button>
              <button
                onClick={() => window.location.reload()}
                className='btn-base border-steel-700 text-steel-300 hover:text-steel-100 py-1.5'
              >
                <RotateCcw size={13} /> Reload Page
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
