import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Git from '../../../src/core/git/Git';
import GitTags from '../../../src/core/git/GitTags';

describe('Publication tags in merged history', () => {
    let directory: string;
    let baseline: string;
    let git: Git;

    function command(args: string[], date = '2026-01-01T00:00:00Z'): string {
        return execFileSync('git', args, {
            cwd: directory,
            encoding: 'utf8',
            env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
        }).trim();
    }

    function commit(name: string): string {
        writeFileSync(join(directory, name), name);
        command(['add', '.']);
        command(['commit', '-qm', name]);
        return command(['rev-parse', 'HEAD']);
    }

    function tag(name: string, date = '2026-01-01T00:00:00Z') {
        command(['tag', '-a', '-m', name, name], date);
    }

    function mergePublication(): string {
        command(['checkout', '-qb', 'report-buttons']);
        const publication = commit('buttons');
        tag('reports_v1.1.0.1', '2026-01-02T00:00:00Z');
        command(['checkout', '-q', 'main']);
        commit('pool-configuration');
        command(['merge', '--no-ff', '-qm', 'merge report buttons', 'report-buttons']);
        commit('layout');
        tag('ui_v1.1.0.1', '2026-01-03T00:00:00Z');
        return publication;
    }

    beforeEach(async () => {
        directory = mkdtempSync(join(tmpdir(), 'sfp-merged-tags-'));
        command(['init', '-q', '-b', 'main']);
        command(['config', 'user.name', 'Test']);
        command(['config', 'user.email', 'test@example.invalid']);
        command(['config', 'commit.gpgsign', 'false']);
        command(['config', 'tag.gpgsign', 'false']);
        command(['remote', 'add', 'origin', 'https://example.invalid/repository.git']);
        baseline = commit('baseline');
        tag('reports_v1.0.0.1');
        tag('ui_v1.0.0.1');
        jest.spyOn(Git.prototype, 'addSafeConfig').mockResolvedValue(undefined);
        git = await Git.initiateRepo(undefined, directory);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        rmSync(directory, { recursive: true, force: true });
    });

    it('includes a second-parent publication only when explicitly requested', async () => {
        const publication = mergePublication();
        expect(command(['log', '--first-parent', '--format=%H'])).not.toContain(publication);
        const reports = new GitTags(git, 'reports');
        expect(await reports.getVersionFromLatestTag()).toBe('1.0.0-1');
        expect(await reports.getVersionFromLatestTag(false)).toBe('1.0.0-1');
        expect(await reports.getVersionFromLatestTag(true)).toBe('1.1.0-1');
        expect(await new GitTags(git, 'ui').getVersionFromLatestTag(true)).toBe('1.1.0-1');
    });

    it('does not select tags outside the requested checkout history', async () => {
        mergePublication();
        command(['checkout', '-qb', 'unmerged']);
        commit('unreleased');
        tag('reports_v9.0.0.1', '2026-02-01T00:00:00Z');
        command(['checkout', '-q', 'main']);
        expect(await new GitTags(git, 'reports').getVersionFromLatestTag(true)).toBe('1.1.0-1');
        command(['checkout', '-q', '--detach', baseline]);
        expect(await new GitTags(git, 'reports').getVersionFromLatestTag(true)).toBe('1.0.0-1');
    });

    it('preserves creator-date ordering rather than choosing the highest numeric version', async () => {
        mergePublication();
        tag('reports_v1.0.0.2', '2026-02-01T00:00:00Z');
        expect(await new GitTags(git, 'reports').getVersionFromLatestTag(true)).toBe('1.0.0-2');
    });

    it('preserves annotated alignment tags and their artifact version conversion', async () => {
        mergePublication();
        command(['checkout', '-qb', 'alignment']);
        commit('aligned');
        tag('reports_v1.1.0.1-ALIGN', '2026-02-01T00:00:00Z');
        command(['checkout', '-q', 'main']);
        command(['merge', '--no-ff', '-qm', 'merge alignment', 'alignment']);
        const reports = new GitTags(git, 'reports');
        expect((await reports.listTagsOnBranch(true)).at(-1)).toBe('reports_v1.1.0.1-ALIGN');
        expect(await reports.getVersionFromLatestTag(true)).toBe('1.1.0-1');
    });

    it('does not change existing lightweight-tag eligibility', async () => {
        mergePublication();
        command(['tag', 'reports_v8.0.0.1']);
        expect(await new GitTags(git, 'reports').listTagsOnBranch(true)).not.toContain('reports_v8.0.0.1');
    });

    it('preserves missing-tag errors and does not mutate HEAD or refs', async () => {
        mergePublication();
        const head = command(['rev-parse', 'HEAD']);
        const refs = command(['show-ref']);
        await expect(new GitTags(git, 'missing').getVersionFromLatestTag(true)).rejects.toThrow(
            'Failed to find latest tag for missing'
        );
        await new GitTags(git, 'reports').getVersionFromLatestTag(true);
        expect(command(['rev-parse', 'HEAD'])).toBe(head);
        expect(command(['show-ref'])).toBe(refs);
    });

    it('keeps cleanup tag selection first-parent-only by default', async () => {
        mergePublication();
        const reports = new GitTags(git, 'reports');
        expect(await reports.listTagsOnBranch()).toEqual(['reports_v1.0.0.1']);
        expect(await reports.limitTags(1)).toEqual([]);
    });

    it('opts pool preparation into merged history without changing other callers', () => {
        const prepare = readFileSync(join(__dirname, '../../../src/impl/prepare/PrepareImpl.ts'), 'utf8');
        expect(prepare).toContain('latestGitTagVersion.getVersionFromLatestTag(true)');
    });
});
