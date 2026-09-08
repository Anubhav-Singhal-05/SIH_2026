// IndexedDB client-side document storage for large confidential files (PDFs, images, etc.)
// Prevents localStorage 5MB quota errors and provides high-performance Blob URLs.

const DB_NAME = 'aegis_document_vault'
const DB_VERSION = 1
const STORE_NAME = 'documents'

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB not supported'))
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function storeDocument(id, fileOrBlob, metadata = {}) {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const record = {
        id: String(id),
        blob: fileOrBlob,
        name: metadata.name || 'document',
        contentType: metadata.contentType || fileOrBlob.type || 'application/pdf',
        size: fileOrBlob.size,
        updatedAt: Date.now(),
      }
      const req = store.put(record)
      req.onsuccess = () => resolve(record)
      req.onerror = () => reject(req.error)
    })
  } catch (err) {
    console.warn('Could not store document in IndexedDB:', err)
    return null
  }
}

export async function retrieveDocument(id) {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.get(String(id))
      req.onsuccess = () => {
        if (req.result && req.result.blob) {
          const blob = req.result.blob
          const objectUrl = URL.createObjectURL(blob)
          resolve({ ...req.result, objectUrl })
        } else {
          resolve(null)
        }
      }
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}
