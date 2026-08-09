/**
 * Notes.
 *
 * A word-processor rather than a text box: headings, bold, lists, checkboxes,
 * and a page list down the side. What it *stores* is Markdown, which is the
 * point — a note written here is a plain file's worth of text, readable by
 * anything, and not a private blob that only this app can open.
 *
 * ## Why TipTap
 *
 * The editing surface is TipTap (ProseMirror), with `tiptap-markdown` doing the
 * conversion at each end. Written by hand this would be a `contenteditable`,
 * and a `contenteditable` is a decade of browser-specific bugs about what
 * happens when you press Enter in a nested list — ProseMirror exists because
 * that problem is genuinely hard. StarterKit brings headings, bold, italic,
 * underline, strike and bullet lists; task lists are the one thing added on top.
 *
 * ## Saving
 *
 * There is no save button and never a moment where closing loses work. Typing
 * schedules a write; leaving a note, switching to another, or closing the view
 * flushes whatever is pending first. The status line says which of those states
 * the note is in rather than leaving you to guess, because an editor that
 * claims to save by itself has to be visibly accountable for it.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Markdown, type MarkdownStorage } from 'tiptap-markdown'
import type { Note, NoteSummary } from '@shared/ipc'
import { useNav } from './nav'

/**
 * `tiptap-markdown` exports its storage type but does not attach it to the
 * editor's, so `editor.storage.markdown` is otherwise an error at the one call
 * that matters. Declared here rather than cast at the call site: a cast would
 * have to be repeated and would go stale silently if the package ever did this
 * itself.
 */
declare module '@tiptap/core' {
  interface Storage {
    markdown: MarkdownStorage
  }
}

/**
 * How long typing must pause before a write.
 *
 * Long enough that a sentence is one write rather than forty, short enough that
 * the gap between "I stopped typing" and "it is saved" is never long enough to
 * start worrying about. Nothing depends on it for safety — every exit flushes.
 */
const AUTOSAVE_MS = 700

/** What a page is called until it is called something. Matches main's default. */
const UNTITLED = 'Untitled'

/** Longest a name taken from the writing may be before it is a paragraph. */
const DERIVED_TITLE_MAX = 60

/**
 * The first line of a note, as a name for it.
 *
 * Markdown syntax is stripped rather than shown: a page named `## Bandos trip`
 * would be advertising its own file format. Returns nothing for a note that
 * begins with something unnameable — a list, a rule — because a name of `-` is
 * worse than Untitled.
 */
