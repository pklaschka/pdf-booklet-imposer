/**
 * Sidebar accordion. Section headings pin like tabs (the CSS does the
 * sticking); this module tells the CSS each section's position, when a
 * closing section has finished collapsing, and which heading is at the edge
 * of a pinned stack and should shade the content beneath it.
 */

/** Collapse duration, read from the stylesheet so the two cannot drift apart. */
const collapseMs = (el: Element) =>
  Number.parseFloat(getComputedStyle(el).getPropertyValue("--collapse")) || 0;

export function initSections(form: HTMLElement, panel: HTMLElement) {
  const sections = [...form.querySelectorAll<HTMLDetailsElement>("details")];
  form.style.setProperty("--n", String(sections.length));
  sections.forEach((d, i) => {
    d.style.setProperty("--i", String(i));
    d.classList.toggle("settled", !d.open);
  });

  // A closed section sticks as a whole, but only once it has stopped shrinking.
  form.addEventListener(
    "toggle",
    (e) => {
      const d = e.target as HTMLDetailsElement;
      if (d.open) d.classList.remove("settled");
      else setTimeout(() => d.classList.toggle("settled", !d.open), collapseMs(form) + 20);
    },
    true,
  );

  const markEdges = () => {
    const box = panel.getBoundingClientRect();
    const tab = sections[0].querySelector("summary")!.offsetHeight + 1;
    const moreBelow = panel.scrollTop + panel.clientHeight < panel.scrollHeight - 1;
    let lastTop = -1;
    let firstBottom = -1;
    sections.forEach((d, i) => {
      const r = d.querySelector("summary")!.getBoundingClientRect();
      if (panel.scrollTop > 0 && r.top - box.top <= i * tab + 1.5) lastTop = i;
      const slot = (sections.length - 1 - i) * tab;
      if (moreBelow && firstBottom < 0 && box.bottom - r.bottom <= slot + 1.5) firstBottom = i;
    });
    sections.forEach((d, i) => {
      d.classList.toggle("edge-top", i === lastTop);
      d.classList.toggle("edge-bottom", i === firstBottom && i !== lastTop);
    });
  };
  let frame = 0;
  const queue = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(markEdges);
  };
  panel.addEventListener("scroll", queue, { passive: true });
  window.addEventListener("resize", queue);
  new ResizeObserver(queue).observe(form); // sections opening, closing, animating
  queue();
}

/** Opens the section containing `target` and scrolls the target into view once it has expanded. */
export function revealInSection(target: HTMLElement) {
  const section = target.closest("details");
  if (!section) return;
  section.open = true;
  setTimeout(
    () => target.scrollIntoView({ behavior: "smooth", block: "center" }),
    collapseMs(section) + 40,
  );
}
