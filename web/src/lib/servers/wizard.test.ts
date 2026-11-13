import { describe, expect, it } from 'vitest';
import { canLeave, firstBlockingStep, stepErrors, stepLabel, wizardSteps } from './wizard';

describe('wizard steps', () => {
	it('has a version and install stage for managed software only', () => {
		expect(wizardSteps('paper')).toEqual([
			'software',
			'version',
			'identity',
			'resources',
			'review',
			'install'
		]);
		expect(wizardSteps('custom')).toEqual(['software', 'identity', 'resources', 'review']);
		expect(stepLabel('version', 'curseforge')).toBe('Modpack');
		expect(stepLabel('version', 'vanilla')).toBe('Version');
	});

	it('validates only the fields owned by each step', () => {
		const errors = { name: 'bad', cpus: 'bad' };
		expect(stepErrors('identity', errors)).toEqual({ name: 'bad' });
		expect(stepErrors('resources', errors)).toEqual({ cpus: 'bad' });
		expect(stepErrors('review', errors)).toEqual({});
	});

	it('blocks leaving incomplete steps and finds the first blocking one', () => {
		const state = { kind: 'vanilla' as const, selectionComplete: false, errors: { cpus: 'x' } };
		expect(canLeave('software', { ...state, kind: null })).toBe(false);
		expect(canLeave('software', state)).toBe(true);
		expect(canLeave('version', state)).toBe(false);
		expect(canLeave('identity', state)).toBe(true);
		expect(canLeave('resources', state)).toBe(false);
		expect(firstBlockingStep(wizardSteps('vanilla'), state)).toBe('version');
		expect(
			firstBlockingStep(wizardSteps('vanilla'), { ...state, selectionComplete: true, errors: {} })
		).toBeNull();
	});
});
