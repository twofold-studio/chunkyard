/**
 * Chunkyard motion library: one place for durations, easings and Svelte transitions.
 *
 * - Every transition resolves to `duration: 0` when the visitor prefers reduced
 *   motion, so content still appears instantly and nothing moves.
 * - Only enter (`in:`) transitions are used for page/tab/step changes so outgoing
 *   and incoming content never overlap and the layout never jumps.
 * - Movement is short (a few pixels) and runs once; nothing loops.
 *
 * Matching CSS tokens (`--motion-*`) and utility classes live in `routes/layout.css`.
 */
import { cubicOut, quintOut } from 'svelte/easing';
import { fade, fly, scale, slide, type TransitionConfig } from 'svelte/transition';

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Durations in milliseconds; mirrors `--motion-fast|base|slow` in layout.css. */
export const DURATION = { fast: 120, base: 200, slow: 320 } as const;

export const EASE = { out: cubicOut, emphasized: quintOut } as const;

/** Small travel distances in px; larger moves read as layout shift. */
export const DISTANCE = { sm: 4, md: 8, lg: 16 } as const;

/** Upper bound for stagger offsets so long lists never feel slow. */
const MAX_STAGGER_ITEMS = 8;

/** Read at transition time (not reactive); see {@link reducedMotion} for reactive use. */
export function prefersReducedMotion(): boolean {
	return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
		? window.matchMedia(REDUCED_MOTION_QUERY).matches
		: false;
}

export interface MotionParams {
	delay?: number;
	duration?: number;
}

/** Applies the reduced-motion policy to any transition config. */
export function respectMotion<T extends MotionParams>(params: T): T {
	if (!prefersReducedMotion()) return params;
	return { ...params, delay: 0, duration: 0 };
}

/** Delay for the `index`-th item of a list, capped so the tail never lags. */
export function stagger(index: number, step = 35, base = 0): number {
	return base + Math.min(Math.max(index, 0), MAX_STAGGER_ITEMS) * step;
}

// Transitions ---------------------------------------------------------------------

/** Opacity only. Use for overlays, status text and swapping small content. */
export function fadeIn(node: Element, params: MotionParams = {}): TransitionConfig {
	return fade(node, respectMotion({ duration: DURATION.fast, easing: EASE.out, ...params }));
}

/** Fade with a short upward rise. Default for sections, cards and page content. */
export function rise(node: Element, params: MotionParams & { y?: number } = {}): TransitionConfig {
	return fly(
		node,
		respectMotion({ duration: DURATION.base, easing: EASE.out, y: DISTANCE.md, ...params })
	);
}

/** Subtle scale-in for popovers, toasts and confirmation content. */
export function pop(
	node: Element,
	params: MotionParams & { start?: number } = {}
): TransitionConfig {
	return scale(
		node,
		respectMotion({ duration: DURATION.fast, easing: EASE.out, start: 0.97, ...params })
	);
}

export type StepDirection = 1 | -1;

/** Horizontal entry for wizard steps and tab panels: forward enters from the right. */
export function step(
	node: Element,
	params: MotionParams & { direction?: StepDirection } = {}
): TransitionConfig {
	const { direction = 1, ...rest } = params;
	return fly(
		node,
		respectMotion({
			duration: DURATION.base,
			easing: EASE.emphasized,
			x: DISTANCE.lg * direction,
			...rest
		})
	);
}

/** Height reveal for disclosures and inline panels (e.g. upload queue, errors). */
export function collapse(node: Element, params: MotionParams = {}): TransitionConfig {
	return slide(node, respectMotion({ duration: DURATION.base, easing: EASE.out, ...params }));
}