function firstLine(markdown: string): string | null {
  const line = markdown
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean)
  if (!line) return null

  const text = line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s*/, '')
    .replace(/[*_`~]/g, '')
    .trim()

  if (!text || /^[-*+\d.[\]\s]+$/.test(text)) return null
  return text.length > DERIVED_TITLE_MAX ? `${text.slice(0, DERIVED_TITLE_MAX).trimEnd()}…` : text
}

type SaveState = 'saved' | 'dirty' | 'saving'

export function Notes({ id }: { id?: number }): JSX.Element {
  const [notes, setNotes] = useState<NoteSummary[] | null>(null)
  const [open, setOpen] = useState<Note | null>(null)
  const [state, setState] = useState<SaveState>('saved')
  const [confirming, setConfirming] = useState<NoteSummary | null>(null)
  const replace = useNav((s) => s.replace)

  const refresh = useCallback(async (): Promise<NoteSummary[]> => {
    const list = await window.rp.notesList()
    setNotes(list)
    return list
  }, [])

  /**
   * The pending write, held outside React state.
   *
   * A ref because the flush has to be callable from an effect's cleanup, where
   * a state value would be the one captured when the effect ran rather than
   * whatever was typed since. The timer id lives with it so a flush can cancel
   * the write it is performing.
   */
  const pending = useRef<{ id: number; title?: string; body?: string } | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const flush = useCallback(async (): Promise<void> => {
    window.clearTimeout(timer.current)
    const write = pending.current
    if (!write) return
    pending.current = null
    setState('saving')
    const saved = await window.rp.notesUpdate(write.id, {
      title: write.title,
      body: write.body,
    })
    // Only settle if nothing was typed while the write was in flight.
    if (!pending.current) setState('saved')
    if (saved) {
      setNotes((list) =>
        list?.map((n) =>
          n.id === saved.id
            ? { ...n, title: saved.title, updatedAt: saved.updatedAt, hasContent: saved.body.trim().length > 0 }
            : n
        ) ?? null
      )
    }
  }, [])

  const schedule = useCallback(
    (write: { id: number; title?: string; body?: string }): void => {
      pending.current = { ...pending.current, ...write, id: write.id }
      setState('dirty')
      // The sidebar follows the title as it is typed rather than waiting for
      // the write — a list that lags the field it names by most of a second
      // reads as a list that has not noticed.
      if (write.title !== undefined) {
        const named = write.title.trim() || 'Untitled'
        setNotes((list) => list?.map((n) => (n.id === write.id ? { ...n, title: named } : n)) ?? null)
      }
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void flush(), AUTOSAVE_MS)
    },
    [flush]
  )

  // Leaving the view at all — closing the window included — writes first.
  useEffect(() => () => void flush(), [flush])

  // First load: pick up the list, and open what the route asked for.
  useEffect(() => {
    void (async () => {
      const list = await refresh()
      if (list.length === 0) return
      const wanted = id ?? list[0].id
      if (id === undefined) replace({ kind: 'notes', id: wanted })
    })()
    // Deliberately once: later navigation is handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Open whichever note the route names, flushing the one being left.
  useEffect(() => {
    if (id === undefined) return
    let live = true
    void (async () => {
      await flush()
      const note = await window.rp.notesRead(id)
      if (live) {
        setOpen(note)
        setState('saved')
      }
    })()
    return () => {
      live = false
    }
  }, [id, flush])

  const add = async (): Promise<void> => {
    await flush()
    const note = await window.rp.notesCreate()
    await refresh()
    replace({ kind: 'notes', id: note.id })
  }

  /** Delete, asking first only when there is something to lose. */
  const askDelete = (note: NoteSummary): void => {
    if (note.hasContent) setConfirming(note)
    else void destroy(note.id)
  }

  const destroy = async (noteId: number): Promise<void> => {
    // Whatever is queued belongs to a note that is about to stop existing.
    if (pending.current?.id === noteId) {
      pending.current = null
      window.clearTimeout(timer.current)
    }
    setConfirming(null)
    await window.rp.notesDelete(noteId)
    const list = await refresh()
    if (noteId === id) {
      setOpen(null)
      replace(list.length > 0 ? { kind: 'notes', id: list[0].id } : { kind: 'notes' })
    }
  }

  return (
    <div className="notes">
      <aside className="notes-list">
        <div className="notes-list-head">
          <h2>Pages</h2>
          <button className="btn notes-add" onClick={() => void add()}>
            New
          </button>
        </div>

        {notes === null ? (
          <p className="notes-empty">Loading…</p>
        ) : notes.length === 0 ? (
          <p className="notes-empty">No pages yet.</p>
        ) : (
          <ul>
            {notes.map((note) => (
              <li key={note.id}>
                <button
                  className={`notes-item ${note.id === id ? 'is-open' : ''}`}
                  onClick={() => replace({ kind: 'notes', id: note.id })}
                >
                  <span className="notes-item-title">{note.title}</span>
                </button>
                <button
                  className="notes-delete"
                  aria-label={`Delete ${note.title}`}
                  title={`Delete ${note.title}`}
                  onClick={() => askDelete(note)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="notes-page">
        {open ? (
          <NoteEditor
            key={open.id}
            note={open}
            state={state}
            onTitle={(title) => schedule({ id: open.id, title })}
            onBody={(body) => schedule({ id: open.id, body })}
          />
        ) : (
          <div className="placeholder">
            <p>{notes && notes.length === 0 ? 'Make a page to start writing.' : 'Pick a page.'}</p>
          </div>
        )}
      </section>

      {confirming && (
        <ConfirmDelete
          note={confirming}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void destroy(confirming.id)}
        />
      )}
    </div>
  )
}

/**
 * The editor for one note.
 *
 * Keyed by note id from the parent, so switching notes builds a new editor
 * rather than swapping the document under the old one — ProseMirror keeps
 * undo history, selection and plugin state per instance, and reusing it would
 * let you undo your way from one note into another's text.
 */
function NoteEditor({
  note,
  state,
  onTitle,
  onBody,
}: {
  note: Note
  state: SaveState
  onTitle: (title: string) => void
  onBody: (body: string) => void
}): JSX.Element {
  /**
   * The title, held here as well as in the database.
   *
   * The field has to show what was just typed on the very next frame, and what
   * the parent holds is the note as it was loaded — it only learns of a change
   * once the save lands, most of a second later. Bound to the parent's copy
   * alone, every keystroke in this box was reverted on the spot. Local state is
   * safe because the parent keys this component by note id, so switching pages
   * builds a new one rather than carrying a stale name across.
   */
  const [title, setTitle] = useState(note.title)

  /**
   * Whether the name is the writer's rather than the writing's.
   *
   * The condition cannot be "is it still called Untitled", which is what this
   * first tried: the derived name stops being Untitled on the very first
   * keystroke, so a page called itself `B` and then never looked again. It has
   * to be whether a human has typed in the title box — until they do, the name
   * follows the first line wherever it goes. A page that arrives already named
   * counts as spoken for.
   */
  const named = useRef(note.title !== UNTITLED)

  const rename = (next: string, byHand: boolean): void => {
    if (byHand) named.current = true
    setTitle(next)
    onTitle(next)
  }

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      // Nested checklists are the reason to allow them: a plan with sub-steps
      // is the common shape of a note like this.
      TaskItem.configure({ nested: true }),
      Markdown.configure({
        // Underline has no Markdown of its own, so it survives as HTML rather
        // than being silently dropped on the way to disk.
        html: true,
        transformPastedText: true,
        breaks: false,
      }),
    ],
    content: note.body,
    onUpdate: ({ editor }) => {
      const markdown = editor.storage.markdown.getMarkdown()
      onBody(markdown)
      // A page nobody has named takes its name from its first line, the way a
      // word processor does — a list of pages all called Untitled has stopped
      // being a list. It keeps following that line until somebody types a name
      // of their own, and falls back to Untitled if the line is emptied.
      if (!named.current) rename(firstLine(markdown) ?? UNTITLED, false)
    },
    editorProps: {
      attributes: { class: 'notes-surface', spellcheck: 'true' },
    },
  })

  return (
    <>
      <header className="notes-head">
        <input
          className="notes-title"
          value={title}
          spellCheck={false}
          aria-label="Page title"
          onChange={(e) => rename(e.target.value, true)}
        />
        <span className={`notes-state is-${state}`}>
          {state === 'saved' ? 'Saved' : state === 'saving' ? 'Saving…' : 'Unsaved'}
        </span>
      </header>

      <Toolbar editor={editor} />

      <div className="notes-scroll">
        <EditorContent editor={editor} />
      </div>
    </>
  )
}

/** One button's worth of formatting. */
interface Tool {
  label: string
  title: string
  /** Whether the cursor is currently inside this formatting. */
  active: (e: Editor) => boolean
  run: (e: Editor) => void
}

const BLOCKS: Array<{ label: string; level: 0 | 1 | 2 | 3 }> = [
  { label: 'Body', level: 0 },
  { label: 'Heading 1', level: 1 },
  { label: 'Heading 2', level: 2 },
  { label: 'Heading 3', level: 3 },
]

const MARKS: Tool[] = [
  {
    label: 'B',
    title: 'Bold — Ctrl+B',
    active: (e) => e.isActive('bold'),
    run: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    label: 'I',
    title: 'Italic — Ctrl+I',
    active: (e) => e.isActive('italic'),
    run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    label: 'U',
    title: 'Underline — Ctrl+U',
    active: (e) => e.isActive('underline'),
    run: (e) => e.chain().focus().toggleUnderline().run(),
  },
  {
    label: 'S',
    title: 'Strikethrough',
    active: (e) => e.isActive('strike'),
    run: (e) => e.chain().focus().toggleStrike().run(),
  },
]

const LISTS: Tool[] = [
  {
    label: '• List',
    title: 'Bulleted list',
    active: (e) => e.isActive('bulletList'),
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    label: '1. List',
    title: 'Numbered list',
    active: (e) => e.isActive('orderedList'),
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    label: '☑ Tasks',
    title: 'Checklist',
    active: (e) => e.isActive('taskList'),
    run: (e) => e.chain().focus().toggleTaskList().run(),
  },
]

/**
 * The toolbar.
 *
 * Redrawn on every selection change, because a button that does not know
 * whether you are already inside a heading is decoration. TipTap emits
 * `transaction` for that, and it is the only reason this component holds state
 * at all.
 */
function Toolbar({ editor }: { editor: Editor | null }): JSX.Element | null {
  const [, redraw] = useState(0)

  useEffect(() => {
    if (!editor) return
    const bump = (): void => redraw((n) => n + 1)
    editor.on('transaction', bump)
    editor.on('selectionUpdate', bump)
    return () => {
      editor.off('transaction', bump)
      editor.off('selectionUpdate', bump)
    }
  }, [editor])

  const current = useMemo(() => {
    if (!editor) return 0
    for (const block of BLOCKS) {
      if (block.level > 0 && editor.isActive('heading', { level: block.level })) return block.level
    }
    return 0
  }, [editor, editor?.state.selection.from, editor?.state.doc])

  if (!editor) return null

  const setBlock = (level: number): void => {
    const chain = editor.chain().focus()
    if (level === 0) chain.setParagraph().run()
    else chain.setHeading({ level: level as 1 | 2 | 3 }).run()
  }

  return (
    <div className="notes-toolbar" role="toolbar" aria-label="Formatting">
      <select
        className="notes-block"
        aria-label="Text style"
        value={current}
        onChange={(e) => setBlock(Number(e.target.value))}
      >
        {BLOCKS.map((b) => (
          <option key={b.level} value={b.level}>
            {b.label}
          </option>
        ))}
      </select>

      <span className="notes-sep" />

      {MARKS.map((tool) => (
        <ToolButton key={tool.label} tool={tool} editor={editor} />
      ))}

      <span className="notes-sep" />

      {LISTS.map((tool) => (
        <ToolButton key={tool.label} tool={tool} editor={editor} />
      ))}
    </div>
  )
}

function ToolButton({ tool, editor }: { tool: Tool; editor: Editor }): JSX.Element {
  return (
    <button
      type="button"
      className={`notes-tool ${tool.active(editor) ? 'is-active' : ''}`}
      title={tool.title}
      aria-label={tool.title}
      aria-pressed={tool.active(editor)}
      // The mouse must not take the selection out of the document on its way to
      // the button, or the command would apply to nothing.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => tool.run(editor)}
    >
      {tool.label}
    </button>
  )
}

/** Asked only when a note has something in it. An empty one just goes. */
function ConfirmDelete({
  note,
  onCancel,
  onConfirm,
}: {
  note: NoteSummary
  onCancel: () => void
  onConfirm: () => void
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  return (
    <div className="notes-confirm" role="dialog" aria-modal="true">
      <div className="notes-confirm-box">
        <h3>Delete “{note.title}”?</h3>
        <p>This page has writing in it. Deleting it cannot be undone.</p>
        <div className="notes-confirm-actions">
          <button className="btn" onClick={onCancel} autoFocus>
            Keep it
          </button>
          <button className="btn is-danger" onClick={onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
