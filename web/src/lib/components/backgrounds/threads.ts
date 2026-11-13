/*
 * Threads background, ported to framework-free TypeScript for Svelte.
 *
 * Source: React Bits "Threads" by David Haz
 *   https://github.com/DavidHDev/react-bits/blob/4e0d091d3b1ea8b7aadef33716a8d99d164ae4ce/src/ts-tailwind/Backgrounds/Threads/Threads.tsx
 * License: MIT + Commons Clause License Condition v1.0, Copyright (c) 2026 David Haz.
 *   Full notice: web/THIRD_PARTY_NOTICES.md. Used here as part of the Chunkyard application;
 *   the component itself must not be sold or redistributed on its own.
 *
 * Adaptation: the GLSL shaders and WebGL2 render passes are kept as published. The React
 * hooks were replaced by `createThreads`/`destroy`; pointer interaction and CSS colour parsing
 * were removed (colours are RGB arrays); reduced motion now reacts to preference changes; the
 * caller is told when WebGL2 is unavailable so it can show a static fallback.
 */

export type Rgb = readonly [number, number, number];

export interface ThreadsOptions {
	color: Rgb;
	accentColor?: Rgb;
	amplitude: number;
	distance: number;
	lineCount: number;
	thickness: number;
	softness: number;
	speed: number;
	waves: number;
	split: number;
	fray: number;
	angle: number;
	seed: number;
	taper: number;
	brightness: number;
	fade: number;
	opacity: number;
}

/** Upstream defaults (React Bits Threads props). */
export const THREADS_DEFAULTS: ThreadsOptions = {
	color: [1, 1, 1],
	amplitude: 1.7,
	distance: 0.4,
	lineCount: 90,
	thickness: 0.6,
	softness: 1.3,
	speed: 0.6,
	waves: 1.05,
	split: 0.04,
	fray: 0.5,
	angle: 25,
	seed: 0,
	taper: 0.85,
	brightness: 1.4,
	fade: 0,
	opacity: 1
};

export interface ThreadsHandle {
	/** True while an animation frame is scheduled. */
	readonly running: boolean;
	destroy(): void;
}

