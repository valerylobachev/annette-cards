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
