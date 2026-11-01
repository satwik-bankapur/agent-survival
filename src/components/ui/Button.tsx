/*
 * Buttons from the HUD language: primary (ink fill), secondary (raised
 * panel) and their disabled states. 32 px tall unless told otherwise.
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: 'primary' | 'secondary'
  readonly children: ReactNode
}

/**
 * Disabled buttons use aria-disabled rather than the disabled attribute, so
 * they stay focusable and a keyboard user can still read why (the tooltip).
 */
export function Button({ variant = 'secondary', disabled = false, className = '', children, onClick, ...rest }: ButtonProps) {
  const look =
    variant === 'primary'
      ? disabled
        ? 'border-hairline bg-panel-raised text-ink-faint font-bold'
        : 'border-ink bg-ink text-panel font-bold hover:border-white hover:bg-white'
      : disabled
        ? 'border-hairline bg-panel text-ink-faint'
        : 'border-hairline bg-panel-raised text-ink hover:border-ink-dim'
  return (
    <button
      type="button"
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      className={`flex h-8 items-center justify-center gap-2 rounded-control border px-3 text-label ${
        disabled ? 'cursor-not-allowed' : 'cursor-pointer'
      } ${look} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

/** A key hint in a hairline box: "Esc", "Space", "Q". */
export function KeyHint({ children, className = '' }: { readonly children: ReactNode; readonly className?: string }) {
  return <span className={`type-num rounded-badge border px-1 text-hint leading-[14px] ${className}`}>{children}</span>
}
