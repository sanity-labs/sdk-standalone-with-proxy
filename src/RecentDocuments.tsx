import {useDocumentProjection, useDocuments, type DocumentHandle} from '@sanity/sdk-react'
import {Suspense} from 'react'
import {documentType} from './env'

// Example data view. Replace with your own app. These hooks use the project
// host (<projectId>.api.sanity.io), so they work on any origin in project CORS.

function DocumentTitle({handle}: {handle: DocumentHandle}) {
  const {data} = useDocumentProjection<{title: string; type: string}>({
    ...handle,
    projection: '{"title": coalesce(title, name, _id), "type": _type}',
  })
  return (
    <>
      {data?.title} <span className="muted">({data?.type})</span>
    </>
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
    <ul>
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
