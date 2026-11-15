/** Invoke during the click event; defer PNG production, not the permission-sensitive write call. */
export function writeImageToClipboard(image: Promise<Blob>): Promise<void> {
	if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
		return Promise.reject(new Error("This webview does not support copying images. Download the PNG instead."))
	try {
		return navigator.clipboard.write([new ClipboardItem({ "image/png": image })])
	} catch (error) {
		return Promise.reject(error)
	}
}
