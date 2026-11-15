import type { Attachment } from 'svelte/attachments';

/**
 * Sizes an element to reach from where it starts down to the bottom of the viewport (less the
 * surrounding `<main>` padding), but never below `minPx`. Content above it (alerts, headers)
 * and window resizes are tracked, so a flex child can fill the rest with `min-h-0 flex-1`.
 */
export function fillViewport(minPx: number): Attachment<HTMLElement> {
	return (element) => {
		let frame = 0;
		const measure = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				const main = element.closest('main');
				const bottom = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
				const top = element.getBoundingClientRect().top + window.scrollY;
				const available = document.documentElement.clientHeight - top - bottom;
				element.style.height = `${Math.max(minPx, Math.floor(available))}px`;
			});
		};
		measure();
		// Body size changes when content above appears or goes; our own height does not move
		// our top, so this settles after one pass.
		const observer = new ResizeObserver(measure);
		observer.observe(document.body);
		window.addEventListener('resize', measure);
		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
			window.removeEventListener('resize', measure);
			element.style.height = '';
		};
	};
}
