/** Saves a file through a temporary download link. */
export function downloadFile(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  // Safari may still be reading the blob right after the click.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Offers a file through the share sheet when the browser can share files (iOS: "Save to Files", AirDrop, mail),
 * otherwise downloads it. A cancelled share sheet is not an error.
 */
export async function shareOrDownload(filename: string, blob: Blob, mime: string): Promise<void> {
  const file = new File([blob], filename, { type: mime })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      // NotAllowedError (e.g. the user gesture expired): fall back to a download.
    }
  }
  downloadFile(filename, blob)
}