const LINE_VERTEX = `#version 300 es
precision highp float;
in vec2 aPoint;
uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uFrame;
uniform float uAmplitude;
uniform float uDistance;
uniform vec2 uMouse;
uniform float uCount;
uniform float uThickness;
uniform float uSoftness;
uniform float uWaves;
uniform float uSplit;
uniform float uFray;
uniform float uSeed;
uniform vec2 uTurn;
uniform vec4 uPart;
uniform float uTaper;
out float vEdge;
out float vBand;
out float vDraw;
out float vAlpha;
out float vIndex;

float Perlin2D(vec2 P) {
  vec2 Pi = floor(P);
  vec4 Pf_Pfmin1 = P.xyxy - vec4(Pi, Pi + 1.0);
  vec4 Pt = vec4(Pi.xy, Pi.xy + 1.0);
  Pt = Pt - floor(Pt * (1.0 / 71.0)) * 71.0;
  Pt += vec2(26.0, 161.0).xyxy;
  Pt *= Pt;
  Pt = Pt.xzxz * Pt.yyww;
  vec4 hash_x = fract(Pt * (1.0 / 951.135664));
  vec4 hash_y = fract(Pt * (1.0 / 642.949883));
  vec4 grad_x = hash_x - 0.49999;
  vec4 grad_y = hash_y - 0.49999;
  vec4 grad_results = inversesqrt(grad_x * grad_x + grad_y * grad_y) * (grad_x * Pf_Pfmin1.xzxz + grad_y * Pf_Pfmin1.yyww);
  grad_results *= 1.4142135623730950;
  vec2 blend = Pf_Pfmin1.xy * Pf_Pfmin1.xy * Pf_Pfmin1.xy * (Pf_Pfmin1.xy * (Pf_Pfmin1.xy * 6.0 - 15.0) + 10.0);
  vec4 blend2 = vec4(blend, vec2(1.0 - blend));
  return dot(grad_results, blend2.zxzx * blend2.wwyy);
}

void main() {
  float perc = float(gl_InstanceID) / uCount;
  float x = aPoint.x;
  float pixel = 1.0 / max(uResolution.x, uResolution.y);
  float splitPoint = uSplit + perc * uFray;
  float amplitudeNormal = smoothstep(splitPoint, max(0.7, splitPoint + 0.2), x);
  float finalAmplitude = amplitudeNormal * 0.5 * uAmplitude * (1.0 + (uMouse.y - 0.5) * 0.2);
  float timeScaled = uTime / 10.0 + (uMouse.x - 0.5);
  float blur = smoothstep(splitPoint, splitPoint + 0.05, x) * perc;
  float xnoise = mix(
    Perlin2D(vec2(timeScaled * 2.5 + uSeed, (x * uWaves + perc) * 2.5)),
    Perlin2D(vec2(timeScaled * 3.5 + uSeed, (x * uWaves + timeScaled) * 3.5)) / 1.5,
    x * 0.3
  );
  float y = 0.5 + (perc - 0.5) * uDistance + xnoise / 2.0 * finalAmplitude;
  vec2 local = vec2((x - 0.5) * uFrame.x, (y - 0.5) * uFrame.y);
  if (uPart.z > 0.0) {
    vec2 delta = local - uPart.xy;
    float reach = uPart.w;
    float pull = exp(-dot(delta, delta) / (reach * reach));
    local.y += delta.y * pull * uPart.z;
  }
  float width = 7.0 * uThickness * pixel * (1.0 - perc);
  float band = (width / 2.0 + 10.0 * uSoftness * pixel * blur) * uFrame.y;
  float draw = max(band, 1.0);
  local.y += aPoint.y * draw;
  vec2 turned = vec2(local.x * uTurn.x - local.y * uTurn.y, local.x * uTurn.y + local.y * uTurn.x);
  gl_Position = vec4(turned / (uResolution * 0.5), 0.0, 1.0);
  vEdge = aPoint.y * draw;
  vBand = band;
  vDraw = draw;
  vAlpha = 1.0 - smoothstep(0.0, 1.0, pow(perc, 0.3)) * uTaper;
  vIndex = perc;
}`;

const LINE_FRAGMENT = `#version 300 es
precision highp float;
in float vEdge;
in float vBand;
in float vDraw;
in float vAlpha;
in float vIndex;
uniform vec3 uColor;
uniform vec3 uAccent;
out vec4 outColor;
void main() {
  float coverage = (1.0 - smoothstep(0.0, vDraw, abs(vEdge))) * (vBand / vDraw) * vAlpha;
  outColor = vec4(mix(uColor, uAccent, vIndex) * coverage, coverage);
}`;

const SCREEN_VERTEX = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const SCREEN_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uLines;
uniform vec2 uResolution;
uniform float uFade;
uniform float uOpacity;
uniform float uCurve;
out vec4 outColor;

