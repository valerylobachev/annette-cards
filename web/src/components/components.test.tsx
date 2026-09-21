import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmSheet } from './ConfirmSheet'
import { EmptyState } from './EmptyState'
import { SnackbarProvider, useSnackbar } from './Snackbar'

afterEach(() => {
  vi.useRealTimers()
})

function ShowButton({ onUndo }: { onUndo: () => void }) {
  const { show } = useSnackbar()
  return (
    <button type="button" onClick={() => show({ message: 'Deck deleted', actionLabel: 'Undo', onAction: onUndo })}>
      show
    </button>
  )
}

describe('Snackbar', () => {
  it('fires the action callback and hides', () => {
    const onUndo = vi.fn()
    render(
      <SnackbarProvider aboveTabBar>
        <ShowButton onUndo={onUndo} />
      </SnackbarProvider>,
    )
    fireEvent.click(screen.getByText('show'))
    expect(screen.getByRole('status')).toHaveTextContent('Deck deleted')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledOnce()
    expect(screen.queryByText('Deck deleted')).not.toBeInTheDocument()
  })

  it('hides after 4 seconds by default', () => {
    vi.useFakeTimers()
    render(
      <SnackbarProvider aboveTabBar={false}>
        <ShowButton onUndo={() => {}} />
      </SnackbarProvider>,
    )
    fireEvent.click(screen.getByText('show'))
    act(() => vi.advanceTimersByTime(3900))
    expect(screen.getByText('Deck deleted')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(200))
    expect(screen.queryByText('Deck deleted')).not.toBeInTheDocument()
  })
})

describe('ConfirmSheet', () => {
  it('calls onConfirm and closes', () => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <ConfirmSheet
        open
        onOpenChange={onOpenChange}
        title="Delete deck and 3 cards?"
        confirmLabel="Delete"
        onConfirm={onConfirm}
      />,
    )
    expect(screen.getByRole('dialog', { name: 'Delete deck and 3 cards?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('EmptyState', () => {
  it('renders the message and fires the primary action', () => {
    const onAction = vi.fn()
    render(<EmptyState message="No decks yet" actionLabel="Create deck" onAction={onAction} />)
    expect(screen.getByText('No decks yet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create deck' }))
    expect(onAction).toHaveBeenCalledOnce()
  })
})
