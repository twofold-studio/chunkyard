import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import UnsavedChangesDialog from './unsaved-changes-dialog.svelte';

function setup() {
	const onStay = vi.fn();
	const onDiscard = vi.fn();
	const result = render(UnsavedChangesDialog, {
		open: true,
		title: 'Leave with unsaved file changes?',
		description: 'Edits <b>not</b> saved.',
		stayLabel: 'Stay',
		discardLabel: 'Discard and leave',
		onStay,
		onDiscard
	});
	return { onStay, onDiscard, ...result };
}

describe('UnsavedChangesDialog', () => {
	it('is an accessible alert dialog with plain-text copy', async () => {
		setup();
		const dialog = page.getByRole('alertdialog', { name: 'Leave with unsaved file changes?' });
		await expect.element(dialog).toBeVisible();
		await expect.element(dialog).toHaveTextContent('Edits <b>not</b> saved.');
		expect(dialog.element().querySelector('b')).toBeNull();
	});

	it('Stay reports only stay', async () => {
		const { onStay, onDiscard } = setup();
		await page.getByRole('button', { name: 'Stay' }).click();
		expect(onStay).toHaveBeenCalledOnce();
		expect(onDiscard).not.toHaveBeenCalled();
	});

	it('Escape counts as stay', async () => {
		const { onStay, onDiscard } = setup();
		await expect.element(page.getByRole('alertdialog')).toBeVisible();
		await userEvent.keyboard('{Escape}');
		await vi.waitFor(() => expect(onStay).toHaveBeenCalledOnce());
		expect(onDiscard).not.toHaveBeenCalled();
	});

	it('Discard reports only discard', async () => {
		const { onStay, onDiscard, rerender } = setup();
		await page.getByRole('button', { name: 'Discard and leave' }).click();
		await rerender({ open: false });
		expect(onDiscard).toHaveBeenCalledOnce();
		expect(onStay).not.toHaveBeenCalled();
	});
});