float smootherstep(float edge, float x) {
  float t = clamp(x / edge, 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

void main() {
  vec4 lines = texture(uLines, vUv);
  float alpha = lines.a;
  vec3 color = alpha > 0.0001 ? lines.rgb / alpha : vec3(0.0);
  float mask = uOpacity;
  if (uFade > 0.0) {
    vec2 px = vUv * uResolution;
    float edge = uFade * min(uResolution.x, uResolution.y) * 0.5;
    mask *= smootherstep(edge, px.x) * smootherstep(edge, uResolution.x - px.x);
    mask *= smootherstep(edge, px.y) * smootherstep(edge, uResolution.y - px.y);
  }
  outColor = vec4(color * pow(alpha, uCurve), alpha) * mask;
}`;

const MAX_RENDER_DIM = 1920;
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
	const shader = gl.createShader(type);
	if (!shader) return null;
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
	gl.deleteShader(shader);
	return null;
}

function link(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string) {
	const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
	const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
	const program = gl.createProgram();
	if (!vertex || !fragment || !program) {
		if (vertex) gl.deleteShader(vertex);
		if (fragment) gl.deleteShader(fragment);
		if (program) gl.deleteProgram(program);
		return null;
	}
	gl.attachShader(program, vertex);
	gl.attachShader(program, fragment);
	gl.linkProgram(program);
	gl.deleteShader(vertex);
	gl.deleteShader(fragment);
	if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
	gl.deleteProgram(program);
	return null;
}

function locate<K extends string>(gl: WebGL2RenderingContext, program: WebGLProgram, names: K[]) {
	const result = {} as Record<K, WebGLUniformLocation | null>;
	for (const name of names) result[name] = gl.getUniformLocation(program, name);
	return result;
}

/**
 * Starts the effect on `canvas`, sized to `container`. Returns null when WebGL2 or the shaders
 * are unavailable, so the caller can render a static fallback instead.
 */
export function createThreads(
	container: HTMLElement,
	canvas: HTMLCanvasElement,
	overrides: Partial<ThreadsOptions> = {}
): ThreadsHandle | null {
	const merged = { ...THREADS_DEFAULTS, ...overrides };
	const s: ThreadsOptions = {
		...merged,
		lineCount: clamp(Math.round(merged.lineCount), 1, 400),
		thickness: Math.max(0, merged.thickness),
		softness: Math.max(0, merged.softness),
		waves: Math.max(0, merged.waves),
		split: clamp(merged.split, 0, 1),
		fray: clamp(merged.fray, 0, 1),
		taper: clamp(merged.taper, 0, 1),
		brightness: clamp(merged.brightness, 0.25, 2),
		fade: clamp(merged.fade, 0, 1),
		opacity: clamp(merged.opacity, 0, 1)
	};
	const color = s.color.map((v) => clamp(v, 0, 1));
	const accent = (s.accentColor ?? s.color).map((v) => clamp(v, 0, 1));

	let gl: WebGL2RenderingContext | null;
	try {
		gl = canvas.getContext('webgl2', {
			alpha: true,
			premultipliedAlpha: true,
			antialias: false,
			depth: false,
			stencil: false
		});
	} catch {
		gl = null;
	}
	if (!gl) return null;

	const lineProgram = link(gl, LINE_VERTEX, LINE_FRAGMENT);
	const screenProgram = link(gl, SCREEN_VERTEX, SCREEN_FRAGMENT);
	if (!lineProgram || !screenProgram) {
		if (lineProgram) gl.deleteProgram(lineProgram);
		if (screenProgram) gl.deleteProgram(screenProgram);
		return null;
	}
	const ctx = gl;

	const lineUniforms = locate(ctx, lineProgram, [
		'uTime',
		'uResolution',
		'uFrame',
		'uAmplitude',
		'uDistance',
		'uMouse',
		'uCount',
		'uThickness',
		'uSoftness',
		'uWaves',
		'uSplit',
		'uFray',
		'uSeed',
		'uTurn',
		'uPart',
		'uTaper',
		'uColor',
		'uAccent'
	]);
	const screenUniforms = locate(ctx, screenProgram, [
		'uLines',
		'uResolution',
		'uFade',
		'uOpacity',
		'uCurve'
	]);

	const lineVao = ctx.createVertexArray();
	const lineBuffer = ctx.createBuffer();
	ctx.bindVertexArray(lineVao);
	ctx.bindBuffer(ctx.ARRAY_BUFFER, lineBuffer);
	const pointLocation = ctx.getAttribLocation(lineProgram, 'aPoint');
	ctx.enableVertexAttribArray(pointLocation);
	ctx.vertexAttribPointer(pointLocation, 2, ctx.FLOAT, false, 0, 0);

	const screenVao = ctx.createVertexArray();
	const screenBuffer = ctx.createBuffer();
	ctx.bindVertexArray(screenVao);
	ctx.bindBuffer(ctx.ARRAY_BUFFER, screenBuffer);
	ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), ctx.STATIC_DRAW);
	const positionLocation = ctx.getAttribLocation(screenProgram, 'aPosition');
	ctx.enableVertexAttribArray(positionLocation);
	ctx.vertexAttribPointer(positionLocation, 2, ctx.FLOAT, false, 0, 0);
	ctx.bindVertexArray(null);

	const target = ctx.createTexture();
	const framebuffer = ctx.createFramebuffer();
	ctx.bindTexture(ctx.TEXTURE_2D, target);
	ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.NEAREST);
	ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx.NEAREST);
	ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.CLAMP_TO_EDGE);
	ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE);

	const motion = window.matchMedia?.(REDUCED_MOTION);
	let reduce = motion?.matches ?? false;
	let time = 0;
	let width = 1;
	let segments = 0;
	let raf = 0;
	let last = 0;
	let visible = true;
	let alive = true;

	const buildStrip = (count: number) => {
		if (count === segments) return;
		segments = count;
		const points = new Float32Array((count + 1) * 4);
		for (let i = 0; i <= count; i++) {
			const u = i / count;
			points.set([u, -1, u, 1], i * 4);
		}
		ctx.bindBuffer(ctx.ARRAY_BUFFER, lineBuffer);
		ctx.bufferData(ctx.ARRAY_BUFFER, points, ctx.STATIC_DRAW);
	};

	const render = () => {
		const w = canvas.width;
		const h = canvas.height;
		const radians = (s.angle * Math.PI) / 180;
		const cos = Math.cos(radians);
		const sin = Math.sin(radians);
		const length = Math.abs(w * cos) + Math.abs(h * sin);
		const across = Math.abs(w * sin) + Math.abs(h * cos);

		ctx.bindFramebuffer(ctx.FRAMEBUFFER, framebuffer);
		ctx.viewport(0, 0, w, h);
		ctx.clearColor(0, 0, 0, 0);
		ctx.clear(ctx.COLOR_BUFFER_BIT);
		ctx.enable(ctx.BLEND);
		ctx.blendFunc(ctx.ONE, ctx.ONE_MINUS_SRC_ALPHA);
		ctx.useProgram(lineProgram);
		ctx.uniform1f(lineUniforms.uTime, time);
		ctx.uniform2f(lineUniforms.uResolution, w, h);
		ctx.uniform2f(lineUniforms.uFrame, length, across);
		ctx.uniform1f(lineUniforms.uAmplitude, s.amplitude);
		ctx.uniform1f(lineUniforms.uDistance, s.distance);
		ctx.uniform2f(lineUniforms.uMouse, 0.5, 0.5);
		ctx.uniform1f(lineUniforms.uCount, s.lineCount);
		ctx.uniform1f(lineUniforms.uThickness, s.thickness);
		ctx.uniform1f(lineUniforms.uSoftness, s.softness);
		ctx.uniform1f(lineUniforms.uWaves, s.waves);
		ctx.uniform1f(lineUniforms.uSplit, s.split);
		ctx.uniform1f(lineUniforms.uFray, s.fray);
		ctx.uniform1f(lineUniforms.uSeed, s.seed * 13.37);
		ctx.uniform2f(lineUniforms.uTurn, cos, sin);
		ctx.uniform4f(lineUniforms.uPart, 0, 0, 0, 1);
		ctx.uniform1f(lineUniforms.uTaper, s.taper);
		ctx.uniform3f(lineUniforms.uColor, color[0], color[1], color[2]);
		ctx.uniform3f(lineUniforms.uAccent, accent[0], accent[1], accent[2]);
		ctx.bindVertexArray(lineVao);
		ctx.drawArraysInstanced(ctx.TRIANGLE_STRIP, 0, (segments + 1) * 2, s.lineCount);

		ctx.bindFramebuffer(ctx.FRAMEBUFFER, null);
		ctx.viewport(0, 0, w, h);
		ctx.disable(ctx.BLEND);
		ctx.clear(ctx.COLOR_BUFFER_BIT);
		ctx.useProgram(screenProgram);
		ctx.activeTexture(ctx.TEXTURE0);
		ctx.bindTexture(ctx.TEXTURE_2D, target);
		ctx.uniform1i(screenUniforms.uLines, 0);
		ctx.uniform2f(screenUniforms.uResolution, w, h);
		ctx.uniform1f(screenUniforms.uFade, s.fade);
		ctx.uniform1f(screenUniforms.uOpacity, s.opacity);
		ctx.uniform1f(screenUniforms.uCurve, 2 / s.brightness);
		ctx.bindVertexArray(screenVao);
		ctx.drawArrays(ctx.TRIANGLES, 0, 3);
		ctx.bindVertexArray(null);
	};

	const resize = () => {
		width = Math.max(1, container.clientWidth);
		const height = Math.max(1, container.clientHeight);
		const baseDpr = Math.min(window.devicePixelRatio || 1, 2);
		const longest = Math.max(width, height) * baseDpr;
		const dpr = longest > MAX_RENDER_DIM ? (baseDpr * MAX_RENDER_DIM) / longest : baseDpr;
		canvas.width = Math.max(1, Math.round(width * dpr));
		canvas.height = Math.max(1, Math.round(height * dpr));
		ctx.bindTexture(ctx.TEXTURE_2D, target);
		ctx.texImage2D(
			ctx.TEXTURE_2D,
			0,
			ctx.RGBA,
			canvas.width,
			canvas.height,
			0,
			ctx.RGBA,
			ctx.UNSIGNED_BYTE,
			null
		);
		ctx.bindFramebuffer(ctx.FRAMEBUFFER, framebuffer);
		ctx.framebufferTexture2D(ctx.FRAMEBUFFER, ctx.COLOR_ATTACHMENT0, ctx.TEXTURE_2D, target, 0);
		ctx.bindFramebuffer(ctx.FRAMEBUFFER, null);
		buildStrip(clamp(Math.round(width / 3), 96, 640));
		render();
	};

	const frame = (now: number) => {
		raf = 0;
		if (!alive || !visible || document.hidden || reduce) return;
		const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
		last = now;
		time += dt * s.speed;
		render();
		raf = requestAnimationFrame(frame);
	};

	const wake = () => {
		if (!raf && alive && visible && !document.hidden && !reduce) {
			last = 0;
			raf = requestAnimationFrame(frame);
		}
	};

	const sleep = () => {
		cancelAnimationFrame(raf);
		raf = 0;
	};

	const onVisibility = () => (document.hidden ? sleep() : wake());

	const onMotion = (event: MediaQueryListEvent) => {
		reduce = event.matches;
		if (reduce) {
			sleep();
			render();
		} else wake();
	};

	const resizeObserver = new ResizeObserver(resize);
	resizeObserver.observe(container);
	const intersection = new IntersectionObserver((entries) => {
		visible = entries.some((entry) => entry.isIntersecting);
		if (visible) wake();
		else sleep();
	});
	intersection.observe(container);
	document.addEventListener('visibilitychange', onVisibility);
	motion?.addEventListener('change', onMotion);
	// With reduced motion, `resize` still draws a single still frame.
	resize();
	wake();

	return {
		get running() {
			return raf !== 0;
		},
		destroy() {
			if (!alive) return;
			alive = false;
			sleep();
			resizeObserver.disconnect();
			intersection.disconnect();
			document.removeEventListener('visibilitychange', onVisibility);
			motion?.removeEventListener('change', onMotion);
			ctx.deleteFramebuffer(framebuffer);
			ctx.deleteTexture(target);
			ctx.deleteBuffer(lineBuffer);
			ctx.deleteBuffer(screenBuffer);
			ctx.deleteVertexArray(lineVao);
			ctx.deleteVertexArray(screenVao);
			ctx.deleteProgram(lineProgram);
			ctx.deleteProgram(screenProgram);
		}
	};
}
