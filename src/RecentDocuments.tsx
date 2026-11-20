import {useDocumentProjection, useDocuments, useEditDocument, type DocumentHandle} from '@sanity/sdk-react'
import {Suspense, useState} from 'react'
import {documentType} from './env'

// Example data view. Replace with your own app. These hooks use the project
// host (<projectId>.api.sanity.io), so they work on any origin in project CORS.
// The title input writes the document's `title` field, and only when Save is pressed.

function DocumentTitle({handle}: {handle: DocumentHandle}) {
  const {data} = useDocumentProjection<{title: string | null; type: string}>({
    ...handle,
    projection: '{"title": title, "type": _type}',
  })
  const editTitle = useEditDocument<string>({...handle, path: 'title'})
  const [draft, setDraft] = useState<string | null>(null)
  const [status, setStatus] = useState<'saving' | 'saved' | 'error' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const saved = data?.title ?? ''
  const value = draft ?? saved
  const dirty = value !== saved

  async function save() {
    setStatus('saving')
    setError(null)
    try {
      await editTitle(value)
      setDraft(null)
      setStatus('saved')
    } catch (e) {
      setStatus('error')
      setError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  return (
    <form
      className="doc-row"
      onSubmit={(event) => {
        event.preventDefault()
        if (dirty) void save()
      }}
    >
      <span className="muted type">{data?.type}</span>
      <input
        aria-label={`Title of ${handle.documentId}`}
        value={value}
        onChange={(event) => {
          setDraft(event.target.value)
          setStatus(null)
        }}
      />
      <button type="submit" disabled={!dirty || status === 'saving'}>
        Save
      </button>
      {status === 'saving' && <span className="muted">Saving…</span>}
      {status === 'saved' && <span className="muted">Saved</span>}
      {status === 'error' && <span className="error">{error}</span>}
    </form>
  )
}

export function RecentDocuments() {
  const {data, hasMore} = useDocuments({
    ...(documentType ? {documentType} : {}),
    // Without a type filter, useDocuments also returns system documents such as
    // `_.groups.*` (type `system.group`).
    filter: '!(_id in path("_.**"))',
    orderings: [{field: '_updatedAt', direction: 'desc'}],
    batchSize: 10,
  })

  if (data.length === 0) return <p className="muted">No documents found.</p>
  return (
    <ul className="doc-list">
      {data.map((handle) => (
        <li key={handle.documentId}>
          <Suspense fallback="…">
            <DocumentTitle handle={handle} />
          </Suspense>
        </li>
      ))}
      {hasMore && <li className="muted">…more</li>}
    </ul>
  )
}
