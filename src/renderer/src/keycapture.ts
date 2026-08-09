/**
 * Turning a keypress into a keybind spec.
 *
 * Two vocabularies, because the two kinds of shortcut in this app are matched by
 * different machinery and neither will accept the other's spelling:
 *
 *  - **global** is an Electron accelerator, handed to `globalShortcut` and
 *    registered with Windows. It names keys the way Electron does — `Space`,
 *    `Return`, `Up` — and accepts keys an in-app bind cannot use at all.
 *  - **app** is matched in JavaScript against a `KeyboardEvent`, by
 *    `shared/keys.ts`, which compares `event.key` directly. So the spec has to
 *    hold whatever `event.key` will be, and only a single character or a
 *    function key parses at all.
 *
 * Deriving one from the other is the trap. `event.code` is the physical key and
 * is what an accelerator wants — Shift+1 is `Digit1`, and an accelerator for it
 * is `Shift+1`. `event.key` is what the keyboard produced and is what an in-app
 * bind must store — Shift+1 is `!`, and storing `1` would give a shortcut that
 * never fires. Each scope is therefore read from its own source.
 */

export type BindScope = 'global' | 'app'

/** Held down rather than pressed; a bind cannot be one of these alone. */
const MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'ContextMenu'])

/**
 * Physical keys an accelerator can name, where the code is not the name.
 *
 * Letters, digits and function keys fall out of a pattern and are handled
 * below; this covers the ones with names of their own.
 */
const ACCELERATOR_KEYS: Record<string, string> = {
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Return',
  NumpadEnter: 'Return',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
}

export interface Captured {
  /** The spec to store, in the scope's own vocabulary. */
  spec: string
  /** Why this press cannot be a bind, if it cannot. */
  problem?: string
}

/**
 * Read a keypress as a bind, or say why it is not one.
 *
 * A press of modifiers alone returns no spec and no complaint: that is what
 * holding Ctrl on the way to Ctrl+Shift+F looks like, and the caller shows it
 * as progress rather than an error.
 */
export function capture(e: KeyboardEvent, scope: BindScope): Captured | null {
  if (MODIFIERS.has(e.key)) return null

  const parts: string[] = []
  if (e.ctrlKey) parts.push('Control')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  // Windows key. Only an accelerator can hold one — the in-app matcher folds
  // Meta into Ctrl, so a bind naming it would fire on the wrong chord.
  if (e.metaKey && scope === 'global') parts.push('Super')

  const key = scope === 'global' ? acceleratorKey(e) : appKey(e)
  if (!key) {
    return {
      spec: '',
      problem:
        scope === 'app'
          ? 'In-app shortcuts can only use a letter, a digit, a symbol or a function key.'
          : 'That key cannot be used in a shortcut.',
    }
  }

  // A bare letter would swallow typing everywhere in the app, and a global one
  // would swallow it everywhere in Windows.
  if (parts.length === 0) {
    return { spec: '', problem: 'Hold Ctrl, Alt or Shift as well — a key on its own is not a shortcut.' }
  }

  return { spec: [...parts, key].join('+') }
}

/** The physical key, named the way an Electron accelerator names it. */
function acceleratorKey(e: KeyboardEvent): string | null {
  const letter = /^Key([A-Z])$/.exec(e.code)
  if (letter) return letter[1]

  const digit = /^(?:Digit|Numpad)(\d)$/.exec(e.code)
  if (digit) return digit[1]

  if (/^F\d{1,2}$/.test(e.code)) return e.code

  return ACCELERATOR_KEYS[e.code] ?? null
}

/**
 * The produced character, which is what the in-app matcher compares against.
 *
 * Anything longer than one character is rejected unless it is a function key,
 * because that is exactly what `parseCombo` will accept — offering a bind here
 * that the parser drops on the way back in would be a shortcut that silently
 * never works.
 */
function appKey(e: KeyboardEvent): string | null {
  if (/^F\d{1,2}$/.test(e.key)) return e.key
  if (e.key.length === 1) return e.key === ' ' ? null : e.key.toUpperCase()
  return null
}

/** The parts of a spec, for drawing it as separate keys. */
export function specParts(spec: string): string[] {
  return spec
    .split(/[+\-\s]+/)
    .filter(Boolean)
    .map((part) => (part === 'Super' ? 'Win' : part === 'Control' ? 'Ctrl' : part))
}
