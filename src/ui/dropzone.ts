/** Accepts a PDF dropped anywhere on the window, showing `overlay` while a file is dragged over it. */
export function initDropzone(
  overlay: HTMLElement,
  onPdf: (file: File) => void,
  onOther: () => void,
) {
  let depth = 0;
  const hasFiles = (e: DragEvent) => Boolean(e.dataTransfer?.types.includes("Files"));
  window.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    depth++;
    overlay.hidden = false;
  });
  window.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    if (--depth <= 0) overlay.hidden = true;
  });
  window.addEventListener("dragover", (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    overlay.hidden = true;
    const pdf = [...(e.dataTransfer?.files ?? [])].find(
      (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name),
    );
    if (pdf) onPdf(pdf);
    else onOther();
  });
}
