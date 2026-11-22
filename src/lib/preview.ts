import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// Runtime assets copied by scripts/copy-pdfjs-assets.mjs
const assets = new URL("pdfjs/", document.baseURI).href;

/** Renders every page of a PDF to a canvas roughly `cssWidth` CSS pixels wide. */
export async function renderPdf(bytes: Uint8Array, cssWidth: number): Promise<HTMLCanvasElement[]> {
  const task = pdfjs.getDocument({
    data: bytes.slice(), // pdf.js takes ownership of the buffer
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`,
    wasmUrl: `${assets}wasm/`,
    iccUrl: `${assets}iccs/`,
  });
  try {
    const doc = await task.promise;
    const canvases: HTMLCanvasElement[] = [];
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const px = Math.min(Math.max(cssWidth, 200) * dpr, 3200);
      const viewport = page.getViewport({ scale: px / base.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
      canvases.push(canvas);
    }
    return canvases;
  } finally {
    await task.destroy();
  }
}
