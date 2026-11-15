import { describe, expect, it } from 'vitest';
import { diffProperties } from './diff';

describe('diffProperties', () => {
	it('reports added, removed and changed settings in a stable order', () => {
		const diff = diffProperties(
			'# v1\nmotd=Old\npvp=true\nwhite-list=false\n',
			'# v2\nmotd=New\npvp=true\nspawn-protection=0\n'
		);
		expect(diff.changes).toEqual([
			{ kind: 'changed', key: 'motd', from: 'Old', to: 'New' },
			{ kind: 'added', key: 'spawn-protection', to: '0' },
			{ kind: 'removed', key: 'white-list', from: 'false' }
		]);
		expect([diff.changed, diff.added, diff.removed, diff.textOnly]).toEqual([1, 1, 1, false]);
	});

	it('uses effective values (last duplicate wins) and unescapes like the form', () => {
		const diff = diffProperties('motd=A\nmotd=B\n', 'motd=B\n');
		expect(diff.changes).toEqual([]);
		expect(diff.textOnly).toBe(true);
		expect(diffProperties('motd=a\\u00e9\n', 'motd=aé\n').changes).toEqual([]);
	});

	it('treats comment and formatting edits as text-only, identical text as no change', () => {
		expect(diffProperties('# a\npvp=true\n', '# b\r\npvp = true\r\n').textOnly).toBe(true);
		const same = diffProperties('pvp=true\n', 'pvp=true\n');
		expect(same.changes).toEqual([]);
		expect(same.textOnly).toBe(false);
	});

	it('distinguishes an empty value from a missing key', () => {
		expect(diffProperties('level-seed=\n', '').changes).toEqual([
			{ kind: 'removed', key: 'level-seed', from: '' }
		]);
		expect(diffProperties('level-seed=1\n', 'level-seed=\n').changes).toEqual([
			{ kind: 'changed', key: 'level-seed', from: '1', to: '' }
		]);
	});
});
