import type { SoftwareKind } from '#lib/api/index.js';
import type { ServerFormErrors, ServerFormValues } from './validate.js';

/** Stages of the new-server wizard. `install` exists only for managed software. */
export type WizardStep = 'software' | 'version' | 'identity' | 'resources' | 'review' | 'install';

export function wizardSteps(kind: SoftwareKind | null): WizardStep[] {
	return kind === 'custom'
		? ['software', 'identity', 'resources', 'review']
		: ['software', 'version', 'identity', 'resources', 'review', 'install'];
}

export function stepLabel(step: WizardStep, kind: SoftwareKind | null): string {
	switch (step) {
		case 'software':
			return 'Software';
		case 'version':
			return kind === 'curseforge' ? 'Modpack' : 'Version';
		case 'identity':
			return 'Name & port';
		case 'resources':
			return 'Resources';
		case 'review':
			return 'Review';
		case 'install':
			return 'Install';
	}
}

/** Form fields validated before leaving each step. */
export const STEP_FIELDS: Partial<Record<WizardStep, readonly (keyof ServerFormValues)[]>> = {
	identity: ['name', 'port'],
	resources: ['memoryMinMb', 'memoryMaxMb', 'cpus', 'dockerImage', 'jar']
};

export function stepErrors(step: WizardStep, errors: ServerFormErrors): ServerFormErrors {
	const fields = STEP_FIELDS[step] ?? [];
	const result: ServerFormErrors = {};
	for (const field of fields) if (errors[field]) result[field] = errors[field];
	return result;
}

export interface StepState {
	kind: SoftwareKind | null;
	/** Software is fully chosen (always true for a custom JAR). */
	selectionComplete: boolean;
	errors: ServerFormErrors;
}

/** Whether the owner may continue past `step`. */
export function canLeave(step: WizardStep, state: StepState): boolean {
	switch (step) {
		case 'software':
			return state.kind !== null;
		case 'version':
			return state.selectionComplete;
		case 'identity':
		case 'resources':
			return Object.keys(stepErrors(step, state.errors)).length === 0;
		default:
			return true;
	}
}

/** First step before `review` that blocks submission, or `null` when everything is valid. */
export function firstBlockingStep(
	steps: readonly WizardStep[],
	state: StepState
): WizardStep | null {
	for (const step of steps) {
		if (step === 'review' || step === 'install') return null;
		if (!canLeave(step, state)) return step;
	}
	return null;
}
