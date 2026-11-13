# Third-party notices

The Chunkyard web UI includes code adapted from the projects below.

## React Bits — Threads background

- Source: <https://github.com/DavidHDev/react-bits/blob/4e0d091d3b1ea8b7aadef33716a8d99d164ae4ce/src/ts-tailwind/Backgrounds/Threads/Threads.tsx>
- Commit: `4e0d091d3b1ea8b7aadef33716a8d99d164ae4ce`
- Used in: `src/lib/components/backgrounds/threads.ts` and `threads-background.svelte` (setup page background)
- Changes: the GLSL shaders and WebGL2 render passes are unchanged. The React hooks were replaced with a framework-free start/destroy API for Svelte. Pointer interaction and CSS colour parsing were removed. Reduced-motion changes are followed at runtime, and a static fallback is shown when WebGL2 is unavailable.

The upstream license, reproduced verbatim from `LICENSE.md` at that commit:

> MIT + Commons Clause License Condition v1.0
>
> Copyright (c) 2026 David Haz
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, and distribute the Software **as part of an application, website, or product**, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> ## Commons Clause Restriction
>
> You may use this Software, including for any commercial purpose, **so long as you do not sell, sublicense, or redistribute the components themselves-whether alone, in a bundle, or as a ported version.**
>
> The same restriction covers the React Bits tools (Background Studio, Texture Lab, Shape Magic, Center Stage, Sound Lab and any tools added later) and the sounds in the sound library. **You may not sell, sublicense, or redistribute the tools or the sounds themselves, or offer the tools or a substantially similar copy of them as a hosted service-whether alone, in a bundle, or as a ported version.**
>
> What you make with the tools is yours to use. You can use exported code, images, videos, and audio files in any personal or commercial application, website, or product, including paid ones. **You may not sell or redistribute the exports on their own, either individually or as the product itself, such as a sound, texture, background, or template pack.**
>
> ## No Warranty
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.
